// Speaker notes for each slide, keyed by slide. Used by build_deck.js.
// Each note has a timed script to say aloud, key facts to remember, and likely questions.
module.exports = {
  title: `PRESENTER: Kshitij · TIME: about 10 seconds

SCRIPT
"Hello, I'm Kshitij, and this is Victor. Our project forecasts Ottawa's electricity load with machine learning, so that the grid can plan its supply ahead of demand instead of reacting to it."

KEY FACTS
- Course: ELG 5255 Applied Machine Learning, Phase 1 proposal (8% of the final grade).
- Topic area from the course brief: smart grid, load forecasting for residential areas.
- The whole talk must fit in 5 minutes; Q&A follows.`,

  problem: `PRESENTER: Kshitij · TIME: about 35 seconds

SCRIPT
"Ottawa's electricity demand changes for four main reasons. First, weather: cold winters cause heating peaks and hot summers cause cooling peaks. Second, the calendar: workdays, weekends and statutory holidays each have a different daily load profile. Third, renewables: solar and wind output changes from hour to hour with the weather. And fourth, electrification: EV fleets add large charging loads, but those loads can be scheduled.

So our research question is: can tree-ensemble models, Random Forest and XGBoost, forecast Ottawa's hourly demand and next-day baseload more accurately than a Linear Regression baseline, using past demand, weather and calendar features?

By baseload we mean the minimum demand the grid must always serve. We define it as the lowest hourly load of each day."

KEY FACTS
- Two targets: (1) next-hour demand in MW; (2) next-day baseload = minimum hourly load of the next day.
- Hourly load is U-shaped against temperature: it rises on cold days (heating) and on hot days (cooling).
- 'Tree ensemble' = a model made of many decision trees whose predictions are combined.

IF ASKED
- Why baseload? It tells operators how much always-on generation (e.g., nuclear and hydro in Ontario) is needed, and when there may be surplus at night.
- Why next-hour? It is the standard short-term load forecasting (STLF) horizon used in the papers we reviewed, so our results are comparable.`,

  sotaEvidence: `PRESENTER: Victor · TIME: about 40 seconds

SCRIPT
"We reviewed four recent studies. Gökçe and Duman, an IEEE conference paper from 2022, forecast Turkey's hourly demand with Linear Regression, Random Forest and XGBoost. Both tree models beat Linear Regression: RMSE dropped from about 2348 to 2075 for Random Forest and 2039 for XGBoost, and Random Forest had the lowest absolute and percentage errors.

Rawal and Ahmad, also IEEE 2022, compared eight regression models on Australian data and found that non-parametric models outperformed parametric ones, with Random Forest the best.

Ibrahim and colleagues, in Energies 2022, tested eight models on Panama's grid. The chart on the left shows their one-hour-ahead errors. Deep learning was best at 2.9 percent MAPE, but Random Forest was close behind at 3.2 percent, and it trained in 7 seconds instead of 20 minutes.

Finally, Kong and colleagues, in IEEE Transactions on Smart Grid, showed that LSTM networks work well for individual households."

KEY FACTS
- [1] Gökçe & Duman: Turkey, 1 Jan 2018 – 31 Dec 2021, 35,064 hourly records; features = month, weekday, hour, holiday flag, temperature of the 16 highest-consuming provinces, load 24 hours earlier; ~80/20 split. RMSE: LR 2348.35, RF 2075.32, XGBoost 2038.54. XGBoost best on squared error; RF best on absolute and percentage error. All models weaker in summer (COVID-19 recovery, extreme heat).
- [2] Rawal & Ahmad: New South Wales, 2020; eight models (linear, polynomial, SVR, elastic net, gradient boosting, decision tree, random forest, KNN). Non-parametric > parametric; RF best. We have NOT verified their exact numbers, so do not quote any.
- [3] Ibrahim et al.: Panama, Jan 2016 – Oct 2019, 33,600 hourly points; chronological 80/20 split. One-hour-ahead MAPE: deep learning 2.90%, LightGBM 3.07%, RF 3.22%, XGBoost 3.45%, SVR 4.90%, AdaBoost 5.70%. R²: deep learning 0.93, RF and LightGBM 0.92, XGBoost 0.91. 24-hour-ahead Bi-LSTM R² only 0.40, GRU 0.31.
- [4] Kong et al.: LSTM on household smart-meter data; beats competing methods for individual homes.

IF ASKED
- 'Parametric' models assume a fixed formula with a fixed number of parameters (e.g., linear regression). 'Non-parametric' models, such as trees and KNN, let the data decide the shape of the function.
- [3] is an MDPI journal, not IEEE. We use it for the review only; our implementation follows the IEEE paper [1].`,

  sotaLessons: `PRESENTER: Victor · TIME: about 35 seconds

SCRIPT
"Here is how each lesson from the literature shapes our design. First, past load and temperature are the strongest predictors, so we use lags of one hour, one day and one week, together with temperature and humidity. Second, calendar effects matter, so we include Ontario's statutory holidays and a workday flag. Third, tree ensembles get within about a third of a percentage point of deep learning at a fraction of the cost, so Random Forest and XGBoost are our core models, with Linear Regression as the baseline. Fourth, earlier models struggled in extreme seasons and over longer horizons, so we will report errors by season and by horizon, and flag the 2020 COVID period.

The gap we address: these studies forecast a whole country, a state or a single home. None looks at a city zone like Ottawa, or at how solar, wind and EV fleets change the net load the grid still has to serve."

KEY FACTS
- Lag notation: t-1 = one hour ago; t-24 = same hour yesterday; t-168 = same hour last week (7 × 24 = 168).
- 0.3 percentage points: RF MAPE 3.22% vs deep learning 2.90% in [3].
- Training cost in [3]: RF 7.1 s, LightGBM 0.8 s, XGBoost 3.3 s, deep learning about 1200 s (20 min).

IF ASKED
- Why humidity? [3] found it useful alongside temperature; humid summer days increase cooling load.
- How do you flag COVID? A binary feature for the lockdown months of 2020, and an experiment training with and without 2020.`,

  solution: `PRESENTER: Kshitij · TIME: about 40 seconds

SCRIPT
"Our solution has five steps. Steps one to four are the graded machine learning core, and they use only real data. We collect IESO's hourly demand for the Ottawa zone, weather from Environment Canada and Open-Meteo, and Ontario's holiday calendar. We engineer features: lags, temperature, heating and cooling degree-hours, and calendar variables. We train Linear Regression, Random Forest and XGBoost. And we forecast next-hour demand and next-day baseload.

Step five is the smart-grid layer. We take the demand forecast, subtract the output of a solar farm and a wind farm, and add EV fleet charging. What is left is the net load: the load that controllable, or 'dispatchable', power plants must cover. This shows, hour by hour, how much supply is needed and when EV charging could be shifted to quieter hours."

KEY FACTS
- Net load = forecast demand − solar output − wind output + EV charging load.
- Dispatchable supply = generation that operators can turn up or down on demand (e.g., hydro, gas), unlike solar and wind.
- HDD/CDD (here degree-hours) = how far the temperature is below or above a base of about 18 °C; this captures heating and cooling demand.

IF ASKED
- Is step 5 machine learning? Not in itself: it is a physics- and rule-based simulation driven by our ML forecast. It turns the forecast into a smart-grid decision tool. The graded ML is in steps 1–4.
- Is this real-time? No. We replay historical hours one by one to show how the system would work; real-time control is out of scope.
- Why is EV charging added, not subtracted? The fleet is a new load that is not in today's data, so it increases what the grid must supply.
- Aren't 10 MW and 20 MW tiny? Yes, only a few percent of the zone's load at most. They are a base case; every size is a parameter we can scale up.
- Why doesn't solar help the winter peak? Ottawa's winter peak comes after sunset, when solar output is zero.
- What does 'dynamic load distribution' mean? Splitting the forecast into residential, industrial/commercial and EV shares each hour, and moving flexible EV charging to the night-time valley (valley filling).
- Full explanation with formulas and a worked example: STUDY_NOTES.md, Part 5A.`,

  data: `PRESENTER: Victor · TIME: about 30 seconds

SCRIPT
"This table separates real data from assumptions. Everything the machine learning model learns from is real and public: IESO's hourly zonal demand for Ottawa, temperature and humidity from Environment and Climate Change Canada, solar irradiance and wind speed from Open-Meteo, and the Ontario holiday calendar. Only the scenario layer uses assumptions, and we label them clearly.

We split the data chronologically: we train on 2020 to 2023, tune on 2024, and test on 2025. We never shuffle the data, so no information from the future can leak into training."

KEY FACTS
- IESO = Independent Electricity System Operator; it runs Ontario's grid and publishes the Hourly Zonal Demand Report for its 10 zones, one of which is Ottawa.
- ECCC = Environment and Climate Change Canada (climate.weather.gc.ca), hourly station data.
- Open-Meteo = free historical weather API with irradiance and 100 m wind speed.
- Rows: about 6 years × 8,760 hours ≈ 52,600 hourly rows.

IF ASKED
- What is data leakage? When the model sees information during training that would not be available at prediction time, which makes test results look better than reality.
- Missing values? Short gaps are interpolated; longer gaps are dropped and reported.`,

  assumptions: `PRESENTER: Kshitij · TIME: about 30 seconds

SCRIPT
"Where no public data exists at city level, we make simple, explicit assumptions. A 10-megawatt solar farm, modelled with the pvlib library from real irradiance. A 20-megawatt wind farm, using a standard turbine power curve on real wind speeds. Residential load that follows temperature, with morning and evening peaks. Industrial and commercial load that follows the working week. And a fleet of 300 electric vehicles charging overnight. We scale these shares to match IESO's real Ottawa total, and every number is a parameter, so we can run what-if scenarios."

KEY FACTS
- Wind power curve: no output below the cut-in speed (3 m/s); output rises roughly with the cube of wind speed up to the rated speed (12 m/s); full output up to the cut-out speed (25 m/s); shutdown above it for safety.
- EV fleet energy: 300 vehicles × 60 kWh = 18 MWh per workday night; spread over 8 hours (22:00–06:00), that is about 2.25 MW on average.
- pvlib = open-source Python library for modelling solar panel output from weather data [8].

IF ASKED
- Why these sizes? They are round, plausible numbers for a city-scale scenario, not real installations. The point is to show the method; any size can be swapped in.
- Isn't this made up? The installations are hypothetical, but the weather that drives them is real, and we label them ASSUMED. The graded ML does not depend on them.`,

  methods: `PRESENTER: Victor · TIME: about 30 seconds

SCRIPT
"We compare four models trained on the same features and the same split. A persistence baseline, which simply says the next hour equals this hour; every model must beat it. Linear Regression, which is easy to interpret. Random Forest, an ensemble of decision trees that captures the U-shaped relationship between temperature and load. And XGBoost, which builds trees one after another, each correcting the errors of the previous ones.

We evaluate on the unseen 2025 test year with four metrics: MAE, RMSE, MAPE and R-squared. And we analyse where each model fails: by season, at peak hours, and on holidays."

KEY FACTS
- MAE = average of |actual − predicted|, in MW. Easy to interpret.
- RMSE = square root of the average squared error, in MW. Penalises large errors more.
- MAPE = average of |error| / actual × 100%. Scale-free, so it can be compared across grids.
- R² = 1 − (sum of squared errors / total variance). 1 is perfect; 0 means no better than predicting the mean.
- Random Forest [9]: many trees, each trained on a bootstrap sample with random feature subsets; predictions are averaged (bagging), which reduces variance.
- XGBoost [10]: gradient boosting; trees are added one at a time to fit the remaining errors, with regularisation to prevent overfitting.

IF ASKED
- Why both RMSE and MAE? In [1], the ranking of RF and XGBoost flipped depending on the metric, so we report both.
- Hyperparameter tuning? Grid or random search on the 2024 validation year; [1] used GridSearchCV with 4-fold cross-validation.`,

  feasibility: `PRESENTER: Kshitij · TIME: about 25 seconds

SCRIPT
"This scope is realistic. The data is free, public and small: about 52,000 hourly rows, which trains in seconds to minutes on a laptop. We use standard libraries. The core deliverable does not depend on the scenario layer, so it cannot be put at risk by it. And if the Ottawa zonal data turns out incomplete, the same pipeline runs on Ontario-wide demand. Our timeline runs from data collection this month to the final presentation on December 8 and the report on December 14."

KEY FACTS
- Milestones: data and EDA by Oct 31; models trained by Nov 15; scenario layer by Nov 28; analysis and final presentation by Dec 8; IEEE-format report (at least 5 pages) by Dec 14.
- Libraries: pandas (data), scikit-learn (LR, RF, metrics), xgboost, pvlib.

IF ASKED
- What if you fall behind? The scenario layer is the first thing to shrink; the ML core comes first.
- What is EDA? Exploratory data analysis: plotting and summarising the data before modelling.`,

  team: `PRESENTER: either · TIME: about 15 seconds

SCRIPT
"Kshitij led the problem definition, the smart-grid scenario layer and the plan. Victor led the literature review, the data pipeline and the evaluation design. We will share the coding and the report. We used ChatGPT for summary tables and diagrams in our draft, and Claude to restructure and proofread the slides and check citations. We chose the problem, papers and methods ourselves, and we checked every number against the papers."

KEY FACTS
- The course requires every deliverable to state each member's contribution, signed by all members.
- Check that the contribution lines are accurate before presenting.`,

  references: `Do not read this slide aloud. Leave it up only if asked about a source.

- [1]–[4] are the literature review; [1], [2] and [4] are IEEE, [3] is MDPI Energies (open access).
- [5]–[7] are data sources; [8] is the solar model library; [9] and [10] are the original Random Forest and XGBoost papers.`,

  questions: `Q&A (2 points of the rubric). Keep answers short and confident.

- Why Ottawa? City scale is where local weather, holidays and EV fleets matter; IESO publishes Ottawa-zone hourly data.
- Why not deep learning? In [3] it was only 0.3 points better in MAPE and took 20 min vs 7 s; LSTM is our stretch goal.
- Which paper are you implementing? Gökçe & Duman [1] (IEEE), extended to Ottawa with weekly lags, baseload and net load.
- Are the solar, wind and EV numbers real? The weather inputs are real; the installations are hypothetical and labelled.
- How do you avoid leakage? Chronological split; lags use only past values; scalers are fit on training data only.
- Success criteria? All models beat persistence; RF and XGBoost beat LR on MAE, RMSE and MAPE in 2025.`,
};
