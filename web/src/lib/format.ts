const nf0 = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 })

export const mw = (v: number | null | undefined) => (v == null ? '—' : `${nf0.format(v)} MW`)
export const mwh = (v: number | null | undefined) => (v == null ? '—' : `${nf0.format(v)} MWh`)
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${nf2.format(v)} %`)
export const num1 = (v: number | null | undefined) => (v == null ? '—' : nf1.format(v))
export const num2 = (v: number | null | undefined) => (v == null ? '—' : nf2.format(v))

export const dateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-CA', {
        timeZone: 'America/Toronto',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—'

export const dateOnly = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('en-CA', {
        timeZone: 'America/Toronto',
        dateStyle: 'medium',
      })
    : '—'

/** YYYY-MM-DD for a Date, in Ottawa time. */
export const isoDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

// Validated categorical palette (fixed order, never cycled). Colour follows the
// entity: each algorithm keeps its slot everywhere in the app.
export const SERIES = {
  blue: '#2a78d6',
  orange: '#eb6834',
  aqua: '#1baf7a',
  yellow: '#eda100',
  magenta: '#e87ba4',
  green: '#008300',
  violet: '#6250d6',
  red: '#e34948',
} as const

export const ALGO_COLORS: Record<string, string> = {
  random_forest: SERIES.blue,
  xgboost: SERIES.orange,
  hist_gradient_boosting: SERIES.aqua,
  extra_trees: SERIES.yellow,
  linear_regression: SERIES.magenta,
  ridge: SERIES.green,
  mlp: SERIES.violet,
}
