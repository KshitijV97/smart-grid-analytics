import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, ErrorBox, Loading, PageHeader, StatusBadge } from '../components/ui'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'

const SOURCE_INFO: Record<string, { label: string; detail: string }> = {
  ieso_demand: {
    label: 'IESO zonal demand',
    detail: 'Hourly MW for Ottawa, Ontario and the other 8 zones (reports-public.ieso.ca)',
  },
  ieso_fuel: {
    label: 'IESO output by fuel',
    detail: 'Hourly Ontario wind, solar, hydro, nuclear, gas output',
  },
  weather_archive: {
    label: 'Open-Meteo history',
    detail: 'ERA5 reanalysis: temperature, humidity, wind at 10/100 m, irradiance, snow, cloud',
  },
  weather_forecast: {
    label: 'Open-Meteo forecast',
    detail: '16-day hourly weather forecast used for live predictions',
  },
  eccc: {
    label: 'ECCC Ottawa Intl',
    detail: 'Environment Canada station observations, for cross-checking weather',
  },
  holidays: { label: 'Ontario holidays', detail: 'Statutory + Civic Holiday, computed locally' },
}

export function DataPage() {
  const qc = useQueryClient()
  const coverage = useQuery({ queryKey: ['coverage'], queryFn: api.coverage })
  const runs = useQuery({
    queryKey: ['ingestion-runs'],
    queryFn: api.ingestionRuns,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running') ? 3000 : false),
  })
  const [sources, setSources] = useState<string[]>([])
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const ingest = useMutation({
    mutationFn: () =>
      api.ingest({
        sources: sources.length ? sources : undefined,
        start: start || undefined,
        end: end || undefined,
      }),
    onSuccess: () => {
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['ingestion-runs'] }), 1000)
    },
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Data warehouse"
        subtitle="All sources are free and public. Times are stored in UTC; IESO's EST hour-ending convention is converted on ingest."
      />
      <Card title="Coverage">
        {coverage.isLoading ? (
          <Loading />
        ) : coverage.error ? (
          <ErrorBox error={coverage.error} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-sm table">
              <thead>
                <tr>
                  <th>Table / source</th>
                  <th className="text-right">Rows</th>
                  <th>From</th>
                  <th>To</th>
                </tr>
              </thead>
              <tbody>
                {coverage.data?.map((c) => (
                  <tr key={c.source}>
                    <td>{c.source}</td>
                    <td className="text-right tabular-nums">{c.rows.toLocaleString()}</td>
                    <td>{dateTime(c.first_ts)}</td>
                    <td>{dateTime(c.last_ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Pull data">
        <p className="text-base-content/70 text-sm">
          Leave dates empty for an incremental update (last stored hour minus 10 days → today). For
          the first run, set a start such as <code>2019-12-01</code>: a full backfill takes several
          minutes. A scheduler also runs the incremental update daily.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(SOURCE_INFO).map(([key, info]) => (
            <label
              key={key}
              className="border-base-300 hover:bg-base-200 flex cursor-pointer gap-3 rounded-lg border p-3"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-sm mt-0.5"
                checked={sources.includes(key)}
                onChange={(e) =>
                  setSources((s) => (e.target.checked ? [...s, key] : s.filter((x) => x !== key)))
                }
              />
              <span>
                <span className="block text-sm font-medium">{info.label}</span>
                <span className="text-base-content/60 block text-xs">{info.detail}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="form-control">
            <span className="label text-xs">Start (optional)</span>
            <input
              type="date"
              className="input input-sm"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="form-control">
            <span className="label text-xs">End (optional)</span>
            <input
              type="date"
              className="input input-sm"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary btn-sm"
            disabled={ingest.isPending}
            onClick={() => ingest.mutate()}
          >
            {ingest.isPending && <span className="loading loading-spinner loading-xs" />}
            Run {sources.length ? `${sources.length} source(s)` : 'all sources'}
          </button>
        </div>
        {ingest.isSuccess && (
          <div className="alert alert-success alert-soft text-sm">
            Started. Progress shows below.
          </div>
        )}
        {ingest.error && <ErrorBox error={ingest.error} />}
      </Card>

      <Card title="Ingestion runs">
        {runs.isLoading ? (
          <Loading />
        ) : runs.error ? (
          <ErrorBox error={runs.error} />
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="table-sm table-pin-rows table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th className="text-right">Rows</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {runs.data?.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{dateTime(r.started_at)}</td>
                    <td>{r.source}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="text-right tabular-nums">{r.rows_upserted.toLocaleString()}</td>
                    <td className="max-w-md truncate text-xs" title={r.message ?? ''}>
                      {r.message}
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
