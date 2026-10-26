import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { TimeLine } from '../components/charts'
import { Card, ErrorBox, Loading, PageHeader, Stat } from '../components/ui'
import { api } from '../lib/api'
import { SERIES, addDays, dateTime, isoDay, mw } from '../lib/format'

const RANGES = { '7d': 7, '30d': 30, '1y': 365 } as const

export function OverviewPage() {
  const [zone, setZone] = useState('Ottawa')
  const [range, setRange] = useState<keyof typeof RANGES>('7d')
  const coverage = useQuery({ queryKey: ['coverage'], queryFn: api.coverage })
  const lastLoad = coverage.data?.find((c) => c.source === 'ieso_zonal_demand')?.last_ts
  const end = lastLoad ? addDays(new Date(lastLoad), 1) : new Date()
  const start = addDays(end, -RANGES[range])
  const series = useQuery({
    queryKey: ['series', zone, isoDay(start), isoDay(end)],
    queryFn: () => api.series({ zone, start: isoDay(start), end: isoDay(end) }),
    enabled: coverage.isSuccess,
  })
  const models = useQuery({ queryKey: ['models'], queryFn: api.models })

  const charts = useMemo(() => {
    const pts = series.data?.points ?? []
    const x = (ts: string) => new Date(ts)
    const loads = pts.filter((p) => p.load_mw != null)
    return {
      daily: series.data?.resolution === 'day',
      load: [
        {
          id: `${zone} demand`,
          color: SERIES.blue,
          points: pts.map((p) => ({ x: x(p.ts), y: p.load_mw })),
        },
      ],
      temp: [
        {
          id: 'Temperature',
          color: SERIES.orange,
          points: pts.map((p) => ({ x: x(p.ts), y: p.temperature_c })),
        },
      ],
      gen: [
        {
          id: 'Ontario wind',
          color: SERIES.aqua,
          points: pts.map((p) => ({ x: x(p.ts), y: p.wind_mw })),
        },
        {
          id: 'Ontario solar',
          color: SERIES.yellow,
          points: pts.map((p) => ({ x: x(p.ts), y: p.solar_mw })),
        },
      ],
      latest: loads.at(-1),
      peak: Math.max(...loads.map((p) => p.load_mw as number)),
      min: Math.min(...loads.map((p) => p.load_mw as number)),
    }
  }, [series.data, zone])

  if (coverage.error) return <ErrorBox error={coverage.error} />
  const empty = coverage.data && !lastLoad

  return (
    <div className="space-y-4">
      <PageHeader
        title="Overview"
        subtitle="Observed IESO demand, weather and Ontario renewable output from the warehouse."
      />
      {empty && (
        <div className="alert alert-info alert-soft">
          The warehouse is empty. Go to{' '}
          <Link to="/data" className="link">
            Data
          </Link>{' '}
          and run a backfill first.
        </div>
      )}
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
          {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
            <button
              key={r}
              className={`join-item btn btn-sm ${range === r ? 'btn-primary' : ''}`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Latest hourly demand"
          value={mw(charts.latest?.load_mw)}
          hint={dateTime(charts.latest?.ts)}
        />
        <Stat
          label={`Peak (${range})`}
          value={Number.isFinite(charts.peak) ? mw(charts.peak) : '—'}
        />
        <Stat
          label={`Minimum / base load (${range})`}
          value={Number.isFinite(charts.min) ? mw(charts.min) : '—'}
        />
        <Stat
          label="Trained models"
          value={models.data?.length ?? '—'}
          hint={
            <Link to="/models" className="link">
              compare models
            </Link>
          }
        />
      </div>
      {series.isLoading ? (
        <Loading />
      ) : series.error ? (
        <ErrorBox error={series.error} />
      ) : (
        <>
          <Card title={`${zone} hourly demand`}>
            <TimeLine series={charts.load} yLabel="MW" daily={charts.daily} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={`Temperature (${zone === 'Ottawa' ? 'Ottawa' : 'Toronto'})`}>
              <TimeLine series={charts.temp} yLabel="°C" height={260} daily={charts.daily} />
            </Card>
            <Card title="Ontario wind and solar output (IESO, transmission-connected)">
              <TimeLine
                series={charts.gen}
                yLabel="MW"
                height={260}
                daily={charts.daily}
                yMin={0}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
