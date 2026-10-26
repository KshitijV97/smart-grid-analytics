import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { HBar } from '../components/charts'
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { ALGO_COLORS, dateTime, num1, num2, pct } from '../lib/format'
import type { ModelSummary } from '../lib/types'

type MetricKey = 'mae' | 'rmse' | 'mape' | 'r2'
const METRICS: { key: MetricKey; label: string; better: 'lower' | 'higher' }[] = [
  { key: 'mape', label: 'MAPE (%)', better: 'lower' },
  { key: 'mae', label: 'MAE (MW)', better: 'lower' },
  { key: 'rmse', label: 'RMSE (MW)', better: 'lower' },
  { key: 'r2', label: 'R²', better: 'higher' },
]

export function ModelsPage() {
  const models = useQuery({ queryKey: ['models'], queryFn: api.models })
  const [metric, setMetric] = useState<MetricKey>('mape')
  const [zone, setZone] = useState('Ottawa')

  if (models.isLoading) return <Loading />
  if (models.error) return <ErrorBox error={models.error} />
  const all = models.data ?? []
  const rows = all.filter((m) => m.target_zone === zone)
  const scored = (m: ModelSummary) => m.test?.[metric] ?? m.validation?.[metric]
  const chart = rows
    .filter((m) => scored(m) != null)
    .map((m) => ({ label: m.name, value: scored(m) as number, color: ALGO_COLORS[m.algorithm] }))
    .sort((a, b) =>
      METRICS.find((x) => x.key === metric)?.better === 'lower'
        ? a.value - b.value
        : b.value - a.value,
    )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Models"
        subtitle="Scores on the held-out test year (validation year when no test data). Base load = daily minimum hourly load."
      />
      <div className="flex flex-wrap gap-2">
        <div className="join">
          {['Ottawa', 'Ontario'].map((z) => (
            <button
              key={z}
              className={`join-item btn btn-sm ${zone === z ? 'btn-primary' : ''}`}
              onClick={() => setZone(z)}
            >
              {z}
            </button>
          ))}
        </div>
        <div className="join">
          {METRICS.map((m) => (
            <button
              key={m.key}
              className={`join-item btn btn-sm ${metric === m.key ? 'btn-primary' : ''}`}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <Card
        title={`Test ${METRICS.find((m) => m.key === metric)?.label} — ${METRICS.find((m) => m.key === metric)?.better} is better`}
      >
        <HBar data={chart} valueFormat={(v) => v.toFixed(metric === 'r2' ? 3 : 2)} />
      </Card>
      <Card title="All models">
        {rows.length === 0 ? (
          <p className="text-sm">
            No {zone} models yet.{' '}
            <Link to="/train" className="link">
              Train one
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-sm table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Horizon</th>
                  <th className="text-right">Val MAPE</th>
                  <th className="text-right">Test MAE</th>
                  <th className="text-right">Test RMSE</th>
                  <th className="text-right">Test MAPE</th>
                  <th className="text-right">Test R²</th>
                  <th className="text-right">Base-load MAE</th>
                  <th className="text-right">Train s</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link
                        to="/models/$modelId"
                        params={{ modelId: m.id }}
                        className="link flex items-center gap-2"
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ background: ALGO_COLORS[m.algorithm] }}
                        />
                        {m.name}
                      </Link>
                    </td>
                    <td>{m.horizon_hours} h</td>
                    <td className="text-right tabular-nums">{pct(m.validation?.mape)}</td>
                    <td className="text-right tabular-nums">{num1(m.test?.mae)}</td>
                    <td className="text-right tabular-nums">{num1(m.test?.rmse)}</td>
                    <td className="text-right tabular-nums">{pct(m.test?.mape)}</td>
                    <td className="text-right tabular-nums">{num2(m.test?.r2)}</td>
                    <td className="text-right tabular-nums">{num1(m.test_baseload?.mae)}</td>
                    <td className="text-right tabular-nums">{num1(m.train_seconds)}</td>
                    <td className="whitespace-nowrap">{dateTime(m.created_at)}</td>
                    <td>
                      <Link
                        to="/forecast"
                        search={{ model: m.id }}
                        className="btn btn-outline btn-xs"
                      >
                        forecast
                      </Link>
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
