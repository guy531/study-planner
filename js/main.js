"use strict";
// STARTING THE PAGE
// Choosing a field and a program, the theme buttons, and main(), which loads the data and sets everything up.
// This file loads last.

// ---------- fields and programs ----------

// the field list and the degrees of the chosen field (guy, 2026-11-03): a degree is in every field it names
const FIELD_ORDER = ["פיסיקה", "כימיה", "מדעי החיים", "מדעי כדור הארץ", "מדעי הטבע"];  // natural sciences last (guy, 2026-11-04)

// the academic advisors link follows the chosen field, not the degree (guy, 2026-11-03); a field without one here
// falls back to the program's own link (column "יועצים אקדמיים")
const FIELD_ADVISORS = {
  "פיסיקה": "https://academic.openu.ac.il/natural_sciences/physics/pages/counseling.aspx",
  "מדעי הטבע": "https://academic.openu.ac.il/natural_sciences/pages/counselling.aspx",
  "כימיה": "https://academic.openu.ac.il/natural_sciences/chemistry/pages/counseling.aspx",
  "מדעי החיים": "https://academic.openu.ac.il/natural_sciences/life/pages/counseling.aspx",
  "מדעי כדור הארץ": "https://academic.openu.ac.il/natural_sciences/earth/pages/counseling.aspx",
};

function showAdvisors() {
  const url = FIELD_ADVISORS[$("#field").value] || (program && program.advisors);
  $("#advisors-link").hidden = !url;
  if (url) $("#advisors-link").href = url;
}

const fieldsOf = (code) => (DATA.programs[code].fields && DATA.programs[code].fields.length ? DATA.programs[code].fields : [FIELD_ORDER[0]]);

function allFields() {
  const used = new Set(programOrder().flatMap(fieldsOf));
  return [...FIELD_ORDER.filter((f) => used.has(f)), ...[...used].filter((f) => !FIELD_ORDER.includes(f))];
}

// the degrees in the order of the programs file ("סדר ברשימה" first): Object.keys puts a code like "83" first
const programOrder = () => Object.keys(DATA.programs).sort((a, b) => {
  const pa = DATA.programs[a], pb = DATA.programs[b];
  return (pa.order ?? 1e6) - (pb.order ?? 1e6) || (pa.position ?? 0) - (pb.position ?? 0);
});

function fillPrograms(field) {
  $("#field").value = field;
  const codes = programOrder().filter((code) => fieldsOf(code).includes(field));
  $("#program").replaceChildren(...codes.map((code) => el("option", { value: code, text: DATA.programs[code].name })));
  try { localStorage.setItem(`${STORE_KEY}:field`, field); } catch (e) { /* no storage */ }
  return codes;
}

// the field list shows a field of the program (the one chosen before, if the program is in it)
function showProgramIn(code) {
  let field = $("#field").value;
  if (!fieldsOf(code).includes(field)) field = fieldsOf(code)[0];
  fillPrograms(field);
  $("#program").value = code;
}

function selectProgram(code) {
  showProgramIn(code);
  program = DATA.programs[code];
  state = load(code);
  selected = null;
  resetHistory();
  restoreHistory();
  renderStatic();
  render();
}

// ---------- light / dark, and colors for color blindness ----------

function setupThemeToggle() {
  const button = $("#theme-toggle");
  const show = () => button.setAttribute("aria-checked", document.documentElement.dataset.theme === "dark");
  button.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem(`${STORE_KEY}:theme`, dark ? "dark" : "light"); } catch (e) { /* no storage */ }
    show();
  });
  show();
}

// colors for color blindness (guy, 2026-11-08): a button beside light/dark, remembered in the browser
function setupCvdToggle() {
  const button = $("#cvd-toggle");
  const show = () => button.setAttribute("aria-pressed", document.documentElement.dataset.cvd === "on");
  button.addEventListener("click", () => {
    const on = document.documentElement.dataset.cvd !== "on";
    if (on) document.documentElement.dataset.cvd = "on"; else delete document.documentElement.dataset.cvd;
    try { localStorage.setItem(`${STORE_KEY}:cvd`, on ? "on" : "off"); } catch (e) { /* no storage */ }
    show();
    announce(on ? T("צבעים לעיוורי צבעים: פועל") : T("צבעים לעיוורי צבעים: כבוי"));
  });
  show();
}

// ---------- start ----------

// a reload (refresh, or a change of language) starts at the top of the page, not where the browser left it, which
// came out in the middle of the page (guy, 2026-10-31)
history.scrollRestoration = "manual";

async function main() {
  setupThemeToggle();
  setupCvdToggle();
  DATA = window.PLANNER_DATA || await fetch("data/data.json").then((r) => r.json());
  localizeData(DATA);
  translatePage();
  $("#lang").replaceChildren(...Object.entries(LANGS).map(([code, l]) => el("option", { value: code, text: l.name })));
  $("#lang").value = LANG;
  $("#lang").addEventListener("change", (e) => setLang(e.target.value));
  const codes = programOrder();
  $("#field").replaceChildren(...allFields().map((f) => el("option", { value: f, text: T(f) })));
  let last = null, field = null;
  try { last = localStorage.getItem(`${STORE_KEY}:last`); field = localStorage.getItem(`${STORE_KEY}:field`); } catch (e) { /* no storage */ }
  const code = codes.includes(last) ? last : codes[0];
  $("#field").value = allFields().includes(field) ? field : fieldsOf(code)[0];
  showProgramIn(code);
  setupDragAndDrop();
  setupHoverMarks();
  setupFind();
  setupMini();
  setupClicks();
  setupControls();
  setupSearch();
  selectProgram(code);
  openSharedPlan();
  window.addEventListener("hashchange", openSharedPlan); // a shared link pasted into an already open tab
}

main();
