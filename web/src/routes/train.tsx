import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Card, ErrorBox, Loading, PageHeader, StatusBadge } from '../components/ui'
import { api } from '../lib/api'
import { ALGO_COLORS, dateTime } from '../lib/format'
import type { AlgorithmSpec, ParamSpec, Split, TrainRequest } from '../lib/types'

const SPLIT_FIELDS: [keyof Split, string][] = [
  ['train_start', 'Train from'],
  ['train_end', 'Train to'],
  ['val_start', 'Validation from'],
  ['val_end', 'Validation to'],
  ['test_start', 'Test from'],
  ['test_end', 'Test to'],
]

function ParamInput({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (spec.type === 'bool') {
    return (
      <input
        type="checkbox"
        className="toggle toggle-sm"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
    )
  }
  if (spec.type === 'choice') {
    return (
      <select
        className="select select-sm w-full"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      >
        {spec.choices?.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    )
  }
  return (
    <input
      type="number"
      className="input input-sm w-full"
      value={value == null ? '' : String(value)}
      min={spec.min ?? undefined}
      max={spec.max ?? undefined}
      step={spec.step ?? (spec.type === 'int' ? 1 : 'any')}
      placeholder={spec.nullable ? 'unlimited' : undefined}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') onChange(spec.nullable ? null : spec.default)
        else onChange(spec.type === 'int' ? parseInt(raw, 10) : parseFloat(raw))
      }}
    />
  )
}

export function TrainPage() {
  const qc = useQueryClient()
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: api.catalog, staleTime: Infinity })
  const runs = useQuery({
    queryKey: ['training-runs'],
    queryFn: api.trainingRuns,
    refetchInterval: (q) =>
      q.state.data?.some((r) => r.status === 'running' || r.status === 'queued') ? 2000 : false,
  })

  const [algoKey, setAlgoKey] = useState('random_forest')
  // Per-algorithm edits on top of the catalog defaults.
  const [overrides, setOverrides] = useState<Record<string, Record<string, unknown>>>({})
  const [zone, setZone] = useState('Ottawa')
  const [horizon, setHorizon] = useState(24)
  const [groups, setGroups] = useState<string[] | null>(null)
  const [split, setSplit] = useState<Split | null>(null)
  const [search, setSearch] = useState(0)
  const [refit, setRefit] = useState(true)
  const [name, setName] = useState('')
  const [openLog, setOpenLog] = useState<string | null>(null)

  const algo: AlgorithmSpec | undefined = useMemo(
    () => catalog.data?.algorithms.find((a) => a.key === algoKey),
    [catalog.data, algoKey],
  )
  const params: Record<string, unknown> = useMemo(
    () => ({
      ...Object.fromEntries((algo?.params ?? []).map((p) => [p.name, p.default])),
      ...overrides[algoKey],
    }),
    [algo, algoKey, overrides],
  )
  const setParam = (name: string, v: unknown) =>
    setOverrides((o) => ({ ...o, [algoKey]: { ...o[algoKey], [name]: v } }))

  const activeGroups = groups ?? catalog.data?.feature_groups.map((g) => g.key) ?? []
  const activeSplit = split ?? catalog.data?.default_split

  const train = useMutation({
    mutationFn: (req: TrainRequest) => api.train(req),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['training-runs'] }),
  })
  useEffect(() => {
    // A run that just finished means a new model.
    if (runs.data?.some((r) => r.status === 'succeeded'))
      void qc.invalidateQueries({ queryKey: ['models'] })
  }, [runs.data, qc])

  if (catalog.isLoading) return <Loading />
  if (catalog.error || !catalog.data || !activeSplit)
    return <ErrorBox error={catalog.error ?? 'catalog unavailable'} />

  const submit = () =>
    train.mutate({
      algorithm: algoKey,
      params,
      target_zone: zone,
      horizon_hours: horizon,
      feature_groups: activeGroups,
      split: activeSplit,
      search_iterations: algo?.tunable ? search : 0,
      refit_on_train_val: refit,
      name: name || undefined,
    })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Train a model"
        subtitle="Chronological split: the model learns on the training years, is tuned on the validation year and is scored once on the unseen test year."
      />
      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <Card title="1 · Algorithm">
          <div className="grid gap-2">
            {catalog.data.algorithms.map((a) => (
              <label
                key={a.key}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${algoKey === a.key ? 'border-primary bg-primary/5' : 'border-base-300'}`}
              >
                <input
                  type="radio"
                  name="algo"
                  className="radio radio-sm mt-0.5"
                  checked={algoKey === a.key}
                  onChange={() => setAlgoKey(a.key)}
                />
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: ALGO_COLORS[a.key] }}
                    />
                    {a.label}
                    {a.tags.includes('primary') && (
                      <span className="badge badge-xs badge-primary">primary</span>
                    )}
                    {a.tags.includes('baseline') && (
                      <span className="badge badge-xs">baseline</span>
                    )}
                  </span>
                  <span className="text-base-content/60 block text-xs">{a.description}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title={`2 · ${algo?.label ?? ''} hyperparameters`}>
            {algo && algo.params.length === 0 && <p className="text-sm">No hyperparameters.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {algo?.params.map((p) => (
                <label key={p.name} className="block">
                  <span className="mb-1 flex items-center justify-between text-xs font-medium">
                    <code>{p.name}</code>
                    {p.tunable && <span className="badge badge-ghost badge-xs">tunable</span>}
                  </span>
                  <ParamInput
                    spec={p}
                    value={params[p.name]}
                    onChange={(v) => setParam(p.name, v)}
                  />
                  <span className="text-base-content/60 mt-1 block text-xs">{p.description}</span>
                </label>
              ))}
            </div>
            {algo?.tunable && (
              <label className="mt-2 block">
                <span className="text-xs font-medium">
                  Random search iterations (0 = use the values above)
                </span>
                <input
                  type="range"
                  min={0}
                  max={30}
                  value={search}
                  className="range range-sm my-1 block w-full"
                  onChange={(e) => setSearch(Number(e.target.value))}
                />
                <span className="text-base-content/60 text-xs">
                  {search
                    ? `Tries ${search} random settings of the tunable parameters and keeps the one with the lowest validation MAE.`
                    : 'Off'}
                </span>
              </label>
            )}
          </Card>

          <Card title="3 · Target, features and split">
            <div className="grid gap-3 sm:grid-cols-3">
              <label>
                <span className="text-xs font-medium">Zone</span>
                <select
                  className="select select-sm w-full"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                >
                  {catalog.data.zones.map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-xs font-medium">Horizon (hours)</span>
                <select
                  className="select select-sm w-full"
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                >
                  <option value={1}>1 — next hour</option>
                  <option value={24}>24 — day ahead</option>
                  <option value={48}>48 — two days</option>
                  <option value={168}>168 — week ahead</option>
                </select>
              </label>
              <label>
                <span className="text-xs font-medium">Model name (optional)</span>
                <input
                  className="input input-sm w-full"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </div>
            <p className="text-base-content/60 text-xs">
              The horizon is the shortest lag of past demand the model may use. 24 h lets it
              forecast a whole day at once; longer windows are forecast recursively.
            </p>
            <div className="flex flex-wrap gap-2">
              {catalog.data.feature_groups.map((g) => (
                <label key={g.key} className="tooltip" data-tip={g.description}>
                  <span
                    className={`btn btn-xs ${activeGroups.includes(g.key) ? 'btn-primary' : 'btn-outline'}`}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={activeGroups.includes(g.key)}
                      onChange={(e) =>
                        setGroups(
                          e.target.checked
                            ? [...activeGroups, g.key]
                            : activeGroups.filter((x) => x !== g.key),
                        )
                      }
                    />
                    {g.key}
                  </span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SPLIT_FIELDS.map(([k, label]) => (
                <label key={k}>
                  <span className="text-xs font-medium">{label}</span>
                  <input
                    type="date"
                    className="input input-sm w-full"
                    value={activeSplit[k]}
                    onChange={(e) => setSplit({ ...activeSplit, [k]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={refit}
                onChange={(e) => setRefit(e.target.checked)}
              />
              Refit on train + validation before scoring the test year (recommended for live
              forecasts)
            </label>
            <div className="flex items-center gap-3">
              <button
                className="btn btn-primary"
                disabled={train.isPending || activeGroups.length === 0}
                onClick={submit}
              >
                {train.isPending && <span className="loading loading-spinner loading-xs" />}
                Train {algo?.label}
              </button>
              {train.error && <ErrorBox error={train.error} />}
            </div>
          </Card>
        </div>
      </div>

      <Card title="Training runs">
        {runs.isLoading ? (
          <Loading />
        ) : runs.error ? (
          <ErrorBox error={runs.error} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-sm table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Algorithm</th>
                  <th>Zone / horizon</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.data?.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap">{dateTime(r.created_at)}</td>
                    <td>{r.algorithm}</td>
                    <td>
                      {r.request.target_zone} · {r.request.horizon_hours} h
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                      {r.error && <div className="text-error mt-1 max-w-md text-xs">{r.error}</div>}
                      {openLog === r.id && (
                        <pre className="bg-base-200 mt-2 max-w-xl overflow-x-auto rounded p-2 text-xs whitespace-pre-wrap">
                          {r.log}
                        </pre>
                      )}
                    </td>
                    <td className="space-x-2 whitespace-nowrap">
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => setOpenLog(openLog === r.id ? null : r.id)}
                      >
                        log
                      </button>
                      {r.model_id && (
                        <Link
                          to="/models/$modelId"
                          params={{ modelId: r.model_id }}
                          className="btn btn-outline btn-xs"
                        >
                          model
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
