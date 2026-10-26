import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { TimeLine, type TimeSeries } from '../components/charts'
import { Card, ErrorBox, Loading, PageHeader, Stat } from '../components/ui'
import { api } from '../lib/api'
import { SERIES, mw, mwh, pct } from '../lib/format'
import type { ForecastResult, Scenario } from '../lib/types'

const HOURS = [24, 48, 72, 168, 336]

const SCENARIO_FIELDS: { key: keyof Scenario; label: string; step?: number }[] = [
  { key: 'solar_mw_ac', label: 'Solar farm (MW AC)' },
  { key: 'wind_mw', label: 'Wind farm (MW)' },
  { key: 'ev_count', label: 'EV fleet (vehicles)', step: 10 },
  { key: 'ev_kwh_per_day', label: 'kWh per EV per workday' },
  { key: 'ev_charger_kw', label: 'Charger power (kW)', step: 0.1 },
  { key: 'ev_charge_start_hour', label: 'Charging starts (hour)' },
]

function line(
  r: ForecastResult,
  id: string,
  color: string,
  pick: (p: ForecastResult['points'][number]) => number | null | undefined,
): TimeSeries {
  return { id, color, points: r.points.map((p) => ({ x: new Date(p.ts), y: pick(p) ?? null })) }
}

export function ForecastPage() {
  const search = useSearch({ from: '/forecast' })
  const navigate = useNavigate({ from: '/forecast' })
  const models = useQuery({ queryKey: ['models'], queryFn: api.models })
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: api.catalog, staleTime: Infinity })
  const modelId = search.model ?? models.data?.[0]?.id ?? ''
  const [start, setStart] = useState('')
  const [hours, setHours] = useState(48)
  const [useScenario, setUseScenario] = useState(false)
  const [scenario, setScenario] = useState<Scenario | null>(null)
  // Start from the Phase 1 scenario: 10 MW solar, 20 MW wind, 300 fleet EVs.
  const scen =
    scenario ??
    (catalog.data
      ? { ...catalog.data.scenario_defaults, solar_mw_ac: 10, wind_mw: 20, ev_count: 300 }
      : null)

  const run = useMutation({
    mutationFn: () =>
      api.forecast({
        model_id: modelId,
        start: start || undefined,
        hours,
        scenario: useScenario ? scen : null,
      }),
  })
  const r = run.data

  const charts = useMemo(() => {
    if (!r) return null
    const hasActual = r.points.some((p) => p.actual_mw != null)
    const hasScenario = r.points.some((p) => p.net_load_mw != null)
    return {
      split: [
        line(r, 'Base load', SERIES.blue, (p) => p.baseload_mw),
        line(r, 'Variable load', SERIES.aqua, (p) => p.variable_mw),
      ],
      accuracy: [
        line(r, 'Forecast', SERIES.blue, (p) => p.predicted_mw),
        line(r, '80% band low', SERIES.violet, (p) => p.lower_mw),
        line(r, '80% band high', SERIES.magenta, (p) => p.upper_mw),
        ...(hasActual ? [line(r, 'Actual', SERIES.orange, (p) => p.actual_mw)] : []),
      ],
      net: hasScenario
        ? [
            line(r, 'Forecast demand', SERIES.blue, (p) => p.predicted_mw),
            line(r, 'Net load', SERIES.orange, (p) => p.net_load_mw),
          ]
        : null,
      gen: hasScenario
        ? [
            line(r, 'Solar farm', SERIES.yellow, (p) => p.solar_mw),
            line(r, 'Wind farm', SERIES.aqua, (p) => p.wind_mw),
            line(r, 'EV charging', SERIES.violet, (p) => p.ev_mw),
          ]
        : null,
      temp: [line(r, 'Temperature', SERIES.orange, (p) => p.temperature_c)],
    }
  }, [r])

  if (models.isLoading || catalog.isLoading) return <Loading />
  if (models.error) return <ErrorBox error={models.error} />
  if (!models.data?.length)
    return (
      <div className="alert alert-info alert-soft">
        No trained models yet.{' '}
        <Link to="/train" className="link">
          Train one first.
        </Link>
      </div>
    )

  const days = r?.daily ?? []
  const fullDays = days.filter((d) => d.hours >= 23)
  const peak = Math.max(...days.map((d) => d.peak_mw ?? 0))
  const base = Math.min(...fullDays.map((d) => d.baseload_mw ?? Infinity))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Forecast"
        subtitle="Hourly demand from a trained model, split into base load (that day's minimum, always on) and variable load (everything above it)."
      />
      <Card>
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[3fr_2fr_1fr_auto]">
          <label>
            <span className="text-xs font-medium">Model</span>
            <select
              className="select select-sm w-full"
              value={modelId}
              onChange={(e) => void navigate({ search: { model: e.target.value } })}
            >
              {models.data.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — test MAPE {pct(m.test?.mape)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-xs font-medium">
              Start (Ottawa time; empty = right after the latest data)
            </span>
            <input
              type="datetime-local"
              step={3600}
              className="input input-sm w-full"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            <span className="text-xs font-medium">Hours</span>
            <select
              className="select select-sm w-full"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} h ({h / 24} d)
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-primary btn-sm"
            disabled={!modelId || run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending && <span className="loading loading-spinner loading-xs" />}
            Forecast
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={useScenario}
            onChange={(e) => setUseScenario(e.target.checked)}
          />
          Scenario: add a hypothetical solar farm, wind farm and EV fleet (net load = demand − solar
          − wind + EV)
        </label>
        {useScenario && scen && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {SCENARIO_FIELDS.map((f) => (
              <label key={f.key}>
                <span className="text-xs font-medium">{f.label}</span>
                <input
                  type="number"
                  min={0}
                  step={f.step ?? 1}
                  className="input input-sm w-full"
                  value={scen[f.key]}
                  onChange={(e) => setScenario({ ...scen, [f.key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
        )}
      </Card>

      {run.error && <ErrorBox error={run.error} />}
      {r && charts && (
        <>
          {r.notes.map((n) => (
            <div key={n} className="alert alert-soft text-sm">
              {n}
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Peak demand" value={mw(peak)} />
            <Stat
              label="Lowest daily base load"
              value={Number.isFinite(base) ? mw(base) : '—'}
              hint="full days only"
            />
            <Stat label="Energy" value={mwh(days.reduce((s, d) => s + (d.energy_mwh ?? 0), 0))} />
            <Stat
              label="Accuracy vs actual"
              value={r.accuracy ? pct(r.accuracy.mape) : 'n/a'}
              hint={
                r.accuracy
                  ? `MAPE over ${r.accuracy.n} h with known demand`
                  : 'future hours: no actuals yet'
              }
            />
          </div>
          <Card title="Base load and variable load (stacked = total forecast)">
            <TimeLine series={charts.split} yLabel="MW" stacked area yMin={0} />
          </Card>
          <Card title="Forecast with 80% band from validation errors">
            <TimeLine series={charts.accuracy} yLabel="MW" />
          </Card>
          {charts.net && charts.gen && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Demand vs net load">
                <TimeLine series={charts.net} yLabel="MW" height={280} />
              </Card>
              <Card title="Scenario solar, wind and EV charging">
                <TimeLine series={charts.gen} yLabel="MW" height={280} yMin={0} />
              </Card>
            </div>
          )}
          <Card title="Temperature used (forecast or climatology)">
            <TimeLine series={charts.temp} yLabel="°C" height={220} />
          </Card>
          <Card title="Daily summary">
            <div className="overflow-x-auto">
              <table className="table-sm table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="text-right">Hours</th>
                    <th className="text-right">Peak</th>
                    <th className="text-right">Peak hour</th>
                    <th className="text-right">Base load</th>
                    <th className="text-right">Energy</th>
                    <th className="text-right">Variable energy</th>
                    <th className="text-right">Actual peak</th>
                    <th className="text-right">Actual base</th>
                    {r.scenario && <th className="text-right">Net peak</th>}
                    {r.scenario && <th className="text-right">Net base</th>}
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td className="text-right">{d.hours}</td>
                      <td className="text-right tabular-nums">{mw(d.peak_mw)}</td>
                      <td className="text-right tabular-nums">
                        {String(d.peak_hour).padStart(2, '0')}:00
                      </td>
                      <td className="text-right tabular-nums">{mw(d.baseload_mw)}</td>
                      <td className="text-right tabular-nums">{mwh(d.energy_mwh)}</td>
                      <td className="text-right tabular-nums">{mwh(d.variable_energy_mwh)}</td>
                      <td className="text-right tabular-nums">{mw(d.actual_peak_mw)}</td>
                      <td className="text-right tabular-nums">{mw(d.actual_baseload_mw)}</td>
                      {r.scenario && (
                        <td className="text-right tabular-nums">{mw(d.net_peak_mw)}</td>
                      )}
                      {r.scenario && (
                        <td className="text-right tabular-nums">{mw(d.net_baseload_mw)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
