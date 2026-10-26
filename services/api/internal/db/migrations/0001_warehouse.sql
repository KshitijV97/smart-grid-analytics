-- Warehouse schema. Everything lives in the `grid` schema so that Supabase's
-- PostgREST (which only exposes `public`) never serves it to anonymous users.
-- All timestamps are UTC, hour-beginning.

create schema if not exists grid;

-- Raw sources ---------------------------------------------------------------

-- IESO Hourly Zonal Demand report. zone = 'Ontario' holds the province total.
create table if not exists grid.ieso_zonal_demand (
    ts_utc      timestamptz      not null,
    zone        text             not null,
    demand_mw   double precision not null,
    ingested_at timestamptz      not null default now(),
    primary key (ts_utc, zone)
);

-- IESO Generator Output by Fuel Type (transmission-connected, Ontario-wide).
create table if not exists grid.ieso_generation_fuel (
    ts_utc      timestamptz      not null,
    fuel        text             not null,
    output_mw   double precision not null,
    ingested_at timestamptz      not null default now(),
    primary key (ts_utc, fuel)
);

-- Hourly weather per location and source:
--   era5     = Open-Meteo historical reanalysis (observed)
--   forecast = Open-Meteo forecast API (future hours, overwritten as they roll in)
--   eccc     = Environment and Climate Change Canada station observations
create table if not exists grid.weather_hourly (
    ts_utc                   timestamptz      not null,
    location                 text             not null,
    source                   text             not null,
    temperature_c            double precision,
    dew_point_c              double precision,
    relative_humidity_pct    double precision,
    apparent_temperature_c   double precision,
    precipitation_mm         double precision,
    snowfall_cm              double precision,
    cloud_cover_pct          double precision,
    wind_speed_10m_kmh       double precision,
    wind_speed_100m_kmh      double precision,
    shortwave_radiation_wm2  double precision,
    direct_radiation_wm2     double precision,
    diffuse_radiation_wm2    double precision,
    ingested_at              timestamptz      not null default now(),
    primary key (ts_utc, location, source)
);

create table if not exists grid.holidays (
    day    date not null,
    region text not null,
    name   text not null,
    primary key (day, region)
);

create table if not exists grid.ingestion_runs (
    id            bigserial primary key,
    source        text        not null,
    status        text        not null default 'running',
    range_start   timestamptz,
    range_end     timestamptz,
    rows_upserted bigint      not null default 0,
    message       text,
    started_at    timestamptz not null default now(),
    finished_at   timestamptz
);
create index if not exists ingestion_runs_source_started_idx
    on grid.ingestion_runs (source, started_at desc);

-- ML metadata ----------------------------------------------------------------

create table if not exists grid.training_runs (
    id          uuid primary key default gen_random_uuid(),
    status      text        not null default 'queued',
    algorithm   text        not null,
    request     jsonb       not null,
    model_id    uuid,
    error       text,
    log         text,
    created_at  timestamptz not null default now(),
    started_at  timestamptz,
    finished_at timestamptz
);

create table if not exists grid.models (
    id                 uuid primary key default gen_random_uuid(),
    name               text        not null,
    algorithm          text        not null,
    target_zone        text        not null,
    horizon_hours      integer     not null,
    params             jsonb       not null,
    features           jsonb       not null,
    split              jsonb       not null,
    metrics            jsonb       not null,
    feature_importance jsonb       not null default '[]'::jsonb,
    residual_quantiles jsonb       not null default '{}'::jsonb,
    artifact_uri       text        not null,
    training_run_id    uuid references grid.training_runs (id) on delete set null,
    train_seconds      double precision,
    created_at         timestamptz not null default now()
);

-- Hourly predictions on the validation and test years, for charts and the report.
create table if not exists grid.model_backtest (
    model_id  uuid             not null references grid.models (id) on delete cascade,
    ts_utc    timestamptz      not null,
    split     text             not null,
    actual    double precision not null,
    predicted double precision not null,
    primary key (model_id, ts_utc)
);

create table if not exists grid.forecasts (
    id         uuid primary key default gen_random_uuid(),
    model_id   uuid        not null references grid.models (id) on delete cascade,
    start_ts   timestamptz not null,
    hours      integer     not null,
    scenario   jsonb       not null default '{}'::jsonb,
    summary    jsonb       not null,
    created_at timestamptz not null default now()
);
