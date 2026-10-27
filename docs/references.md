# References

All project documentation cites sources by number in IEEE style, for example "[9]". Numbers
[1]–[10] match the Phase 1 deck (`presentation/build_deck.js`) and `presentation/STUDY_NOTES.md`,
so the report, slides and docs can share one list. Later numbers were added for the
implementation.

Sources are split into two groups:

- **Primary sources:** original data, original method papers, technical manuals and software
  that this project uses directly, and original empirical studies.
- **Secondary sources:** reviews, tutorials and textbooks that summarise or analyse other work.

Notes on use:

- [2]: only its qualitative finding (non-parametric models, Random Forest best) may be quoted.
  Its exact numbers have not been checked against the full text.
- [3]: open-access MDPI journal, not ACM/IEEE indexed. It supports the literature review only and
  is not the paper the implementation reproduces. The implementation anchor is [1] (IEEE).
- Online data sources ([5]–[7], [11]–[13], [15]) change over time. Give the access date in the
  final report.

## Primary sources

### Empirical load-forecasting studies

[1] M. M. Gökçe and E. Duman, "Performance comparison of simple regression, random forest and
XGBoost algorithms for forecasting electricity demand," in *Proc. 3rd Int. Informatics and
Software Engineering Conf. (IISEC)*, Ankara, Turkey, 2022. doi: 10.1109/IISEC56263.2022.9998213.

[2] K. Rawal and A. Ahmad, "A comparative analysis of supervised machine learning algorithms for
electricity demand forecasting," in *Proc. 2nd Int. Conf. Power, Control and Computing
Technologies (ICPC2T)*, 2022, pp. 1–6. doi: 10.1109/ICPC2T53885.2022.9776960.

[3] B. Ibrahim, L. Rabelo, E. Gutierrez-Franco, and N. Clavijo-Buritica, "Machine learning for
short-term load forecasting in smart grids," *Energies*, vol. 15, no. 21, art. no. 8079, 2022.
doi: 10.3390/en15218079.

[4] W. Kong, Z. Y. Dong, Y. Jia, D. J. Hill, Y. Xu, and Y. Zhang, "Short-term residential load
forecasting based on LSTM recurrent neural network," *IEEE Trans. Smart Grid*, vol. 10, no. 1,
pp. 841–851, Jan. 2019. doi: 10.1109/TSG.2017.2753802.

### Data

[5] Independent Electricity System Operator (IESO), "Hourly Zonal Demand Report"
(`PUB_DemandZonal_YYYY.csv`). [Online]. Available:
https://reports-public.ieso.ca/public/DemandZonal/

[6] Environment and Climate Change Canada, "Historical Climate Data." [Online]. Available:
https://climate.weather.gc.ca/

[7] Open-Meteo, "Historical Weather API." [Online]. Available:
https://open-meteo.com/en/docs/historical-weather-api

[11] Independent Electricity System Operator (IESO), "Generator Output by Fuel Type Hourly
Report" (`PUB_GenOutputbyFuelHourly_YYYY.xml`). [Online]. Available:
https://reports-public.ieso.ca/public/GenOutputbyFuelHourly/

[12] Open-Meteo, "Weather Forecast API." [Online]. Available: https://open-meteo.com/en/docs

[13] P. Zippenfenig, "Open-Meteo.com Weather API," Zenodo, 2023. [Computer software].
doi: 10.5281/zenodo.7970649.

[14] H. Hersbach *et al.*, "The ERA5 global reanalysis," *Q. J. R. Meteorol. Soc.*, vol. 146,
no. 730, pp. 1999–2049, 2020. doi: 10.1002/qj.3803.

[15] vacanza contributors, "holidays: Python library for generating country and subdivision
holidays," version 0.107. [Online]. Available: https://github.com/vacanza/holidays

### Machine-learning methods

[9] L. Breiman, "Random forests," *Mach. Learn.*, vol. 45, no. 1, pp. 5–32, 2001.
doi: 10.1023/A:1010933404324.

[10] T. Chen and C. Guestrin, "XGBoost: A scalable tree boosting system," in *Proc. 22nd ACM
SIGKDD Int. Conf. Knowledge Discovery and Data Mining*, 2016, pp. 785–794.
doi: 10.1145/2939672.2939785.

[16] J. H. Friedman, "Greedy function approximation: A gradient boosting machine," *Ann.
Statist.*, vol. 29, no. 5, pp. 1189–1232, 2001. doi: 10.1214/aos/1013203451.

[17] P. Geurts, D. Ernst, and L. Wehenkel, "Extremely randomized trees," *Mach. Learn.*,
vol. 63, no. 1, pp. 3–42, 2006. doi: 10.1007/s10994-006-6226-1.

[18] G. Ke *et al.*, "LightGBM: A highly efficient gradient boosting decision tree," in *Advances
in Neural Information Processing Systems 30 (NIPS 2017)*, 2017, pp. 3146–3154.

[19] J. Bergstra and Y. Bengio, "Random search for hyper-parameter optimization," *J. Mach.
Learn. Res.*, vol. 13, pp. 281–305, 2012.

### Solar and photovoltaic models (scenario layer and solar features)

[8] W. F. Holmgren, C. W. Hansen, and M. A. Mikofski, "pvlib python: A python package for
modeling solar energy systems," *J. Open Source Softw.*, vol. 3, no. 29, p. 884, 2018.
doi: 10.21105/joss.00884.

[20] D. G. Erbs, S. A. Klein, and J. A. Duffie, "Estimation of the diffuse radiation fraction for
hourly, daily and monthly-average global radiation," *Solar Energy*, vol. 28, no. 4,
pp. 293–302, 1982. doi: 10.1016/0038-092X(82)90302-4.

[21] B. Haurwitz, "Insolation in relation to cloudiness and cloud density," *J. Meteorol.*,
vol. 2, pp. 154–166, 1945.

[22] D. Faiman, "Assessing the outdoor operating temperature of photovoltaic modules," *Prog.
Photovolt.: Res. Appl.*, vol. 16, no. 4, pp. 307–315, 2008. doi: 10.1002/pip.813.

[23] A. P. Dobos, "PVWatts version 5 manual," National Renewable Energy Laboratory, Golden, CO,
USA, Tech. Rep. NREL/TP-6A20-62641, 2014.

### Scientific software

[24] F. Pedregosa *et al.*, "Scikit-learn: Machine learning in Python," *J. Mach. Learn. Res.*,
vol. 12, pp. 2825–2830, 2011.

[25] C. R. Harris *et al.*, "Array programming with NumPy," *Nature*, vol. 585, no. 7825,
pp. 357–362, 2020. doi: 10.1038/s41586-020-2649-2.

[26] W. McKinney, "Data structures for statistical computing in Python," in *Proc. 9th Python in
Science Conf. (SciPy)*, 2010, pp. 56–61. doi: 10.25080/Majora-92bf1922-00a.

## Secondary sources

[27] T. Hong and S. Fan, "Probabilistic electric load forecasting: A tutorial review," *Int. J.
Forecast.*, vol. 32, no. 3, pp. 914–938, 2016. doi: 10.1016/j.ijforecast.2015.11.011.

[28] R. J. Hyndman and A. B. Koehler, "Another look at measures of forecast accuracy," *Int. J.
Forecast.*, vol. 22, no. 4, pp. 679–688, 2006. doi: 10.1016/j.ijforecast.2006.03.001.

[29] L. J. Tashman, "Out-of-sample tests of forecasting accuracy: An analysis and review," *Int.
J. Forecast.*, vol. 16, no. 4, pp. 437–450, 2000. doi: 10.1016/S0169-2070(00)00065-0.

[30] R. J. Hyndman and G. Athanasopoulos, *Forecasting: Principles and Practice*, 3rd ed.
Melbourne, Australia: OTexts, 2021. [Online]. Available: https://otexts.com/fpp3/

[31] T. Hastie, R. Tibshirani, and J. Friedman, *The Elements of Statistical Learning: Data
Mining, Inference, and Prediction*, 2nd ed. New York, NY, USA: Springer, 2009.
doi: 10.1007/978-0-387-84858-7.

## Where each source is used

| Ref. | Used for | Documented in |
|---|---|---|
| [1] | Implementation anchor: LR vs RF vs XGBoost, holiday and 24 h lag features | [methodology](methodology.md) |
| [2], [4] | Literature context (non-parametric models; LSTM stretch goal) | [methodology](methodology.md) |
| [3] | Weekly and daily lags as top predictors; 24 h-ahead is harder | [methodology](methodology.md) |
| [5], [11] | Target series; Ontario wind and solar output | [data sources](data-sources.md) |
| [6] | Station weather for cross-checks | [data sources](data-sources.md) |
| [7], [12]–[14] | Weather history and forecasts | [data sources](data-sources.md) |
| [15] | Ontario holiday calendar | [data sources](data-sources.md) |
| [9], [10], [16]–[18], [24] | Algorithms | [methodology](methodology.md) |
| [19] | Random hyper-parameter search | [methodology](methodology.md) |
| [8], [20]–[23] | Sun position, clear-sky, PV and scenario models | [methodology](methodology.md) |
| [25], [26] | Numerical and data-frame libraries | [architecture](architecture.md) |
| [27] | Forecast intervals, holiday and weather effects | [methodology](methodology.md) |
| [28] | Accuracy metrics and their caveats | [methodology](methodology.md) |
| [29], [30] | Chronological evaluation, seasonal-naive benchmark | [methodology](methodology.md) |
| [31] | Background on trees, bagging, boosting and regularisation | [methodology](methodology.md) |
