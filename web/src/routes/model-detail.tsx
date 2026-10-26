import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { HBar, TimeLine } from '../components/charts'
import { Card, ErrorBox, Loading, PageHeader, Stat } from '../components/ui'
import { api } from '../lib/api'
import { SERIES, addDays, isoDay, num1, num2, pct } from '../lib/format'
import type { Breakdown, Metrics } from '../lib/types'

function MetricRow({ label, m }: { label: string; m?: Metrics | null }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="text-right tabular-nums">{m?.n ?? '—'}</td>
      <td className="text-right tabular-nums">{num1(m?.mae)}</td>
      <td className="text-right tabular-nums">{num1(m?.rmse)}</td>
      <td className="text-right tabular-nums">{pct(m?.mape)}</td>
      <td className="text-right tabular-nums">{num2(m?.r2)}</td>
      <td className="text-right tabular-nums">{num1(m?.bias)}</td>
    </tr>
  )
}

function BreakdownTable({ b }: { b: Breakdown }) {
  return (
    <div className="overflow-x-auto">
      <table className="table-sm table">
        <thead>
          <tr>
            <th>Slice</th>
            <th className="text-right">Hours</th>
            <th className="text-right">MAE</th>
            <th className="text-right">RMSE</th>
            <th className="text-right">MAPE</th>
            <th className="text-right">R²</th>
            <th className="text-right">Bias</th>
          </tr>
        </thead>
        <tbody>
          <MetricRow label="Overall (hourly)" m={b.overall} />
          {['winter', 'spring', 'summer', 'fall'].map((s) => (
            <MetricRow key={s} label={`Season: ${s}`} m={b.by_season[s]} />
          ))}
          <MetricRow label="On-peak (workdays 07–23)" m={b.on_peak} />
          <MetricRow label="Off-peak" m={b.off_peak} />
          <MetricRow label="Holidays" m={b.holidays} />
          <MetricRow label="Daily base load (min)" m={b.daily_baseload} />
          <MetricRow label="Daily peak (max)" m={b.daily_peak} />
        </tbody>
      </table>
    </div>
  )
}

export function ModelDetailPage() {
  const { modelId } = useParams({ from: '/models/$modelId' })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const model = useQuery({ queryKey: ['model', modelId], queryFn: () => api.model(modelId) })
  const [split, setSplit] = useState<'test' | 'validation'>('test')
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const range = useMemo(() => {
    const s = model.data?.split
    const from = weekStart ?? (split === 'test' ? s?.test_start : s?.val_start)
    return from ? { start: from, end: isoDay(addDays(new Date(`${from}T12:00:00`), 14)) } : null
  }, [model.data, split, weekStart])
  const backtest = useQuery({
    queryKey: ['backtest', modelId, split, range?.start],
    queryFn: () => api.backtest(modelId, { split, ...range! }),
    enabled: !!range,
  })
  const del = useMutation({
    mutationFn: () => api.deleteModel(modelId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['models'] })
      void navigate({ to: '/models' })
    },
  })

  if (model.isLoading) return <Loading />
  if (model.error || !model.data) return <ErrorBox error={model.error ?? 'not found'} />
  const m = model.data
  const b = split === 'test' ? m.metrics.test : m.metrics.validation
  const naive = split === 'test' ? m.metrics.naive_weekly?.test : m.metrics.naive_weekly?.validation
  const bt = backtest.data ?? []
  const series = [
    {
      id: 'Actual',
      color: SERIES.orange,
      points: bt.map((p) => ({ x: new Date(p.ts), y: p.actual })),
    },
    {
      id: 'Predicted',
      color: SERIES.blue,
      points: bt.map((p) => ({ x: new Date(p.ts), y: p.predicted })),
    },
  ]
  const top = m.feature_importance
    .slice(0, 20)
    .map((f) => ({ label: f.feature, value: f.importance * 100 }))
  const hourly = (b?.by_hour_mae ?? []).map((v, h) => ({
    label: `${String(h).padStart(2, '0')}:00`,
    value: v,
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title={m.name}
        subtitle={
          <>
            {m.algorithm} · {m.target_zone} · {m.horizon_hours} h horizon · {m.features.length}{' '}
            features ·{' '}
            <Link to="/forecast" search={{ model: m.id }} className="link">
              forecast with this model
            </Link>
          </>
        }
      />
      <div className="join">
        {(['test', 'validation'] as const).map((s) => (
          <button
            key={s}
            className={`join-item btn btn-sm ${split === s ? 'btn-primary' : ''}`}
            onClick={() => {
              setSplit(s)
              setWeekStart(null)
            }}
          >
            {s === 'test' ? 'Test year' : 'Validation year'}
          </button>
        ))}
      </div>
      {!b ? (
        <div className="alert alert-warning alert-soft">No {split} data for this model.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat
              label="MAPE"
              value={pct(b.overall.mape)}
              hint={naive ? `naive “same hour last week”: ${pct(naive.mape)}` : undefined}
            />
            <Stat label="MAE" value={`${num1(b.overall.mae)} MW`} />
            <Stat label="RMSE" value={`${num1(b.overall.rmse)} MW`} />
            <Stat label="R²" value={num2(b.overall.r2)} />
            <Stat
              label="Base-load MAE"
              value={`${num1(b.daily_baseload.mae)} MW`}
              hint="daily minimum"
            />
          </div>
          <Card
            title="Actual vs predicted (two weeks)"
            actions={
              <input
                type="date"
                className="input input-sm"
                value={range?.start ?? ''}
                min={split === 'test' ? m.split.test_start : m.split.val_start}
                max={split === 'test' ? m.split.test_end : m.split.val_end}
                onChange={(e) => setWeekStart(e.target.value)}
              />
            }
          >
            {backtest.isLoading ? <Loading /> : <TimeLine series={series} yLabel="MW" />}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Error breakdown">
              <BreakdownTable b={b} />
            </Card>
            <Card title="Mean absolute error by hour of day (MW)">
              <HBar data={hourly} valueFormat={(v) => v.toFixed(1)} color={SERIES.blue} />
            </Card>
          </div>
        </>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top 20 features (share of importance, %)">
          <HBar data={top} valueFormat={(v) => v.toFixed(1)} color={SERIES.blue} />
        </Card>
        <Card title="Hyperparameters and split">
          <pre className="bg-base-200 overflow-x-auto rounded p-3 text-xs">
            {JSON.stringify({ params: m.params, split: m.split }, null, 2)}
          </pre>
          <div>
            <button
              className="btn btn-error btn-outline btn-sm"
              disabled={del.isPending}
              onClick={() => confirm(`Delete model “${m.name}”?`) && del.mutate()}
            >
              Delete model
            </button>
            {del.error && <ErrorBox error={del.error} />}
          </div>
        </Card>
      </div>
    </div>
  )
}
