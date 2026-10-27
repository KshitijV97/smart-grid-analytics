# User guide

This guide walks through the web UI from an empty warehouse to a forecast. Locally the UI is at
http://localhost:3000 after `make up`. In development (`npm run dev`) it is at
http://localhost:5173.

## 0. Admin token

In the cloud, training, ingestion and deleting models need the admin token. Get it with
`terraform output -raw admin_token`, click **Admin token** in the top bar, and paste it. The
token is kept in this browser only. Locally no token is needed.

## 1. Data: fill the warehouse

**Data** page:

- **Coverage** lists each source with its row count and date range.
- **Pull data** runs ingestion:
  - For the first run, leave all sources unticked (meaning all of them) and set **Start** to
    `2019-12-01`. A full backfill takes several minutes; `make backfill` does the same from the
    command line.
  - Later runs can leave the dates empty for an incremental update.
- **Ingestion runs** shows each source's status, row count and any error. It refreshes while a
  run is in progress.

See [data-sources.md](data-sources.md) for what each source contains.

## 2. Overview: look at the data

The **Overview** page shows recent observed data:

- demand for the selected zone;
- temperature;
- Ontario wind and solar output.

Switch between Ottawa and Ontario, and between 7 days, 30 days and 1 year. Long ranges switch
to daily values. The cards show the latest demand, the peak and the minimum (base load) over
the range.

## 3. Train: fit a model

1. **Algorithm.** Random Forest is the primary model, XGBoost the secondary, Linear Regression
   the baseline. See [methodology.md §4](methodology.md#4-algorithms-algorithmspy).
2. **Hyperparameters.** The form is generated from the algorithm's declaration. Parameters
   marked *tunable* are included in **random search** when the iterations slider is above 0.
3. **Target, features and split.**
   - *Zone*: Ottawa or Ontario.
   - *Horizon*: the shortest past-load lag the model may use (1, 24, 48 or 168 h). Use 24 h for
     day-ahead forecasts.
   - *Feature groups*: switch groups off for ablation experiments.
   - *Split dates*: default train 2020–2023, validate 2024, test 2025.
   - *Refit*: refit on train + validation before scoring the test year.
4. Click **Train**. The run appears in **Training runs** and moves from *queued* to *running*
   to *succeeded*. **log** shows progress; **model** opens the result.

## 4. Models: compare

The **Models** page has a bar chart of one test metric for every model in a zone (MAPE, MAE,
RMSE or R²), and a table with validation and test scores, base-load MAE and training time.

Click a model to open its detail page:

- Test-year and validation-year headline metrics, including the seasonal-naive ("same hour last
  week") MAPE for reference.
- **Actual vs predicted** for any two-week window; pick the start date.
- **Error breakdown** by season, on/off-peak, holidays, daily base load and daily peak.
- **MAE by hour of day.**
- **Top 20 features** by importance.
- Final hyperparameters (after search or early stopping) and the split.
- **Delete model** (admin).

These views are designed to supply the tables and figures for the report's results section.

## 5. Forecast: predict demand, base load and variable load

1. Choose a **model**. The **forecast** buttons on the Models page preselect it.
2. **Start**: leave empty to start right after the newest observed hour, or pick a past date to
   back-test (actual demand is then shown and scored).
3. **Hours**: 24 h to 14 days.
4. Optional **Scenario**: a hypothetical solar farm, wind farm and EV fleet. Defaults are
   10 MW, 20 MW and 300 vehicles.
5. Click **Forecast**.

Results:

- **Notes**: caveats such as recursive hours beyond the model horizon, climatology weather, or a
  data gap that was bridged.
- **Cards**: peak demand, lowest daily base load, total energy, and accuracy when actuals exist.
- **Base load and variable load**: stacked; the top of the stack is the total forecast.
- **Forecast with 80 % band**, plus actual demand when known.
- With a scenario: **demand vs net load** and the solar, wind and EV curves.
- **Temperature used.**
- **Daily summary** table: peak, peak hour, base load, energy, variable energy, actual values
  and net-load values.
