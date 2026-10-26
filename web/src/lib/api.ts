import type {
  BacktestPoint,
  Catalog,
  Coverage,
  ForecastRequest,
  ForecastResult,
  IngestionRun,
  Model,
  ModelSummary,
  Series,
  TrainingRun,
  TrainRequest,
} from './types'

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const TOKEN_KEY = 'grid.adminToken'

export function getAdminToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAdminToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable (private mode): the token lives for this page only
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getAdminToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    const d = data as { error?: string; detail?: unknown } | null
    const detail =
      typeof d?.detail === 'string' ? d.detail : d?.detail ? JSON.stringify(d.detail) : undefined
    throw new ApiError(res.status, d?.error ?? detail ?? `HTTP ${res.status}`)
  }
  return data as T
}

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  catalog: () => request<Catalog>('GET', '/api/catalog'),
  coverage: () => request<Coverage[]>('GET', '/api/data/coverage'),
  series: (p: { zone: string; start?: string; end?: string; resolution?: string }) =>
    request<Series>('GET', `/api/data/series${qs(p)}`),
  ingestionRuns: () => request<IngestionRun[]>('GET', '/api/ingestion-runs?limit=100'),
  ingest: (body: { sources?: string[]; start?: string; end?: string }) =>
    request<{ status: string }>('POST', '/api/ingest', body),
  trainingRuns: () => request<TrainingRun[]>('GET', '/api/training-runs?limit=50'),
  train: (body: TrainRequest) =>
    request<{ run_id: string; status: string }>('POST', '/api/training-runs', body),
  models: () => request<ModelSummary[]>('GET', '/api/models'),
  model: (id: string) => request<Model>('GET', `/api/models/${id}`),
  deleteModel: (id: string) => request<{ deleted: string }>('DELETE', `/api/models/${id}`),
  backtest: (id: string, p: { split?: string; start?: string; end?: string }) =>
    request<BacktestPoint[]>('GET', `/api/models/${id}/backtest${qs(p)}`),
  forecast: (body: ForecastRequest) => request<ForecastResult>('POST', '/api/forecasts', body),
}
