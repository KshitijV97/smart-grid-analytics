import { ResponsiveBar } from '@nivo/bar'
import { ResponsiveLine, type LineSeries } from '@nivo/line'
import { useMemo } from 'react'

// Recessive axes and grid; text stays in ink colours, never the series colour.
const nivoTheme = {
  text: { fill: 'var(--color-base-content)', fontSize: 11 },
  axis: {
    domain: { line: { stroke: 'transparent' } },
    ticks: { line: { stroke: 'transparent' }, text: { fill: 'currentColor', opacity: 0.7 } },
    legend: { text: { fill: 'currentColor', opacity: 0.8, fontSize: 12 } },
  },
  grid: { line: { stroke: 'currentColor', strokeOpacity: 0.08 } },
  crosshair: { line: { stroke: 'currentColor', strokeOpacity: 0.5 } },
  legends: { text: { fill: 'currentColor' } },
  tooltip: {
    container: {
      background: 'var(--color-base-100)',
      color: 'var(--color-base-content)',
      fontSize: 12,
      borderRadius: 6,
      boxShadow: '0 2px 10px rgba(0,0,0,.15)',
    },
  },
}

export type TimeSeries = {
  id: string
  color: string
  points: { x: Date; y: number | null }[]
}

type TimeLineProps = {
  series: TimeSeries[]
  yLabel: string
  height?: number
  stacked?: boolean
  area?: boolean
  daily?: boolean
  yMin?: number | 'auto'
}

const tzFmt = (withHour: boolean) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    ...(withHour ? { month: 'short', day: 'numeric', hour: '2-digit' } : { dateStyle: 'medium' }),
  })

/** Line chart on a time axis with a crosshair tooltip listing every series. */
export function TimeLine({
  series,
  yLabel,
  height = 320,
  stacked = false,
  area = false,
  daily = false,
  yMin = 'auto',
}: TimeLineProps) {
  const data: LineSeries[] = useMemo(
    () => series.map((s) => ({ id: s.id, data: s.points.map((p) => ({ x: p.x, y: p.y })) })),
    [series],
  )
  const colors = series.map((s) => s.color)
  const xs = series.flatMap((s) => s.points.map((p) => p.x.getTime()))
  const spanDays = xs.length ? (Math.max(...xs) - Math.min(...xs)) / 86_400_000 : 0
  // Hours only matter on short windows; long windows label dates.
  const tickFmt = tzFmt(!daily && spanDays <= 3)
  const fmt = tzFmt(!daily)
  if (!series.some((s) => s.points.length)) {
    return <EmptyChart height={height} />
  }
  return (
    <div style={{ height }} role="img" aria-label={`${yLabel} over time`}>
      <ResponsiveLine
        data={data}
        theme={nivoTheme}
        colors={colors}
        margin={{ top: 12, right: 16, bottom: 56, left: 64 }}
        xScale={{ type: 'time', precision: daily ? 'day' : 'hour' }}
        yScale={{ type: 'linear', min: yMin, max: 'auto', stacked }}
        axisBottom={{ format: (v: Date) => tickFmt.format(v), tickValues: height < 300 ? 4 : 6 }}
        axisLeft={{ legend: yLabel, legendOffset: -54, legendPosition: 'middle', tickValues: 5 }}
        enableGridX={false}
        enablePoints={false}
        lineWidth={2}
        enableArea={area}
        areaOpacity={0.35}
        enableSlices="x"
        sliceTooltip={({ slice }) => (
          <div className="bg-base-100 rounded-md p-2 text-xs shadow-lg">
            <div className="mb-1 font-medium">{fmt.format(slice.points[0]?.data.x as Date)}</div>
            {slice.points.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: p.seriesColor }}
                />
                <span className="opacity-80">{p.seriesId}</span>
                <span className="ml-auto pl-3 tabular-nums">
                  {Number(p.data.y).toLocaleString('en-CA', { maximumFractionDigits: 1 })}
                </span>
              </div>
            ))}
          </div>
        )}
        legends={[
          {
            anchor: 'bottom-left',
            direction: 'row',
            translateY: 52,
            itemWidth: 130,
            itemHeight: 16,
            symbolSize: 10,
            symbolShape: 'circle',
          },
        ]}
      />
    </div>
  )
}

type BarDatum = { label: string; value: number; color?: string }

export function HBar({
  data,
  height,
  valueFormat = (v: number) => v.toFixed(2),
  color = '#2a78d6',
  xLabel,
}: {
  data: BarDatum[]
  height?: number
  valueFormat?: (v: number) => string
  color?: string
  xLabel?: string
}) {
  if (!data.length) return <EmptyChart height={height ?? 200} />
  const h = height ?? Math.max(90, data.length * 28 + 40)
  const rows = [...data].reverse()
  return (
    <div style={{ height: h }} role="img" aria-label={xLabel ?? 'bar chart'}>
      <ResponsiveBar
        data={rows}
        keys={['value']}
        indexBy="label"
        layout="horizontal"
        theme={nivoTheme}
        margin={{ top: 4, right: 56, bottom: xLabel ? 40 : 16, left: 180 }}
        padding={0.35}
        colors={({ data: d }) => (d as BarDatum).color ?? color}
        borderRadius={4}
        enableGridY={false}
        enableGridX
        axisLeft={{ tickSize: 0, tickPadding: 8 }}
        axisBottom={
          xLabel
            ? { legend: xLabel, legendOffset: 32, legendPosition: 'middle', tickValues: 5 }
            : null
        }
        label={(d) => valueFormat(Number(d.value))}
        labelPosition="end"
        labelOffset={6}
        labelTextColor="currentColor"
        valueFormat={(v) => valueFormat(Number(v))}
        tooltip={({ indexValue, value }) => (
          <div className="bg-base-100 rounded-md p-2 text-xs shadow-lg">
            {indexValue}: <b>{valueFormat(Number(value))}</b>
          </div>
        )}
      />
    </div>
  )
}

export function EmptyChart({ height = 200 }: { height?: number }) {
  return (
    <div
      style={{ height }}
      className="border-base-300 text-base-content/60 flex items-center justify-center rounded-lg border border-dashed text-sm"
    >
      No data yet
    </div>
  )
}
