// Builds the Phase 1 proposal deck: node build_deck.js [out.pptx]
// Needs: pptxgenjs, react, react-dom, react-icons, sharp
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");
const path = require("path");
const NOTES = require("./speaker_notes");

const OUT = process.argv[2] || path.join(__dirname, "ELG5255_Phase1_Ottawa_Load_Forecasting.pptx");
const APPLY_THEME = process.env.APPLY_THEME; // path to the pptx skill's apply_theme.js (optional)

const THEME = {
  name: "Ottawa Grid",
  headFontFace: "Calibri",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "1B2A2F", lt1: "FFFFFF", dk2: "0F3B3F", lt2: "EEF4F3",
    accent1: "F2A541", accent2: "2D8C8C", accent3: "C8553D", accent4: "5B7F95",
    accent5: "8FB996", accent6: "6B5B95", hlink: "2D8C8C", folHlink: "5B7F95",
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
pres.author = "Kshitij and Victor";
pres.title = "Forecasting Ottawa's Electricity Load for a Smarter Grid";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

const W = 13.333;
const M = 0.6;
const FOOT = "ELG 5255 Applied Machine Learning · Phase 1 Proposal · Kshitij & Victor";

pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: C.background1 },
  objects: [
    { text: { text: FOOT, options: { x: M, y: 7.0, w: 8, h: 0.3, fontSize: 10, color: C.text2, transparency: 30, isTextBox: true } } },
    { placeholder: { options: { name: "title", type: "title", x: M, y: 0.35, w: W - 2 * M - 2.4, h: 0.8, fontSize: 30, bold: true, color: C.text2, align: "left", valign: "middle", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: W - M - 0.6, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, color: C.text2, align: "right" },
});
pres.defineSlideMaster({
  title: "DARK",
  background: { color: C.text2 },
  objects: [],
});

async function icon(Comp, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: "#" + color, size: String(size) }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

// Icon in a filled circle: the deck's repeated motif.
async function badge(slide, Comp, x, y, d, fill, fg = HEX.lt1, name = "badge") {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill }, objectName: name + "-circle" });
  const pad = d * 0.24;
  slide.addImage({ data: await icon(Comp, fg), x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad, objectName: name + "-icon" });
}

function speaker(slide, who, text) {
  slide.addText(who, { x: W - M - 2.2, y: 0.35, w: 2.2, h: 0.8, fontSize: 14, italic: true, color: C.accent2, align: "right", valign: "middle", margin: 0, isTextBox: true });
}

function card(slide, x, y, w, h, fill = C.background2) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: fill } });
}

(async () => {
  // ---------- 1. Title ----------
  pres.addSection({ title: "Introduction" });
  let s = pres.addSlide({ masterName: "DARK", sectionTitle: "Introduction" });
  await badge(s, fa.FaBolt, M, 1.2, 1.0, HEX.accent1, HEX.dk2, "title-bolt");
  s.addText("Forecasting Ottawa's Electricity Load for a Smarter Grid", { x: M, y: 2.4, w: 10.5, h: 1.8, fontSize: 44, bold: true, color: C.background1, margin: 0, isTextBox: true });
  s.addText("Weather- and calendar-aware machine learning forecasts of hourly demand and baseload, with a net-load view of solar, wind and EV fleets", { x: M, y: 4.25, w: 10.5, h: 0.9, fontSize: 18, color: C.background2, margin: 0, isTextBox: true });
  s.addText([
    { text: "Kshitij  ·  Victor", options: { bold: true, breakLine: true } },
    { text: "ELG 5255 Applied Machine Learning · University of Ottawa · Phase 1 Proposal · October 13, 2026" },
  ], { x: M, y: 5.8, w: 11, h: 0.8, fontSize: 14, color: C.accent1, margin: 0, isTextBox: true });
  s.addNotes(NOTES.title);

  // ---------- 2. Problem & research question ----------
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Introduction" });
  s.addText("The problem: what drives Ottawa's electricity load?", { placeholder: "title" });
  speaker(s, "Kshitij");
  const drivers = [
    [fa.FaThermometerHalf, "Weather", "Cold winters cause heating peaks; hot summers cause cooling peaks"],
    [fa.FaCalendarAlt, "Calendar", "Workdays, weekends and statutory holidays change the daily load profile"],
    [fa.FaSolarPanel, "Renewables", "Solar and wind output changes from hour to hour with the weather"],
    [fa.FaChargingStation, "Electrification", "EV fleets add large charging loads that can be scheduled"],
  ];
  for (let i = 0; i < drivers.length; i++) {
    const y = 1.45 + i * 1.12;
    await badge(s, drivers[i][0], M, y, 0.8, i % 2 ? HEX.accent2 : HEX.dk2, HEX.lt1, "driver" + i);
    s.addText([
      { text: drivers[i][1], options: { bold: true, fontSize: 18, color: C.text2, breakLine: true } },
      { text: drivers[i][2], options: { fontSize: 14, color: C.text1 } },
    ], { x: M + 1.0, y: y - 0.05, w: 5.2, h: 0.95, valign: "middle", margin: 0, isTextBox: true });
  }
  card(s, 7.2, 1.45, 5.53, 4.35, C.text2);
  s.addText([
    { text: "Research question", options: { bold: true, fontSize: 20, color: C.accent1, breakLine: true } },
    { text: " ", options: { fontSize: 8, breakLine: true } },
    { text: "Can tree-ensemble models (Random Forest, XGBoost) forecast Ottawa's hourly electricity demand and next-day baseload more accurately than a Linear Regression baseline, using lagged demand, weather and calendar features?", options: { fontSize: 16, color: C.background1, breakLine: true } },
    { text: " ", options: { fontSize: 8, breakLine: true } },
    { text: "Why it matters: an accurate forecast lets the grid schedule supply, storage and flexible loads (such as EV charging) ahead of demand, instead of reacting to it.", options: { fontSize: 14, italic: true, color: C.background2 } },
  ], { x: 7.5, y: 1.65, w: 4.95, h: 3.95, valign: "top", margin: 0, isTextBox: true });
  s.addText("Baseload is the minimum level of demand that the grid must always serve. We define it as the lowest hourly load of each day.", { x: M, y: 6.1, w: W - 2 * M, h: 0.5, fontSize: 12, italic: true, color: C.text2, margin: 0, isTextBox: true });
  s.addNotes(NOTES.problem);

  // ---------- 3. State of the art: evidence ----------
  pres.addSection({ title: "State of the art" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "State of the art" });
  s.addText("State of the art: what recent studies found", { placeholder: "title" });
  speaker(s, "Victor");
  s.addChart(pres.charts.BAR, [{ name: "MAPE (%)", labels: ["Deep learning", "LightGBM", "Random Forest", "XGBoost", "SVR", "AdaBoost"], values: [2.90, 3.07, 3.22, 3.45, 4.90, 5.70] }], {
    x: M, y: 1.35, w: 4.9, h: 4.55, barDir: "bar", catAxisOrientation: "maxMin",
    showTitle: true, title: "Ibrahim et al. [3]: 1-h-ahead MAPE (lower is better)", titleFontSize: 12, titleColor: HEX.dk2, titleFontFace: "+mn-lt",
    chartColors: [HEX.accent4, HEX.accent2, HEX.accent1, HEX.accent1, HEX.accent4, HEX.accent4], varyColors: true,
    showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '0.00"%"', dataLabelFontSize: 11, dataLabelColor: HEX.dk1, dataLabelFontFace: "+mn-lt",
    catAxisLabelColor: HEX.dk1, valAxisLabelColor: HEX.dk1, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
    valGridLine: { color: "D9E2E1", size: 0.5 }, catGridLine: { style: "none" }, showLegend: false, valAxisMaxVal: 7, valAxisMinVal: 0,
  });
  s.addText("Orange bars mark the two models we propose. Random Forest reached R² = 0.92 with 7.1 s of training, versus 20 min for deep learning.", { x: M, y: 5.95, w: 4.9, h: 0.55, fontSize: 11, italic: true, color: C.text2, margin: 0, isTextBox: true });
  const th = (t) => ({ text: t, options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk2 } } });
  const studies = [
    [th("Study"), th("Data"), th("Result")],
    ["[1] Gökçe & Duman, IEEE IISEC 2022", "Turkey, hourly, 2018–21 (35,064 h); temperature, holidays, 24-hour lag", "RMSE: LR 2348, RF 2075, XGBoost 2039. RF had the lowest absolute and percentage errors"],
    ["[2] Rawal & Ahmad, IEEE ICPC2T 2022", "New South Wales, Australia, 2020; eight regression models", "Non-parametric models outperformed parametric ones; Random Forest was best"],
    ["[3] Ibrahim et al., Energies 2022", "Panama, hourly, 2016–19 (33,600 h); temperature, humidity, lagged load", "Deep learning R² = 0.93; RF and LightGBM R² = 0.92; 24-hour-ahead Bi-LSTM only 0.40"],
    ["[4] Kong et al., IEEE Trans. Smart Grid 2019", "Household smart-meter data", "LSTM outperformed competing methods for individual households"],
  ];
  s.addTable(studies, {
    x: 5.85, y: 1.35, w: 6.88, colW: [2.05, 2.35, 2.48], fontSize: 11, color: HEX.dk1, valign: "middle",
    border: { type: "solid", pt: 0.5, color: "D9E2E1" }, fill: { color: HEX.lt1 }, rowH: [0.4, 1.0, 0.85, 1.0, 0.7], margin: [0.04, 0.08, 0.04, 0.08],
  });
  s.addNotes(NOTES.sotaEvidence);

  // ---------- 4. State of the art: lessons ----------
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "State of the art" });
  s.addText("How the literature shapes our design", { placeholder: "title" });
  speaker(s, "Victor");
  const lessons = [
    [fa.FaHistory, "Lagged load and temperature drive accuracy", "Load from the previous week and day, plus temperature, were the top predictors in [3]; [1] used a 24-hour lag.", "Lags t-1, t-24, t-168; temperature, humidity"],
    [fa.FaCalendarAlt, "Calendar effects matter", "Both [1] and [3] used holiday and working-day indicators as inputs.", "Ontario statutory-holiday and workday flags"],
    [fa.FaTree, "Tree ensembles: near-best accuracy at low cost", "RF and XGBoost outperformed LR in [1]–[3], and came within 0.3 percentage points of deep learning's MAPE in [3].", "LR baseline vs Random Forest [9] vs XGBoost [10]"],
    [fa.FaExclamationTriangle, "Known weak spots", "Summer heat and COVID-19 reduced accuracy in [1]; 24-hour-ahead forecasts were much harder in [3].", "Report errors by season and horizon; flag the 2020 COVID period"],
  ];
  for (let i = 0; i < lessons.length; i++) {
    const y = 1.35 + i * 1.12;
    card(s, M, y, 7.4, 0.98);
    await badge(s, lessons[i][0], M + 0.2, y + 0.17, 0.64, HEX.accent2, HEX.lt1, "lesson" + i);
    s.addText([
      { text: lessons[i][1], options: { bold: true, fontSize: 14, color: HEX.dk2, breakLine: true } },
      { text: lessons[i][2], options: { fontSize: 12, color: HEX.dk1 } },
    ], { x: M + 1.05, y: y + 0.04, w: 6.2, h: 0.9, valign: "middle", margin: 0, isTextBox: true });
    s.addShape(pres.shapes.RIGHT_ARROW, { x: M + 7.5, y: y + 0.36, w: 0.3, h: 0.26, fill: { color: C.accent1 }, line: { color: C.accent1 } });
    card(s, M + 7.9, y, 4.23, 0.98, C.text2);
    s.addText(lessons[i][3], { x: M + 8.1, y: y + 0.04, w: 3.85, h: 0.9, fontSize: 13, bold: true, color: C.background1, valign: "middle", margin: 0, isTextBox: true });
  }
  s.addText([
    { text: "Gap we address: ", options: { bold: true, color: HEX.accent3 } },
    { text: "the four studies forecast a whole country, a state or a single home. None targets a city zone such as Ottawa, or examines how solar, wind and EV fleets change the net load left to serve." },
  ], { x: M, y: 5.95, w: W - 2 * M, h: 0.6, fontSize: 13, color: HEX.dk1, valign: "middle", margin: 0, isTextBox: true });
  s.addNotes(NOTES.sotaLessons);

  // ---------- 4. Proposed solution ----------
  pres.addSection({ title: "Proposal" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Proposal" });
  s.addText("Proposed solution: forecast, then balance", { placeholder: "title" });
  speaker(s, "Kshitij");
  const stages = [
    [fa.FaDatabase, "1 · Real data", "IESO hourly demand (Ottawa zone), ECCC and Open-Meteo weather, Ontario holidays"],
    [fa.FaCogs, "2 · Features", "Lags t-1, t-24, t-168; temperature, HDD/CDD; hour, weekday, month, holiday flag"],
    [fa.FaBrain, "3 · ML models", "Linear Regression (baseline), Random Forest, XGBoost"],
    [fa.FaChartLine, "4 · Forecasts", "Next-hour demand and next-day baseload (daily minimum)"],
  ];
  const sw = 2.78, sg = 0.27;
  for (let i = 0; i < stages.length; i++) {
    const x = M + i * (sw + sg);
    card(s, x, 1.45, sw, 2.75);
    await badge(s, stages[i][0], x + 0.25, 1.65, 0.7, i === 2 ? HEX.accent1 : HEX.dk2, i === 2 ? HEX.dk2 : HEX.lt1, "stage" + i);
    s.addText(stages[i][1], { x: x + 0.25, y: 2.45, w: sw - 0.5, h: 0.4, fontSize: 16, bold: true, color: C.text2, margin: 0, isTextBox: true });
    s.addText(stages[i][2], { x: x + 0.25, y: 2.85, w: sw - 0.5, h: 1.25, fontSize: 13, color: C.text1, valign: "top", margin: 0, isTextBox: true });
    if (i < stages.length - 1) {
      s.addShape(pres.shapes.RIGHT_ARROW, { x: x + sw + 0.03, y: 2.68, w: 0.21, h: 0.3, fill: { color: C.accent2 }, line: { color: C.accent2 } });
    }
  }
  card(s, M, 4.5, W - 2 * M, 2.0, C.text2);
  await badge(s, fa.FaBalanceScale, M + 0.3, 4.75, 0.8, HEX.accent1, HEX.dk2, "netload");
  s.addText([
    { text: "5 · Scenario layer: live supply-demand view", options: { bold: true, fontSize: 18, color: C.accent1, breakLine: true } },
    { text: "Net load = forecast demand − solar farm − wind farm + EV fleet charging", options: { fontSize: 16, bold: true, color: C.background1, breakLine: true } },
    { text: "Solar and wind output are estimated from weather data with physical models, and EV charging from workday and holiday schedules. The result shows, hour by hour, how much dispatchable supply is needed and when flexible EV charging can be shifted.", options: { fontSize: 13, color: C.background2 } },
  ], { x: M + 1.4, y: 4.6, w: W - 2 * M - 1.7, h: 1.8, valign: "middle", margin: 0, isTextBox: true });
  s.addNotes(NOTES.solution);

  // ---------- 5. Data: real vs assumed ----------
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Proposal" });
  s.addText("Data: real where possible, assumed where not", { placeholder: "title" });
  speaker(s, "Victor");
  const hdr = (t) => ({ text: t, options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk2 } } });
  const tag = (real) => ({ text: real ? "REAL" : "ASSUMED", options: { bold: true, color: real ? HEX.dk2 : HEX.dk1, fill: { color: real ? HEX.accent5 : HEX.accent1 }, align: "center" } });
  const rows = [
    [hdr("Component"), hdr("Source"), hdr("Resolution"), hdr("Type")],
    ["Ottawa-zone electricity demand (target)", "IESO Hourly Zonal Demand Report, Ottawa zone [5]", "Hourly, 2020–2025", tag(true)],
    ["Temperature, humidity", "ECCC historical climate data, Ottawa station [6]", "Hourly", tag(true)],
    ["Solar irradiance, 100 m wind speed", "Open-Meteo historical weather API [7]", "Hourly", tag(true)],
    ["Holidays, workdays", "Ontario statutory holiday calendar", "Daily", tag(true)],
    ["Solar farm output", "pvlib PV model [8] driven by real irradiance", "Hourly", tag(false)],
    ["Wind farm output", "Generic turbine power curve driven by real wind speed", "Hourly", tag(false)],
    ["Residential vs. industrial split, EV fleet load", "Calendar-based profiles (next slide)", "Hourly", tag(false)],
  ];
  s.addTable(rows, {
    x: M, y: 1.4, w: W - 2 * M, colW: [3.6, 4.9, 1.9, 1.73], fontSize: 13, color: HEX.dk1, valign: "middle",
    border: { type: "solid", pt: 0.5, color: "D9E2E1" }, fill: { color: HEX.lt1 }, rowH: 0.52, margin: [0.04, 0.1, 0.04, 0.1],
  });
  s.addText("Data split: training 2020–2023, validation 2024, test 2025. The split is chronological with no shuffling, so no future data leaks into training.", { x: M, y: 5.85, w: W - 2 * M, h: 0.5, fontSize: 14, italic: true, color: C.text2, margin: 0, isTextBox: true });
  s.addNotes(NOTES.data);

  // ---------- 6. Assumptions ----------
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Proposal" });
  s.addText("Scenario assumptions: explicit and adjustable", { placeholder: "title" });
  speaker(s, "Kshitij");
  const asm = [
    [fa.FaSun, "Solar farm", "A 10 MW (AC) fixed-tilt array near Ottawa. Output is modelled with pvlib from real irradiance and temperature: zero at night, reduced under snow."],
    [fa.FaWind, "Wind farm", "A 20 MW farm (e.g., six 3.3 MW turbines). Power curve: cut-in 3 m/s, rated 12 m/s, cut-out 25 m/s, applied to 100 m wind speed."],
    [fa.FaHome, "Residential", "Follows temperature (heating and cooling degree-hours), with morning and evening peaks; higher on weekends and holidays."],
    [fa.FaIndustry, "Industrial / commercial", "A flat daytime block on workdays, reduced on weekends and statutory holidays, and minimal overnight."],
    [fa.FaChargingStation, "EV fleet", "300 fleet vehicles using about 60 kWh each per workday, charged overnight (22:00–06:00); about 30% of that on holidays."],
    [fa.FaSlidersH, "Calibration", "Component shares are scaled so that they add up to the real IESO Ottawa-zone total. Every parameter can be varied for stress tests."],
  ];
  const cw = 3.84, ch = 2.45, gx = 0.3, gy = 0.3;
  for (let i = 0; i < asm.length; i++) {
    const x = M + (i % 3) * (cw + gx), y = 1.4 + Math.floor(i / 3) * (ch + gy);
    card(s, x, y, cw, ch);
    await badge(s, asm[i][0], x + 0.25, y + 0.25, 0.65, i === 5 ? HEX.accent1 : HEX.accent2, i === 5 ? HEX.dk2 : HEX.lt1, "asm" + i);
    s.addText(asm[i][1], { x: x + 1.05, y: y + 0.25, w: cw - 1.3, h: 0.65, fontSize: 17, bold: true, color: C.text2, valign: "middle", margin: 0, isTextBox: true });
    s.addText(asm[i][2], { x: x + 0.25, y: y + 1.0, w: cw - 0.5, h: ch - 1.15, fontSize: 13, color: C.text1, valign: "top", margin: 0, isTextBox: true });
  }
  s.addNotes(NOTES.assumptions);

  // ---------- 7. Models & evaluation ----------
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Proposal" });
  s.addText("Methodology: models, baselines and evaluation", { placeholder: "title" });
  speaker(s, "Victor");
  const models = [
    ["Persistence / seasonal naive", "The minimum bar for every model: demand(t+1) = demand(t), or the same hour last week"],
    ["Linear Regression", "An interpretable baseline that shows how much of the load is linear in temperature and calendar"],
    ["Random Forest", "An ensemble of bagged trees [9] that captures the nonlinear (U-shaped) heating and cooling response"],
    ["XGBoost", "Gradient-boosted trees [10]; achieved the lowest RMSE of the three models in [1]"],
  ];
  for (let i = 0; i < models.length; i++) {
    const y = 1.4 + i * 1.08;
    card(s, M, y, 6.6, 0.95, i >= 2 ? C.text2 : C.background2);
    s.addText([
      { text: models[i][0], options: { bold: true, fontSize: 15, color: i >= 2 ? HEX.accent1 : HEX.dk2, breakLine: true } },
      { text: models[i][1], options: { fontSize: 13, color: i >= 2 ? HEX.lt1 : HEX.dk1 } },
    ], { x: M + 0.25, y: y + 0.05, w: 6.1, h: 0.85, valign: "middle", margin: 0, isTextBox: true });
  }
  s.addText("Stretch goal: an LSTM sequence model [4], if time allows.", { x: M, y: 5.8, w: 6.6, h: 0.45, fontSize: 13, italic: true, color: C.text2, margin: 0, isTextBox: true });
  const metrics = [["MAE", "MW"], ["RMSE", "MW"], ["MAPE", "%"], ["R²", "goodness of fit"]];
  s.addText("Evaluation on the unseen 2025 test year", { x: 7.6, y: 1.4, w: 5.1, h: 0.45, fontSize: 17, bold: true, color: C.text2, margin: 0, isTextBox: true });
  for (let i = 0; i < metrics.length; i++) {
    const x = 7.6 + (i % 2) * 2.6, y = 2.0 + Math.floor(i / 2) * 1.45;
    card(s, x, y, 2.35, 1.25);
    s.addText([
      { text: metrics[i][0], options: { fontSize: 30, bold: true, color: HEX.accent2, breakLine: true } },
      { text: metrics[i][1], options: { fontSize: 12, color: HEX.dk1 } },
    ], { x, y, w: 2.35, h: 1.25, align: "center", valign: "middle", margin: 0, isTextBox: true });
  }
  s.addText([
    { text: "Critical analysis: ", options: { bold: true } },
    { text: "errors by season, peak hours and holidays; feature importance; residual plots; and finally, net-load error once the solar, wind and EV scenarios are added." },
  ], { x: 7.6, y: 5.0, w: 5.1, h: 1.25, fontSize: 13, color: C.text1, valign: "top", margin: 0, isTextBox: true });
  s.addNotes(NOTES.methods);

  // ---------- 8. Feasibility & timeline ----------
  pres.addSection({ title: "Plan" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Plan" });
  s.addText("Feasibility and timeline", { placeholder: "title" });
  speaker(s, "Kshitij");
  card(s, M, 1.4, 5.9, 4.9);
  s.addText([
    { text: "Why this scope is realistic", options: { bold: true, fontSize: 17, color: HEX.dk2, breakLine: true } },
    { text: "The data is free, public and hourly: about 52,000 rows for 2020–2025, small enough to train in seconds to minutes on a laptop.", options: { bullet: true, breakLine: true } },
    { text: "We use standard, well-documented libraries: pandas, scikit-learn, XGBoost and pvlib.", options: { bullet: true, breakLine: true } },
    { text: "The core ML deliverable (steps 1–4) does not depend on the scenario layer, so the scenarios cannot put it at risk.", options: { bullet: true, breakLine: true } },
    { text: "Clear fallback: if the zonal data is incomplete, we will use IESO's Ontario-wide hourly demand with the same pipeline.", options: { bullet: true, breakLine: true } },
    { text: "Out of scope: real-time control, power-flow simulation of the grid, and private utility data.", options: { bullet: true } },
  ], { x: M + 0.25, y: 1.55, w: 5.4, h: 4.6, fontSize: 14, color: HEX.dk1, valign: "top", paraSpaceAfter: 8, margin: 0, isTextBox: true });
  const tl = [
    ["Oct 13", "Proposal (this talk)"],
    ["Oct 14–31", "Collect and clean data; build features; explore the data"],
    ["Nov 1–15", "Train the baselines, RF and XGBoost; tune on 2024 data"],
    ["Nov 16–28", "Build the scenario layer: solar, wind, EV and net load"],
    ["Nov 29–Dec 8", "Analyse the test year; prepare the final presentation"],
    ["Dec 14", "Submit the final report in IEEE format"],
  ];
  const tx = 7.1;
  s.addShape(pres.shapes.LINE, { x: tx + 0.2, y: 1.6, w: 0, h: 4.5, line: { color: HEX.accent2, width: 2 } });
  for (let i = 0; i < tl.length; i++) {
    const y = 1.45 + i * 0.82;
    s.addShape(pres.shapes.OVAL, { x: tx + 0.05, y: y + 0.12, w: 0.3, h: 0.3, fill: { color: i === 0 ? C.accent1 : C.accent2 }, line: { color: C.background1, width: 2 } });
    s.addText([
      { text: tl[i][0], options: { bold: true, color: HEX.dk2, breakLine: true } },
      { text: tl[i][1], options: { color: HEX.dk1 } },
    ], { x: tx + 0.6, y: y - 0.05, w: 5.0, h: 0.72, fontSize: 14, valign: "top", margin: 0, isTextBox: true });
  }
  s.addNotes(NOTES.feasibility);

  // ---------- 9. Team & AI use ----------
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Plan" });
  s.addText("Team contributions and use of AI", { placeholder: "title" });
  const people = [
    [fa.FaUserAlt, "Kshitij", "Problem definition and research question; smart-grid scenario layer (solar, wind, EV, net load); feasibility and timeline; slide design."],
    [fa.FaUserAlt, "Victor", "State-of-the-art review; data sources and preprocessing pipeline; model training and evaluation design."],
  ];
  for (let i = 0; i < people.length; i++) {
    const y = 1.4 + i * 1.55;
    card(s, M, y, 5.9, 1.35);
    await badge(s, people[i][0], M + 0.25, y + 0.3, 0.75, HEX.dk2, HEX.lt1, "person" + i);
    s.addText([
      { text: people[i][1], options: { bold: true, fontSize: 17, color: HEX.dk2, breakLine: true } },
      { text: people[i][2], options: { fontSize: 13, color: HEX.dk1 } },
    ], { x: M + 1.25, y: y + 0.1, w: 4.45, h: 1.15, valign: "middle", margin: 0, isTextBox: true });
  }
  s.addText("Both members will share the coding and the writing of the final report.", { x: M, y: 4.55, w: 5.9, h: 0.5, fontSize: 13, italic: true, color: C.text2, margin: 0, isTextBox: true });
  card(s, 6.9, 1.4, 5.83, 4.9, C.text2);
  await badge(s, fa.FaRobot, 7.15, 1.6, 0.75, HEX.accent1, HEX.dk2, "ai");
  s.addText("AI disclosure", { x: 8.1, y: 1.6, w: 4.4, h: 0.75, fontSize: 20, bold: true, color: C.accent1, valign: "middle", margin: 0, isTextBox: true });
  s.addText([
    { text: "ChatGPT (OpenAI): ", options: { bold: true, color: HEX.accent1 } },
    { text: "creating summary tables and illustrative diagrams for our draft.", options: { color: HEX.lt1, breakLine: true } },
    { text: "Claude (Anthropic), via Claude Code: ", options: { bold: true, color: HEX.accent1 } },
    { text: "restructuring the deck for the 5-minute limit, improving slide wording and layout, proofreading, checking citations, and drafting the scenario assumptions for our review.", options: { color: HEX.lt1, breakLine: true } },
    { text: "Our own work: ", options: { bold: true, color: HEX.accent1 } },
    { text: "the choice of problem, papers, data sources and methods. We checked every number against the cited papers and take responsibility for all content.", options: { color: HEX.lt1 } },
  ], { x: 7.15, y: 2.55, w: 5.35, h: 3.6, fontSize: 14, valign: "top", paraSpaceAfter: 10, margin: 0, isTextBox: true });
  s.addNotes(NOTES.team);

  // ---------- 10. References ----------
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Plan" });
  s.addText("References", { placeholder: "title" });
  const refs = [
    "[1] M. M. Gökçe and E. Duman, “Performance Comparison of Simple Regression, Random Forest and XGBoost Algorithms for Forecasting Electricity Demand,” in Proc. 3rd Int. Informatics and Software Engineering Conf. (IISEC), Ankara, Turkey, 2022. doi: 10.1109/IISEC56263.2022.9998213.",
    "[2] K. Rawal and A. Ahmad, “A Comparative Analysis of Supervised Machine Learning Algorithms for Electricity Demand Forecasting,” in Proc. 2nd Int. Conf. Power, Control and Computing Technologies (ICPC2T), 2022, pp. 1–6. doi: 10.1109/ICPC2T53885.2022.9776960.",
    "[3] B. Ibrahim, L. Rabelo, E. Gutierrez-Franco and N. Clavijo-Buritica, “Machine Learning for Short-Term Load Forecasting in Smart Grids,” Energies, vol. 15, no. 21, art. 8079, 2022. doi: 10.3390/en15218079.",
    "[4] W. Kong, Z. Y. Dong, Y. Jia, D. J. Hill, Y. Xu and Y. Zhang, “Short-Term Residential Load Forecasting Based on LSTM Recurrent Neural Network,” IEEE Trans. Smart Grid, vol. 10, no. 1, pp. 841–851, 2019. doi: 10.1109/TSG.2017.2753802.",
    "[5] Independent Electricity System Operator (IESO), “Hourly Zonal Demand Report.” [Online]. Available: https://reports-public.ieso.ca/public/DemandZonal/",
    "[6] Environment and Climate Change Canada, “Historical Climate Data.” [Online]. Available: https://climate.weather.gc.ca/",
    "[7] Open-Meteo, “Historical Weather API.” [Online]. Available: https://open-meteo.com/en/docs/historical-weather-api",
    "[8] W. F. Holmgren, C. W. Hansen and M. A. Mikofski, “pvlib python: a python package for modeling solar energy systems,” J. Open Source Software, vol. 3, no. 29, p. 884, 2018. doi: 10.21105/joss.00884.",
    "[9] L. Breiman, “Random Forests,” Machine Learning, vol. 45, no. 1, pp. 5–32, 2001. doi: 10.1023/A:1010933404324.",
    "[10] T. Chen and C. Guestrin, “XGBoost: A Scalable Tree Boosting System,” in Proc. 22nd ACM SIGKDD Int. Conf. Knowledge Discovery and Data Mining, 2016, pp. 785–794. doi: 10.1145/2939672.2939785.",
  ];
  s.addText(refs.map((r, i) => ({ text: r, options: { breakLine: i < refs.length - 1 } })), {
    x: M, y: 1.35, w: W - 2 * M, h: 5.5, fontSize: 11, color: C.text1, valign: "top", paraSpaceAfter: 5, margin: 0, isTextBox: true,
  });

  s.addNotes(NOTES.references);

  // ---------- 11. Q&A ----------
  s = pres.addSlide({ masterName: "DARK", sectionTitle: "Plan" });
  await badge(s, fa.FaQuestion, W / 2 - 0.6, 2.0, 1.2, HEX.accent1, HEX.dk2, "qa");
  s.addText("Questions?", { x: 0, y: 3.5, w: W, h: 1.0, fontSize: 44, bold: true, color: C.background1, align: "center", isTextBox: true });
  s.addText("Forecasting Ottawa's load from real data and balancing it against solar, wind and EV fleets", { x: 1, y: 4.5, w: W - 2, h: 0.6, fontSize: 18, color: C.accent1, align: "center", isTextBox: true });

  s.addNotes(NOTES.questions);

  await pres.writeFile({ fileName: OUT });
  if (APPLY_THEME) {
    const { applyTheme } = require(APPLY_THEME);
    await applyTheme(OUT, THEME);
  }
  console.log("wrote", OUT);
})();
