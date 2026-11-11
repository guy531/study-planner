"use strict";
// THE PLAN AND ITS STORAGE
// The student's plan (`state`), the program it is for (`program`) and the data (`DATA`), and everything that keeps
// the plan: saving in the browser, undo / redo, and the semester ids ("2027א", "2027ב", "2027ג"...).
// Every change to the plan ends in save(), and then render() draws the page again from `state`.
// See ARCHITECTURE.md for how the files fit together.

// ---------- names used everywhere ----------

const STORE_KEY = "physics-planner-v1";

const LETTERS = ["א", "ב", "ג"];

const $ = (sel) => document.querySelector(sel);

// scrolling that jumps instead of gliding when the system asks to reduce motion (accessibility)
const SMOOTH = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

// ---------- the data, the program and the plan ----------

let DATA = null;

let program = null;

let state = null;

// ---------- what the page is doing right now (not saved) ----------

let selected = null; // course number picked by tap (phones), waiting for a destination

let dragging = null; // course number being dragged, so semesters that refuse it can show it

let hovering = null; // course number under the mouse: the semesters take its colors too (guy, 2026-11-01)

let hoverSkip = null; // the course just dropped: no hover colors for it until the mouse leaves it

let toastTimer = null;

let reopenWindow = null; // redraws the open course window after a change made from inside it

let problems = []; // unmet admission / required-knowledge conditions of placed courses, rebuilt on every render

let showPlaced = false; // the tree's switch: show what is already in the plan in full, instead of shrunk

const openGroups = new Set(); // finished (shrunk) groups the student opened

// ---------- a new plan, and loading a saved one ----------

function defaultState(code) {
  return { program: code, start: "2027א", done: [], semesters: Array.from({ length: 9 }, () => []), extra: [], background: [], skills: [], locked: [], blocked: [] };
}

// the plan always starts in semester א of a year (guy, 2026-10-31); a student who starts later blocks the semesters
// before it. A plan saved (or shared) with a start in ב or ג moves to א of that year, with the semesters before blocked
function fromYearStart(st) {
  st.blocked = (st.blocked || []).filter((i) => Number.isInteger(i));
  const off = LETTERS.indexOf(st.start.slice(4));
  if (off > 0) {
    st.start = `${st.start.slice(0, 4)}א`;
    st.semesters = [...Array.from({ length: off }, () => []), ...st.semesters];
    st.blocked = [...Array.from({ length: off }, (_, i) => i), ...st.blocked.map((i) => i + off)];
  }
  return st;
}

function load(code) {
  try {
    const saved = JSON.parse(localStorage.getItem(`${STORE_KEY}:${code}`));
    if (saved && Array.isArray(saved.semesters)) {
      saved.semesters = saved.semesters.map((s) => s.filter((n) => !n.startsWith("slot:"))); // slot cards are gone
      return fromYearStart({ background: [], skills: [], locked: [], blocked: [], ...saved });
    }
  } catch (e) { /* storage unavailable - start fresh */ }
  return defaultState(code);
}

// a semester the student blocked (guy, 2026-10-31): nothing can be placed in it, and automatic completion skips it;
// only the recommended fill, which replaces the whole plan, clears the blocks
const isBlockedSemester = (i) => (state.blocked || []).includes(i);

// ---------- saving, undo and redo ----------

// undo / redo: every change to the plan ends in save(), so save() keeps the plan as it was before the change.
// The history lives while the tab is open (also across a reload, see keepHistory), per program, up to HISTORY_LIMIT steps
const HISTORY_LIMIT = 50;

let undoStack = [];

let redoStack = [];

let lastSaved = null; // the plan as last saved, as JSON

function persist() {
  try {
    localStorage.setItem(`${STORE_KEY}:${state.program}`, JSON.stringify(state));
    localStorage.setItem(`${STORE_KEY}:last`, state.program);
  } catch (e) { /* storage unavailable - the plan lives only in this tab */ }
}

// the plan as JSON with its fields in a fixed order: a reset of an untouched plan builds the same plan with its fields
// in another order, and must not count as a change that can be undone (guy)
const planJSON = (st) => JSON.stringify(Object.fromEntries(Object.entries(st).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

function save() {
  const now = planJSON(state);
  if (lastSaved !== null && now !== lastSaved) {
    undoStack.push(lastSaved);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
  }
  lastSaved = now;
  persist();
  updateHistoryButtons();
}

function resetHistory() {
  undoStack = [];
  redoStack = [];
  lastSaved = planJSON(state);
  updateHistoryButtons();
}

// a language switch reloads the page, and so does a refresh: the history goes to this tab's sessionStorage on the
// way out and comes back on load (guy, 2026-10-31: Ctrl+Z was lost after switching to English). Only if it is the
// same program and the same plan; it is read once, so switching programs later still starts a fresh history
const HISTORY_KEY = `${STORE_KEY}:history`;

function keepHistory() {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify({ program: state.program, lastSaved, undoStack, redoStack }));
  } catch (e) { /* no storage: the history ends with the page, as before */ }
}

function restoreHistory() {
  try {
    const kept = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "null");
    sessionStorage.removeItem(HISTORY_KEY);
    if (!kept || kept.program !== state.program || kept.lastSaved !== planJSON(state)) return;
    undoStack = kept.undoStack || [];
    redoStack = kept.redoStack || [];
    updateHistoryButtons();
  } catch (e) { /* no storage, or a broken entry: a fresh history */ }
}

addEventListener("pagehide", keepHistory);

function stepHistory(from, to) {
  if (!from.length) return;
  to.push(lastSaved);
  lastSaved = from.pop();
  state = JSON.parse(lastSaved);
  selected = null;
  persist();
  render(true);
  updateHistoryButtons();
}

const undo = () => stepHistory(undoStack, redoStack);

const redo = () => stepHistory(redoStack, undoStack);

function updateHistoryButtons() {
  const u = $("#undo"), r = $("#redo");
  if (!u) return;
  u.disabled = !undoStack.length;
  r.disabled = !redoStack.length;
  // nothing to reset in an untouched plan, so the button cannot be pressed (guy)
  if (program) $("#reset").disabled = planJSON(defaultState(program.code)) === planJSON(state);
}

// ---------- semesters ----------

function nextSemester(id) {
  const year = Number(id.slice(0, 4));
  const i = LETTERS.indexOf(id.slice(4));
  return i === 2 ? `${year + 1}א` : `${year}${LETTERS[i + 1]}`;
}

function prevSemester(id) {
  const year = Number(id.slice(0, 4));
  const i = LETTERS.indexOf(id.slice(4));
  return i === 0 ? `${year - 1}ג` : `${year}${LETTERS[i - 1]}`;
}

function semesterIds() {
  const ids = [state.start];
  while (ids.length < state.semesters.length) ids.push(nextSemester(ids[ids.length - 1]));
  return ids;
}

// a semester's place in time, to compare two ids ("2027ג" comes before "2028א")
const semesterOrder = (id) => Number(id.slice(0, 4)) * 3 + LETTERS.indexOf(id.slice(4));

function semesterLabel(id) {
  return id.endsWith("ג") ? T`${semName(id)} (קיץ)` : semName(id);
}

// ---------- where a course is in the plan ----------

function locationOf(n) {
  if (state.done.includes(n)) return "done";
  const i = state.semesters.findIndex((s) => s.includes(n));
  return i >= 0 ? i : null;
}

// a locked course stays where it is: it cannot be dragged or removed, and reset or filling from the recommended
// plan leaves it in place (guy). Courses in "done" can be locked too: reset keeps all of them anyway, but the
// "clear" button of that area keeps only the locked ones (guy)
const isLocked = (n) => (state.locked || []).includes(n);

function plannedCourses() {
  return [...state.done, ...state.semesters.flat()];
}
