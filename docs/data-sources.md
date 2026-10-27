# Data sources

Every source is free, public and needs no API key. The ingestion code is in
`services/ml/src/gridml/ingest/`; the tables are defined in
`services/api/internal/db/migrations/0001_warehouse.sql`. Reference numbers point to
[references.md](references.md).

## Summary

| Source | Table (`grid.` schema) | Granularity | Used for | Ref. |
|---|---|---|---|---|
| IESO Hourly Zonal Demand | `ieso_zonal_demand` | Hourly, per zone | Target and load lags | [5] |
| IESO Generator Output by Fuel Type (hourly) | `ieso_generation_fuel` | Hourly, per fuel, Ontario | Lagged wind and solar features; charts | [11] |
| Open-Meteo historical weather (ERA5-based) | `weather_hourly`, `source = 'era5'` | Hourly, per location | Weather and solar features for training | [7], [13], [14] |
| Open-Meteo forecast | `weather_hourly`, `source = 'forecast'` | Hourly, 16 days ahead | Weather for live forecasts | [12], [13] |
| ECCC station observations | `weather_hourly`, `source = 'eccc'` | Hourly, Ottawa | Cross-checking the reanalysis | [6] |
| Ontario holidays (`holidays` package) | `holidays` | Daily | Calendar features | [15] |

## Time conventions

Everything in the warehouse is stored in **UTC, hour-beginning**. Features that depend on local
time (hour of day, weekday, holidays) are derived from `America/Toronto` in code.

- **IESO** reports use Eastern Standard Time (UTC−5) all year, with no daylight-saving shift,
  and number hours 1–24 as *hour ending*. Hour 1 covers 00:00–01:00 EST. The parser converts
  this with `ts_utc = date + (hour − 1) h + 5 h` (`ingest/ieso.py`).
- **ECCC** hourly files use Local Standard Time (UTC−5 for Ottawa) all year, so the same
  +5 h shift applies (`ingest/weather.py`).
- **Open-Meteo** is requested with `timezone=GMT`, so no conversion is needed.

## IESO Hourly Zonal Demand [5]

- Yearly CSV files `PUB_DemandZonal_YYYY.csv`; the current year's file is updated as the year
  goes on.
- One column per transmission zone (Ottawa, Toronto, East, Essa, Northeast, Northwest, Bruce,
  Southwest, Niagara, West), plus `Ontario Demand`, `Zone Total` and `Diff`. `Ontario Demand` is
  stored as zone `Ontario`; `Zone Total` and `Diff` are dropped.
- The parser ignores `\\` comment lines, finds the header row, and averages to hourly if a file
  carries sub-hourly intervals. It has been tested on a fixture in the documented format only.
  The first real backfill should be checked against the raw file, because IESO changed several
  reports with its 2025 market renewal.

## IESO Generator Output by Fuel Type, hourly [11]

- Yearly XML files `PUB_GenOutputbyFuelHourly_YYYY.xml`, published at the end of each business
  day.
- According to IESO's help file for the report, it covers generators of 20 MW or more registered
  with the IESO and reports energy in MWh per hour (numerically equal to average MW). It does
  **not** include distribution-connected (embedded) generation such as rooftop solar.
- Only the `WIND` and `SOLAR` totals are used as features, lagged by at least the model horizon
  (`features.renewable_features`), because their future values are unknown at forecast time.

## Open-Meteo weather [7], [12]–[14]

- **History:** `archive-api.open-meteo.com/v1/archive`, which serves reanalysis data based on
  ECMWF ERA5 [14] and is a few days behind real time. Stored as `source = 'era5'`.
- **Forecast:** `api.open-meteo.com/v1/forecast` with `past_days=7` and `forecast_days=16`.
  Stored as `source = 'forecast'`. Forecast rows for a given hour are overwritten each run.
- **Variables:** 2 m temperature, dew point, relative humidity, apparent temperature,
  precipitation, snowfall, cloud cover, wind speed at 10 m and 100 m, and shortwave (global),
  direct and diffuse radiation.
- **Locations** (`config.LOCATIONS`): Ottawa, Toronto, London and Sudbury. The Ottawa zone uses
  Ottawa weather. The Ontario target uses a weighted blend (Toronto 0.60, Ottawa 0.20, London
  0.12, Sudbury 0.08), which is a rough population weighting chosen for this project, not an
  official figure.
- When both exist for the same hour, observed (`era5`) rows win over forecast rows
  (`warehouse.blend_weather`).
- Open-Meteo asks users to cite [13] and is free for non-commercial use.

### Why reanalysis for training and forecasts for prediction

Models are trained on observed (reanalysis) weather but used with forecast weather. Back-tests
therefore use actual weather in place of a weather forecast (an *ex-post* evaluation; see [27]
on ex-post versus ex-ante load forecasting). This is common in short-term load forecasting
studies, but it makes back-test errors optimistic compared with live use. The report should
state this.

## ECCC station observations [6]

- Bulk hourly CSV per month from `climate.weather.gc.ca` for the Ottawa airport station, set in
  `config.ECCC_OTTAWA_STATION_ID = 49568` (OTTAWA INTL A, climate ID 6106001). **Confirm this
  station ID on the ECCC site before the first backfill**; it could not be checked from the build
  environment.
- Used to cross-check the reanalysis temperature, not as a model input, because no matching
  forecast exists for prediction time.
- ECCC data may be redistributed with acknowledgement of the source.

## Ontario holidays [15]

- Computed locally with the `holidays` package for `CA`, subdivision `ON`, with both the
  `PUBLIC` and `OPTIONAL` categories. The optional category adds the August Civic Holiday, which
  is not statutory but on which many workplaces close.
- Stored for 2015 up to two years ahead, so forecasts always have a calendar.

## Refresh schedule

| Environment | Mechanism | Frequency |
|---|---|---|
| Local (Docker Compose) | `scheduler` container calls `POST /ingest` on the ML service | Every 6 h |
| Google Cloud | Cloud Scheduler job with an OIDC token | Daily, 06:17 America/Toronto |
| Manual | UI **Data** page, `make ingest`, or `gridml ingest --start YYYY-MM-DD` | On demand |

An incremental run re-fetches the last 10 days before the newest stored hour
(`ingest/runner.REFRESH_WINDOW`), because providers revise recent values. Every run is logged
in `grid.ingestion_runs` with its status, row count and any error message.

## Data quality checks to report

Before training on real data, record these in the report:

- Missing hours per year in the Ottawa series (DST transitions should not create gaps, because
  IESO uses EST all year).
- Outliers such as the 2020 COVID-19 lockdown months, flagged by the `covid_lockdown` feature.
- Agreement between ECCC and reanalysis temperature for Ottawa (for example, the mean absolute
  difference).
