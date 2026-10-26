export type Metrics = {
  n: number
  mae: number | null
  rmse: number | null
  mape: number | null
  r2: number | null
  bias: number | null
}

export type Breakdown = {
  overall: Metrics
  by_season: Record<string, Metrics>
  on_peak: Metrics
  off_peak: Metrics
  holidays: Metrics
  non_holidays: Metrics
  by_hour_mae: number[]
  daily_baseload: Metrics
  daily_peak: Metrics
}

export type ParamSpec = {
  name: string
  type: 'int' | 'float' | 'bool' | 'choice'
  default: number | boolean | string | null
  description: string
  min: number | null
  max: number | null
  step: number | null
  choices: string[] | null
  nullable: boolean
  tunable: boolean
}

export type AlgorithmSpec = {
  key: string
  label: string
  family: string
  description: string
  tags: string[]
  tunable: boolean
  params: ParamSpec[]
}

export type Split = {
  train_start: string
  train_end: string
  val_start: string
  val_end: string
  test_start: string
  test_end: string
}

export type Scenario = {
  solar_mw_ac: number
  solar_dc_ac_ratio: number
  solar_tilt_deg: number
  wind_mw: number
  wind_cut_in_ms: number
  wind_rated_ms: number
  wind_cut_out_ms: number
  ev_count: number
  ev_kwh_per_day: number
  ev_charger_kw: number
  ev_charge_start_hour: number
  ev_off_day_factor: number
}

export type Catalog = {
  algorithms: AlgorithmSpec[]
  feature_groups: { key: string; description: string }[]
  zones: string[]
  default_split: Split
  ingest_sources: string[]
  scenario_defaults: Scenario
}

export type Coverage = {
  source: string
  rows: number
  first_ts: string | null
  last_ts: string | null
}

export type IngestionRun = {
  id: number
  source: string
  status: string
  range_start: string | null
  range_end: string | null
  rows_upserted: number
  message: string | null
  started_at: string
  finished_at: string | null
}

export type SeriesPoint = {
  ts: string
  load_mw: number | null
  temperature_c: number | null
  wind_mw: number | null
  solar_mw: number | null
  ghi_wm2: number | null
}

export type Series = { zone: string; resolution: 'hour' | 'day'; points: SeriesPoint[] }

export type TrainRequest = {
  algorithm: string
  params: Record<string, unknown>
  target_zone: string
  horizon_hours: number
  feature_groups: string[]
  split: Split
  search_iterations: number
  refit_on_train_val: boolean
  name?: string
}

export type TrainingRun = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  algorithm: string
  request: TrainRequest
  model_id: string | null
  error: string | null
  log: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type ModelSummary = {
  id: string
  name: string
  algorithm: string
  target_zone: string
  horizon_hours: number
  created_at: string
  train_seconds: number | null
  validation: Metrics | null
  test: Metrics | null
  test_baseload: Metrics | null
}

export type Model = ModelSummary & {
  params: Record<string, unknown>
  features: string[]
  split: Split
  metrics: {
    train: Metrics
    validation: Breakdown
    test?: Breakdown
    naive_weekly?: { validation: Metrics; test: Metrics | null }
  }
  feature_importance: { feature: string; importance: number }[]
  training_run_id: string | null
}

export type BacktestPoint = { ts: string; split: string; actual: number; predicted: number }

export type ForecastPoint = {
  ts: string
  local_time: string
  predicted_mw: number | null
  lower_mw: number | null
  upper_mw: number | null
  actual_mw: number | null
  baseload_mw: number | null
  variable_mw: number | null
  temperature_c: number | null
  weather: 'weather' | 'climatology'
  solar_mw?: number | null
  wind_mw?: number | null
  ev_mw?: number | null
  net_load_mw?: number | null
}

export type ForecastDay = {
  date: string
  hours: number
  peak_mw: number | null
  peak_hour: number
  baseload_mw: number | null
  mean_mw: number | null
  energy_mwh: number | null
  variable_energy_mwh: number | null
  actual_peak_mw: number | null
  actual_baseload_mw: number | null
  net_peak_mw?: number | null
  net_baseload_mw?: number | null
}

export type ForecastResult = {
  id?: string
  model_id: string
  start: string
  end: string
  hours: number
  target_zone: string
  horizon_hours: number
  points: ForecastPoint[]
  daily: ForecastDay[]
  accuracy: Metrics | null
  scenario: Scenario | null
  notes: string[]
}

export type ForecastRequest = {
  model_id: string
  start?: string
  hours: number
  scenario?: Scenario | null
}
