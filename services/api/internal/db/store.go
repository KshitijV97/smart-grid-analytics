package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("not found")

// SourceCoverage summarises one warehouse source.
type SourceCoverage struct {
	Source  string     `json:"source"`
	Rows    int64      `json:"rows"`
	FirstTS *time.Time `json:"first_ts"`
	LastTS  *time.Time `json:"last_ts"`
}

// IngestionRun is one row of grid.ingestion_runs.
type IngestionRun struct {
	ID           int64      `json:"id"`
	Source       string     `json:"source"`
	Status       string     `json:"status"`
	RangeStart   *time.Time `json:"range_start"`
	RangeEnd     *time.Time `json:"range_end"`
	RowsUpserted int64      `json:"rows_upserted"`
	Message      *string    `json:"message"`
	StartedAt    time.Time  `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at"`
}

// SeriesPoint is one hour (or day) of observed data.
type SeriesPoint struct {
	TS           time.Time `json:"ts"`
	LoadMW       *float64  `json:"load_mw"`
	TemperatureC *float64  `json:"temperature_c"`
	WindMW       *float64  `json:"wind_mw"`
	SolarMW      *float64  `json:"solar_mw"`
	GHI          *float64  `json:"ghi_wm2"`
}

// TrainingRun is one row of grid.training_runs.
type TrainingRun struct {
	ID         string          `json:"id"`
	Status     string          `json:"status"`
	Algorithm  string          `json:"algorithm"`
	Request    json.RawMessage `json:"request"`
	ModelID    *string         `json:"model_id"`
	Error      *string         `json:"error"`
	Log        *string         `json:"log"`
	CreatedAt  time.Time       `json:"created_at"`
	StartedAt  *time.Time      `json:"started_at"`
	FinishedAt *time.Time      `json:"finished_at"`
}

// ModelSummary is a model with headline metrics, for lists.
type ModelSummary struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Algorithm    string          `json:"algorithm"`
	TargetZone   string          `json:"target_zone"`
	HorizonHours int             `json:"horizon_hours"`
	CreatedAt    time.Time       `json:"created_at"`
	TrainSeconds *float64        `json:"train_seconds"`
	Validation   json.RawMessage `json:"validation"`
	Test         json.RawMessage `json:"test"`
	TestBaseload json.RawMessage `json:"test_baseload"`
}

// Model is the full model record.
type Model struct {
	ModelSummary
	Params            json.RawMessage `json:"params"`
	Features          json.RawMessage `json:"features"`
	Split             json.RawMessage `json:"split"`
	Metrics           json.RawMessage `json:"metrics"`
	FeatureImportance json.RawMessage `json:"feature_importance"`
	TrainingRunID     *string         `json:"training_run_id"`
}

// BacktestPoint is an actual-vs-predicted pair.
type BacktestPoint struct {
	TS        time.Time `json:"ts"`
	Split     string    `json:"split"`
	Actual    float64   `json:"actual"`
	Predicted float64   `json:"predicted"`
}

// ForecastRecord is a saved forecast summary.
type ForecastRecord struct {
	ID        string          `json:"id"`
	ModelID   string          `json:"model_id"`
	StartTS   time.Time       `json:"start_ts"`
	Hours     int             `json:"hours"`
	Scenario  json.RawMessage `json:"scenario"`
	Summary   json.RawMessage `json:"summary"`
	CreatedAt time.Time       `json:"created_at"`
}

// Store is the read side of the warehouse used by the HTTP handlers.
type Store interface {
	Ping(ctx context.Context) error
	Coverage(ctx context.Context) ([]SourceCoverage, error)
	IngestionRuns(ctx context.Context, limit int) ([]IngestionRun, error)
	Series(ctx context.Context, zone, location string, start, end time.Time, daily bool) ([]SeriesPoint, error)
	TrainingRuns(ctx context.Context, limit int) ([]TrainingRun, error)
	TrainingRun(ctx context.Context, id string) (TrainingRun, error)
	Models(ctx context.Context) ([]ModelSummary, error)
	Model(ctx context.Context, id string) (Model, error)
	Backtest(ctx context.Context, id, split string, start, end time.Time) ([]BacktestPoint, error)
	Forecasts(ctx context.Context, modelID string, limit int) ([]ForecastRecord, error)
}

// PG implements Store on Postgres.
type PG struct{ Pool *pgxpool.Pool }

// Ping checks connectivity.
func (p PG) Ping(ctx context.Context) error { return p.Pool.Ping(ctx) }

// Coverage reports row counts and time range per source.
func (p PG) Coverage(ctx context.Context) ([]SourceCoverage, error) {
	rows, err := p.Pool.Query(ctx, `
		select 'ieso_zonal_demand', count(*), min(ts_utc), max(ts_utc) from grid.ieso_zonal_demand
		union all
		select 'ieso_generation_fuel', count(*), min(ts_utc), max(ts_utc) from grid.ieso_generation_fuel
		union all
		select 'weather_' || source, count(*), min(ts_utc), max(ts_utc)
		  from grid.weather_hourly group by source
		union all
		select 'holidays', count(*), min(day)::timestamptz, max(day)::timestamptz from grid.holidays`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SourceCoverage, error) {
		var c SourceCoverage
		err := r.Scan(&c.Source, &c.Rows, &c.FirstTS, &c.LastTS)
		return c, err
	})
}

// IngestionRuns lists recent ingestion runs.
func (p PG) IngestionRuns(ctx context.Context, limit int) ([]IngestionRun, error) {
	rows, err := p.Pool.Query(ctx, `
		select id, source, status, range_start, range_end, rows_upserted, message, started_at, finished_at
		from grid.ingestion_runs order by started_at desc limit $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (IngestionRun, error) {
		var x IngestionRun
		err := r.Scan(&x.ID, &x.Source, &x.Status, &x.RangeStart, &x.RangeEnd, &x.RowsUpserted,
			&x.Message, &x.StartedAt, &x.FinishedAt)
		return x, err
	})
}

// Series returns observed demand, weather and Ontario wind/solar output.
// Observed (era5) weather is preferred over forecast weather for the same hour.
func (p PG) Series(ctx context.Context, zone, location string, start, end time.Time, daily bool) ([]SeriesPoint, error) {
	bucket := "h.ts"
	if daily {
		bucket = "date_trunc('day', h.ts at time zone 'America/Toronto') at time zone 'America/Toronto'"
	}
	q := fmt.Sprintf(`
		with hours as (
			select generate_series($3::timestamptz, $4::timestamptz - interval '1 hour', interval '1 hour') as ts
		),
		w as (
			select distinct on (ts_utc) ts_utc, temperature_c, shortwave_radiation_wm2
			from grid.weather_hourly
			where location = $2 and source in ('era5', 'forecast') and ts_utc >= $3 and ts_utc < $4
			order by ts_utc, case source when 'era5' then 0 else 1 end
		),
		f as (
			select ts_utc,
			       max(output_mw) filter (where fuel = 'WIND') as wind,
			       max(output_mw) filter (where fuel = 'SOLAR') as solar
			from grid.ieso_generation_fuel
			where ts_utc >= $3 and ts_utc < $4 group by ts_utc
		)
		select %s as ts, avg(d.demand_mw), avg(w.temperature_c), avg(f.wind), avg(f.solar),
		       avg(w.shortwave_radiation_wm2)
		from hours h
		left join grid.ieso_zonal_demand d on d.ts_utc = h.ts and d.zone = $1
		left join w on w.ts_utc = h.ts
		left join f on f.ts_utc = h.ts
		group by 1 order by 1`, bucket)
	rows, err := p.Pool.Query(ctx, q, zone, location, start, end)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SeriesPoint, error) {
		var s SeriesPoint
		err := r.Scan(&s.TS, &s.LoadMW, &s.TemperatureC, &s.WindMW, &s.SolarMW, &s.GHI)
		return s, err
	})
}

const trainingRunCols = `id::text, status, algorithm, request, model_id::text, error, log, created_at, started_at, finished_at`

func scanTrainingRun(r pgx.Row) (TrainingRun, error) {
	var t TrainingRun
	err := r.Scan(&t.ID, &t.Status, &t.Algorithm, &t.Request, &t.ModelID, &t.Error, &t.Log,
		&t.CreatedAt, &t.StartedAt, &t.FinishedAt)
	return t, err
}

// TrainingRuns lists recent training runs.
func (p PG) TrainingRuns(ctx context.Context, limit int) ([]TrainingRun, error) {
	rows, err := p.Pool.Query(ctx,
		"select "+trainingRunCols+" from grid.training_runs order by created_at desc limit $1", limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (TrainingRun, error) { return scanTrainingRun(r) })
}

// TrainingRun fetches one run.
func (p PG) TrainingRun(ctx context.Context, id string) (TrainingRun, error) {
	t, err := scanTrainingRun(p.Pool.QueryRow(ctx,
		"select "+trainingRunCols+" from grid.training_runs where id::text = $1", id))
	if errors.Is(err, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	return t, err
}

const modelSummaryCols = `id::text, name, algorithm, target_zone, horizon_hours, created_at, train_seconds,
	coalesce(metrics->'validation'->'overall', 'null'::jsonb),
	coalesce(metrics->'test'->'overall', 'null'::jsonb),
	coalesce(metrics->'test'->'daily_baseload', 'null'::jsonb)`

func scanSummary(r pgx.Row, extra ...any) (ModelSummary, error) {
	var m ModelSummary
	dest := append([]any{&m.ID, &m.Name, &m.Algorithm, &m.TargetZone, &m.HorizonHours, &m.CreatedAt,
		&m.TrainSeconds, &m.Validation, &m.Test, &m.TestBaseload}, extra...)
	err := r.Scan(dest...)
	return m, err
}

// Models lists models, newest first.
func (p PG) Models(ctx context.Context) ([]ModelSummary, error) {
	rows, err := p.Pool.Query(ctx, "select "+modelSummaryCols+" from grid.models order by created_at desc")
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ModelSummary, error) { return scanSummary(r) })
}

// Model fetches one model with all metadata.
func (p PG) Model(ctx context.Context, id string) (Model, error) {
	var m Model
	row := p.Pool.QueryRow(ctx, "select "+modelSummaryCols+
		", params, features, split, metrics, feature_importance, training_run_id::text from grid.models where id::text = $1", id)
	s, err := scanSummary(row, &m.Params, &m.Features, &m.Split, &m.Metrics, &m.FeatureImportance, &m.TrainingRunID)
	if errors.Is(err, pgx.ErrNoRows) {
		return m, ErrNotFound
	}
	m.ModelSummary = s
	return m, err
}

// Backtest returns stored validation/test predictions for a model.
func (p PG) Backtest(ctx context.Context, id, split string, start, end time.Time) ([]BacktestPoint, error) {
	rows, err := p.Pool.Query(ctx, `
		select ts_utc, split, actual, predicted from grid.model_backtest
		where model_id::text = $1 and ($2 = '' or split = $2) and ts_utc >= $3 and ts_utc < $4
		order by ts_utc`, id, split, start, end)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (BacktestPoint, error) {
		var b BacktestPoint
		err := r.Scan(&b.TS, &b.Split, &b.Actual, &b.Predicted)
		return b, err
	})
}

// Forecasts lists saved forecasts, optionally for one model.
func (p PG) Forecasts(ctx context.Context, modelID string, limit int) ([]ForecastRecord, error) {
	rows, err := p.Pool.Query(ctx, `
		select id::text, model_id::text, start_ts, hours, scenario, summary, created_at
		from grid.forecasts where ($1 = '' or model_id::text = $1)
		order by created_at desc limit $2`, modelID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ForecastRecord, error) {
		var f ForecastRecord
		err := r.Scan(&f.ID, &f.ModelID, &f.StartTS, &f.Hours, &f.Scenario, &f.Summary, &f.CreatedAt)
		return f, err
	})
}
