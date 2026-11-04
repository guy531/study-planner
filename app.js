"use strict";
// Degree planner prototype. Works only by course numbers: names and details come from data.json.

const STORE_KEY = "physics-planner-v1";
const LETTERS = ["א", "ב", "ג"];
const $ = (sel) => document.querySelector(sel);
// scrolling that jumps instead of gliding when the system asks to reduce motion (accessibility)
const SMOOTH = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

let DATA = null;
let program = null;
let state = null;
let selected = null; // course number picked by tap (phones), waiting for a destination
let dragging = null; // course number being dragged, so semesters that refuse it can show it
let hovering = null; // course number under the mouse: the semesters take its colors too (guy, 2026-11-01)
let hoverSkip = null; // the course just dropped: no hover colors for it until the mouse leaves it
let toastTimer = null;
let reopenWindow = null; // redraws the open course window after a change made from inside it
let problems = []; // unmet admission / required-knowledge conditions of placed courses, rebuilt on every render
let showPlaced = false; // the tree's switch: show what is already in the plan in full, instead of shrunk
const openGroups = new Set(); // finished (shrunk) groups the student opened

// ---------- state ----------

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

function locationOf(n) {
  if (state.done.includes(n)) return "done";
  const i = state.semesters.findIndex((s) => s.includes(n));
  return i >= 0 ? i : null;
}

// a locked course stays where it is: it cannot be dragged or removed, and reset or filling from the recommended
// plan leaves it in place (guy). Courses in "done" can be locked too: reset keeps all of them anyway, but the
// "clear" button of that area keeps only the locked ones (guy)
const isLocked = (n) => (state.locked || []).includes(n);
const LOCK_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
// drawn here (not from an icon library): an eye, for "show where this course is"
const EYE_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
// every control that jumps to where a course is now carries it (guy, 2026-10-31): the tree's place buttons, the
// course window's "ב-2027א" / "הצגה", the conditions window's "הצגה", and "הצגה" in the problems bar
function eyeIcon() {
  const s = document.createElement("span");
  s.className = "eye";
  s.innerHTML = EYE_ICON;
  return s;
}
const UNLOCK_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>';

// a semester's place in time, to compare two ids ("2027ג" comes before "2028א")
const semesterOrder = (id) => Number(id.slice(0, 4)) * 3 + LETTERS.indexOf(id.slice(4));

// is semester id after the last semester the course is offered in ("מוצע עד")
const afterLastOffer = (c, id) => !!c.offeredUntil && /^\d{4}[אבג]$/.test(c.offeredUntil) && semesterOrder(id) > semesterOrder(c.offeredUntil);
// is semester id before the first semester a new course is offered in ("מוצע מ"; M8, 2026-11-03: 20980 from 2027ב)
const beforeFirstOffer = (c, id) => !!c.offeredFrom && /^\d{4}[אבג]$/.test(c.offeredFrom) && semesterOrder(id) < semesterOrder(c.offeredFrom);

// why course n cannot go into semester i, or null if it can
function blockedReason(n, i) {
  const c = DATA.courses[n];
  const id = semesterIds()[i];
  if (isBlockedSemester(i)) return T`סמסטר ${semesterLabel(id)} חסום. כדי לשבץ בו, משחררים אותו בכפתור שבכותרת שלו.`;
  if (!c) return null;
  if (c.offered === false) return T`${n} ${c.name} כבר לא מוצע, ולכן אפשר לשים אותו רק ב"קורסים שכבר עשיתי".`;
  // a new course that has not opened yet (guy, 2026-11-03: 20611, 20612)
  if (c.notYet) return T`${n} ${c.name} עוד לא מוצע: זה קורס חדש, שעוד לא נפתח באף סמסטר, ולכן אי אפשר לשבץ אותו עדיין.`;
  // after its last offer first: every later semester says the same thing, whatever its letter (guy, 2026-11-01)
  if (afterLastOffer(c, id)) return T`${n} ${c.name} מוצע רק עד ${semName(c.offeredUntil)}, ולכן אי אפשר לשבץ אותו ב-${semesterLabel(id)}.`;
  if (beforeFirstOffer(c, id)) return T`${n} ${c.name} הוא קורס חדש, שמוצע רק מ-${semName(c.offeredFrom)}, ולכן אי אפשר לשבץ אותו ב-${semesterLabel(id)}.`;
  if (c.semesters.length && !c.semesters.includes(id.slice(4))) {
    return T`${n} ${c.name} לא מוצע בסמסטר ${letterName(id.slice(4))}. הוא מוצע בסמסטרים ${letterList(c.semesters)}.`;
  }
  return null;
}

// the short words on a semester the course cannot go to, while it is dragged or picked (guy, 2026-11-01); a blocked
// semester keeps its own "חסום" text
function blockedShort(n, i) {
  const c = DATA.courses[n];
  if (!c || isBlockedSemester(i)) return null;
  const id = semesterIds()[i];
  if (c.offered === false) return T("הקורס כבר לא מוצע");
  if (c.notYet) return T("הקורס עוד לא מוצע");
  if (afterLastOffer(c, id)) return T`הקורס מוצע רק עד ${semName(c.offeredUntil)}`;
  if (beforeFirstOffer(c, id)) return T`הקורס מוצע רק מ-${semName(c.offeredFrom)}`;
  if (c.semesters.length && !c.semesters.includes(id.slice(4))) return T("הקורס לא מוצע בסמסטר הזה");
  return null;
}

function toast(text, ms = 4500, action = null) {
  const t = $("#toast");
  // (replaceChildren would print a null as the text "null")
  // × closes it at once (guy, 2026-10-31: a long message after the recommended fill stood over the semesters)
  const close = el("button", { type: "button", class: "toast-close", "aria-label": T("סגירת ההודעה"), text: "×" });
  t.replaceChildren(el("span", { text }), ...(action ? [el("button", { type: "button", class: "toast-action", text: action.label })] : []), close);
  if (action) t.querySelector(".toast-action").addEventListener("click", () => { t.classList.remove("show"); action.run(); });
  close.addEventListener("click", () => { clearTimeout(toastTimer); t.classList.remove("show"); });
  t.classList.toggle("has-action", !!action);
  t.classList.add("show");
  clearTimeout(toastTimer);
  const wait = action ? Math.max(ms, 10000) : ms;
  const hide = () => { toastTimer = setTimeout(() => t.classList.remove("show"), wait); };
  t.onmouseenter = t.onfocusin = () => clearTimeout(toastTimer);
  t.onmouseleave = t.onfocusout = () => { clearTimeout(toastTimer); hide(); };
  hide();
}

// before: the course it should go in front of (from the drop position), or null for the end of the list.
// In the same semester this reorders it (guy, 2026-11-01); dropping a course back where it was changes nothing, and
// save() keeps no history step for it
function place(n, target, before = null) {
  if (isLocked(n) && locationOf(n) !== target) { toast(T`${n} נעול. כדי להזיז אותו, לוחצים על המנעול שבכרטיס.`); render(); return; }
  if (typeof target === "number") {
    const reason = blockedReason(n, target);
    if (reason) { toast(reason); render(); return; }
  }
  if (locationOf(n) === target && (target === "done" || before === n)) { render(); return; }
  state.done = state.done.filter((x) => x !== n);
  state.semesters = state.semesters.map((s) => s.filter((x) => x !== n));
  if (target === "done") state.done.push(n);
  else if (typeof target === "number") {
    const list = state.semesters[target];
    const k = before ? list.indexOf(before) : -1;
    if (k >= 0) list.splice(k, 0, n);
    else list.push(n);
  }
  save();
  keepInView = target;
  render();
}

function slotName(id) {
  for (const s of program.sections) {
    if (s.id === id) return s.name;
    const g = s.groups.find((x) => x.id === id);
    if (g) return g.name;
  }
  return id;
}

function plannedCourses() {
  return [...state.done, ...state.semesters.flat()];
}

// fill the semesters from the program's recommended plan; it starts in semester א, so a student who starts
// in ב or ג gets it from their first א semester on. Electives are left to the student: the plan only says
// how many credits of them remain, not when to take them
// the recommended plans of the program by length in years (3, 4...)
function planLengths() {
  return [...new Set((program.recommended || []).map((r) => r.years))].sort();
}

function fillRecommended() {
  const years = Number($("#plan-length").value) || planLengths()[0];
  const rows = (program.recommended || []).filter((r) => r.years === years);
  const plan = rows.filter((r) => r.course && r.year);
  if (!plan.length) return;
  // it replaces the whole plan (guy, 2026-10-31): from semester א of the start year, as many semesters as the plan
  // needs (more only for a locked course further on), and no blocked semesters
  const index = (r) => (r.year - 1) * 3 + LETTERS.indexOf(r.semester);
  const needed = Math.max(...plan.map(index)) + 1;
  const kept = state.semesters.map((s) => s.filter(isLocked));
  const lastLocked = kept.reduce((m, s, i) => (s.length ? i : m), -1);
  state.start = `${state.start.slice(0, 4)}א`;
  state.blocked = [];
  const length = Math.ceil(Math.max(needed, lastLocked + 1) / 3) * 3; // whole years
  state.semesters = Array.from({ length }, (_, i) => [...(kept[i] || [])]);
  const skipped = [];
  plan.forEach((r) => {
    if (state.done.includes(r.course)) skipped.push(r.course);
    else if (!isLocked(r.course)) state.semesters[index(r)].push(r.course);
  });
  selected = null;
  save();
  render();
  // what is left, from the recommended plan itself and not from the page: the fill replaces the semesters, so the list
  // is the same whatever was there before (guy, 2026-11-03: after a full plan it listed only "לתקן קורס 1")
  const todo = rows.filter((r) => r.slot).map((r) => {
    // a slot for one course from a list (the broadening course) is named, not counted in credits
    const group = program.sections.flatMap((s) => s.groups).find((g) => g.id === r.slot);
    if (group && isRequired(group)) return T`לבחור: ${slotName(r.slot)}${group.rule === "חובת בחירה" && choiceText(group) ? ` (${choiceText(group)})` : ""}`;
    return T`לבחור ${r.credits} נ"ז ${slotName(r.slot)}`;
  });
  // the recommended plans leave the foundations out: they take the matriculation for granted
  (program.background || []).forEach((b) => todo.push(T`לסמן ב"רקע ודרישות" אם יש לך ${backgroundWhat(b)}. התכנית המומלצת מניחה שיש לך; אם לא, צריך להוסיף את ${plainCourses(b.courses)}`));
  const planCourses = plan.filter((r) => r.course).map((r) => r.course);
  todo.push(...skillTodos(SKILLS.filter((sk) => degreeAsks(sk) || courseAsks(sk, planCourses)), planCourses));
  const notes = [];
  if (skipped.length) notes.push(T`לא שובצו קורסים שכבר עשיתם: ${skipped.join(", ")}.`);
  if (state.locked && state.locked.length) notes.push(T`קורסים נעולים נשארו במקומם: ${state.locked.join(", ")}.`);
  showAfterFill(years, todo, notes);
}

// the window after the recommended plan is filled (guy, 2026-11-03: a message that went by itself left colleagues
// thinking the plan was finished): it says that this is a starting point, and what is left, as in "התכנית עוד לא גמורה"
function showAfterFill(years, todo, notes) {
  showStartWindow(T`מולאה התכנית המומלצת ל-${years} שנים`,
    T("התכנית המומלצת משבצת את קורסי החובה. את קורסי הבחירה בוחרים בעצמכם, וצריך לסמן את הרקע ואת הדרישות שלכם."), todo, notes);
}

// the window after the recommended fill and after the automatic completion (guy, 2026-11-03: the same for both):
// "זו נקודת התחלה, לא תכנית גמורה", what is left to do, notes, and "הבנתי"; then, when it closes, onClose
function showStartWindow(title, intro, todo, notes, onClose) {
  reopenWindow = null;
  fillInfo(
    el("h3", { text: title }),
    el("p", {}, el("strong", { text: T("זו נקודת התחלה, לא תכנית גמורה.") }), " ", intro),
    todo.length ? el("h4", { text: T("מה עוד צריך לעשות:") }) : null,
    todo.length ? el("ul", { class: "after-fill" }, todo.map((t) => el("li", { text: t }))) : null,
    todo.length ? el("p", { class: "cond-note", text: T("את הקורסים לבחירתך לומדים בכל סמסטר שמתאים לך; הרשימות בעץ.") }) : null,
    notes.length ? el("p", { class: "cond-note", text: notes.join(" ") }) : null,
    el("p", { class: "cond-note", text: T("מה שעוד חסר, כולל קורסים שחסרים להם תנאים, מופיע בראש התכנית תחת \"התכנית עוד לא גמורה\", עד שהכול מסומן ✓.") }),
    el("p", { class: "after-fill-ok" }, el("button", { type: "button", class: "mini", text: T("הבנתי") })));
  if (!$("#info").open) $("#info").showModal();
  // "הבנתי" closes the window and then does onClose itself (the flash of the new cards): the dialog's own "close" event
  // did not come in every browser view; × closes it without the flash
  $("#info-body .after-fill-ok button").addEventListener("click", () => { $("#info").close(); if (onClose) onClose(); });
}

// ---------- conditions ----------

// ---------- auto-complete ----------
// Fills the semesters with the required courses the plan still lacks, around what the student already placed
// (nothing placed or done is moved). Rules: every admission and required-knowledge condition comes in an
// earlier semester; prior-credit conditions are met; each course only in a semester it is offered in; at most
// two courses in a summer; about the same load in every semester; no electives (the student chooses them).

// does course c count toward a prior-credits field such as "פיסיקה" or "פיסיקה ומתמטיקה"
function inField(c, field) {
  if (!field || field === "כל הקורסים") return true;
  // "מדעים-כללי": a course whose science affiliations are all general (מדעים - כללי, מדעי הטבע - כללי), as in CB's
  // "at most 5 advanced credits in general sciences". One with a discipline too (20991: also chemistry) fits both,
  // so it is not held by that limit (guy)
  if (field === "מדעים-כללי") {
    const sciences = c.affiliation.filter((a) => a.startsWith("מדעים"));
    return sciences.length > 0 && sciences.every((a) => /כללי$/.test(a));
  }
  // "מדעי" alone is no field: it matched every "מדעים" course, so "מדעי הטבע" counted mathematics too (M8, 2026-11-03)
  const words = field.split(/ ו| /).filter((w) => w.length > 2 && w !== "מדעי");
  return c.affiliation.some((a) => words.some((w) => a.includes(w)));
}

// a group the degree requires: every item ("כל הפריטים"), or a required choice ("חובת בחירה", guy 2026-11-03: two of
// three courses the student picks; required like the first, but the automatic completion and the recommended plans
// leave it to the student)
const isRequired = (g) => g.rule === "כל הפריטים" || g.rule === "חובת בחירה";
// "2 מתוך 3 קורסים": what a required choice asks, from its one item
function choiceText(g) {
  const c = g.items.length === 1 && g.items[0].courses;
  if (c && c.of) return T`${c.atleast} מתוך ${c.of.length} קורסים`;
  if (c && c.or) return T`קורס אחד מתוך ${c.or.length}`;
  return null;
}

function autoFill() {
  const usable = (n) => DATA.courses[n] && DATA.courses[n].offered !== false && !DATA.courses[n].notYet;
  const planned = new Set(plannedCourses());
  // courses a background requirement replaces are never added: ticked or not, the student decides about them
  const assumed = new Set();
  (program.background || []).forEach((b) => coursesIn(b.courses, assumed));
  // where the recommended plan puts a course (the plan length chosen next to the fill button): a tie-breaker
  const years = Number($("#plan-length").value) || planLengths()[0];
  const recIndex = new Map();
  (program.recommended || []).filter((r) => r.course && r.year && r.years === years)
    .forEach((r) => recIndex.set(r.course, (r.year - 1) * 3 + LETTERS.indexOf(r.semester)));
  const rank = (n) => (recIndex.has(n) ? recIndex.get(n) : 99);

  // 1. what to add: the unmet required items, and whatever their conditions need, choosing among alternatives
  //    the one that adds the fewest courses (then the one the recommended plan uses, then the fewest credits)
  const toPlace = new Set();
  const known = () => new Set([...planned, ...toPlace, ...assumed]);
  // n: the course whose condition this is, so the background counts only where it accepts it
  const choose = (expr, n = null) => {
    if (!expr) return [];
    const have = n ? forCourse(n, known(), new Set([...planned, ...toPlace])) : known();
    if (satisfied(expr, have)) return [];
    if (typeof expr === "string") return usable(expr) ? [expr] : [];
    if (expr.and) return expr.and.flatMap((e) => choose(e, n));
    const options = expr.or || expr.of;
    const k = expr.of ? expr.atleast : 1;
    // first, an alternative with no course that is being phased out ("מוצע עד"; OF, 2026-11-03: 20452 ends in
    // 2027ב, before its conditions can come, and 20614 + 20615 replace it)
    const cost = (o) => {
      const need = [...coursesIn(o)].filter((x) => !have.has(x));
      if (need.some((x) => !usable(x))) return [Infinity];
      // then, among as many courses, the one whose admission conditions are already met or planned (83, 2026-11-03:
      // of four labs, 20459 needs 20322, outside the required courses, and 20460 needs only what is there)
      const known_ = new Set([...known(), ...need]);
      const missingAdmission = need.filter((x) => DATA.courses[x].admission && !satisfied(DATA.courses[x].admission, known_)).length;
      return [need.filter((x) => DATA.courses[x].offeredUntil).length, need.length, missingAdmission, Math.min(99, ...need.map(rank)),
        need.reduce((s, x) => s + (DATA.courses[x].credits || 0), 0)];
    };
    const before = (a, b) => { for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j] - b[j]; return 0; };
    const open = options.filter((o) => !satisfied(o, have)).map((o) => ({ o, c: cost(o) })).sort((a, b) => before(a.c, b.c));
    const missing = k - (options.length - open.length);
    return open.slice(0, Math.max(0, missing)).filter((x) => x.c[0] !== Infinity).flatMap((x) => choose(x.o, n));
  };
  const add = (list) => list.forEach((n) => {
    if (toPlace.has(n) || planned.has(n) || assumed.has(n) || !usable(n)) return;
    toPlace.add(n);
    // the background counts for required knowledge too, as "הנחתי שיש לך": the course is placed and the card shows
    // what is missing (20482 needs the foundations, and its page says nothing about a matriculation); an admission
    // condition is a hard one, and there it counts only where the course accepts it (20418, 20434)
    add(choose(DATA.courses[n].admission, n));
    add(choose(DATA.courses[n].required));
  });
  program.sections.forEach((s) => s.groups.forEach((g) => {
    if (g.rule === "כל הפריטים") g.items.forEach((it) => it.courses && !isLongList(it.courses) && add(choose(it.courses)));
  }));
  if (!toPlace.size) {
    toast(T("אין קורסי חובה שחסרים בתכנית. את קורסי הבחירה בוחרים בעצמכם, מהעץ."), 7000);
    return;
  }

  // 2. order: a course that more of the remaining courses wait for goes first
  const deps = (n) => [...coursesIn(DATA.courses[n].admission || ""), ...coursesIn(DATA.courses[n].required || "")].filter((x) => toPlace.has(x));
  const waiting = new Map([...toPlace].map((n) => [n, []]));
  toPlace.forEach((n) => deps(n).forEach((d) => waiting.get(d).push(n)));
  const depthMemo = new Map();
  const depth = (n, seen = new Set()) => {
    if (depthMemo.has(n)) return depthMemo.get(n);
    if (seen.has(n)) return 0;
    seen.add(n);
    const d = 1 + Math.max(0, ...waiting.get(n).map((x) => depth(x, seen)));
    depthMemo.set(n, d);
    return d;
  };

  // 3. the load to aim for: everything in the semesters, spread evenly (a summer counts as half a semester)
  const credits = (n) => (DATA.courses[n] || {}).credits || 0;
  const idsFor = (length) => {
    const list = [state.start];
    while (list.length < length) list.push(nextSemester(list[list.length - 1]));
    return list;
  };
  const isSummer = (i) => idsFor(i + 1)[i].endsWith("ג");
  const total = state.semesters.flat().reduce((s, n) => s + credits(n), 0) + [...toPlace].reduce((s, n) => s + credits(n), 0);
  const weightTo = (end) => idsFor(end + 1).reduce((s, id, k) => s + (isBlockedSemester(k) ? 0 : id.endsWith("ג") ? 0.5 : 1), 0);
  const capFor = (c) => (i) => (isSummer(i) ? Math.max(5, Math.ceil(c * 0.55)) : c);
  const base = new Set([...state.done, ...assumed]);

  // 4-5. one full scheduling run. parallel = false: required knowledge too must come in an earlier semester;
  // parallel = true: it may be in the same semester (as the recommended plan does with 20215 and 20406)
  const run = (parallel) => {
    const fitsAt = (n, i, plan, same = parallel) => {
      if (isBlockedSemester(i)) return false; // a semester the student blocked
      const c = DATA.courses[n];
      if (!c) return true;
      const real = new Set(state.done);
      plan.slice(0, i).forEach((x) => x.forEach((y) => real.add(y)));
      const have = new Set([...base, ...real]);
      if (c.semesters.length && !c.semesters.includes(idsFor(i + 1)[i].slice(4))) return false;
      if (afterLastOffer(c, idsFor(i + 1)[i]) || beforeFirstOffer(c, idsFor(i + 1)[i])) return false;
      if (c.admission && !satisfied(c.admission, forCourse(n, have, real))) return false;
      if (c.required && !satisfied(c.required, same ? new Set([...have, ...plan[i].filter((x) => x !== n)]) : have)) return false;
      if (c.priorCredits) {
        const order = new Map([...base].map((x) => [x, -1]));
        plan.slice(0, i).forEach((list, k) => list.forEach((y) => order.set(y, k)));
        if (priorCreditsIn([...real], c.priorField, order) < c.priorCredits) return false; // background courses give no credits
      }
      return true;
    };
    // semester by semester, the most-awaited courses that can go there, up to the load; more semesters if needed.
    // With parallel, a course added to a semester can open the way for another one in the same semester
    const greedy = (cap) => {
    const sems = state.semesters.map((x) => [...x]);
    const remaining = new Set(toPlace);
    for (let i = 0; remaining.size && i < state.semesters.length + 12; i++) {
      if (i >= sems.length) sems.push([]);
      let load = sems[i].reduce((a, n) => a + credits(n), 0);
      for (let added = true; added;) {
        added = false;
        const inParallel = (n) => (parallel && !fitsAt(n, i, sems, false) ? 1 : 0);
        const candidates = [...remaining].filter((n) => fitsAt(n, i, sems))
          .sort((a, b) => inParallel(a) - inParallel(b) || depth(b) - depth(a) || rank(a) - rank(b) || a.localeCompare(b));
        for (const n of candidates) {
          if (isSummer(i) && sems[i].length >= 2) break;
          if (load + credits(n) > cap(i) && sems[i].length) continue;
          sems[i].push(n);
          load += credits(n);
          remaining.delete(n);
          added = parallel;
          if (added) break;
        }
      }
    }
    return { sems, remaining, last: sems.reduce((m, x, i) => (x.length ? i : m), -1) };
    };
    // the end to aim for: as early as the conditions allow, but not before the semesters the plan already has.
    // The load is the total spread evenly up to there; if that load leaves courses past the end, it grows a little
    const free = greedy(() => Infinity);
    const end = Math.max(free.last, state.semesters.length - 1);
    const target = total / weightTo(end);
    let size = Math.max(10, Math.ceil(target * 1.15));
    let g = greedy(capFor(size));
    while ((g.last > end || g.remaining.size > free.remaining.size) && size < 22) g = greedy(capFor(++size));
    const cap = capFor(size);
    const { sems, remaining } = g;
    // balance: move one added course at a time to another semester while that makes the loads more even and
    // every course that met its conditions still does (the student's own courses included). Never past the
    // last semester the plan already reached: evening out the load must not make the degree longer
    const reached = sems.reduce((m, x, i) => (x.length ? i : m), -1);
    const okNow = new Set(sems.flatMap((x, i) => x.filter((n) => fitsAt(n, i, sems))));
    const valid = (plan) => plan.every((x, i) => (!isSummer(i) || x.length <= 2) && x.every((n) => !okNow.has(n) || fitsAt(n, i, plan)));
    // the score to lower: uneven loads, plus a smaller cost for each recommended course that comes only in the
    // same semester or later (recommended knowledge is never required, but it is better before)
    const spread = (plan) => {
      const at = new Map();
      plan.forEach((x, i) => x.forEach((n) => at.set(n, i)));
      return plan.reduce((sum, x, i) => {
        const load = x.reduce((a, n) => a + credits(n), 0);
        const late = x.reduce((a, n) => a + [...coursesIn((DATA.courses[n] || {}).recommended || "")]
          .filter((r) => at.has(r) && at.get(r) >= i).length, 0);
        const together = parallel ? x.filter((n) => toPlace.has(n) && !fitsAt(n, i, plan, false)).length : 0;
        return sum + (load - target * (isSummer(i) ? 0.5 : 1)) ** 2 + (load > cap(i) ? 1000 : 0) + 8 * late + 40 * together;
      }, 0);
    };
    for (let round = 0, better = true; better && round < 200; round++) {
      better = false;
      const now = spread(sems);
      let best = null;
      sems.forEach((x, i) => x.filter((n) => toPlace.has(n)).forEach((n) => sems.forEach((_, j) => {
        if (j === i || j > reached) return;
        const plan = sems.map((y, k) => (k === i ? y.filter((z) => z !== n) : k === j ? [...y, n] : y));
        if (!valid(plan)) return;
        const score = spread(plan);
        if (score < now - 0.01 && (!best || score < best.score)) best = { plan, score };
      })));
      if (best) { sems.splice(0, sems.length, ...best.plan); better = true; }
    }
    // semesters added at the end and left empty are dropped again
    while (sems.length > state.semesters.length && !sems[sems.length - 1].length) sems.pop();
    const last = sems.reduce((m, x, i) => (x.length ? i : m), -1);
    return { sems, remaining, last, target };
  };

  // required knowledge in the same semester only when that places more courses or ends the plan earlier (guy)
  const strict = run(false);
  const loose = run(true);
  const useLoose = loose.remaining.size < strict.remaining.size
    || (loose.remaining.size === strict.remaining.size && loose.last < strict.last);
  const { sems, remaining, target } = useLoose ? loose : strict;
  state.semesters = sems;
  selected = null;
  save();
  render();
  const placed = toPlace.size - remaining.size;
  // a window like the one after the recommended fill (guy, 2026-11-03), instead of a message that went by itself:
  // what was placed, and what is still left to do, which here depends on the plan around it
  const notes = [T`כל מה שכבר היה בתכנית נשאר במקומו. בערך ${Math.round(target)} נ"ז בסמסטר.`];
  if (useLoose) {
    const n = problems.filter((p) => p.level === "soft" && toPlace.has(p.n)).length; // only the courses added now
    notes.push(T`כדי לסיים ב-${semesterLabel(semesterIds()[loose.last])} ולא ב-${semesterLabel(idsFor(strict.last + 1)[strict.last])}, ${n === 1 ? T("קורס 1 נלמד") : T`${n} קורסים נלמדים`} במקביל לידע הקודם שלהם (מסומנים "ידע קודם במקביל").`);
  }
  const todo = [];
  if (remaining.size) todo.push(T`לשבץ ידנית את ${[...remaining].join(", ")}: לא נמצא להם מקום (אפשר גם להוסיף שנה)`);
  program.sections.forEach((s) => s.groups.forEach((g) => isRequired(g) && g.items
    .filter((it) => (isLongList(it.courses) || g.rule === "חובת בחירה") && !satisfied(it.courses, new Set(plannedCourses())))
    .forEach((it) => todo.push(T`לבחור: ${it.label}${g.rule === "חובת בחירה" && choiceText(g) ? ` (${choiceText(g)})` : ""}`))));
  degreeGaps().filter((g) => g.kind === "credits").forEach((g) => todo.push(T`לבחור ${g.text}`));
  (program.background || []).filter((b) => !(state.background || []).includes(b.id) && !satisfied(b.courses, new Set(plannedCourses())))
    .forEach((b) => todo.push(T`לסמן ב"רקע ודרישות" אם יש לך ${backgroundWhat(b)}. ההשלמה הניחה שיש לך; אם לא, צריך להוסיף את ${plainCourses(b.courses)}`));
  todo.push(...skillTodos(askedSkills().filter((sk) => !hasSkill(sk.id)), state.semesters.flat()));
  // a hint of what was added, once the window is closed: the new cards flash for a moment (guy)
  const flashAdded = () => {
    const added = [...document.querySelectorAll("#semesters .chip")].filter((c) => toPlace.has(c.dataset.n) && !remaining.has(c.dataset.n));
    if (added.length) added[0].scrollIntoView({ behavior: SMOOTH(), block: "nearest" });
    added.forEach((c) => { c.classList.add("flash"); setTimeout(() => c.classList.remove("flash"), 1600); });
  };
  showStartWindow(T`שובצו ${placed} קורסי חובה (${[...toPlace].filter((n) => !remaining.has(n)).reduce((s, n) => s + credits(n), 0)} נ"ז)`,
    T("ההשלמה האוטומטית משבצת רק את קורסי החובה שחסרו. את קורסי הבחירה בוחרים בעצמכם, וצריך לסמן את הרקע ואת הדרישות שלכם."),
    todo, notes, flashAdded);
}

function satisfied(expr, have) {
  if (typeof expr === "string") return have.has(expr);
  if (expr.and) return expr.and.every((e) => satisfied(e, have));
  if (expr.or) return expr.or.some((e) => satisfied(e, have));
  if (expr.atleast) return expr.of.filter((e) => satisfied(e, have)).length >= expr.atleast;
  return false;
}

function coursesIn(expr, out = new Set()) {
  if (typeof expr === "string") out.add(expr);
  else (expr.and || expr.or || expr.of || []).forEach((e) => coursesIn(e, out));
  return out;
}

// courses finished before semester i: "done" counts as the semester before the first one
// the background requirements the student ticked (for example a 5-unit physics matriculation): the courses
// each one replaces count as taken, in every check
// the background requirement whose courses include n (20125, 20113, 20114 in NQ), or undefined
function backgroundFor(n) {
  return (program.background || []).find((b) => coursesIn(b.courses).has(n));
}

// "בגרות 5 יח"ל בפיסיקה ובמתמטיקה בציון 80 לפחות", from the checkbox text "יש לי בגרות ..."
const backgroundWhat = (b) => b.checkbox.replace(/^(יש לי |لديّ |لدي |I have )/, "");

// the warning on such a course, so nobody registers for it by mistake
function onlyWithoutBackground(b) {
  return (state.background || []).includes(b.id)
    ? T`סימנת שיש לך ${backgroundWhat(b)}, ולכן הקורס הזה לא נדרש ממך.`
    : T`רק למי שאין ${backgroundWhat(b)}. יש לך? אין צורך בקורס: סמנו את זה ב"רקע ודרישות".`;
}

// The preparatory workshop of a background requirement (guy, 2026-11-03: 91463 before the physics foundations):
// a course without credits, and a test that tells who needs it. A recommendation, not a requirement: no step in
// "התכנית עוד לא גמורה", no warning, and the fills do not add it
const prepOf = (n) => (program.background || []).find((b) => b.prep === n);

// "לא בטוחים שאתם מוכנים ...? מבחן התאמה (כשעה) ימליץ אם כדאי ללמוד קודם את 91463 סדנת הכנה בפיסיקה (ללא נ"ז)."
// guy's words (2026-11-03): what the workshop is, and the test that says whether to take it
function prepLine(b) {
  return el("span", { class: "prep-line" }, T("קורס הקדמה ליסודות הפיסיקה לסטודנטים בלי רקע בפיסיקה. "),
    b.prepTest ? [T("בצעו את "), el("a", { href: b.prepTest, target: "_blank", rel: "noopener", text: T("מבחן ההתאמה") }),
      T(" ובדקו אם כדאי לכם להירשם לסדנה.")] : null);
}

// the workshop in semester i: better before the courses it prepares for, and not needed with the box ticked
function prepNote(n, i) {
  const b = prepOf(n);
  if (!b || typeof i !== "number") return null;
  if ((state.background || []).includes(b.id)) return T`סימנת שיש לך ${backgroundWhat(b)}, ולכן כנראה אין צורך בסדנה.`;
  const courses = coursesIn(b.courses);
  // the first place one of those courses is in: "done", or the first semester with one
  const first = state.semesters.findIndex((sem) => sem.some((x) => courses.has(x)));
  const at = state.done.some((x) => courses.has(x)) ? state.done : first !== -1 && first <= i ? state.semesters[first] : null;
  return at ? T`כדאי ללמוד את הסדנה לפני ${at.filter((x) => courses.has(x)).join(", ")}.` : null;
}

function checkedBackground() {
  return (program.background || []).filter((b) => (state.background || []).includes(b.id));
}

function backgroundCourses() {
  const set = new Set();
  checkedBackground().forEach((b) => coursesIn(b.courses, set));
  return set;
}

// A background box stands for its courses only in the conditions of a course whose own catalog page says so
// (column "דרישת רקע מתקבלת"; guy, 2026-11-03: 20418 had the matriculation counted for its admission, and its page
// does not say so). The background requirements course n accepts:
function backgroundsFor(n) {
  const accepts = (DATA.courses[n] || {}).acceptsBackground || [];
  return (program.background || []).filter((b) => accepts.includes(b.id));
}
// "have" for the conditions of course n: the courses of a background n does not accept go, unless really taken
function forCourse(n, have, real) {
  const accepted = new Set(backgroundsFor(n).map((b) => b.id));
  const out = new Set(have);
  (program.background || []).filter((b) => !accepted.has(b.id))
    .forEach((b) => coursesIn(b.courses).forEach((x) => { if (!real.has(x)) out.delete(x); }));
  return out;
}

// what is taken before semester i, for the conditions of course n (by default the course skipped)
function takenBefore(i, skip, n = skip) {
  const real = new Set(state.done);
  state.semesters.slice(0, i).forEach((s) => s.forEach((x) => real.add(x)));
  if (skip) real.delete(skip);
  const have = new Set([...real, ...backgroundCourses()]);
  if (skip) have.delete(skip);
  return n ? forCourse(n, have, real) : have;
}

// split the unmet parts of a condition: single courses that must be taken ("must"), and choices
// ("one of", "at least k of") whose courses are only options, so the tree marks them once per item, not each course
function missingParts(parts, have) {
  const must = new Set();
  const choices = [];
  parts.forEach((e, index) => {
    if (satisfied(e, have)) return;
    if (typeof e === "string") must.add(e);
    else choices.push({ index, courses: [...coursesIn(e)].filter((x) => !have.has(x)), atleast: e.of ? e.atleast : 1 });
  });
  return { must, choices };
}

function programCourses() {
  const set = new Set();
  program.sections.forEach((s) => s.groups.forEach((g) => g.items.forEach((it) => it.courses && coursesIn(it.courses, set))));
  return set;
}

// what the tree shows: the program's courses, and, while a background box is unticked, the courses it replaces
// (in "במקום בגרות" at the top). A course there is shown, not offered for "קורסים נוספים" (guy, 2026-10-31)
function treeShows() {
  const set = programCourses();
  (program.background || []).filter((b) => !(state.background || []).includes(b.id)).forEach((b) => {
    coursesIn(b.courses, set);
    if (b.prep) set.add(b.prep);
  });
  return set;
}

const CONDITIONS = [
  { key: "admission", level: "bad", tag: T("חסר תנאי קבלה"), label: T("תנאי קבלה") },
  { key: "required", level: "warn", tag: T("חסר ידע קודם דרוש"), label: T("ידע קודם דרוש") },
];

// general requirements some courses ask for (English, the library course): the student ticks them,
// and until then every course that asks for one carries a tag, so they are not missed
const SKILLS = [
  { id: "english", key: "needsEnglish", checkbox: T("יש לי פטור מקורסי שפה באנגלית"), short: T("פטור מאנגלית"),
    link: "https://academic.openu.ac.il/yedion/english/pages/default.aspx" },
  { id: "library", key: "needsLibrary", checkbox: T("עמדתי בדרישות ההדרכה הביבליוגרפית"), short: T("הדרכה ביבליוגרפית"),
    link: "https://academic.openu.ac.il/yedion/studies/pages/default.aspx?expand=studies8" },
];

const hasSkill = (id) => (state.skills || []).includes(id);

// a requirement the degree itself asks for, course or not (guy, 2026-11-04): its general requirements link to the
// same rules page (by link, not by name, which is translated)
const degreeAsks = (s) => (program.general || []).some((g) => (g.link || "").toLowerCase() === s.link.toLowerCase());
const courseAsks = (s, list = state.semesters.flat()) => list.some((n) => (DATA.courses[n] || {})[s.key]);
// the requirements the student is asked about: the degree's own, and any a planned course asks for
const askedSkills = () => SKILLS.filter((s) => degreeAsks(s) || courseAsks(s));
// the "what is left" lines for them: before the courses that ask (the courses set the deadline), or, with no
// such course, as a general requirement of the degree, which sets no date (guy, 2026-11-04)
function skillTodos(list, planned) {
  const byCourse = list.filter((s) => courseAsks(s, planned)), general = list.filter((s) => !courseAsks(s, planned));
  const names = (l) => l.map((sk) => sk.short).join(T(" ו"));
  return [
    ...(byCourse.length ? [T`להשלים ${names(byCourse)} לפני הקורסים שדורשים אותם, ולסמן את זה ב"רקע ודרישות"`] : []),
    ...(general.length ? [T`להשלים ${names(general)} (דרישה כללית של התואר), ולסמן את זה ב"רקע ודרישות"`] : []),
  ];
}

// the general requirements course n asks for that the student has not ticked yet
function missingSkills(n) {
  const c = DATA.courses[n];
  return c ? SKILLS.filter((s) => c[s.key] && !hasSkill(s.id)) : [];
}

// "דרוש", not "דורש" (guy, 2026-11-01)
const skillsTag = (list) => T`דרוש ${list.map((s) => s.short).join(T(" ו"))}`;

// for each requirement not ticked yet: the planned courses that ask for it, in plan order (the first one sets the deadline)
function skillNeeds() {
  return SKILLS.filter((s) => !hasSkill(s.id)).map((skill) => {
    const courses = [];
    state.semesters.forEach((list, i) => list.forEach((n) => { if ((DATA.courses[n] || {})[skill.key]) courses.push({ n, i }); }));
    return { skill, courses };
  }).filter((x) => x.courses.length);
}

const fewCourses = (list) => (list.length > 3 ? T`${list.slice(0, 3).join(", ")} ועוד ${list.length - 3}` : list.join(", "));

// a "prior credits" condition of course n in semester i (for example 40 credits in physics before it): what the
// courses before it give in that field, after the overlap cuts among them, and whether it is short. The background
// courses a ticked box stands for give no credits. null when the course has no such condition (guy, 2026-11-01)
function priorCheck(n, i) {
  const c = DATA.courses[n];
  if (!c || !c.priorCredits) return null;
  const order = new Map(state.done.map((x) => [x, -1]));
  state.semesters.slice(0, i).forEach((list, k) => list.forEach((x) => order.set(x, k)));
  const got = priorCreditsIn([...withoutBackground(takenBefore(i, n))], c.priorField, order);
  return { got, need: c.priorCredits, field: c.priorField, short: got < c.priorCredits };
}
const priorText = (p) => T`חסרים נ"ז קודמים: יש ${p.got} מתוך ${p.need} ב${T(p.field)}`;

function findProblems() {
  const ids = semesterIds();
  const found = [];
  state.semesters.forEach((list, i) => {
    list.forEach((n) => {
      const c = DATA.courses[n];
      if (!c) return;
      const have = takenBefore(i, null, n);
      CONDITIONS.forEach((cond) => {
        const expr = c[cond.key];
        if (!expr || satisfied(expr, have)) return;
        const parts = expr.and || [expr];
        // required knowledge taken in the same semester is allowed: a soft gray note, not a warning
        // (admission requirements must come before, so they get no such allowance)
        if (cond.key === "required" && satisfied(expr, new Set([...have, ...list.filter((x) => x !== n)]))) {
          found.push({ n, i, semester: ids[i], ...cond, level: "soft", tag: T("ידע קודם במקביל"), have, parts, missing: new Set(), choices: [] });
          return;
        }
        const { must, choices } = missingParts(parts, have);
        found.push({ n, i, semester: ids[i], ...cond, have, parts, missing: must, choices });
      });
      // prior credits are part of the admission conditions in the catalog: red, like them
      const prior = priorCheck(n, i);
      if (prior && prior.short) {
        found.push({ n, i, semester: ids[i], key: "prior", level: "bad", tag: T("חסרים נ\"ז קודמים"), label: T("נ\"ז קודמים"),
          have, parts: [], missing: new Set(), choices: [], prior });
      }
    });
  });
  return found;
}

// the latest place a prerequisite can go, for the note in the tree
function deadline(i) {
  return i === 0 ? T('ב"קורסים שכבר עשיתי"') : T`עד ${semesterLabel(prevSemester(semesterIds()[i]))}`;
}

// ---------- small builders ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
  return node;
}

function courseName(n) {
  return DATA.courses[n] ? DATA.courses[n].name : T("(קורס לא מוכר)");
}

function creditsText(c) {
  if (!c || c.credits === null) return "";
  return c.advanced ? T`${c.credits} נ"ז, ${c.advanced} מתקדמות` : T`${c.credits} נ"ז`;
}

function semesterLabel(id) {
  return id.endsWith("ג") ? T`${semName(id)} (קיץ)` : semName(id);
}

// a course card always has the same rows: number and name with the buttons; then credits and tags; then the notes
function chip(n, context) {
  const c = DATA.courses[n];
  const where = locationOf(n);
  const inTree = context === "tree" || context === "extra" || context === "outside";
  const placed = inTree && where !== null;
  const head = el("div", { class: "chip-head" },
    el("span", { class: "num", text: n }),
    el("bdi", { class: "name", text: courseName(n), title: courseName(n), lang: LANG === "he" ? null : "he" }));
  const tags = [el("span", { class: "cr", text: creditsText(c) })];
  const notes = [];
  const node = el("li", {
    class: ["chip", placed && "placed", c && c.offered === false && "gone", selected === n && "selected", !inTree && isLocked(n) && "locked"].filter(Boolean).join(" "),
    "data-n": n,
    draggable: placed || (!inTree && isLocked(n)) ? null : "true",
    // the keyboard reaches every card that can move; Enter on it opens "where to?" (accessibility, 2026-10-31)
    tabindex: placed ? null : "0",
    "aria-describedby": placed ? null : typeof context === "number" ? "kbd-hint kbd-hint-order" : "kbd-hint",
  });

  if (c && c.offered === false) tags.push(el("span", { class: "tag gone", text: T("לא מוצע עוד") }));
  // a seminar course (advanced-seminar level), which some programs require (guy, 2026-11-03: M8, OE)
  if (c && c.seminar === "חובה") tags.push(el("span", { class: "tag seminar", title: T("קורס ברמה מתקדמת-סמינריונית: כותבים בו עבודה סמינריונית"), text: T("סמינריוני") }));
  // a broadening course this program allows beyond the shared list (guy, 2026-11-04: 22006 in 15, OJ, OH)
  if (context !== "outside" && programBroadening(n)) tags.push(el("span", { class: "tag own-broadening", title: T("קורס שהתכנית שלך מתירה במקום קורס מרחיב-דעת, מעבר לרשימה הכללית"), text: T("מרחיב-דעת ייחודי לתכנית") }));
  if (c && c.notYet) tags.push(el("span", { class: "tag gone", title: T("קורס חדש, שעוד לא נפתח באף סמסטר"), text: T("עוד לא מוצע") }));
  const skills = context === "done" || (c && c.offered === false) ? [] : missingSkills(n);
  if (skills.length) tags.push(el("span", { class: "tag need", title: T("סמנו למעלה כשתעמדו בדרישה"), text: skillsTag(skills) }));
  if (typeof context === "number" && c && c.semesters.length) {
    const letter = semesterIds()[context].slice(4);
    if (!c.semesters.includes(letter)) tags.push(el("span", { class: "tag warn", text: T`לא מוצע בסמסטר ${letterName(letter)}` }));
  }
  // a course left in a semester after its last offer (placed before this check existed, or from a shared link)
  if (typeof context === "number" && c && afterLastOffer(c, semesterIds()[context])) {
    tags.push(el("span", { class: "tag warn", text: T`מוצע רק עד ${semName(c.offeredUntil)}` }));
  }
  if (typeof context === "number" && c && beforeFirstOffer(c, semesterIds()[context])) {
    tags.push(el("span", { class: "tag warn", text: T`מוצע רק מ-${semName(c.offeredFrom)}` }));
  }
  // where the course is, with an eye: a click takes you there and flashes the card (guy, 2026-10-31)
  if (placed) head.append(placeButton(n));
  if (typeof context === "number") {
    // this course in this semester: its own unmet conditions
    const own = problems.filter((p) => p.n === n && p.i === context);
    // the tag and, below, the line with what is missing (guy, 2026-10-29: both, even if the words repeat; the
    // numbers inside the tag looked odd)
    own.forEach((p) => tags.push(el("span", { class: `tag ${p.level}`, text: p.tag })));
    // the side stripe is for real problems only, not for knowledge taken in parallel
    if (own.some((p) => p.level !== "soft")) node.classList.add(own.some((p) => p.level === "bad") ? "prob-bad" : "prob-warn");
    if (!own.length && c && (c.admission || c.required || c.recommended || c.priorCredits)) {
      tags.push(el("button", { type: "button", class: "link cond-link", "data-cond": `${n}|${context}`, text: T("תנאים") }));
    }
    // one short line per condition, naming what is missing in short (guy, 2026-10-29); the full checklist opens in a window
    own.forEach((p) => {
      const same = new Set([...p.have, ...state.semesters[context]]);
      const open = p.parts.filter((e) => !satisfied(e, p.have));
      const missing = fewCourses((p.level === "soft" ? open : open.filter((e) => !satisfied(e, same))).map(shortPart));
      notes.push(el("div", { class: `why ${p.level}` },
        p.level === "soft" ? T("נלמד באותו סמסטר ") : p.key === "prior" ? priorText(p.prior) + " "
          : p.key === "admission" ? T`חסר תנאי קבלה: ${missing}` + " " : T`חסר ידע קודם: ${missing}` + " ",
        el("button", { type: "button", class: "link", "data-cond": `${n}|${context}`, text: T("פירוט") })));
    });
  } else if (inTree && !placed) {
    // a course in the tree that a placed course is waiting for
    const needs = problems.filter((p) => p.missing.has(n));
    if (needs.length) {
      node.classList.add(needs.some((p) => p.level === "bad") ? "needed-bad" : "needed-warn");
      needs.forEach((p) => notes.push(el("div", { class: `why ${p.level}`, text: T`${p.label} ל-${p.n}, ${deadline(p.i)}` })));
    } else {
      // one of several options for a placed course: a soft dot, not a frame, so it does not look required
      const options = problems.filter((p) => p.choices.some((ch) => ch.courses.includes(n)));
      if (options.length) {
        const level = options.some((p) => p.level === "bad") ? "bad" : "warn";
        node.classList.add(`option-${level}`);
        head.prepend(el("span", { class: `dot ${level}`, "aria-label": T`אפשרות לתנאי של ${options.map((p) => p.n).join(", ")}`, text: "●" }));
      }
    }
  }
  // a course whose credits an overlap cuts (in a semester or in "done"): what it counts, and with which course
  const cutLine = (typeof context === "number" || context === "done") ? overlapLine(n) : null;
  if (cutLine) {
    tags.push(el("span", { class: `tag ${cutLine.level === "bad" ? "bad" : "soft"}`, text: cutLine.level === "bad" ? T("אסור יחד") : T`נספרים ${counted(n)} נ"ז` }));
    notes.push(el("div", { class: `why ${cutLine.level}` }, cutLine.text + " ",
      el("button", { type: "button", class: "link", "data-info": n, text: T("פירוט") })));
  }
  const bg = c && backgroundFor(n);
  if (bg && typeof context === "number") { // in a semester; in "done" the student has already taken it
    const ticked = (state.background || []).includes(bg.id);
    notes.push(el("div", { class: `why ${ticked ? "warn" : "soft"}`, text: onlyWithoutBackground(bg) }));
  }
  const prepWhy = prepNote(n, context);
  if (prepWhy) notes.push(el("div", { class: "why soft", text: prepWhy }));
  const lockable = typeof context === "number" || context === "done";
  let lockButton = null;
  if (lockable) {
    lockButton = el("button", { type: "button", class: `lock${isLocked(n) ? " on" : ""}`, "data-lock": n,
      title: context === "done"
        ? (isLocked(n) ? T("נעול: נשאר כאן גם כשמנקים את האזור. לחיצה משחררת.") : T("נעילה: הקורס יישאר כאן גם כשמנקים את האזור"))
        : isLocked(n) ? T("נעול: נשאר במקום גם בניקוי ובמילוי. לחיצה משחררת.") : T("נעילה: הקורס יישאר במקומו גם בניקוי הסמסטרים ובמילוי לפי התכנית המומלצת"),
      "aria-label": isLocked(n) ? T("שחרור הנעילה") : T("נעילה"), "aria-pressed": isLocked(n) ? "true" : "false" });
    lockButton.innerHTML = isLocked(n) ? LOCK_ICON : UNLOCK_ICON;
  }
  head.append(el("span", { class: "actions" },
    lockButton,
    el("button", { type: "button", class: "i", "data-info": n, "aria-label": T("פרטי הקורס"), text: "ⓘ" }),
    (!inTree || context === "extra") && !(lockable && isLocked(n))
      ? el("button", { type: "button", class: "x", "data-remove": n, "data-from": context === "extra" ? "extra" : "plan", "aria-label": T("הסרה"), text: "×" })
      : null));
  node.append(head, el("div", { class: "chip-tags" }, tags), ...notes);
  // what a screen reader says on reaching the card: number, name, credits and tags (not the buttons in it)
  if (!placed) node.setAttribute("aria-label", [n, courseName(n), ...tags.filter((t) => t.tagName === "SPAN").map((t) => t.textContent)].join(", "));
  return node;
}

// ---------- rendering ----------

// what a re-render should hold still on screen (guy, 2026-10-30: after a drop the whole page jumped): the place the
// course went to, or else the topmost part of the plan in view; and the top of the tree's own scroll
let keepInView = null;

// several candidates, top first, each found again after the re-render by a selector: the first that is still there
// sets how far things moved, and the page (or the tree) scrolls back by that much
function holdStill(candidates, scroller = null) {
  const marks = candidates.map((find) => ({ find, node: find() })).filter((m) => m.node)
    .map((m) => ({ find: m.find, top: m.node.getBoundingClientRect().top }));
  return () => {
    for (const m of marks) {
      const again = m.find();
      if (!again) continue;
      const shift = again.getBoundingClientRect().top - m.top;
      if (shift && scroller) scroller.scrollTop += shift;
      else if (shift) window.scrollBy(0, shift);
      return;
    }
  };
}

// the parts of the plan column in view, top first, as selectors that find them again after a re-render
function planInView() {
  const parts = [...document.querySelectorAll(".plan [id], .plan [data-zone]")].filter((x) => {
    const r = x.getBoundingClientRect();
    return r.height && r.top >= 0 && r.top < innerHeight;
  });
  return parts.slice(0, 6).map((x) => {
    const sel = x.id ? `#${CSS.escape(x.id)}` : `[data-zone='${x.dataset.zone}']`;
    return () => $(sel);
  });
}

// the cards in view in the tree, top first. A course can show in two lists (CB: 20916 is required and elective), so
// each is found again inside its own item; a card whose item shrank after the change is gone, and the next one counts
function treeInView(treeBox) {
  const box = treeBox.getBoundingClientRect();
  return [...treeBox.querySelectorAll("#tree .chip")].filter((c) => {
    const r = c.getBoundingClientRect();
    return r.bottom > box.top + 20 && r.top < box.bottom;
  }).slice(0, 8).map((c) => {
    const holder = c.parentElement.closest("#tree [id]");
    const within = holder ? `#${CSS.escape(holder.id)} ` : "#tree ";
    return () => treeBox.querySelector(`${within}.chip[data-n="${c.dataset.n}"]`);
  });
}

// withStatic: also the parts that change only with the program or a whole new plan (undo, redo, reset), inside the
// same hold, so they do not move things before it measures
// the keyboard focus, described so it can be found again after the page is rebuilt: a card (its place and number)
// or a button in it, an element with an id, or a button by its data attribute
function focusKey(a) {
  if (!a || a === document.body || a.closest("dialog")) return null;
  const card = a.closest(".chip");
  if (card) {
    const box = a.closest("[data-zone]") || a.closest("[id]");
    const where = box ? (box.dataset.zone ? `[data-zone='${box.dataset.zone}']` : `#${CSS.escape(box.id)}`) : "";
    // the first class only: the others are states that the change itself may flip ("lock on" -> "lock")
    const part = a === card ? "" : a.classList[0] ? `.${CSS.escape(a.classList[0])}` : a.tagName.toLowerCase();
    return `${where} .chip[data-n='${card.dataset.n}']${part ? ` ${part}` : ""}`;
  }
  if (a.id) return `#${CSS.escape(a.id)}`;
  const data = [...a.attributes].find((x) => x.name.startsWith("data-") && x.name !== "data-t");
  return data ? `${a.tagName.toLowerCase()}[${data.name}="${CSS.escape(data.value)}"]` : null;
}
function refocus(key) {
  if (!key) return;
  const again = document.querySelector(key);
  if (again && again !== document.activeElement) again.focus({ preventScroll: true });
}

function render(withStatic = false) {
  const focus = focusKey(document.activeElement);
  const zone = keepInView === null ? null : keepInView === "done" ? "#done" : `[data-zone='s${keepInView}']`;
  keepInView = null;
  // at the very top of the page the page stays at the top: holding a part in place there scrolled the page down at
  // the first build, so a refresh opened in the middle of the page (guy, 2026-10-31)
  const holdPage = zone ? holdStill([() => $(zone)]) : scrollY > 0 ? holdStill(planInView()) : () => {};
  const treeBox = $(".tree");
  const holdTree = treeBox ? holdStill(treeInView(treeBox), treeBox) : () => {};
  if (withStatic) renderStatic();
  renderAll();
  markFound();
  holdPage();
  holdTree();
  placeMini();
  if (moveFocus) { const next = moveFocus; moveFocus = null; if (typeof next === "function") next(); else focusMoved(next); } else refocus(focus);
}

function renderAll() {
  problems = findProblems();
  renderProblems();
  renderBackground();
  renderNeeds();
  renderSkills();
  renderStatus();
  renderMeters();
  renderMini();
  // a finished plan: the green status line and the counters become one green card (guy, 2026-10-31). Not while a
  // bar (problems, English/library) sits between them: then the plan is not really finished for the student
  $("#plan-start").classList.toggle("complete", $("#status").classList.contains("done") && $("#problems").hidden
    && $("#needs").hidden && [...document.querySelectorAll("#meters .meter")].every((m) => m.classList.contains("full")));
  renderDone();
  renderSemesters();
  renderTree();
  renderExtra();
  renderLists();
  // with a course picked by tap, light up only the places it can go: the semesters and "done", not the lists in the tree
  document.querySelectorAll("#done, [data-zone^='s']").forEach((z) => z.classList.toggle("tap-target", selected !== null));
  markBlocked(); // and their colors, as while dragging (and off again when the pick ends)
  document.body.classList.toggle("picking", selected !== null);
  const doneTools = $("#done-sum").parentNode;
  doneTools.querySelectorAll(".put-here").forEach((b) => b.remove());
  if (selected !== null) doneTools.prepend(putHere($("#done")));
  $("#pick-bar").hidden = selected === null;
  // one line: the "+ שיבוץ כאן" buttons explain themselves; the how-to is left for a screen reader, which does not see them
  if (selected !== null) $("#pick-text").replaceChildren(T`נבחר: ${selected} ${courseName(selected)}`,
    el("span", { class: "sr-only", text: T(". לוחצים על \"שיבוץ כאן\" בסמסטר, או על קורס אחר כדי לבחור אותו.") }));
}

// with a course picked, a button in the head of each place it can go
function putHere(zone) {
  if (selected === null || zone.classList.contains("no-drop")) return null;
  return el("button", { type: "button", class: "put-here", text: T("+ שיבוץ כאן") });
}

// ---------- the keyboard: "where to?" ----------
// Enter on a card (or "העברה ל..." in its window) opens a list of every place the course can go, each with what
// would be missing there; the arrows move in the list, Enter puts the course there, and the focus follows the
// course to its new place, so the next Tab goes on from there (accessibility, 2026-10-31)
let moveFocus = null; // the course whose card gets the focus after the next render (or a function that sets it)
function openMove(n) {
  const c = DATA.courses[n];
  const where = locationOf(n);
  const ids = semesterIds();
  const item = (target, label, state, cls, disabledReason) => el("li", {}, el("button", {
    type: "button", class: cls, "data-move-to": String(target), "data-move-n": n,
    // a place the course cannot go: Tab and the arrows skip it (a screen reader still reads it, with its state)
    ...(disabledReason ? { "aria-disabled": "true", "data-reason": disabledReason, tabindex: "-1" } : {}),
  }, el("span", { text: label }), el("span", { class: "state", text: state })));
  const sems = ids.map((id, i) => {
    const label = T`סמסטר ${semesterLabel(id)}`;
    if (where === i) return item(i, label, T("הקורס כאן עכשיו"), "here");
    const reason = blockedReason(n, i);
    if (reason) return item(i, label, T("לא אפשרי"), "", reason);
    const issues = dropIssues(n, i);
    return issues.admission ? item(i, label, T("חסר תנאי קבלה"), "bad")
      : issues.required ? item(i, label, T("חסר ידע קודם דרוש"), "warn")
        : item(i, label, T("אפשר"), "ok");
  });
  $("#move-body").replaceChildren(
    el("h3", { id: "move-title" }, T("לאן להעביר את "), el("span", { class: "num", text: n }), " ", el("bdi", { lang: LANG === "he" ? null : "he", text: c ? c.name : "" }), "?"),
    el("ul", { class: "move-list" },
      where === "done" ? item("done", T("קורסים שכבר עשיתי"), T("הקורס כאן עכשיו"), "here") : item("done", T("קורסים שכבר עשיתי"), "", ""),
      ...sems,
      where !== null ? item("tree", T("הוצאה מהתכנית (חזרה לעץ)"), "", "") : null),
    el("p", { class: "move-hint", text: T("חיצים למעלה ולמטה עוברים בין המקומות, Enter משבץ, Esc סוגר.") }));
  liftTitle("#move-body", "#move-head");
  $("#move").showModal();
  // the focus starts on the first semester where nothing would be missing, after the course's current place
  const buttons = [...$("#move-body").querySelectorAll("button")];
  const start = buttons.find((b) => b.classList.contains("ok") && (typeof where !== "number" || Number(b.dataset.moveTo) > where))
    || buttons.find((b) => b.classList.contains("ok")) || buttons.find((b) => !b.hasAttribute("aria-disabled")) || buttons[0];
  start.focus();
}
function focusMoved(n) {
  const card = [...document.querySelectorAll(`.chip[data-n='${n}'][tabindex]`)].find((x) => !x.closest(".outside, #lists"));
  if (!card) return;
  card.focus({ preventScroll: true });
  card.scrollIntoView({ block: "nearest", behavior: SMOOTH() });
}
function announce(text) {
  const box = $("#announce");
  box.textContent = "";
  setTimeout(() => { box.textContent = text; }, 50); // a change the screen reader notices even for the same text
}
function setupMove() {
  $("#move").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = [...$("#move-body").querySelectorAll("button:not([aria-disabled])")];
    const k = buttons.indexOf(document.activeElement);
    if (k < 0) return;
    e.preventDefault();
    buttons[(k + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length].focus();
  });
  $("#move").addEventListener("click", (e) => {
    const b = e.target.closest("[data-move-to]");
    if (!b) return;
    if (b.dataset.reason) { toast(b.dataset.reason); announce(b.dataset.reason); return; }
    const n = b.dataset.moveN;
    const to = b.dataset.moveTo;
    const target = to === "done" || to === "tree" ? to : Number(to);
    $("#move").close();
    keepOutside(n);
    moveFocus = n;
    place(n, target);
    const now = locationOf(n);
    announce(now === null ? T`${n} הוצא מהתכנית` : now === "done" ? T`${n} נמצא ב"קורסים שכבר עשיתי"` : T`${n} שובץ בסמסטר ${semesterLabel(semesterIds()[now])}`);
  });
}

// phones: the tree is a full-screen layer, opened by the floating button
function setTreeOpen(open) {
  document.body.classList.toggle("tree-open", open);
}
const treeIsLayer = () => matchMedia("(max-width: 900px)").matches;

// the credit totals of the plan against the program's minimums: [label, value, target]
// the credit counters of the program (sheet "מונים"): [label, value, target, phrase]. A counter sums the credits
// (or the advanced credits) of the planned courses in its field; with a cap, at most so many come from a narrower
// field (CB: of the 27 advanced in sciences, at most 5 in general sciences)
// "מקטע ג": only the courses the program lists in that section (CB's 75 physics credits are from its lists,
// not from any physics course; guy: stick to the program's own lists)
function inCounter(n, field) {
  // "מקטע ב", or several sections, "מקטעים ג, ד, ה" (OJ, 2026-11-03: 76 credits in life sciences, from three sections)
  const section = /^מקטע(?:ים)? (.+)$/.exec(field || "");  // not /מקטעים?/, which needs "מקטעי" (broke every "מקטע X", 2026-11-03)
  if (!section) return inField(DATA.courses[n], field);
  const ids = section[1].split(", ");
  const listed = new Set();
  program.sections.filter((s) => ids.includes(s.id))
    .forEach((s) => s.groups.forEach((g) => g.items.forEach((it) => it.courses && coursesIn(it.courses, listed))));
  if (!listed.has(n)) return false;
  // a course that a required group of another section uses counts there, not here too (CC, 2026-11-03: 20320 is a
  // physics elective, and with 20955 the quantum requirement of section ג)
  const have = new Set(plannedCourses());
  const elsewhere = new Set();
  program.sections.filter((s) => !ids.includes(s.id)).forEach((s) => s.groups.filter(isRequired)
    .forEach((g) => g.items.forEach((it) => it.courses && usedCourses(it.courses, have, elsewhere))));
  return !elsewhere.has(n);
}

// ---------- overlapping courses (guy, 2026-10-31) ----------
// The courses of an overlap combination give together at most its credits (the university's overlap page). When the
// plan has all of them, the excess comes off one course: never a required course of the program, if another one
// can pay (the rule of the overlap page: a required course counts in full); otherwise the one studied last ("done"
// counts as first). A combination marked "-" may not be studied together at all: the course studied later counts
// nothing, and its card says so. The counters and the groups use these credits; the semester sums keep the full
// credits, since they show how much there is to study in the semester
let overlapMemo = null;
function overlapCuts() {
  const key = program.code + planJSON(state);
  if (overlapMemo && overlapMemo.key === key) return overlapMemo.cuts;
  const order = new Map();
  state.done.forEach((n) => order.set(n, -1));
  state.semesters.forEach((list, i) => list.forEach((n) => order.set(n, i)));
  const cuts = cutsFor([...new Set(plannedCourses())], order);
  overlapMemo = { key, cuts };
  return cuts;
}
// the overlap cuts among a set of courses (order: course -> when it is studied, "done" = -1)
function cutsFor(courses, order) {
  const planned = courses.filter((n) => DATA.courses[n]);
  const have = new Set(planned);
  const required = new Set();
  program.sections.forEach((s) => s.groups.filter(isRequired)
    .forEach((g) => g.items.forEach((it) => it.courses && !isLongList(it.courses) && usedCourses(it.courses, have, required))));
  const combos = new Map(); // each combination once, by its sorted members
  planned.forEach((n) => (DATA.courses[n].overlaps || []).forEach((o) => {
    const members = [n, ...o.with].sort();
    if (members.every((m) => have.has(m))) combos.set(members.join("+"), { members, total: o.total });
  }));
  const left = new Map(planned.map((n) => [n, DATA.courses[n].credits || 0]));
  const cuts = new Map(); // course -> { cut, notes: [{ with, total }] }
  const charge = (n, cut, note) => {
    if (cut <= 0) return;
    left.set(n, left.get(n) - cut);
    const c = cuts.get(n) || { cut: 0, notes: [] };
    c.cut += cut;
    c.notes.push(note);
    cuts.set(n, c);
  };
  // the larger combinations first (20522 + 20320 + 20955 before 20522 + 20320)
  [...combos.values()].sort((a, b) => b.members.length - a.members.length).forEach(({ members, total }) => {
    const payers = [...members].sort((a, b) => (required.has(a) - required.has(b)) || (order.get(b) - order.get(a)) || b.localeCompare(a));
    if (total === null) { // not together: the later one counts nothing
      const n = payers[0];
      charge(n, left.get(n), { with: members.filter((m) => m !== n), total: null });
      return;
    }
    let excess = members.reduce((s, m) => s + left.get(m), 0) - total;
    for (const n of payers) {
      if (excess <= 0) break;
      const cut = Math.min(excess, left.get(n));
      charge(n, cut, { with: members.filter((m) => m !== n), total });
      excess -= cut;
    }
  });
  return cuts;
}
// the credits in a field among courses studied before a course, after the overlap cuts among them, for a "prior
// credits" condition (guy, 2026-11-01: 20522 + 20320 count 7, not 9, as in the counters)
function priorCreditsIn(courses, field, order) {
  const cuts = cutsFor(courses, order);
  return courses.filter((x) => DATA.courses[x] && inField(DATA.courses[x], field))
    .reduce((a, x) => a + (DATA.courses[x].credits || 0) - (cuts.get(x) ? cuts.get(x).cut : 0), 0);
}
// what a course counts in the plan: its credits less the overlap cut; its advanced credits at most that
function counted(n, kind = "credits") {
  const c = DATA.courses[n];
  if (!c) return 0;
  const cut = overlapCuts().get(n);
  const credits = (c.credits || 0) - (cut ? cut.cut : 0);
  if (kind === "advanced") return Math.min(c.advanced || 0, credits);
  // opening-level credits: the whole course at opening level, a course of two levels by its opening part (M8)
  if (kind === "opening") return c.level === "פתיחה" ? credits : Math.min(c.opening || 0, credits);
  return credits;
}
// one line on a course whose credits were cut: with which course, and what it counts
function overlapLine(n) {
  const cut = overlapCuts().get(n);
  if (!cut) return null;
  const c = DATA.courses[n];
  const forbidden = cut.notes.find((x) => x.total === null);
  if (forbidden) return { level: "bad", text: T`אסור ללמוד יחד עם ${forbidden.with.join(" + ")}: מי שלמד אחד מהם לא יכול ללמוד את השני. הקורס לא נספר בתכנית.` };
  const others = [...new Set(cut.notes.flatMap((x) => x.with))].join(", ");
  return { level: "soft", text: T`חופף ל-${others}: נספרים ${counted(n)} נ"ז מתוך ${c.credits}.` };
}

function creditTotals() {
  const have = [...new Set(plannedCourses())].filter((n) => DATA.courses[n]);
  // with the overlap cuts (counted), not the full credits
  const sum = (list, key) => list.reduce((s, n) => s + counted(n, key), 0);
  return (program.counters || []).filter((m) => m.max == null).map((m) => counterRow(m, have, sum));
}
// one counter: the sum of its field, with at most so many credits from a narrower field
function counterRow(m, have, sum) {
  const inIt = have.filter((n) => inCounter(n, m.field));
  let value = sum(inIt, m.kind);
  if (m.capField && m.cap != null) {
    const capped = sum(inIt.filter((n) => inCounter(n, m.capField)), m.kind);
    value = value - capped + Math.min(capped, m.cap);
  }
  return [m.label, value, m.min, m.phrase || m.label, m];
}
// the counters of "at most" (M8: no more than 36 opening credits): [label, value, max, phrase, counter]
function creditCaps() {
  const have = [...new Set(plannedCourses())].filter((n) => DATA.courses[n]);
  const sum = (list, key) => list.reduce((s, n) => s + counted(n, key), 0);
  return (program.counters || []).filter((m) => m.max != null).map((m) => {
    const [label, value, , phrase] = counterRow(m, have, sum);
    return [label, value, m.max, phrase, m];
  });
}

// courses that a required ("all items") group uses to meet its items: an elective group does not count them again
// (CB: 20916 is both a required option and an elective, "only for those who did not take it as required").
// Of the options of "k of" that are met, the k with the fewest credits are the required ones, so the rest
// count as electives
function usedCourses(expr, have, out = new Set()) {
  if (typeof expr === "string") { if (have.has(expr)) out.add(expr); return out; }
  if (expr.and) expr.and.forEach((e) => usedCourses(e, have, out));
  else if (expr.or) { const e = expr.or.find((x) => satisfied(x, have)); if (e) usedCourses(e, have, out); }
  else if (expr.of) {
    const credits = (e) => [...usedCourses(e, have)].reduce((s, n) => s + ((DATA.courses[n] || {}).credits || 0), 0);
    expr.of.filter((x) => satisfied(x, have)).sort((a, b) => credits(a) - credits(b)).slice(0, expr.atleast)
      .forEach((e) => usedCourses(e, have, out));
  }
  return out;
}

// the credits a "at least N credits" group has in the plan, without the courses the required groups use
function groupCredits(group) {
  const have = new Set(plannedCourses());
  const required = new Set();
  program.sections.forEach((s) => s.groups.filter(isRequired)
    .forEach((g) => g.items.forEach((it) => it.courses && usedCourses(it.courses, have, required))));
  const inGroup = new Set();
  group.items.forEach((it) => it.courses && coursesIn(it.courses, inGroup));
  return [...inGroup].filter((n) => have.has(n) && !required.has(n)).reduce((s, n) => s + counted(n), 0);
}

// everything the plan still lacks for the degree: required items, credits in choice groups, and the credit totals.
// Each gap points at the tree item or group it is about (target), so the student can jump there
function degreeGaps() {
  const have = new Set(plannedCourses());
  const gaps = [];
  program.sections.forEach((section) => section.groups.forEach((group) => {
    if (isRequired(group)) {
      group.items.forEach((item, i) => {
        if (item.courses && !satisfied(item.courses, have)) {
          // the course numbers too (guy, 2026-10-31), on the site and in print: "20229 אלגברה לינארית 2" for one course,
          // "תרמודינמיקה (20482 או 20217)" for a short choice; a long choice ("אחת מ-5 חלופות") keeps just its topic
          const c = item.courses;
          const brief = typeof c === "string" || c.of ? null : shortPart(c);
          const text = typeof c === "string" ? `${c} ${item.label}` : brief && /^\d{5}/.test(brief) ? `${item.label} (${brief})` : item.label;
          gaps.push({ kind: "item", text, where: group.name, target: `item-${group.id}-${i}`, choice: group.rule === "חובת בחירה" || isLongList(c) });
        }
      });
    } else if (group.minCredits) {
      const credits = groupCredits(group);
      if (credits < group.minCredits) {
        gaps.push({ kind: "credits", credits: group.minCredits - credits, text: T`${group.minCredits - credits} נ"ז מ${group.name}`, target: `group-${group.id}` });
      }
      // a requirement inside the group (OE: one seminar course among its 15 credits), missing as long as it is not met
      if (group.mustInclude && !satisfied(group.mustInclude, have)) {
        gaps.push({ kind: "item", text: T`${group.mustLabel} מ${group.name}`, where: group.name, target: `group-${group.id}`, choice: true });
      }
    }
  }));
  creditTotals().forEach(([label, value, target, phrase, counter]) => {
    if (target && value < target) gaps.push({ kind: "total", credits: target - value, text: T`${target - value} נ"ז ${phrase}`, label, counter });
  });
  creditCaps().forEach(([label, value, max, phrase, counter]) => {
    if (value > max) gaps.push({ kind: "cap", credits: value - max, text: T`${value} נ"ז ${phrase}, ומותר לכל היותר ${max}`, label, counter });
  });
  return gaps;
}

// What is left before the plan is a whole degree, as steps (guy, 2026-11-03: colleagues read the old line "עוד חסר
// לתואר" as information, and a plan filled from the recommended plan as a finished one). In order: the required courses,
// the choices the degree leaves to the student, the electives, the credit totals, the courses whose conditions are not
// met, and "רקע ודרישות". A step that applies to the program is listed also when it is done (✓), so the student sees how
// far the plan has come. Each: { done, text, subs (gaps, each a link into the tree), problems, target, detail, hint }
function planSteps() {
  const gaps = degreeGaps();
  const groups = program.sections.flatMap((x) => x.groups);
  const steps = [];
  const items = gaps.filter((g) => g.kind === "item" && !g.choice);
  steps.push(items.length
    ? { done: false, text: items.length === 1 ? T("להוסיף קורס חובה 1") : T`להוסיף ${items.length} קורסי חובה`, subs: items }
    : { done: true, text: T("כל קורסי החובה בתכנית") });
  const choices = gaps.filter((g) => g.kind === "item" && g.choice);
  if (groups.some((g) => g.rule === "חובת בחירה" || g.mustInclude || (isRequired(g) && g.items.some((it) => isLongList(it.courses))))) {
    steps.push(choices.length ? { done: false, text: T("לבחור את הקורסים שהתואר משאיר לבחירתך"), subs: choices }
      : { done: true, text: T("הקורסים שהתואר משאיר לבחירתך") });
  }
  const credits = gaps.filter((g) => g.kind === "credits");
  if (groups.some((g) => !isRequired(g) && g.minCredits)) {
    steps.push(credits.length ? { done: false, text: T("לבחור קורסי בחירה"), subs: credits } : { done: true, text: T("קורסי הבחירה") });
  }
  const totals = gaps.filter((g) => g.kind === "total");
  steps.push(totals.length
    ? { done: false, text: T("להשלים נ\"ז"), subs: totals, hint: T("נ\"ז שחסרים בסך הכול אפשר להשלים גם בקורסי בחירה חופשית מכל תחום.") }
    : { done: true, text: T("כל הנ\"ז שהתואר דורש") });
  // a counter of "at most" (M8): its own step, done while the plan stays within it
  const caps = creditCaps();
  if (caps.length) {
    const over = gaps.filter((g) => g.kind === "cap");
    steps.push(over.length ? { done: false, text: T("להוריד נ\"ז מעבר למותר"), subs: over }
      : { done: true, text: caps.map(([, , max, phrase]) => T`לא יותר מ-${max} נ"ז ${phrase}`).join(" · ") });
  }
  const open = new Set(problems.filter((x) => x.level !== "soft").map((x) => x.n)).size;
  // only with courses in the semesters: an empty plan does not "meet every condition" (guy, 2026-11-03)
  if (open) steps.push({ done: false, text: open === 1 ? T("לתקן קורס 1 שחסרים לו תנאים") : T`לתקן ${open} קורסים שחסרים להם תנאים`, problems: true });
  else if (state.semesters.some((x) => x.length)) steps.push({ done: true, text: T("כל הקורסים עומדים בתנאים שלהם") });
  // a background box neither ticked nor replaced by its courses in the plan, and English / library a course needs
  const planned = new Set(plannedCourses());
  const bg = (program.background || []).filter((b) => !(state.background || []).includes(b.id) && !satisfied(b.courses, planned));
  // English / library: also those the degree itself asks for, with no course yet (guy, 2026-11-04)
  const openSkills = askedSkills().filter((sk) => !hasSkill(sk.id));
  if (bg.length || openSkills.length) {
    steps.push({ done: false, text: T("לסמן את \"רקע ודרישות\""), target: "prereq-card",
      detail: [...bg.map((b) => T`${backgroundWhat(b)}, או ${plainCourses(b.courses)} בתכנית`), ...openSkills.map((sk) => sk.short)].join(" · ") });
  } else if ((program.background || []).length || askedSkills().length) {
    steps.push({ done: true, text: T("\"רקע ודרישות\"") });
  }
  return steps;
}

// a gap as a link into the tree (or plain text), for the steps
const gapLink = (g) => (g.target ? el("button", { type: "button", class: "link", "data-goto": g.target, text: g.text }) : el("span", { text: g.text }));

// above the meters: green when the plan is a whole degree, otherwise "התכנית עוד לא גמורה" and the steps
// a plan built here is not an approved plan (guy, 2026-11-03: students must not think it is): the same words on the
// page, in the print and share windows and on the print page
// "מערכת השאילתא" links to Sheilta (guy, 2026-11-03), also in a saved PDF of the print page
const SHEILTA = "https://sheilta.apps.openu.ac.il/pls/dmyopt2/sheilta.main";
const sheiltaLink = () => el("a", { href: SHEILTA, target: "_blank", rel: "noopener", text: T("מערכת השאילתא") });
const approvalFinal = () => [T("אישור תכנית לימודים סופית מתקבל רק דרך "), sheiltaLink(), "."];
const APPROVAL = () => [T("תכנית שבונים כאן אינה מאושרת. "), ...approvalFinal()];
const approvalNote = () => el("p", { class: "approval" }, el("strong", { text: T("חשוב: ") }), APPROVAL());

function renderStatus() {
  const steps = planSteps();
  const open = steps.filter((x) => !x.done);
  const box = $("#status");
  if (!open.length) {
    box.className = "status done";
    box.replaceChildren(el("span", { class: "big", text: "✓" }),
      el("span", {}, el("strong", { text: T("התכנית כוללת את כל דרישות התואר") }), T(", וכל הקורסים בה עומדים בתנאים שלהם."),
        el("span", { class: "next" }, approvalFinal())));
    return;
  }
  box.className = "status todo";
  box.replaceChildren(
    el("div", { class: "steps-head" }, el("strong", { text: T("התכנית עוד לא גמורה") }), " ",
      el("span", { text: open.length === 1 ? T("נשאר צעד 1") : T`נשארו ${open.length} צעדים` })),
    el("ol", { class: "steps" }, steps.map((x) => el("li", { class: x.done ? "done" : "open" },
      el("span", { class: "mark", "aria-label": x.done ? T("בוצע") : T("עוד לא"), text: x.done ? "✓" : "○" }),
      el("div", {},
        el("span", { class: "step-text", text: x.text }),
        x.problems ? el("span", {}, " ", el("button", { type: "button", class: "link show-problem" }, eyeIcon(), T("הצגה"))) : null,
        x.target ? el("span", {}, " ", el("button", { type: "button", class: "link", "data-goto": x.target, text: T("סימון") })) : null,
        x.detail ? el("div", { class: "step-sub", text: x.detail }) : null,
        // a few gaps inline; many (an empty plan has some 20 required courses) folded under "הצגה"
        x.subs && x.subs.length <= 4 ? el("div", { class: "step-sub" }, x.subs.flatMap((g, k) => [k ? " · " : null, gapLink(g)])) : null,
        x.subs && x.subs.length > 4 ? el("details", { class: "step-sub" }, el("summary", { text: T`הצגת ${x.subs.length} הפריטים` }),
          el("ul", {}, x.subs.map((g) => el("li", {}, gapLink(g), g.where ? el("span", { class: "where", text: ` (${g.where})` }) : null)))) : null,
        x.hint ? el("div", { class: "step-sub hint", text: x.hint }) : null)))));
}

function renderMeters() {
  const meters = creditTotals().map(([label, value, target]) => [capital(label), value, target]);
  const caps = creditCaps();
  $("#meters").style.setProperty("--count", meters.length + caps.length);
  $("#meters").replaceChildren(
    ...meters.map(([label, value, target]) => {
      const pct = target ? Math.min(100, (value / target) * 100) : 0;
      return el("div", { class: `meter${target && value >= target ? " full" : ""}` },
        el("div", { class: "label", text: label }),
        // left to right in every language, "120 / 132": the goal on the right in large, the student's credits on the
        // left in small, also once the goal is reached (then only the color turns green; guy, 2026-11-01)
        el("div", { class: "value" }, target ? el("span", { dir: "ltr" }, el("small", { text: `${value} / ` }), String(target)) : String(value)),
        el("div", { class: "bar" }, el("span", { style: `width:${pct}%` })));
    }),
    // "at most" (M8): within it, a plain meter; over it, red
    ...caps.map(([label, value, max]) => el("div", { class: `meter cap${value > max ? " over" : ""}` },
      el("div", { class: "label", text: capital(label) }),
      el("div", { class: "value" }, el("span", { dir: "ltr" }, el("small", { text: `${value} / ` }), String(max)), el("small", { class: "at-most", text: T(" לכל היותר") })),
      el("div", { class: "bar" }, el("span", { style: `width:${Math.min(100, (value / max) * 100)}%` })))),
    el("p", { class: "meters-note", text: meterNote() }));
}

// the floating summary at the bottom of the plan column (guy, 2026-11-01): it shows while the status line and the
// counters at the top are scrolled out of sight, so the student sees what changes while placing courses far below.
// A click goes back up to them. Wide: what is missing, and every counter with a thin bar; narrow (a phone, with the
// tree's button beside it): one short line
// It follows the steps of "התכנית עוד לא גמורה" (guy, 2026-11-03: the bar said "✓ כל דרישות התואר בתכנית" while the
// card above still had a course with missing conditions): green only when no step is left
function renderMini() {
  const gaps = degreeGaps();
  const left = planSteps().filter((x) => !x.done).length;
  const leftText = left === 1 ? T("נשאר צעד 1") : T`נשארו ${left} צעדים`;
  const total = gaps.find((g) => g.kind === "total" && (!g.counter.field || g.counter.field === "כל הקורסים") && g.counter.kind === "credits");
  const done = !left;
  const box = $("#mini-status");
  box.classList.toggle("done", done);
  box.replaceChildren(
    el("span", { class: "mini-head" }, done ? el("strong", { text: T("✓ כל דרישות התואר בתכנית") })
      : [el("span", { class: "l", text: T("התכנית עוד לא גמורה") }), el("strong", { text: leftText })]),
    ...creditTotals().map(([label, value, target]) => el("span", { class: `mini-meter${target && value >= target ? " full" : ""}` },
      el("span", { class: "l", text: capital(label) }),
      el("span", { class: "v" }, target ? el("span", { dir: "ltr" }, `${value} / `, el("strong", { text: String(target) })) : el("strong", { text: String(value) })),
      el("span", { class: "bar" }, el("span", { style: `width:${target ? Math.min(100, (value / target) * 100) : 0}%` })))),
    el("span", { class: "mini-short", text: done ? T("✓ כל דרישות התואר בתכנית")
      : [T("לא גמורה"), leftText, total ? T`חסר: ${total.credits} נ"ז` : null].filter(Boolean).join(" · ") }));
}
// shown once the counters are above the screen (not while they are in sight); checked on scroll, on resize and after
// every render
function placeMini() {
  const above = $("#meters").getBoundingClientRect().bottom < 0;
  if ($("#mini-status").hidden === !above) return;
  $("#mini-status").hidden = !above;
  document.body.classList.toggle("mini-on", above);
}
function setupMini() {
  // capture: also a scroll of any box inside the page, not only of the page itself
  document.addEventListener("scroll", placeMini, { passive: true, capture: true });
  addEventListener("resize", placeMini);
  $("#mini-status").addEventListener("click", () => $("#status").scrollIntoView({ behavior: SMOOTH(), block: "start" }));
}

// under the counters: what they include, and the overlap cuts, if any (guy, 2026-10-31: the old note said the
// counters did not cut overlaps yet; now they do, and the note names the courses)
function meterNote() {
  const cuts = [...overlapCuts()].filter(([, c]) => c.cut > 0);
  const base = T("כולל את \"קורסים שכבר עשיתי\" ואת כל הסמסטרים.");
  if (!cuts.length) return base;
  const total = cuts.reduce((s, [, c]) => s + c.cut, 0);
  return base + " " + T`בגלל קורסים חופפים נספרים ${total} נ"ז פחות: ${cuts.map(([n]) => n).join(", ")} (פירוט בכרטיס הקורס).`;
}

function renderProblems() {
  const bad = new Set(problems.filter((p) => p.level === "bad").map((p) => p.n));
  const warn = new Set(problems.filter((p) => p.level === "warn" && !bad.has(p.n)).map((p) => p.n));
  const box = $("#problems");
  box.hidden = !bad.size && !warn.size;
  const parts = [];
  if (bad.size) parts.push(bad.size === 1 ? T("קורס 1 לא עומד בתנאי הקבלה") : T`${bad.size} קורסים לא עומדים בתנאי הקבלה`);
  if (warn.size) parts.push(warn.size === 1 ? T("לקורס 1 חסר ידע קודם דרוש") : T`ל-${warn.size} קורסים חסר ידע קודם דרוש`);
  box.className = `problems ${bad.size ? "bad" : "warn"}`;
  box.replaceChildren(el("span", { text: T`בתכנית: ${parts.join("; ")}.` }),
    el("button", { type: "button", class: "link", id: "show-problem" }, eyeIcon(), T("הצגה")));
}

// a bar under the problems: the English / library requirements the plan needs, by when
function renderNeeds() {
  const needs = skillNeeds();
  const box = $("#needs");
  box.hidden = !needs.length;
  if (!needs.length) return;
  const ids = semesterIds();
  const byDate = new Map();
  needs.forEach((x) => {
    const when = semesterLabel(ids[x.courses[0].i]);
    byDate.set(when, [...(byDate.get(when) || []), x.skill.short]);
  });
  box.replaceChildren(el("span", { text: T`בתכנית יש קורסים שדורשים ${[...byDate].map(([when, what]) => T`${what.join(T(" ו"))} לפני ${when}`).join(T(", ו"))}.` }),
    el("button", { type: "button", class: "link", "data-goto": "prereq-card", text: T("סימון") }));
}

// a checkbox for each requirement that the degree or a course in the semesters asks for (none asked, no box),
// with a link to the rules and, while unticked, where the plan needs it; one the degree asks for is open even before
// any course needs it, and says so (guy, 2026-11-04)
function renderSkills() {
  const needs = skillNeeds();
  const ids = semesterIds();
  const asked = askedSkills();
  $("#skills-card").hidden = !asked.length;
  $("#skills").replaceChildren(...asked.map((s) => {
    const need = needs.find((x) => x.skill === s);
    return el("div", { class: "skill" },
      el("label", { class: "check" },
        el("input", { type: "checkbox", "data-skill": s.id, checked: hasSkill(s.id) }),
        // the link inside the text, so a long text wraps beside the checkbox and not under it (guy, 2026-11-01: phone)
        el("span", {}, s.checkbox, " ", el("a", { href: s.link, target: "_blank", rel: "noopener", class: "muted", text: T("מה זה? ↗") }))),
      need || (degreeAsks(s) && !hasSkill(s.id)) ? el("p", { class: "need-line", text: [
        degreeAsks(s) ? T("דרישה כללית של התואר.") : "",
        need ? T`נדרש לפני ${semesterLabel(ids[need.courses[0].i])}, בשביל ${fewCourses(need.courses.map((x) => x.n))}.` : "",
      ].filter(Boolean).join(" ") }) : null);
  }));
  renderPrereq();
}

// the card that holds both: hidden when neither has a line; folded to one line of ✓ once nothing is left to tick
// (a background met by courses in the plan counts), and open again when something is. Only a change of that state
// opens or folds it, so a student who opened or folded it by hand keeps it so
let prereqDone = null;
function renderPrereq() {
  const card = $("#prereq-card");
  const planned = new Set(plannedCourses());
  const bg = $("#background-card").hidden ? [] : (program.background || []).map((b) => ({
    text: T("בגרות"), ok: (state.background || []).includes(b.id) || satisfied(b.courses, planned) }));
  const skills = SKILLS.filter((s) => $(`#skills [data-skill='${s.id}']`)).map((s) => ({ text: s.short, ok: hasSkill(s.id) }));
  const all = [...bg, ...skills];
  card.hidden = !all.length;
  $("#prereq-sum").textContent = all.map((x) => `${x.ok ? "✓" : "○"} ${x.text}`).join(" · ");
  const done = all.every((x) => x.ok);
  if (done !== prereqDone) card.open = !done;
  prereqDone = done;
}

function renderDone() {
  const zone = $("#done");
  zone.dataset.empty = T("גוררים לכאן קורסים שכבר סיימתם");
  zone.replaceChildren(...state.done.map((n) => chip(n, "done")));
  const credits = state.done.reduce((s, n) => s + ((DATA.courses[n] || {}).credits || 0), 0);
  $("#done-sum").textContent = state.done.length ? T`${credits} נ"ז` : "";
  $("#clear-done").hidden = !state.done.some((n) => !isLocked(n));
  $("#clear-semesters").hidden = !state.semesters.flat().some((n) => !isLocked(n));
}

// a trash-can icon (not an ×, which the course cards inside already use) for removing the last semester
const TRASH_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>';

function trashButton(id) {
  const b = el("button", { type: "button", class: "remove-semester", id: "remove-semester",
    title: T("הסרת הסמסטר (אפשר להסיר רק את הסמסטר האחרון)"), "aria-label": T`הסרת סמסטר ${semesterLabel(id)}` });
  b.innerHTML = TRASH_ICON;
  return b;
}

function renderSemesters() {
  const ids = semesterIds(); // always from semester א, so every row of three is one academic year (א, ב, summer)
  const last = ids.length - 1;
  // a whole year at a time, not one semester (guy, 2026-10-31); a year cut short by removing semesters is completed first
  const nextYear = nextSemester(ids[last]).slice(0, 4);
  const addYear = el("button", { type: "button", class: "add-year", id: "add-year" },
    el("span", { class: "plus", "aria-hidden": "true", text: "+" }),
    ids.length % 3 ? T("השלמת השנה האחרונה") : T`הוספת שנה (${nextYear})`);
  $("#semesters").replaceChildren(...ids.map((id, i) => {
    const list = state.semesters[i];
    const credits = list.reduce((s, n) => s + ((DATA.courses[n] || {}).credits || 0), 0);
    const blocked = isBlockedSemester(i);
    const zone = el("ul", { class: "zone", "data-zone": `s${i}`, "data-empty": blocked ? T("חסום: לא משבצים כאן קורסים") : T("גוררים לכאן קורסים") }, list.map((n) => chip(n, i)));
    markZone(zone, i);
    return el("div", { class: `semester${blocked ? " blocked" : ""}` },
      el("div", { class: "zone-head" },
        el("h3", { text: T`סמסטר ${semesterLabel(id)}` }),
        blocked ? null : putHere(zone),
        el("span", { class: "zone-sum", text: list.length ? T`${credits} נ"ז` : "" }),
        blockButton(i, id),
        i === last && last > 0 ? trashButton(id) : null),
      zone);
  }), addYear);
}

// blocks a semester, or frees it: in the head of every semester (guy, 2026-10-31). Only an empty semester can be
// blocked, so no course is lost or left in a place it cannot be
const BLOCK_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></svg>';
function blockButton(i, id) {
  const on = isBlockedSemester(i);
  const b = el("button", { type: "button", class: `block-semester${on ? " on" : ""}`, "data-block": String(i), "aria-pressed": on ? "true" : "false",
    title: on ? T`שחרור סמסטר ${semesterLabel(id)}` : T`חסימת סמסטר ${semesterLabel(id)}: לא ישובצו בו קורסים`,
    "aria-label": on ? T`שחרור סמסטר ${semesterLabel(id)}` : T`חסימת סמסטר ${semesterLabel(id)}` });
  b.innerHTML = BLOCK_ICON;
  return b;
}

function toggleBlock(i) {
  const id = semesterIds()[i];
  if (!isBlockedSemester(i) && state.semesters[i].length) {
    toast(T`בסמסטר ${semesterLabel(id)} יש קורסים. כדי לחסום אותו, מוציאים אותם קודם.`, 6000);
    return;
  }
  state.blocked = isBlockedSemester(i) ? state.blocked.filter((x) => x !== i) : [...(state.blocked || []), i].sort((a, b) => a - b);
  save(); render();
  announce(isBlockedSemester(i) ? T`סמסטר ${semesterLabel(id)} חסום` : T`סמסטר ${semesterLabel(id)} שוחרר`);
}

// each alternative gets its own box, with an "או" divider between boxes; the alternative already covered turns green
// a choice of one course from a long list (CB's broadening course: 145 courses), not alternatives to weigh
const LONG_LIST = 12;
// "מה זה?" beside a broadening list, to the catalog page (guy, 2026-11-04)
const whatBroadening = () => el("a", { href: BROADENING_LINK, target: "_blank", rel: "noopener", class: "muted", text: T("מה זה? ↗") });
const isLongList = (expr) => !!(expr && expr.or && expr.or.length > LONG_LIST && expr.or.every((e) => typeof e === "string"));

// Every "one of" (or "at least k of") is a dashed box with "או" between its options (guy, 2026-10-29). An option of
// one course is a bare card; an option of several courses taken together is one package: a box with a colored
// stripe and "+ וגם" between its parts. inner: a choice inside such a package, like (20453 | 11203); 20454, is
// labeled "אחד מהשניים" rather than "אחת מהחלופות", so it does not read as one more alternative
function renderExpr(expr, have, inner = false) {
  if (typeof expr === "string") return el("ul", { class: "zone chips" }, chip(expr, "tree"));
  // folded: the search above the tree finds a course in it (and opens it), or the student opens the whole list
  if (isLongList(expr)) {
    return el("div", { class: "expr long-list" },
      el("p", { class: "alt-label" }, T`אחד מ-${expr.or.length} הקורסים ברשימה. אפשר לחפש קורס לפי שם בחיפוש שבראש העץ.`,
        ...(isBroadeningList(expr) ? [" ", whatBroadening()] : [])),
      el("details", {}, el("summary", { text: T`הצגת כל ${expr.or.length} הקורסים` }),
        el("ul", { class: "zone chips" }, expr.or.map((n) => chip(n, "tree")))));
  }
  if (expr.and) {
    return el("div", { class: "together" }, expr.and.flatMap((e, i) => [
      i ? el("div", { class: "alt-and", "aria-hidden": "true" }, el("span", { text: T("+ וגם") })) : null,
      renderExpr(e, have, true)]));
  }
  const options = expr.or || expr.of;
  const label = expr.of ? T`לפחות ${expr.atleast} מתוך:`
    : !inner ? T("אחת מהחלופות:") : options.length === 2 ? T("אחד מהשניים:") : T("אחד מאלה:");
  return el("div", { class: `expr choice${satisfied(expr, have) ? " ok" : ""}` }, el("span", { class: "alt-label", text: label }),
    options.flatMap((o, i) => [
      i && expr.or ? el("div", { class: `alt-or${inner ? " small" : ""}`, "aria-hidden": "true" }, el("span", { text: T("או") })) : null,
      o.and ? el("div", { class: `alt${satisfied(o, have) ? " ok" : ""}` }, renderExpr(o, have)) : renderExpr(o, have, true)]));
}

// where a course of the plan is, for the shrunk lines of the tree: a semester, or "עשיתי"
function placeName(n) {
  const where = locationOf(n);
  return where === "done" ? T("עשיתי") : typeof where === "number" ? semName(semesterIds()[where]) : "";
}

// that place as a small button with an eye: a click shows the card in its semester and flashes it (guy, 2026-10-31),
// on the tree's cards and on its shrunk lines
function placeButton(n) {
  const at = placeName(n);
  return el("button", { type: "button", class: "where", "data-show-course": n, title: T`הצגת ${n} ב-${at}`, "aria-label": T`הצגת ${n} ב-${at}` },
    eyeIcon(), el("span", { text: at }));
}

// The tree empties as the plan fills (guy): an item already met shrinks to one line with its courses and where
// they are (its other alternatives are gone), and a finished group shrinks to its heading, which opens on a
// click. The switch above the tree, or a search, shows everything in full
function renderTree() {
  const have = new Set(plannedCourses());
  const treeCourses = programCourses();
  const full = showPlaced || !!$("#tree-search").value.trim();
  // the counters the plan is still short of: an elective group past its own minimum stays open while one of its
  // unplaced courses would still count in one of them (guy, 2026-10-29: NQ's free choice can be physics electives)
  const short = creditTotals().filter(([, value, target]) => value < target).map((r) => r[4]);
  const stillUseful = (group) => {
    const inGroup = new Set();
    group.items.forEach((it) => it.courses && coursesIn(it.courses, inGroup));
    return [...inGroup].some((n) => !have.has(n) && DATA.courses[n] && DATA.courses[n].offered !== false &&
      short.some((m) => inCounter(n, m.field) && (DATA.courses[n][m.kind] || 0) > 0));
  };
  // only sections with courses: the others (free choice, general requirements) have nothing to drag, and what
  // they say is shown elsewhere (the degree status line, the general requirements at the bottom)
  // the courses a background requirement replaces are not in the program, so the tree adds them on top, only while
  // the box is unticked: the student without that matriculation needs them, the one with it does not
  const basics = (program.background || []).filter((b) => !(state.background || []).includes(b.id)).map((b) => {
    const ok = satisfied(b.courses, have);
    const id = `bg-${b.id}`;
    const body = ok && !full
      ? el("div", { class: "item ok compact", id: `item-${id}` },
        el("div", { class: "ih" }, el("span", { text: plainCourses(b.courses) }), el("span", { class: "mark", text: "✓" })),
        el("div", { class: "placed-list" }, [...coursesIn(b.courses)].filter((n) => have.has(n)).map((n, k) => el("span", {}, k ? ", " : "",
          el("span", { class: "num", text: n }), " ", placeButton(n)))))
      : el("div", { class: `item${ok ? " ok" : ""}`, id: `item-${id}` }, renderExpr(b.courses, have));
    const prep = !ok && b.prep && DATA.courses[b.prep] ? el("div", { class: "item prep" },
      el("div", { class: "ih" }, el("span", { text: T("הכנה, לא חובה") })),
      el("ul", { class: "zone chips" }, chip(b.prep, "tree")),
      el("p", { class: "desc" }, prepLine(b))) : null;
    return el("div", { class: "section basics", id: `group-${id}` },
      el("h3", { text: T("במקום בגרות (רק למי שצריך)") }),
      el("div", { class: "desc", text: T`רק למי שאין ${backgroundWhat(b)}. מי שיש לו לא צריך את הקורסים האלה, ויכול לסמן את זה ב"רקע ודרישות".` }),
      prep, body);
  });
  $("#tree").replaceChildren(...basics, ...program.sections.filter((section) => section.groups.length).map((section) => {
    const groups = section.groups.map((group) => {
      const items = group.items.map((item, itemIndex) => {
        const ok = item.courses && satisfied(item.courses, have);
        // a placed course that needs one of the courses in this item: one note on the item, not a frame on each option
        const inItem = item.courses ? coursesIn(item.courses) : new Set();
        const needs = problems.map((p) => ({ p, chs: p.choices.filter((ch) => ch.courses.some((x) => inItem.has(x))) })).filter(({ chs }) => chs.length);
        const notes = needs.map(({ p, chs }) => {
          const k = Math.max(...chs.map((ch) => ch.atleast));
          const others = [...new Set(chs.flatMap((ch) => ch.courses.filter((x) => !inItem.has(x))))];
          const outside = others.filter((x) => !treeCourses.has(x) && DATA.courses[x] && DATA.courses[x].offered !== false);
          const hint = [others.some((x) => treeCourses.has(x)) ? T("יש אפשרויות גם בפריטים אחרים") : null,
            outside.length ? T`אפשר גם ${outside.join(", ")} מחוץ לתכנית` : null].filter(Boolean).join("; ");
          return el("div", { class: `need-note ${p.level}` },
            // name the condition type instead of "נדרש", which reads like "ידע קודם נדרש"
            T`${p.label} ל-${p.n}: `, el("span", { class: `dot ${p.level}`, text: "●" }),
            k === 1 ? T(" אחת מהאפשרויות המסומנות") : T` לפחות ${k} מהאפשרויות המסומנות`,
            `, ${deadline(p.i)}`, hint ? ` · ${hint}` : "");
        });
        if (ok && !full) {
          const mine = [...coursesIn(item.courses)].filter((n) => have.has(n));
          return el("div", { class: "item ok compact", id: `item-${group.id}-${itemIndex}` },
            el("div", { class: "ih" }, el("span", { text: item.label }), el("span", { class: "mark", text: "✓" })),
            el("div", { class: "placed-list" }, mine.map((n, k) => el("span", {}, k ? ", " : "",
              el("span", { class: "num", text: n }), " ", placeButton(n)))));
        }
        // an item that is one course named after it (or the start of its name, "כתיבה מדעית" for "כתיבה מדעית
        // (אנגלית)"): the card already says the name, so no heading above it
        const single = typeof item.courses === "string" && DATA.courses[item.courses]
          && DATA.courses[item.courses].name.startsWith(item.label);
        return el("div", { class: `item${ok ? " ok" : ""}${single ? " single" : ""}`, id: `item-${group.id}-${itemIndex}` },
          single ? null : el("div", { class: "ih" }, el("span", { text: item.label }), ok ? el("span", { class: "mark", text: "✓" }) : null),
          notes,
          item.courses ? renderExpr(item.courses, have) : null);
      });
      let progress = "";
      let finished = false;
      if (isRequired(group)) {
        const met = group.items.filter((it) => it.courses && satisfied(it.courses, have)).length;
        progress = `${met}/${group.items.length}`;
        finished = met === group.items.length;
      } else if (group.minCredits) {
        const credits = groupCredits(group);
        progress = T`${credits}/${group.minCredits} נ"ז`;
        finished = credits >= group.minCredits && (!group.mustInclude || satisfied(group.mustInclude, have));
      }
      // a required group of a single choice ("one of the 27 seminars") is not "all the items" (guy, 2026-10-31)
      const oneChoice = group.items.length === 1 && group.items[0].courses && (group.items[0].courses.or || group.items[0].courses.of);
      const rule = group.rule === "חובת בחירה" ? T`חובת בחירה: ${choiceText(group) || T("לפי הרשימה")}`
        : group.rule === "כל הפריטים" ? (oneChoice ? T("חובה: אחד מהקורסים") : T("חובה: כל הפריטים"))
        // an elective list without its own minimum (M8: "completing the credits of section א"): the counters check it
        : !group.minCredits ? T("בחירה: להשלמת הנ\"ז של התואר (ראו המונים)")
        : T`בחירה: לפחות ${group.minCredits} נ"ז מהרשימה` + (group.mustLabel ? T`, ובהן ${group.mustLabel}` : "");
      if (finished && !isRequired(group) && stillUseful(group)) {
        return el("div", { class: "group", id: `group-${group.id}` },
          el("div", { class: "gh" }, el("span", { text: group.name }), el("span", { class: "rule done-mark", text: `✓ ${progress}` })),
          el("div", { class: "rule", text: T`${rule}. הגעת למינימום, אבל לתואר עוד חסרות נ"ז, ואפשר להשלים אותן גם מכאן.` }),
          items);
      }
      if (finished && !full) {
        // an elective group stays openable after its minimum: many students take more than the minimum
        return el("details", { class: "group finished", id: `group-${group.id}`, "data-group": group.id, open: openGroups.has(group.id) },
          el("summary", { class: "gh" }, el("span", { text: group.name }), el("span", { class: "rule done-mark", text: `✓ ${progress}` })),
          el("div", { class: "rule", text: isRequired(group) ? rule : T`${rule}. אפשר ללמוד גם יותר מהמינימום.` }),
          items);
      }
      return el("div", { class: "group", id: `group-${group.id}` },
        el("div", { class: "gh" }, el("span", { text: group.name }), el("span", { class: "rule", text: progress })),
        el("div", { class: "rule", text: rule }),
        items);
    });
    return el("div", { class: "section" },
      el("h3", { text: `${letterName(section.id)}. ${section.name}` }),
      section.description ? el("div", { class: "desc", text: section.description }) : null,
      groups);
  }));
  filterTree();
}

// search text: no quotes or gereshes, hyphens as spaces, so "רב-תחומי" and "רב תחומי" match alike
const searchText = (s) => s.replace(/["״'׳]/g, "").replace(/[-–־]/g, " ").replace(/\s+/g, " ").trim();
// ו, ה, ב, ל, מ, ש, כ written before a word: "המדע" is the word "מדע". One or two of them, each tried, since a
// word can also start with one of these letters ("מדע" itself)
const PREFIX = "והבלמשכ";
const wordForms = (w) => [w, ...(PREFIX.includes(w[0]) ? [w.slice(1)] : []),
  ...(PREFIX.includes(w[0]) && PREFIX.includes(w[1]) ? [w.slice(2)] : [])].filter(Boolean);

// how well course n matches the search words (any order; every word must match): 0 = not at all. A number matches
// the start of the course number; a word scores 3 as a whole word (also after a prefix letter), 2 as the start of
// a word, 1 anywhere. So "מדע" puts "פילוסופיה של המדע" before "מדעי החברה" (guy, 2026-10-29)
function searchScore(n, words) {
  const nameWords = searchText(courseName(n)).split(" ");
  let score = 0;
  for (const w of words) {
    if (/^\d+$/.test(w)) {
      if (!n.startsWith(w)) return 0;
      score += 3;
      continue;
    }
    let best = 0;
    for (const nw of nameWords) {
      const forms = wordForms(nw);
      if (forms.includes(w)) best = 3;
      else if (forms.some((f) => f.startsWith(w))) best = Math.max(best, 2);
      else if (nw.includes(w)) best = Math.max(best, 1);
    }
    if (!best) return 0;
    score += best;
  }
  return score;
}

let showAllOutside = false; // "הצגת כל N" under the results outside the degree; a new search folds them again

// the search box on the tree: hide every course that does not match (name or number), and every alternative,
// item, group and section left empty. Runs after each render, so the filter stays while the plan changes
function filterTree() {
  const words = searchText($("#tree-search").value).split(" ").filter(Boolean);
  const q = words.join(" ");
  $("#tree-search-clear").hidden = !$("#tree-search").value;
  const tree = $("#tree");
  tree.classList.toggle("filtering", !!q);
  tree.querySelectorAll(".f-hide").forEach((x) => x.classList.remove("f-hide"));
  $("#tree-empty").hidden = true;
  const matchesQuery = (n) => searchScore(n, words) > 0;
  // courses outside the degree that match too, in their own block under the tree, the best five first (guy). They
  // are cards like the tree's, dragged straight to a semester, to "done" or to the tree (guy); see keepOutside
  const inTree = new Set([...tree.querySelectorAll(".chip")].map((c) => c.dataset.n));
  const outside = q ? Object.keys(DATA.courses).filter((n) => !inTree.has(n) && !state.extra.includes(n) && matchesQuery(n))
    .sort((a, b) => searchScore(b, words) - searchScore(a, words)) : [];
  const shown = showAllOutside ? outside : outside.slice(0, 5);
  $("#outside").hidden = !outside.length;
  $("#outside-list").replaceChildren(
    ...shown.map((n) => chip(n, "outside")),
    ...(outside.length > shown.length ? [el("li", { class: "empty" },
      el("button", { type: "button", class: "link", "data-all-outside": "1", text: T`הצגת כל ${outside.length} הקורסים` }))] : []));
  if (!q) return;
  const matches = (chipNode) => matchesQuery(chipNode.dataset.n);
  tree.querySelectorAll(".chip").forEach((c) => c.classList.toggle("f-hide", !matches(c)));
  const hideEmpty = (selector) => tree.querySelectorAll(selector).forEach((box) => {
    if (!box.querySelector(".chip:not(.f-hide)")) box.classList.add("f-hide");
  });
  hideEmpty(".alt");
  hideEmpty(".choice");
  tree.querySelectorAll(".long-list details").forEach((d) => { if (d.querySelector(".chip:not(.f-hide)")) d.open = true; });
  hideEmpty(".item");
  hideEmpty(".group");
  hideEmpty(".section");
  $("#tree-empty").hidden = !!tree.querySelector(".chip:not(.f-hide)") || !!outside.length;
}

// the broadening-courses list of another program (CB), folded under the tree of every program that does not have it,
// so any student can look through it and drag one, like a search result (guy, 2026-10-31). The texts name it, and say
// nothing of CB's own rule, which does not apply here (guy). Only this list: other long lists (EL's 27 computer
// science seminars and workshops) belong to their own program and showed up here by mistake (guy)
let listsOpen = new Set();
// the lists shown under the tree, as [key, { name, program, courses }]
// one broadening list, shared by all programs (guy, 2026-11-04): the catalog's, from the sheet "קורסים מרחיבי-דעת".
// Its part "במדעים" is left out of science programs (all of ours): a broadening course comes from outside the
// student's field. A program's own extra courses (22006 in 15, OJ, OH) are only in its own item, with a tag
const BROADENING_LINK = "https://www3.openu.ac.il/ouweb/owal/yed.marchiv_daat";
const isScience = (p) => (p.fields || []).some((f) => FIELD_ORDER.includes(f));
const broadeningCourses = (p = program) => (DATA.broadening || []).filter((b) => !(isScience(p) && /במדעים$/.test(b.part || ""))).map((b) => b.n);
const broadeningItems = (p = program) => p.sections.flatMap((sec) => sec.groups
  .filter((g) => (g.name_he || g.name).includes("מרחיב-דעת")).flatMap((g) => g.items.filter((it) => isLongList(it.courses))));
// the courses of the program's broadening item that are not on the shared list
const ownBroadening = new Map();
function programBroadening(n) {
  if (!ownBroadening.has(program.code)) {
    const shared = new Set((DATA.broadening || []).map((b) => b.n));
    ownBroadening.set(program.code, new Set(broadeningItems().flatMap((it) => it.courses.or).filter((x) => !shared.has(x))));
  }
  return ownBroadening.get(program.code).has(n);
}
const isBroadeningList = (expr) => broadeningItems().some((it) => it.courses === expr);

// the shared list under "מחוץ לתואר שלך", unless the program has a broadening item of its own (then it is in the tree)
function otherLists() {
  if (broadeningItems().length || !(DATA.broadening || []).length) return [];
  return [["broadening", { courses: broadeningCourses() }]];
}
function renderLists() {
  const shown = otherLists();
  $("#lists").replaceChildren(...shown.map(([key, l]) =>
    el("details", { class: "lists-block", "data-list": key, ...(listsOpen.has(key) ? { open: "" } : {}) },
      el("summary", { text: T`קורסים מרחיבי-דעת (${l.courses.length})` }),
      el("p", { class: "hint" }, T("מותר ללמוד גם קורסים מרחיבי-דעת. זו לא דרישה של התואר שלך. גוררים קורס לסמסטר, והוא נשמר ב\"קורסים נוספים\"."), " ", whatBroadening()),
      ...(listsOpen.has(key) ? [el("ul", { class: "outside-list" }, l.courses.map((n) => chip(n, "outside")))] : []))));
}

function renderExtra() {
  const zone = $("#extra");
  zone.dataset.empty = T("קורס שאינו חלק מהתואר: מחפשים אותו בחיפוש שבראש העץ וגוררים לכאן");
  zone.replaceChildren(...state.extra.map((n) => chip(n, "extra")));
}

// one missing part of a condition, in short for a card: a course number, "X או Y" for a choice of two, and
// "אחת מ-5 חלופות" for a longer one (the full list is in "פירוט")
function shortPart(e) {
  if (typeof e === "string" || e.and) return plainCourses(e);
  if (e.of) return T`${e.atleast} מתוך ${e.of.length}`;
  // a choice inside a choice counts as more options, not as one long option
  const flat = (x) => x.or.flatMap((o) => (o.or ? flat(o) : [o]));
  const options = flat(e);
  const simple = (o) => typeof o === "string" || (o.and && o.and.every((x) => typeof x === "string"));
  return options.length === 2 && options.every(simple) ? options.map(plainCourses).join(T(" או ")) : T`אחת מ-${options.length} חלופות`;
}

// a short condition for a label: "20125, או 20113 + 20114"
function plainCourses(expr) {
  if (typeof expr === "string") return expr;
  if (expr.and) return expr.and.map(plainCourses).join(" + ");
  if (expr.or) return expr.or.map(plainCourses).join(T(", או "));
  return T`${expr.atleast} מתוך ${expr.of.map(plainCourses).join(", ")}`;
}

// a background requirement is an alternative to courses, not an extra requirement: the card says so, and says
// when the courses it replaces are already in the plan (then there is nothing to tick)
function renderBackground() {
  const list = program.background || [];
  $("#background-card").hidden = !list.length;
  const planned = new Set(plannedCourses());
  $("#background").replaceChildren(...list.map((b) => {
    const ticked = (state.background || []).includes(b.id);
    const viaCourses = !ticked && satisfied(b.courses, planned);
    // the courses already in the plan: the box shows grey with a check (guy, 2026-11-03: an empty box beside "כבר
    // בתכנית שלך" looked odd). It is not ticked in the plan; a click ticks it for real, for whoever has the
    // matriculation and placed the course by mistake (then the course card says it is not needed)
    return el("div", { class: "bg-item" },
      el("label", { class: `check${viaCourses ? " auto" : ""}`,
        title: viaCourses ? T("יש לך בגרות כזו? לחיצה מסמנת אותה, ואז הקורסים האלה לא נדרשים ממך.") : null },
        el("input", { type: "checkbox", "data-background": b.id, checked: ticked || viaCourses, class: viaCourses ? "auto" : null }),
        el("span", {}, b.checkbox, " ", el("button", { type: "button", class: "link", "data-background-info": b.id, text: T("הסבר") }))),
      // ticked: nothing to explain; otherwise either the courses are already in the plan, or where to find them
      ticked ? null : el("p", { class: `bg-note${viaCourses ? " ok" : ""}` }, viaCourses
        ? T`✓ ${plainCourses((b.courses.or || [b.courses]).find((p) => satisfied(p, planned)))} בתכנית שלך, ולכן הדרישה מתקיימת.`
        : T`בלי בגרות כזו, יש ללמוד את ${plainCourses(b.courses).replace(", או ", ", או את ").replace(" + ", T(" ו-"))} (בראש העץ).`),
      ticked || viaCourses || !b.prep || !DATA.courses[b.prep] ? null : el("p", { class: "bg-note" }, prepLine(b)));
  }));
}

// what a background requirement means, in plain words: who needs it, what ticking it does, which courses ask for it
// the course window body; null children are skipped (replaceChildren would print them as the text "null")
function fillInfo(...children) {
  $("#info-body").replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined));
  liftTitle("#info-body", "#info-head");
}

// a window's title goes up into its head row, beside ×, so the text scrolls under both and × is not on the
// scrollbar (guy, 2026-10-31: in the course window it stood on the scrollbar, as it did in the help)
function liftTitle(body, head) {
  const title = $(body).querySelector(":scope > h3");
  $(head).replaceChildren(...(title ? [title] : []));
}

function showBackground(id) {
  const b = program.background.find((x) => x.id === id);
  reopenWindow = () => showBackground(id);
  const replaced = coursesIn(b.courses);
  const mentions = (e) => [...coursesIn(e || "")].some((x) => replaced.has(x));
  const asking = Object.entries(DATA.courses)
    .filter(([n, c]) => !replaced.has(n) && c.offered !== false && (mentions(c.admission) || mentions(c.required)))
    .map(([n]) => n).sort();
  const ticked = (state.background || []).includes(id);
  fillInfo(
    el("h3", { text: b.name }),
    el("p", { text: b.explanation }),
    el("h4", { text: T("מה קורה כשמסמנים") }),
    el("p", { text: T`האתר מתייחס אליך כאילו כבר למדת את ${plainCourses(b.courses)}, ולכן לא תקבל/י אזהרות על קורסים שדורשים אותם.` }),
    el("h4", { text: T("אם אין לך את הרקע הזה") }),
    el("p", {}, T`צריך ללמוד את ${plainCourses(b.courses)} לפני קורסי ה${b.field ? T(b.field) : T("תכנית")}, בדרך כלל בסמסטר הראשון. אפשר להוסיף לתכנית: `,
      el("span", { class: "actions-inline" }, [...replaced].map((x) => courseAction(x, true)))),
    asking.length ? el("h4", { text: T("קורסים שבתנאים שלהם מופיעה הדרישה") }) : null,
    asking.length ? el("p", { class: "cond-note" }, asking.map((x, k) => el("span", {}, k ? ", " : "", courseLink(x)))) : null,
    ticked ? el("p", {}, el("span", { class: "tag ok", text: T("✓ סימנת שיש לך את הרקע הזה") })) : null,
    b.link ? el("p", {}, el("a", { href: b.link, target: "_blank", rel: "noopener", text: T("המקור: דף התכנית באתר האוניברסיטה") })) : null);
  if (!$("#info").open) $("#info").showModal();
}

function renderStatic() {
  renderBackground();
  $("#fill-group").hidden = !(program.recommended && program.recommended.length);
  const lengths = planLengths();
  $("#plan-length").replaceChildren(...lengths.map((y) => el("option", { value: y, text: T`ל-${y} שנים` })));
  $("#plan-length").hidden = lengths.length < 2;
  $("#program-link").hidden = !program.link;
  if (program.link) $("#program-link").href = program.link;
  showAdvisors();
  // the banner at the top: who the planning fits, and (in bold, so no student misses it; guy) that the tool is only
  // a help, that offerings and programs may change, and that the catalog has the up-to-date information. Only here,
  // not again at the bottom of the page (guy)
  $("#audience").replaceChildren(
    T`התכנון באתר מתאים לסטודנטים שהתחילו ללמוד בתכנית מסמסטר ${semName(program.planFrom)} ואילך. ` +
    T("לסטודנטים שהתחילו לפני כן חלים כללים אחרים, ומומלץ לפנות לייעוץ אקדמי."),
    el("strong", { class: "disclaimer-line" }, T("הכלי נועד לעזרה בלבד, ועשויים לחול שינויים בהיצע הקורסים ובתכניות הלימודים. המידע המעודכן ביותר על הקורסים נמצא ב"),
      el("a", { href: "https://www.openu.ac.il/academic/Catalog/", target: "_blank", rel: "noopener", text: T("קטלוג הקורסים של האוניברסיטה הפתוחה") }), "."),
    el("strong", { class: "disclaimer-line" }, APPROVAL()));
  $("#general").replaceChildren(...program.general.map((g) =>
    el("li", {}, el("strong", { text: g.name }), g.details ? ` – ${g.details} ` : " ",
      g.link ? el("a", { href: g.link, target: "_blank", rel: "noopener", text: T("הסבר") }) : null)));
  const [y, m, d] = DATA.updated.split("-");
  $("#updated").textContent = T`תאריך עדכון אחרון: ${d}.${m}.${y}`;
  const years = $("#start-year");
  years.replaceChildren(...[2024, 2025, 2026, 2027, 2028, 2029].map((yr) => el("option", { value: yr, text: yr })));
  years.value = state.start.slice(0, 4);
}

// ---------- course details ----------

// a course number in a window (conditions, overlaps...) jumps to the course where it is now, in the plan or in the
// tree, and flashes it, like the eye buttons (guy, 2026-11-01). A course that is nowhere on the page stays plain text
// a course that is nowhere on the page yet but is offered: a click adds it to "קורסים נוספים" and jumps there
// (guy, 2026-11-03: instead of a separate "+ הוספה" button)
const onPage = (n) => locationOf(n) !== null || treeShows().has(n) || state.extra.includes(n);
const canAdd = (n) => DATA.courses[n] && DATA.courses[n].offered !== false;
function numLink(n) {
  if (!onPage(n) && canAdd(n)) return el("button", { type: "button", class: "num num-link", "data-add-show": n, title: T("הוספה לעץ והצגה"), text: n });
  if (!onPage(n)) return el("span", { class: "num", text: n });
  return el("button", { type: "button", class: "num num-link", "data-show-course": n, title: T("הצגת הקורס במקום שלו"), text: n });
}

// the number and the name of a course as one button that jumps to it (guy, 2026-11-03: only the number was
// clickable, and the name next to it is the bigger target); plain text when the course is nowhere on the page
function courseLink(n) {
  const parts = [el("span", { class: "num", text: n }), " ", el("bdi", { text: courseName(n) })];
  if (!onPage(n) && canAdd(n)) return el("button", { type: "button", class: "course-link", "data-add-show": n, title: T("הוספה לעץ והצגה") }, ...parts);
  if (!onPage(n)) return el("span", {}, ...parts);
  return el("button", { type: "button", class: "course-link", "data-show-course": n, title: T("הצגת הקורס במקום שלו") }, ...parts);
}

function formula(expr, top = true) {
  if (typeof expr === "string") {
    return courseLink(expr);
  }
  const parts = expr.and || expr.or || expr.of;
  const op = expr.and ? T("וגם") : T("או");
  const inner = [];
  parts.forEach((p, i) => {
    if (i) inner.push(el("span", { class: "op", text: expr.of ? "," : op }));
    inner.push(formula(p, false));
  });
  const prefix = expr.of ? T`לפחות ${expr.atleast} מתוך: ` : "";
  return el("span", { class: "formula" }, prefix, top || expr.of ? "" : "(", inner, top || expr.of ? "" : ")");
}

// one course, the way the checklist shows it: number, name, and where it sits if it is in the plan too late
function courseLine(n, have, sameSemester) {
  const where = have.has(n) ? null : locationOf(n);
  const note = typeof where !== "number" ? null
    : where === sameSemester ? el("span", { class: "same", text: T(" (באותו סמסטר)") })
      : el("span", { class: "late", text: T` (נמצא ב-${semName(semesterIds()[where])})` });
  return el("span", {}, courseLink(n), note);
}

// an option inside "one of" / "at least k of": a single course, courses taken together (+), or a deeper formula
function optionLine(e, have, sameSemester) {
  if (typeof e === "string") return courseLine(e, have, sameSemester);
  if (e.and && e.and.every((x) => typeof x === "string")) {
    return el("span", {}, e.and.map((x, j) => el("span", {}, j ? " + " : "", courseLine(x, have, sameSemester))));
  }
  return formula(e);
}

// close the window, scroll the tree to the courses that would meet this part of the condition, and flash them
function showInTree(n, i, key, index) {
  const expr = DATA.courses[n][key];
  const part = (expr.and || [expr])[Number(index)];
  const have = takenBefore(Number(i), null, n);
  flashInTree([...coursesIn(part)].filter((x) => !have.has(x)));
}

// show courses wherever they are (guy): a course in the plan is shown in its semester or in "done", any other in
// the tree (opening a shrunk part of it if needed), and they flash
// flash = false: only scroll there (the find bar marks the course itself, in yellow, as long as it is open)
function flashInTree(wanted, flash = true) {
  $("#info").close();
  const placed = wanted.filter((n) => locationOf(n) !== null);
  const loose = wanted.filter((n) => locationOf(n) === null);
  const inPlan = () => [...document.querySelectorAll("#semesters .chip, #done .chip")].filter((c) => placed.includes(c.dataset.n));
  const inTree = () => [...document.querySelectorAll(".tree .chip")].filter((c) => loose.includes(c.dataset.n));
  let chips = [...inPlan(), ...inTree()];
  if (loose.length && !inTree().length && !showPlaced && loose.some((n) => programCourses().has(n))) {
    setShowPlaced(true); // the course is in a shrunk part of the tree
    chips = [...inPlan(), ...inTree()];
  }
  chips.forEach((c) => { const d = c.closest("details"); if (d) d.open = true; });
  if (chips.length && treeIsLayer()) setTreeOpen(!!chips[0].closest(".tree"));
  if (!chips.length) {
    toast(T`${wanted.join(", ")} לא נמצאים בעץ, כי הם לא חלק מהתכנית. אפשר להוסיף אותם ל"קורסים נוספים" בכפתור שליד הקורס, או בחיפוש שבראש העץ.`);
    return;
  }
  chips[0].scrollIntoView({ behavior: SMOOTH(), block: "center" });
  if (flash) chips.forEach((c) => { c.classList.add("flash"); setTimeout(() => c.classList.remove("flash"), 2400); });
}

// ---------- Ctrl+F: find a course anywhere on the page (guy, 2026-11-01) ----------
// A bar at the bottom: the courses whose name or number match (the tree search's rules), in the plan ("done", then the
// semesters in order) and then in the tree. Typing jumps to the first, Enter to the next, Shift+Enter back; each one
// flashes where it is now. A second Ctrl+F closes the bar (the browser's own find is not needed here)
let findHits = [];
let findAt = -1;
let findReturn = null; // the element that had the focus, back to it when the bar closes

// where Ctrl+F looks: the plan, the degree's tree, "קורסים נוספים", and the broadening-courses lists under the tree,
// also while they are folded (guy, 2026-11-01). Not the other courses outside the degree, for now (guy)
function findCandidates() {
  const placed = [...state.done, ...state.semesters.flat()];
  const tree = [...document.querySelectorAll(".tree .chip")].filter((c) => !c.closest("#outside, #lists")).map((c) => c.dataset.n);
  const lists = otherLists().flatMap(([, l]) => l.courses);
  const loose = [...tree, ...treeShows(), ...state.extra, ...lists].filter((n) => locationOf(n) === null);
  return [...new Set([...placed, ...loose])].filter((n) => DATA.courses[n]);
}
// while the bar is open, every course found is marked, the current one more strongly; yellow, like a browser's
// find, and not red, which here means a missing condition (guy, 2026-11-01). Again after every render
function markFound() {
  document.querySelectorAll(".chip.found, .chip.found-now").forEach((c) => c.classList.remove("found", "found-now"));
  if ($("#find-bar").hidden || !findHits.length) return;
  const hits = new Set(findHits);
  document.querySelectorAll("#semesters .chip, #done .chip, .tree .chip").forEach((c) => {
    if (!hits.has(c.dataset.n) || c.closest("#outside")) return;
    c.classList.add("found");
    if (c.dataset.n === findHits[findAt]) c.classList.add("found-now");
  });
}
function findShow() {
  const q = $("#find-input").value;
  const count = $("#find-count");
  $("#find-input").classList.toggle("none", !!q.trim() && !findHits.length);
  count.textContent = !q.trim() ? "" : !findHits.length ? T("לא נמצא") : T`${findAt + 1} מתוך ${findHits.length}`;
  $("#find-prev").disabled = $("#find-next").disabled = findHits.length < 2;
}
function findGo(step) {
  if (!findHits.length) return;
  findAt = (findAt + step + findHits.length) % findHits.length;
  findShow();
  const n = findHits[findAt];
  // a course of a folded list under the tree: open the list (its cards are built only then)
  if (locationOf(n) === null && !treeShows().has(n) && !state.extra.includes(n)) {
    const list = otherLists().find(([, l]) => l.courses.includes(n));
    if (list && !listsOpen.has(list[0])) { listsOpen.add(list[0]); renderLists(); }
  }
  flashInTree([n], false);
  markFound();
}
function findUpdate() {
  const words = searchText($("#find-input").value).split(" ").filter(Boolean);
  findHits = words.length ? findCandidates().filter((n) => searchScore(n, words) > 0) : [];
  findAt = -1;
  if (findHits.length) findGo(1); else { findShow(); markFound(); }
}
function openFind() {
  const bar = $("#find-bar");
  if (bar.hidden) findReturn = document.activeElement;
  bar.hidden = false;
  $("#find-input").focus();
  $("#find-input").select();
  if ($("#find-input").value.trim()) findUpdate();
}
function closeFind() {
  $("#find-bar").hidden = true;
  markFound();
  if (findReturn && document.contains(findReturn)) findReturn.focus({ preventScroll: true });
  findReturn = null;
}
function setupFind() {
  document.addEventListener("keydown", (e) => {
    // e.code: the F key in any keyboard language (in Hebrew it is "כ")
    if (!(e.ctrlKey || e.metaKey) || e.code !== "KeyF" || e.shiftKey || e.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    e.preventDefault();
    // a second Ctrl+F closes the bar, instead of opening the browser's own search (guy, 2026-11-01)
    if ($("#find-bar").hidden) openFind(); else closeFind();
  });
  $("#find-input").addEventListener("input", findUpdate);
  $("#find-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); }
    if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  $("#find-next").addEventListener("click", () => findGo(1));
  $("#find-prev").addEventListener("click", () => findGo(-1));
  $("#find-close").addEventListener("click", closeFind);
}

// the conditions of course n in semester i as a checklist: one row per condition, ✓ or ✗, alternatives listed under it
function showConditions(n, i) {
  reopenWindow = () => showConditions(n, i);
  const c = DATA.courses[n];
  const id = semesterIds()[i];
  const have = takenBefore(i, null, n);
  const withSame = new Set([...have, ...state.semesters[i].filter((x) => x !== n)]);
  const real = withoutBackground(have);
  const mark = (ok) => el("span", { class: `mark ${ok ? "yes" : "no"}`, "aria-label": ok ? T("מתקיים") : T("חסר"), text: ok ? "✓" : "✗" });
  const parallelMark = el("span", { class: "mark par", "aria-label": T("נלמד במקביל"), text: "◐" });
  const parallelNote = el("div", { class: "par-note", text: T("נלמד באותו סמסטר. זה אפשרי, אבל החומר שלו נדרש כבר מתחילת הקורס, ולכן העומס גדול יותר.") });
  const kinds = [...CONDITIONS, { key: "recommended", level: "rec", label: T("ידע קודם מומלץ") }];
  const sections = kinds.filter((cond) => c[cond.key]).map((cond) => {
    const parts = c[cond.key].and || [c[cond.key]];
    const markFor = (ok) => (cond.key === "recommended" && !ok
      ? el("span", { class: "mark rec", "aria-label": T("עוד לא נלמד"), text: "○" }) : mark(ok));
    // no "הצגה" buttons: every course number here jumps to the course (guy, 2026-11-01)
    const inTree = treeShows();
    // a course the student cannot drag from anywhere yet: its number adds it (numLink), no separate link
    const addButtons = () => [];
    const rows = parts.map((part, index) => {
      const ok = satisfied(part, have);
      if (!ok && cond.key !== "admission" && satisfied(part, withSame)) {
        const options = typeof part === "string" ? [part] : part.or || part.of || [part];
        const shown = options.filter((o) => satisfied(o, withSame));
        // only the alternatives taken in the same semester are listed: one of "one of these" is just that course, with
        // no "אחד מאלה:" over it (guy, 2026-11-01)
        const head = typeof part === "string" || (part.or && shown.length === 1) ? null
          : part.or ? T("אחד מאלה:") : part.of ? T`לפחות ${part.atleast} מאלה:` : T("כל אלה יחד:");
        return el("li", { class: "par" }, parallelMark.cloneNode(true),
          el("div", {}, head ? el("div", { class: "head", text: head }) : null,
            shown.map((o) => el("div", {}, optionLine(o, have, i))),
            cond.key === "required" ? parallelNote.cloneNode(true) : el("div", { class: "par-note", text: T("נלמד באותו סמסטר.") })));
      }
      if (typeof part === "string") {
        return el("li", { class: ok ? "ok" : "" }, markFor(ok),
          el("div", {}, courseLine(part, have), ok || inTree.has(part) ? null : el("div", { class: "row-actions" }, addButtons(part))));
      }
      const options = part.or || part.of || [part];
      const head = part.or ? T("אחד מאלה:") : part.of ? T`לפחות ${part.atleast} מאלה:` : T("כל אלה יחד:");
      return el("li", { class: ok ? "ok" : "" }, markFor(ok),
        el("div", {}, el("div", { class: "head", text: head }),
          el("ul", { class: "options" }, options.map((o) => el("li", { class: satisfied(o, real) ? "ok" : "" },
            satisfied(o, real) ? "✓ " : "", optionLine(o, real), ok ? null : addButtons(o))), backgroundOption(part, have, n))));
    });
    return el("section", { class: `cond ${cond.level}` },
      el("h4", { text: cond.label }),
      cond.key === "recommended" ? el("p", { class: "cond-note", text: T("לא חובה. כדאי, אם יש מקום בתכנית.") }) : null,
      el("ul", { class: "checklist" }, rows));
  });
  // prior credits, after the admission conditions (they are part of them in the catalog)
  const prior = priorCheck(n, i);
  if (prior) {
    sections.splice(c.admission ? 1 : 0, 0, el("section", { class: "cond bad" },
      el("h4", { text: T("נ\"ז קודמים") }),
      el("ul", { class: "checklist" }, el("li", { class: prior.short ? "" : "ok" }, mark(!prior.short),
        el("div", { text: T`לפחות ${prior.need} נ"ז ב${T(prior.field)} לפני הסמסטר. בתכנית יש ${prior.got} (קורסים חופפים נספרים פעם אחת).` })))));
  }
  fillInfo(
    el("h3", {}, el("span", { class: "num", text: n }), " ", el("bdi", { text: c.name }), T` בסמסטר ${semesterLabel(id)}`),
    el("p", { class: "cond-note", text: T`נבדק מול הקורסים שבסמסטרים שלפני ${semName(id)} וב"קורסים שכבר עשיתי". קורסים חסרים מסומנים גם בעץ.` }),
    ...sections,
    el("p", {}, el("button", { type: "button", class: "link", "data-info": n, text: T("כל פרטי הקורס") })));
  if (!$("#info").open) $("#info").showModal();
}

// a condition as a list a student can scan: one row per requirement, alternatives listed under "one of";
// courses already in the plan get a small tag, as in the overlap list
// the small control next to a course in the course window, by where the course is now:
// in the plan → where; in the tree → show it there; elsewhere → add it to "קורסים נוספים"
// forN: the course whose condition this is; a ticked background shows on x only where forN accepts it (guy,
// 2026-11-03: 20418's window said "✓ רקע בפיסיקה ובמתמטיקה", and its page says nothing about a matriculation)
function courseAction(x, named, forN) {
  const where = locationOf(x);
  const label = named ? `${x} ` : "";
  const accepted = forN === undefined ? checkedBackground() : checkedBackground().filter((b) => backgroundsFor(forN).includes(b));
  const covered = accepted.find((b) => coursesIn(b.courses).has(x));
  if (covered) return el("span", { class: "tag ok", title: covered.checkbox, text: `${label}✓ ${covered.name}` });
  // where it is, as plain words: the course number is the link that jumps there (guy, 2026-11-01: an eye button
  // next to a clickable number was two buttons doing the same thing)
  if (where !== null) {
    return el("span", {}, named ? numLink(x) : null, named ? " " : null,
      el("span", { class: "tag warn", text: where === "done" ? T("עשיתי") : T`ב-${semName(semesterIds()[where])}` }));
  }
  // in the tree, or addable: the course number itself does it (numLink)
  return named ? numLink(x) : null;
}

// a condition as a list a student can scan: one row per requirement, alternatives listed under "one of",
// and next to every course a control to find it or add it
// a background requirement (for example a 5-unit matriculation) that would meet this part of a condition:
// shown as one more alternative, with a button that ticks it
// the courses the student really has: "have" without the ones that only count because a background box is ticked
function withoutBackground(have) {
  const bg = backgroundCourses();
  return new Set([...have].filter((x) => !bg.has(x) || locationOf(x) !== null));
}

// a background requirement (for example a 5-unit matriculation) that meets or would meet this part of a condition.
// Ticked: it says that this is how the part is met. Not ticked: one more alternative, with a button that ticks it
// Only a background course n accepts (backgroundsFor)
function backgroundOption(part, have, n) {
  const inPart = coursesIn(part);
  const real = withoutBackground(have);
  for (const b of backgroundsFor(n)) {
    if (![...coursesIn(b.courses)].some((n) => inPart.has(n))) continue;
    const ticked = (state.background || []).includes(b.id);
    if (ticked && !satisfied(part, real)) {
      return el("li", { class: "bg-alt ok" }, "✓ ", b.checkbox, " ", el("span", { class: "muted", text: T("(סימנת)") }), " ",
        el("button", { type: "button", class: "link", "data-background-untick": b.id, text: T("ביטול הסימון") }), " ",
        el("button", { type: "button", class: "link", "data-background-info": b.id, text: T("הסבר") }));
    }
    if (!ticked && !satisfied(part, real) && satisfied(part, new Set([...real, ...coursesIn(b.courses)]))) {
      return el("li", { class: "bg-alt" }, T("או: "), b.checkbox, " ",
        el("button", { type: "button", class: "mini", "data-background-tick": b.id, text: T("סימון") }), " ",
        el("button", { type: "button", class: "link", "data-background-info": b.id, text: T("הסבר") }));
    }
  }
  return null;
}

// check (only for a course placed in a semester): { have, withSame, kind } - each requirement then gets a mark:
// ✓ met before the semester, ◐ in the same semester (not for admission), ✗ missing (○ for recommended knowledge)
function conditionList(expr, planned, check, n) {
  const actions = (e) => {
    const list = [...coursesIn(e)];
    return el("span", { class: "actions-inline" }, list.map((x) => courseAction(x, list.length > 1, n)));
  };
  const markOf = (part) => {
    if (!check) return null;
    if (satisfied(part, check.have)) return el("span", { class: "mark yes", "aria-label": T("מתקיים"), text: "✓" });
    if (check.kind !== "admission" && satisfied(part, check.withSame)) return el("span", { class: "mark par", "aria-label": T("באותו סמסטר"), text: "◐" });
    if (check.kind === "recommended") return el("span", { class: "mark rec", "aria-label": T("עוד לא נלמד"), text: "○" });
    return el("span", { class: `mark no ${check.kind === "admission" ? "bad" : "warn"}`, "aria-label": T("חסר"), text: "✗" });
  };
  const have = check ? check.have : planned;
  const parts = expr.and || [expr];
  return el("ul", { class: `condlist${check ? " checked" : ""}` }, parts.map((part) => {
    if (typeof part === "string") return el("li", {}, markOf(part), el("div", {}, courseLine(part, planned), actions(part)));
    const options = part.or || part.of || [part];
    const head = part.or ? T("אחד מאלה:") : part.of ? T`לפחות ${part.atleast} מאלה:` : T("כל אלה יחד:");
    return el("li", {}, markOf(part), el("div", {}, el("div", { class: "head", text: head }),
      el("ul", {}, options.map((o) => el("li", {}, optionLine(o, planned), actions(o))), backgroundOption(part, have, n))));
  }));
}

function showInfo(n) {
  reopenWindow = () => showInfo(n);
  const c = DATA.courses[n];
  const rows = [];
  const add = (label, value) => { if (value !== null && value !== undefined && value !== "") rows.push(el("dt", { text: label }), el("dd", {}, value)); };
  add(T("נקודות זכות"), c.credits === null ? null : `${c.credits}${c.level ? ` (${T(c.level)})` : ""}${c.advanced && c.advanced !== c.credits ? T`, מתוכן ${c.advanced} מתקדמות` : ""}`);
  add(T("ניקוד קודם"), c.previousCredits);
  add(T("עבודה סמינריונית"), c.seminar === "חובה" ? T("חובה: קורס סמינריוני (רמה מתקדמת-סמינריונית)")
    : c.seminar === "כן" ? T("אפשר לכתוב בקורס עבודה סמינריונית") : null);
  // in the student's plan, an overlap may cut what the course counts
  const cutLine = overlapLine(n);
  if (cutLine) add(T("בתכנית שלך"), el("span", { class: cutLine.level === "bad" ? "bad" : "", text: cutLine.text }));
  add(T("שיוך"), c.affiliation.map((a) => a.split(" / ").map((part) => T(part)).join(" / ")).join(" · "));
  // always shown: the data is still being filled, so a missing name or address says so instead of hiding the row
  const missing = (what) => el("span", { class: "missing", text: T`${what}: עדיין לא הוזן` });
  add(T("מרכז/ת ההוראה"), el("span", {},
    c.coordinator ? el("bdi", { text: c.coordinator }) : missing(T("שם")), " · ",
    c.coordinatorEmail ? el("a", { href: `mailto:${c.coordinatorEmail}`, class: "email", text: c.coordinatorEmail }) : missing(T("אימייל"))));
  add(T("מוצע"), c.offered === false ? T("לא מוצע עוד") : c.notYet ? T("עוד לא: קורס חדש, שעוד לא נפתח באף סמסטר") : c.semesters.length ? T`בסמסטרים ${letterList(c.semesters)}` : null);
  add(T("מוצע עד"), c.offeredUntil ? semName(c.offeredUntil) : null);
  add(T("מוצע מ"), c.offeredFrom ? T`${semName(c.offeredFrom)} (קורס חדש)` : null);
  const planned = new Set(plannedCourses());
  // a course in a semester gets marks against what comes before it; in the tree or in "done" there is nothing to check
  const where = locationOf(n);
  const check = (kind) => (typeof where === "number"
    ? { have: takenBefore(where, null, n), withSame: new Set([...takenBefore(where, null, n), ...state.semesters[where].filter((x) => x !== n)]), kind } : null);
  add(T("תנאי קבלה"), c.admission && conditionList(c.admission, planned, check("admission"), n));
  add(T("נ\"ז קודמים"), c.priorCredits ? T`לפחות ${c.priorCredits} נ"ז (${T(c.priorField)})` : null);
  const extras = SKILLS.filter((s) => c[s.key]);
  add(T("דרישות נוספות"), extras.length ? el("span", {}, extras.map((s, k) => el("span", {}, k ? " · " : "", s.short, " ",
    hasSkill(s.id) ? el("span", { class: "mark yes", text: "✓" }) : el("span", { class: "tag need", text: T("עוד לא סימנת") })))) : null);
  add(T("ידע קודם דרוש"), c.required && conditionList(c.required, planned, check("required"), n));
  add(T("ידע קודם מומלץ"), c.recommended && conditionList(c.recommended, planned, check("recommended"), n));
  // a program background requirement that this course accepts (guy, 2026-11-03: not every course in its field)
  backgroundsFor(n).forEach((b) => {
    if (coursesIn(b.courses).has(n)) return;
    const ticked = (state.background || []).includes(b.id);
    add(b.name, el("span", {}, b.explanation, " ", ticked ? el("span", { class: "tag ok", text: T("✓ סימנת שיש לך") }) : null));
  });
  const bgOf = backgroundFor(n);
  if (bgOf && bgOf.prep && DATA.courses[bgOf.prep] && !(state.background || []).includes(bgOf.id)) add(T("הכנה"), prepLine(bgOf));
  const prepFor = prepOf(n);
  if (prepFor && prepFor.prepTest) add(T("מבחן התאמה"), el("span", {},
    el("a", { href: prepFor.prepTest, target: "_blank", rel: "noopener", text: T("מבחן התאמה") }),
    T` (כשעה) ימליץ אם כדאי לך ללמוד את הסדנה לפני ${plainCourses(prepFor.courses)}.`));
  add(T("הערות"), c.notes);
  // overlaps: one row per combination, the ones touching the student's plan first and marked
  const overlaps = c.overlaps
    .map((o) => ({ ...o, mine: o.with.some((m) => [...coursesIn(m)].some((x) => planned.has(x))) }))
    .sort((a, b) => b.mine - a.mine);
  const overlapList = overlaps.length ? el("section", { class: "overlaps" },
    el("h4", { text: T`חפיפה (${overlaps.length})` }),
    el("p", { class: "cond-note", text: T`${n} יחד עם הקורסים בכל שורה מקנים לכל היותר את הנ"ז שמשמאל.` }),
    el("ul", {}, overlaps.map((o) => el("li", { class: o.mine ? "mine" : "" },
      el("span", { class: "who" }, o.with.map((m, j) => el("span", {}, j ? " + " : "", formula(m)))),
      // the course numbers in the row jump to the courses (guy, 2026-11-01: no eye button besides them)
      o.mine ? el("span", { class: "tag warn", text: T("בתכנית שלך") }) : null,
      o.total === null ? el("span", { class: "pts bad", text: T("אסור יחד") }) : el("span", { class: "pts", text: T`עד ${o.total} נ"ז` }))))) : null;
  fillInfo(
    el("h3", {}, el("span", { class: "num", text: n }), " ", el("bdi", { text: c.name })),
    // a course with minimal details only: without this it would look like a course with no conditions
    c.full === false ? el("p", { class: "partial-note" }, T("התנאים, הידע הקודם והחפיפות של הקורס הזה עוד לא הוזנו לכלי. בדקו אותם ב"),
      c.link ? el("a", { href: c.link, target: "_blank", rel: "noopener", text: T("דף הקורס בקטלוג") }) : T("קטלוג הקורסים"), ".") : null,
    typeof where === "number" && (c.admission || c.required || c.recommended)
      ? el("p", { class: "cond-note", text: T`הסימונים ליד התנאים: לפי הקורסים שלפני ${semName(semesterIds()[where])} ו"קורסים שכבר עשיתי".` }) : null,
    el("dl", {}, rows),
    c.offered !== false || where !== null ? el("p", { class: "lock-row" }, el("button", { type: "button", class: "mini", "data-move-open": n, text: T("שיבוץ או העברה...") })) : null,
    typeof where === "number" || where === "done" ? el("p", { class: "lock-row" }, el("button", { type: "button", class: `mini${isLocked(n) ? " on" : ""}`, "data-lock": n,
      text: isLocked(n) ? T("🔒 נעול במקומו · שחרור") : T("נעילת הקורס במקומו") }),
      el("span", { class: "cond-note", text: where === "done" ? T(" נשאר כאן גם כשמנקים את \"קורסים שכבר עשיתי\".")
        : T(" נשאר במקום גם בניקוי הסמסטרים ובמילוי לפי התכנית המומלצת.") })) : null,
    // its place in the semester, also on a phone, where there is no drag and no Alt+arrows (guy, 2026-11-01)
    typeof where === "number" && state.semesters[where].length > 1 ? (() => {
      const list = state.semesters[where], k = list.indexOf(n);
      return el("p", { class: "lock-row" },
        el("button", { type: "button", class: "mini", "data-order": `${n}|up`, disabled: k === 0 ? "" : null, text: T("↑ למעלה") }), " ",
        el("button", { type: "button", class: "mini", "data-order": `${n}|down`, disabled: k === list.length - 1 ? "" : null, text: T("↓ למטה") }),
        el("span", { class: "cond-note", text: T` מקום ${k + 1} מתוך ${list.length} בסמסטר.` }));
    })() : null,
    ...(overlapList ? [overlapList] : []), // replaceChildren would print a null as the text "null"
    c.link ? el("p", {}, el("a", { href: c.link, target: "_blank", rel: "noopener", text: T("לדף הקורס בקטלוג") })) : null);
  if (!$("#info").open) $("#info").showModal();
}

// ---------- interaction ----------

function zoneTarget(node) {
  const zone = node.closest("[data-zone]");
  if (!zone) return undefined;
  const z = zone.dataset.zone;
  if (z === "done") return "done";
  if (z.startsWith("s")) return Number(z.slice(1));
  return "tree"; // the tree and the extra list take courses out of the plan
}

// what course n would miss in semester i (warnings, not blocks): its admission conditions (they must come before),
// and its required knowledge (before, or in the same semester, which is allowed)
function dropIssues(n, i) {
  const c = DATA.courses[n];
  const have = takenBefore(i, n);
  const withSame = new Set([...have, ...(state.semesters[i] || []).filter((x) => x !== n)]);
  const prior = priorCheck(n, i);
  return { admission: !!(c && c.admission && !satisfied(c.admission, have)) || !!(prior && prior.short),
    required: !!(c && c.required && !satisfied(c.required, withSame)) };
}

// while a course is dragged or picked, each semester takes the colors of the cards (guy, 2026-10-29): striped where it
// is not offered (a block), red where an admission condition would be missing, orange where only required knowledge
// would, and blue otherwise. No text in the semester: it changed the semesters' size and the page jumped (guy)
// Also while the mouse is over a course card (guy, 2026-11-01: a glance at where a course can go, without clicking);
// a drag or a picked course comes first
function markZone(zone, i) {
  const pending = dragging || selected || hovering;
  const blocked = !!pending && !!blockedReason(pending, i);
  const issues = pending && !blocked ? dropIssues(pending, i) : { admission: false, required: false };
  zone.classList.toggle("no-drop", blocked);
  const why = blocked ? blockedShort(pending, i) : null;
  if (why) zone.dataset.why = why; else delete zone.dataset.why;
  zone.classList.toggle("cond-bad", issues.admission);
  zone.classList.toggle("cond-warn", !issues.admission && issues.required);
  zone.classList.toggle("cond-ok", !!pending && !blocked && !issues.admission && !issues.required);
}

// without re-rendering mid-drag
function markBlocked() {
  document.querySelectorAll("[data-zone^='s']").forEach((z) => markZone(z, Number(z.dataset.zone.slice(1))));
  // "done" takes any course: blue like a semester with nothing missing, while dragging or picked (guy, 2026-10-31)
  $("#done").classList.toggle("cond-ok", !!(dragging || selected || hovering));
}

// the mouse over a card in the tree that can be moved: the semesters show where it can go. Only a real mouse (a tap on a phone
// also sends a mouseover). The colors go the moment the mouse leaves the card (guy, 2026-11-01: a delay of 120ms
// against flicker between cards felt slow)
// After a drop the mouse is often still on the course it dropped: no colors for it until the mouse leaves the place of
// that card and comes back (guy, 2026-11-01: the colors went off with the drag and flashed on again). The place is
// checked by position on every move, since the card is rebuilt under the mouse and may get no pointerover
// The keyboard too: Tab onto a course in the tree, or onto a button in its card (ⓘ), shows its colors the same way
// (guy, 2026-11-01). The mouse and the focus are kept apart, so one leaving does not wipe the other; the mouse wins
function setupHoverMarks() {
  let mouseN = null, focusN = null;
  const update = () => { const n = mouseN || focusN; if (n !== hovering) { hovering = n; markBlocked(); } };
  const set = (n) => { mouseN = n; update(); };
  const treeChip = (t) => t && t.closest ? t.closest("aside.tree .chip[draggable]") : null;
  // keyboard focus only (:focus-visible): a click also focuses the card, and its colors would stay after the mouse left
  document.addEventListener("focusin", (e) => {
    const chip = e.target.matches(":focus-visible") ? treeChip(e.target) : null;
    focusN = chip ? chip.dataset.n : null; update();
  });
  document.addEventListener("focusout", (e) => { if (!treeChip(e.relatedTarget)) { focusN = null; update(); } });
  const onDropped = (e) => [...document.querySelectorAll(`.chip[data-n='${hoverSkip}']`)].some((c) => {
    const r = c.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  });
  const hover = (e) => {
    if (e.pointerType !== "mouse" || dragging) return;
    if (hoverSkip) { if (onDropped(e)) return; hoverSkip = null; }
    // only the courses in the tree column (the tree, the search results, "קורסים נוספים", the lists): a course already
    // placed shows its colors only when clicked or dragged (guy, 2026-11-01)
    const chip = treeChip(e.target);
    set(chip ? chip.dataset.n : null);
  };
  document.addEventListener("pointerover", hover);
  // leaving a card for anything that is not a card (also where no pointerover follows, like out of the window)
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "mouse" && !dragging && mouseN && !treeChip(e.relatedTarget)) set(null);
  });
  document.addEventListener("pointermove", (e) => { if (hoverSkip) hover(e); });
  document.documentElement.addEventListener("pointerleave", () => set(null)); // the mouse left the window
}

// the course a drop lands in front of: the first card in the semester whose middle is below the pointer, or null
// for the end. So a drop in the gap between two cards goes between them, and above the first card goes first
// (guy, 2026-11-01: a drop in the gap went to the end, because only the card under the pointer counted)
function dropBefore(e) {
  const zone = e.target.closest("[data-zone]");
  if (!zone) return null;
  const card = [...zone.querySelectorAll(":scope > .chip")].find((c) => {
    const r = c.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  });
  return card ? card.dataset.n : null;
}

// while dragging over a semester, a line shows where the course will land: above the card it goes in front of, or
// under the last card (guy, 2026-11-01). No line where the drop changes nothing (the course's own place)
function clearDropLine() {
  document.querySelectorAll(".drop-before").forEach((c) => c.classList.remove("drop-before"));
  document.querySelectorAll(".drop-end").forEach((z) => z.classList.remove("drop-end"));
}
function showDropLine(zone, e) {
  clearDropLine();
  if (!/^s\d+$/.test(zone.dataset.zone)) return;
  const before = dropBefore(e);
  const cards = [...zone.querySelectorAll(":scope > .chip")].map((c) => c.dataset.n);
  const at = cards.indexOf(dragging);
  if (at >= 0 && (before === dragging || before === (cards[at + 1] ?? null))) return;
  if (before) zone.querySelector(`:scope > .chip[data-n='${before}']`)?.classList.add("drop-before");
  else if (cards.length) zone.classList.add("drop-end");
}

// a course from the search results outside the degree is kept in "קורסים נוספים" wherever it is dropped, so taking
// it out of a semester later leaves it in the tree instead of losing it
function keepOutside(n) {
  if (DATA.courses[n] && !programCourses().has(n) && !state.extra.includes(n)) state.extra.push(n);
}

function setupDragAndDrop() {
  document.addEventListener("dragstart", (e) => {
    const c = e.target.closest && e.target.closest(".chip[draggable]");
    if (!c) return;
    e.dataTransfer.setData("text/plain", c.dataset.n);
    e.dataTransfer.effectAllowed = "copyMove";
    // the picture under the pointer is taken after this handler: hold it where the card was grabbed, and mark the
    // semesters only after it, in case marking moves anything (guy once saw the picture far from the pointer)
    const r = c.getBoundingClientRect();
    e.dataTransfer.setDragImage(c, e.clientX - r.left, e.clientY - r.top);
    dragging = c.dataset.n;
    document.body.classList.add("dragging"); // the floating summary lets drops through to the semester under it
    selected = null; // a drag replaces any course picked by tap
    document.querySelectorAll(".chip.selected").forEach((x) => x.classList.remove("selected"));
    setTimeout(markBlocked, 0);
  });
  // a drag that ends anywhere, including a cancelled one, unlocks every semester
  const endDrag = () => { clearDropLine(); document.body.classList.remove("dragging"); if (dragging) { hoverSkip = dragging; hovering = null; dragging = null; markBlocked(); } };
  document.addEventListener("dragend", endDrag);
  // safety net: some browsers skip dragend when the drop is cancelled; the next plain mouse move ends the drag
  document.addEventListener("mousemove", (e) => { if (dragging && e.buttons === 0) endDrag(); });
  document.addEventListener("dragover", (e) => {
    const zone = e.target.closest && e.target.closest("[data-zone]");
    if (!zone || zone.classList.contains("no-drop")) return;
    e.preventDefault();
    // a "+" on the pointer where the course can be dropped (guy, 2026-10-31); elsewhere the browser shows 🚫
    e.dataTransfer.dropEffect = "copy";
    document.querySelectorAll(".drop-target").forEach((z) => z !== zone && z.classList.remove("drop-target"));
    zone.classList.add("drop-target");
    showDropLine(zone, e);
  });
  document.addEventListener("dragleave", (e) => {
    const zone = e.target.closest && e.target.closest("[data-zone]");
    if (zone && !zone.contains(e.relatedTarget)) { zone.classList.remove("drop-target"); clearDropLine(); }
  });
  document.addEventListener("drop", (e) => {
    const target = e.target.closest && zoneTarget(e.target);
    document.querySelectorAll(".drop-target").forEach((z) => z.classList.remove("drop-target"));
    clearDropLine();
    if (target === undefined) return;
    e.preventDefault();
    const n = e.dataTransfer.getData("text/plain");
    endDrag();
    if (!DATA.courses[n]) return;
    keepOutside(n);
    place(n, target, typeof target === "number" ? dropBefore(e) : null);
  });
}

function setupClicks() {
  // a click on the dimmed area around the course window closes it (the dialog element itself covers its padding,
  // so check the click position against the window's box)
  ["#info", "#help-dialog", "#move", "#a11y-dialog"].forEach((id) => $(id).addEventListener("click", (e) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close();
  }));
  document.addEventListener("click", (e) => {
    if (e.target.closest("#show-problem, .show-problem")) {
      const first = document.querySelector(".chip.prob-bad, .chip.prob-warn");
      if (first) {
        first.scrollIntoView({ behavior: SMOOTH(), block: "center" });
        first.classList.add("flash");
        setTimeout(() => first.classList.remove("flash"), 1600);
      }
      return;
    }
    const goto = e.target.closest("[data-goto]");
    if (goto) {
      const target = document.getElementById(goto.dataset.goto);
      if (target && treeIsLayer()) setTreeOpen(!!target.closest(".tree"));
      if (target && target.tagName === "DETAILS") target.open = true; // the folded "רקע ודרישות" card
      if (target) {
        target.scrollIntoView({ behavior: SMOOTH(), block: "center" });
        target.classList.add("flash");
        setTimeout(() => target.classList.remove("flash"), 1600);
      }
      return;
    }
    const showIt = e.target.closest("[data-show]");
    if (showIt) { showInTree(...showIt.dataset.show.split("|")); return; }
    const addIt = e.target.closest("[data-add-extra]");
    if (addIt) {
      state.extra.push(addIt.dataset.addExtra);
      save(); render();
      if (reopenWindow) reopenWindow();
      return;
    }
    const moveOpen = e.target.closest("[data-move-open]");
    if (moveOpen) { $("#info").close(); openMove(moveOpen.dataset.moveOpen); return; }
    const addShow = e.target.closest("[data-add-show]");
    if (addShow) {
      const n = addShow.dataset.addShow;
      if (!state.extra.includes(n)) state.extra.push(n);
      save(); render();
      flashInTree([n]);
      return;
    }
    const showCourse = e.target.closest("[data-show-course]");
    if (showCourse) { flashInTree(showCourse.dataset.showCourse.split(",")); return; } // one course, or several (an overlap row)
    const cond = e.target.closest("[data-cond]");
    if (cond) { const [n, i] = cond.dataset.cond.split("|"); showConditions(n, Number(i)); return; }
    const info = e.target.closest("[data-info]");
    if (info) { showInfo(info.dataset.info); return; }
    const bgTick = e.target.closest("[data-background-tick]");
    if (bgTick) {
      state.background = [...new Set([...(state.background || []), bgTick.dataset.backgroundTick])];
      save(); renderBackground(); render();
      if (reopenWindow) reopenWindow();
      return;
    }
    const bgUntick = e.target.closest("[data-background-untick]");
    if (bgUntick) {
      state.background = (state.background || []).filter((x) => x !== bgUntick.dataset.backgroundUntick);
      save(); renderBackground(); render();
      if (reopenWindow) reopenWindow();
      return;
    }
    const bgInfo = e.target.closest("[data-background-info]");
    if (bgInfo) { e.preventDefault(); showBackground(bgInfo.dataset.backgroundInfo); return; }
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      const n = remove.dataset.remove;
      if (selected === n) selected = null; // × on a picked course: it goes back to the tree, and is not picked any more (guy)
      if (remove.dataset.from === "extra") { state.extra = state.extra.filter((x) => x !== n); place(n, "tree"); }
      else place(n, "tree");
      return;
    }
    const order = e.target.closest("[data-order]");
    if (order) {
      const [n, dir] = order.dataset.order.split("|");
      const i = locationOf(n);
      const list = state.semesters[i], k = list.indexOf(n);
      place(n, i, dir === "up" ? list[k - 1] : list[k + 2] ?? null);
      if (reopenWindow) reopenWindow();
      // the focus stays on the button pressed, or on the other one at the top or the bottom
      const again = document.querySelector(`#info [data-order='${n}|${dir}']:not([disabled])`)
        || document.querySelector(`#info [data-order^='${n}|']:not([disabled])`);
      if (again) again.focus();
      return;
    }
    const lock = e.target.closest("[data-lock]");
    if (lock) {
      const n = lock.dataset.lock;
      state.locked = isLocked(n) ? state.locked.filter((x) => x !== n) : [...(state.locked || []), n];
      save(); render();
      if (lock.closest("#info") && reopenWindow) reopenWindow();
      return;
    }
    // tap to pick a course, tap a zone to put it there (for touch screens, and a mouse too)
    const c = e.target.closest(".chip[draggable]");
    // a click on a card always picks it (or another one instead); a course is put in a place by a click on its
    // "שיבוץ כאן" button, or anywhere in the box around its cards (guy, 2026-10-31: a click on a card that put the
    // picked course there instead of picking the card was confusing)
    if (c) {
      selected = selected === c.dataset.n ? null : c.dataset.n;
      if (selected !== null && c.closest(".tree")) setTreeOpen(false); // phones: the tree makes way for the semesters
      render();
      return;
    }
    if (selected !== null) {
      const box = e.target.closest(".semester, .zone-card");
      const zoneNode = box && box.querySelector("[data-zone]");
      const target = zoneTarget(zoneNode || e.target);
      const n = selected;
      selected = null;
      // a tap outside any zone cancels the pick and unlocks the semesters
      if (target !== undefined) { keepOutside(n); place(n, target); } else render();
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && selected) { selected = null; render(); } });
  document.addEventListener("keydown", (e) => {
    const card = e.target.classList && e.target.classList.contains("chip") ? e.target : null;
    if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openMove(card.dataset.n); return; }
    // Alt+↑ / Alt+↓ moves a card one place up or down in its semester; the focus stays on it (guy, 2026-11-01)
    if (card && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const i = locationOf(card.dataset.n);
      if (typeof i !== "number") return;
      e.preventDefault();
      const list = state.semesters[i], n = card.dataset.n, k = list.indexOf(n);
      const to = e.key === "ArrowUp" ? k - 1 : k + 1;
      if (to < 0 || to >= list.length) return;
      place(n, i, e.key === "ArrowUp" ? list[to] : list[to + 1] ?? null);
      announce(T`${n}: מקום ${to + 1} מתוך ${list.length} בסמסטר ${semesterLabel(semesterIds()[i])}`);
      return;
    }
    // Delete takes a card out of the plan, like its ×
    if (card && (e.key === "Delete" || e.key === "Backspace")) {
      const x = card.querySelector(".x");
      if (x) {
        e.preventDefault();
        // the focus stays in the same place: the next card there, or the one before, or the course back in the tree
        const zone = card.closest("[data-zone]");
        const near = card.nextElementSibling || card.previousElementSibling;
        const nearN = near && near.dataset.n;
        const zoneSel = zone ? `[data-zone='${zone.dataset.zone}']` : "";
        const n = card.dataset.n;
        moveFocus = () => {
          const again = nearN && document.querySelector(`${zoneSel} .chip[data-n='${nearN}']`);
          if (again) again.focus({ preventScroll: true }); else focusMoved(n);
        };
        x.click();
      }
      return;
    }
    if (e.key === "Escape" && document.body.classList.contains("tree-open") && !document.querySelector("dialog[open]")) {
      setTreeOpen(false); $("#tree-fab").focus(); return;
    }
    // "/" goes to the course search, as on many sites
    if (e.key === "/" && !(e.target.closest && e.target.closest("input, select, textarea")) && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      if (treeIsLayer()) setTreeOpen(true);
      $("#tree-search").focus();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    // e.code names the physical key, so Ctrl+Z works whatever the keyboard language is (in Hebrew e.key is "ז")
    const key = e.code === "KeyZ" ? "z" : e.code === "KeyY" ? "y" : e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
  });
}

function setupControls() {
  // the start is a year: the plan always begins in its semester א (guy, 2026-10-31)
  $("#start-year").addEventListener("change", () => { state.start = `${$("#start-year").value}א`; save(); render(); });
  $("#semesters").addEventListener("click", (e) => {
    if (e.target.closest("#add-year")) {
      const add = 3 - (state.semesters.length % 3); // a whole year, or what is left of the last one
      state.semesters.push(...Array.from({ length: add }, () => []));
      save(); render();
    } else if (e.target.closest("#remove-semester")) removeLastSemester();
    else if (e.target.closest("[data-block]")) toggleBlock(Number(e.target.closest("[data-block]").dataset.block));
  });
  $("#undo").addEventListener("click", undo);
  $("#redo").addEventListener("click", redo);
  $("#fill-recommended").addEventListener("click", fillRecommended);
  $("#auto-fill").addEventListener("click", autoFill);
  $("#share").addEventListener("click", sharePlan);
  $("#help").addEventListener("click", showHelp);
  // focus goes into the layer, but not to the search: on a phone that opens the keyboard (guy, 2026-11-01)
  $("#tree-fab").addEventListener("click", () => { setTreeOpen(true); $("#tree-close").focus({ preventScroll: true }); });
  $("#skip-tree").addEventListener("click", (e) => { e.preventDefault(); if (treeIsLayer()) setTreeOpen(true); $("#tree-search").focus(); });
  $("#skip-plan").addEventListener("click", (e) => { e.preventDefault(); $("#plan-start").focus(); });
  $("#a11y-open").addEventListener("click", showAccessibility);
  setupMove();
  // the notice on top closes until the next load (guy): nothing is saved, so it is back on every refresh
  $("#audience-close").addEventListener("click", () => {
    $("#audience-box").hidden = true;
    $("#plan-start").focus({ preventScroll: true }); // the focus does not get lost with the button
  });
  // a window that closes gives the focus back to what opened it; when the page was rebuilt meanwhile, that
  // element is gone, so the focus goes to the same element in the new page (or the course that was moved)
  let lastKey = null;
  document.addEventListener("focusin", (e) => { const k = focusKey(e.target); if (k) lastKey = k; });
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("close", () => setTimeout(() => {
    if (!document.activeElement || document.activeElement === document.body) refocus(lastKey);
  }, 0)));
  // the cards of a list are built only when it is opened (145 cards)
  $("#lists").addEventListener("toggle", (e) => {
    const key = e.target.dataset && e.target.dataset.list;
    if (!key || e.target.open === listsOpen.has(key)) return;
    if (e.target.open) listsOpen.add(key); else listsOpen.delete(key);
    renderLists();
  }, true);
  $("#tree-close").addEventListener("click", () => { setTreeOpen(false); $("#tree-fab").focus({ preventScroll: true }); });
  $("#pick-cancel").addEventListener("click", (e) => { e.stopPropagation(); selected = null; render(); });
  $("#background").addEventListener("change", (e) => {
    const id = e.target.dataset.background;
    if (!id) return;
    const set = new Set(state.background || []);
    // a grey box (the courses are in the plan) shows a check already; a click on it ticks it for real
    if (e.target.checked || e.target.classList.contains("auto")) set.add(id); else set.delete(id);
    state.background = [...set];
    save(); render();
  });
  const removeLastSemester = () => {
    const last = state.semesters[state.semesters.length - 1];
    if (state.semesters.length <= 1) return;
    if (last.some(isLocked)) { toast(T`בסמסטר האחרון יש קורס נעול (${last.filter(isLocked).join(", ")}). צריך לשחרר אותו לפני שמסירים את הסמסטר.`, 7000); return; }
    state.semesters.pop();
    state.blocked = (state.blocked || []).filter((x) => x < state.semesters.length);
    save(); render();
    if (last.length) toast(T`הסמסטר האחרון הוסר, והקורסים שבו (${last.join(", ")}) חזרו לעץ.`, 7000, { label: T("ביטול"), run: undo });
  };
  // "clear" of the semesters: every course out of them, except the locked ones; the start, "courses I already did",
  // the background and the extra courses stay (guy). The grid goes back to its default length, or as far as a locked course
  $("#clear-semesters").addEventListener("click", () => {
    const gone = state.semesters.flat().filter((n) => !isLocked(n));
    if (!gone.length) return;
    const kept = state.semesters.map((s) => s.filter(isLocked));
    const length = Math.max(defaultState(program.code).semesters.length, kept.findLastIndex((s) => s.length) + 1);
    state.semesters = Array.from({ length }, (_, i) => kept[i] || []);
    state.blocked = (state.blocked || []).filter((x) => x < length); // blocks stay: they are the student's, not courses
    save(); render();
    const locked = kept.flat().length;
    toast([T`${gone.length} קורסים הוצאו מהסמסטרים.`,
      locked === 1 ? T(" הקורס הנעול נשאר במקומו.") : locked ? T` ${locked} קורסים נעולים נשארו במקומם.` : ""].join(""), 8000, { label: T("ביטול"), run: undo });
  });
  // reset, at the top: everything back to the start, locks or not (guy); undo brings it back
  $("#reset").addEventListener("click", () => {
    state = defaultState(program.code); save(); render(true);
    toast(T("הכול אופס: הסמסטרים, קורסים שכבר עשיתי, הנעילות והסימונים."), 8000, { label: T("ביטול"), run: undo });
  });
  // empties "courses I already did", except the locked ones (guy); reset never touches that area
  $("#clear-done").addEventListener("click", () => {
    const gone = state.done.filter((n) => !isLocked(n));
    if (!gone.length) return;
    state.done = state.done.filter(isLocked); save(); render();
    const kept = state.done.length;
    toast([T`${gone.length} קורסים הוצאו מ"קורסים שכבר עשיתי".`,
      kept === 1 ? T(" הקורס הנעול נשאר.") : kept ? T` ${kept} קורסים נעולים נשארו.` : ""].join(""), 8000, { label: T("ביטול"), run: undo });
  });
  $("#program").addEventListener("change", (e) => selectProgram(e.target.value));
  // another field: its first degree, unless the current one is in it too
  $("#field").addEventListener("change", (e) => {
    const codes = fillPrograms(e.target.value);
    if (codes.includes(program.code)) { $("#program").value = program.code; showAdvisors(); }
    else selectProgram(codes[0]);
  });
  $("#skills").addEventListener("change", (e) => {
    const id = e.target.dataset.skill;
    if (!id) return;
    state.skills = e.target.checked ? [...new Set([...(state.skills || []), id])] : (state.skills || []).filter((x) => x !== id);
    save(); render();
  });
  // the browser's print window draws the sheet best; a site cannot save a PDF without it. The page title
  // becomes the file name the browser suggests for "Save as PDF"
  const title = document.title;
  $("#print").addEventListener("click", printPlan);
  // Ctrl+P goes the same way, so an unfinished plan is never printed without the window (the browser's own menu
  // still prints at once; then the page says "טיוטה" at the top)
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyP" && !e.shiftKey && !e.altKey) { e.preventDefault(); printPlan(); }
  });
  window.addEventListener("beforeprint", () => { buildPrint(); document.title = T`תכנית לימודים - ${program.code}`; });
  window.addEventListener("afterprint", () => { document.title = title; });
}

// ---------- help ----------
// The "?" button: how to use the site, step by step, each step with a screenshot of the real site in the chosen
// language (site/help/<language>/<name>.png, made by scripts/make_help_shots.py; a missing picture is skipped).
// Rewritten for the finished site, 2026-11-01 (guy)
const HELP_STEPS = [
  { shot: "top", title: T("1. בוחרים תואר ושנת התחלה"),
    text: T("בראש העמוד בוחרים תחום ואז תואר, ולידו יש קישור לדף התכנית ולרשימת היועצים האקדמיים. ליד \"הסמסטרים שלי\" בוחרים את שנת ההתחלה, והתכנית מתחילה תמיד בסמסטר א שלה. מי שמתחיל בסמסטר ב או בקיץ חוסם את הסמסטרים שלפני בכפתור ⊘ שבכותרת הסמסטר. \"+ הוספת שנה\" מתחת לסמסטרים מוסיף שנה שלמה.") },
  { shot: "controls", title: T("2. מתחילים מהר"),
    text: T("\"מילוי לפי התכנית המומלצת\" ממלא את הסמסטרים לפי התכנית של המחלקה (3 או 4 שנים). \"השלמה אוטומטית\" משבצת רק את קורסי החובה שעוד חסרים, סביב מה שכבר שיבצת. שניהם רק נקודת התחלה: את קורסי הבחירה בוחרים לבד, ואחרי המילוי חלון אומר מה עוד נשאר. כל פעולה אפשר לבטל ב-↶ שבראש העמוד או ב-Ctrl+Z.") },
  { shot: "drag", title: T("3. משבצים קורסים"),
    text: T("עץ הקורסים מראה את מה שהתואר דורש. גוררים קורס לסמסטר, או ל\"קורסים שכבר עשיתי\" אם כבר למדת אותו. אפשר גם ללחוץ על קורס ואז על \"+ שיבוץ כאן\" (כך בטלפון). כשהעכבר על קורס בעץ, ובזמן הגרירה, הסמסטרים נצבעים: כחול אפשר, אדום או כתום יחסר תנאי, ובסמסטר מפוספס הקורס לא מוצע. מה שכבר שיבצת מתכווץ בעץ, כך שרואים בעיקר את מה שנשאר.") },
  { shot: null, title: T("4. מסדרים ונועלים"),
    text: T("בתוך סמסטר גוררים קורס למעלה או למטה, וקו מראה איפה הוא ינחת. במקלדת: Alt וחץ. בטלפון: \"למעלה\" ו\"למטה\" בחלון הקורס (ⓘ). המנעול שעל הכרטיס משאיר קורס במקומו, גם בניקוי וגם במילוי לפי התכנית המומלצת.") },
  { shot: "warn", title: T("5. תנאים ואזהרות"),
    text: T("כל קורס נבדק מול הקורסים שבסמסטרים שלפניו. תגית אדומה: חסר תנאי קבלה או נ\"ז קודמים. כתומה: חסר ידע קודם דרוש. אפורה: ידע קודם שנלמד באותו סמסטר. \"פירוט\" או \"תנאים\" פותחים רשימה של כל תנאי עם ✓ או ✗. לחיצה על מספר של קורס בחלון קופצת אליו.") },
  { shot: "status", title: T("6. מה עוד נשאר לעשות"),
    text: T("בראש התכנית כרטיס כתום, \"התכנית עוד לא גמורה\", עם הצעדים שנשארו: קורסי חובה, בחירות, קורסי בחירה, נ\"ז, תנאים שחסרים, ו\"רקע ודרישות\". כל פריט בו קופץ למקום שלו בעץ, וצעד שהושלם מסומן ✓. מתחתיו מוני נקודות הזכות מול מה שנדרש. כשהכול מסומן, הם מתאחדים לכרטיס ירוק אחד. קורסים חופפים נספרים פעם אחת, וכרטיס הקורס אומר כמה הוא נספר.") },
  { shot: "background", title: T("7. רקע ודרישות"),
    text: T("בכרטיס \"רקע ודרישות\" מסמנים אם יש לך בגרות שבאה במקום קורסי היסוד, ואם עמדת בדרישות האנגלית וההדרכה הביבליוגרפית. מה שלא סומן מופיע כתגית על הקורסים שדורשים אותו. כשקורסי היסוד כבר בתכנית, תיבת הבגרות אפורה ועם ✓. בלי בגרות, מבחן התאמה ימליץ אם כדאי ללמוד קודם את סדנת ההכנה (ללא נ\"ז). כשהכול מסומן, הכרטיס מתקפל לשורה אחת.") },
  { shot: "search", title: T("8. חיפוש"),
    text: T("החיפוש בראש העץ מוצא קורס לפי שם או מספר, ומתחת לעץ מציג גם קורסים מתאימים שאינם חלק מהתואר; אפשר לגרור אותם ישר לסמסטר. Ctrl+F פותח חיפוש בכל העמוד, בעץ ובתכנית: Enter עובר להתאמה הבאה, והקורסים שנמצאו מסומנים בצהוב. Ctrl+F שוב סוגר אותו.") },
  { shot: "share", title: T("9. הדפסה ושיתוף"),
    text: T("\"הדפסה / PDF\" מכין טבלה של התכנית לפי סמסטרים, להדפסה או לשמירה כ-PDF, עם מה שעוד חסר. \"שיתוף\" יוצר קישור שפותח את התכנית אצל מי שמקבל אותו, למשל יועץ אקדמי. תכנית שבונים כאן אינה מאושרת: אישור תכנית לימודים סופית מתקבל רק דרך מערכת השאילתא.") },
];

// ---------- accessibility statement ----------
// required by the Israeli accessibility regulations (a statement in a prominent place, with a contact). It says
// what was done and what is not accessible yet; keep it true when the site changes (accessibility, 2026-10-31)
const A11Y_CHECKED = "2026-11-01";
function showAccessibility() {
  const p = (text) => el("p", { text });
  const li = (text) => el("li", { text });
  $("#a11y-body").replaceChildren(el("div", { class: "a11y-body" },
    p(T("אנחנו רוצים שכל הסטודנטים יוכלו להשתמש בכלי, גם עם מקלדת בלבד, עם קורא מסך או עם הגדלת טקסט. הכלי נבנה לפי התקן הישראלי 5568 (המבוסס על הנחיות WCAG) ברמה AA, ככל שידענו.")),
    el("h4", { text: T("מה עשינו") }),
    el("ul", {},
      li(T("אפשר לבנות את כל התכנית במקלדת: Tab עובר בין הקורסים, ו-Enter על קורס פותח רשימה של המקומות שאפשר לשבץ בה אותו, עם מה שיחסר בכל סמסטר.")),
      li(T("Alt עם חץ למעלה או למטה על קורס בסמסטר משנה את המקום שלו בסמסטר.")),
      li(T("קישורי דילוג בראש העמוד: לתכנית ולחיפוש הקורסים. המקש / עובר לחיפוש.")),
      li(T("Ctrl+F פותח חיפוש של קורס בכל העמוד: בעץ, בסמסטרים וב\"קורסים שכבר עשיתי\". Enter עובר להתאמה הבאה.")),
      li(T("ביטול וחזרה גם במקלדת: Ctrl+Z ו-Ctrl+Y.")),
      li(T("אזהרות מוצגות בטקסט ולא רק בצבע, וכל הטקסט בניגודיות מספקת, בתצוגה הבהירה ובכהה.")),
      li(T("הודעות מוקראות בקורא מסך, ולחלונות יש כותרות וכפתור סגירה.")),
      li(T("האתר מתאים את עצמו למסך צר ולהגדלת טקסט, ומכבד את הגדרת המערכת להפחתת תנועה.")),
      li(T("האתר זמין בעברית, בערבית ובאנגלית."))),
    el("h4", { text: T("מה עוד לא נגיש") }),
    el("ul", {},
      li(T("גרירה של קורסים אפשרית רק בעכבר או במגע. החלופה במקלדת היא Enter על הקורס.")),
      li(T("שמות הקורסים מופיעים בעברית גם באתר בערבית ובאנגלית, כמו בקטלוג.")),
      li(T("קובץ PDF שנשמר מכפתור ההדפסה נוצר בדפדפן שלכם, ולכן ייתכן שאינו מתויג לקורא מסך.")),
      li(T("האתר לא נבדק עדיין על ידי מורשה נגישות."))),
    el("h4", { text: T("נתקלתם בבעיית נגישות?") }),
    el("p", {}, T("כתבו לנו, ונשתדל לתקן מהר: ד\"ר גיא עמית, "),
      el("a", { href: "mailto:guyam@openu.ac.il", dir: "ltr", text: "guyam@openu.ac.il" }), "."),
    el("p", { class: "small", text: T`ההצהרה עודכנה ב-${A11Y_CHECKED.split("-").reverse().join(".")}.` })));
  $("#a11y-dialog").showModal();
  $("#a11y-body").scrollTop = 0;
}

function showHelp() {
  $("#help-body").replaceChildren(
    el("p", { class: "help-intro", text: T("האתר עוזר לבנות תכנית לימודים לתואר: משבצים קורסים בסמסטרים, והאתר בודק את התנאים וסופר את נקודות הזכות. התכנית נשמרת בדפדפן שלך. פרטי כל קורס: לחיצה על ⓘ שליד הקורס.") }),
    ...HELP_STEPS.map((step) => el("section", { class: "help-step" },
      el("h4", { text: step.title }),
      el("p", { text: step.text }),
      step.shot ? el("img", { src: `help/${LANG}/${step.shot}.png`, alt: step.title }) : null)));
  $("#help-body").querySelectorAll("img").forEach((img) => img.addEventListener("error", () => img.remove()));
  $("#help-dialog").showModal();
  $("#help-body").scrollTop = 0;
}

// ---------- sharing a plan ----------
// The whole plan goes into the link itself (after #, so it never reaches any server): whoever opens the link
// sees the same plan. No accounts and no storage are needed, which suits a static site
function encodePlan() {
  const plan = { p: state.program, s: state.start, d: state.done, m: state.semesters, x: state.extra, b: state.background || [], k: state.skills || [], l: state.locked || [], o: state.blocked || [] };
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodePlan(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const p = JSON.parse(new TextDecoder().decode(bytes));
  const list = (v) => (Array.isArray(v) ? v.filter((n) => typeof n === "string") : []);
  if (!DATA.programs[p.p] || !/^\d{4}[אבג]$/.test(p.s) || !Array.isArray(p.m)) throw new Error("bad plan");
  const blocked = Array.isArray(p.o) ? p.o.filter((i) => Number.isInteger(i) && i >= 0 && i < p.m.length) : [];
  return fromYearStart({ program: p.p, start: p.s, done: list(p.d), semesters: p.m.map(list), extra: list(p.x), background: list(p.b), skills: list(p.k), locked: list(p.l), blocked });
}

// "התכנית עוד לא גמורה: נשארו N צעדים" and the steps, for the print and share windows (guy, 2026-11-03)
function unfinishedNote() {
  const open = planSteps().filter((x) => !x.done);
  if (!open.length) return null;
  return el("div", { class: "unfinished" },
    el("strong", { text: T("התכנית עוד לא גמורה.") }), " ",
    open.length === 1 ? T("נשאר צעד 1:") : T`נשארו ${open.length} צעדים:`,
    el("ul", {}, open.map((x) => el("li", { text: x.text }))));
}

// print: an unfinished plan first gets a window that says so, with "חזרה לעריכה" and "הדפסה בכל זאת" (guy,
// 2026-11-03); a finished one prints at once
function printPlan() {
  const note = unfinishedNote();
  reopenWindow = null;
  // a finished plan gets the window too, for the approval note (guy, 2026-11-03)
  fillInfo(
    el("h3", { text: note ? T("להדפיס תכנית שעוד לא גמורה?") : T("הדפסת התכנית") }),
    note,
    approvalNote(),
    el("p", { class: "after-fill-ok" },
      el("button", { type: "button", class: "mini", id: "print-back", text: T("חזרה לעריכה") }), " ",
      el("button", { type: "button", class: "mini", id: "print-anyway", text: note ? T("הדפסה בכל זאת") : T("הדפסה") })));
  if (!$("#info").open) $("#info").showModal();
  $("#print-back").addEventListener("click", () => $("#info").close());
  $("#print-anyway").addEventListener("click", () => { $("#info").close(); setTimeout(() => window.print(), 50); });
  $("#print-back").focus();
}

function sharePlan() {
  const link = `${location.origin}${location.pathname}#plan=${encodePlan()}`;
  const input = el("input", { class: "share-link", readonly: true, value: link });
  fillInfo(
    el("h3", { text: T("שיתוף התכנית") }),
    // an unfinished plan says so first (guy, 2026-11-03): whoever gets the link should know it is a draft
    unfinishedNote(),
    approvalNote(),
    el("p", { text: T("הקישור הזה פותח את התכנית בדיוק כמו שהיא עכשיו, אצל כל מי שמקבל אותו (למשל יועץ אקדמי). אפשר לשלוח אותו במייל או בהודעה.") }),
    input,
    el("p", {}, el("button", { type: "button", class: "mini", id: "copy-link", text: T("העתקת הקישור") })),
    el("p", { class: "cond-note", text: T("מי שפותח את הקישור מקבל עותק: שינויים שהוא עושה לא משנים את התכנית שלך. התכנית לא נשמרת בשום שרת, היא כולה בתוך הקישור.") }));
  if (!$("#info").open) $("#info").showModal();
  input.select();
  $("#copy-link").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); } catch (e) { input.select(); document.execCommand("copy"); }
    $("#copy-link").textContent = T("✓ הקישור הועתק");
  });
}

// a shared link opened: show that plan (it replaces the current one, and "ביטול" brings the old one back)
function openSharedPlan() {
  const m = location.hash.match(/^#plan=([\w-]+)$/);
  if (!m) return false;
  history.replaceState(null, "", location.pathname + location.search); // a reload shows the student's own plan again
  let shared;
  try { shared = decodePlan(m[1]); } catch (e) {
    toast(T("הקישור לתכנית פגום, ולכן התכנית לא נפתחה."), 8000);
    return false;
  }
  $("#program").value = shared.program;
  selectProgram(shared.program);
  state = { ...defaultState(shared.program), ...shared };
  save();
  renderStatic();
  render();
  toast(T("נפתחה תכנית ששותפה איתך. היא נשמרה במקום התכנית שהייתה כאן; \"ביטול\" מחזיר את הקודמת."), 12000, { label: T("ביטול"), run: undo });
  return true;
}

// ---------- print ----------

// a condition with course numbers only, read right to left: 20406 וגם (20423 או 20224).
// Where the plan already meets one of the alternatives, only that one is printed, so the page stays short
// n: the course whose condition this is; "רקע מהתיכון" only for a background it accepts
function printFormula(expr, top = true, full = false, n = null) {
  if (typeof expr === "string") return el("bdi", { text: expr });
  if (expr.or && !full) {
    const planned = new Set(plannedCourses());
    const met = expr.or.find((p) => satisfied(p, planned));
    if (met) return printFormula(met, top, false, n);
    const bg = new Set();
    backgroundsFor(n).filter((b) => (state.background || []).includes(b.id)).forEach((b) => coursesIn(b.courses, bg));
    if (expr.or.some((p) => satisfied(p, bg))) return el("span", { text: T("רקע מהתיכון") });
  }
  const parts = expr.and || expr.or || expr.of;
  const inner = [];
  parts.forEach((p, i) => {
    if (i) inner.push(expr.of ? ", " : expr.and ? T(" וגם ") : T(" או "));
    inner.push(printFormula(p, false, full, n));
  });
  if (expr.of) return el("span", {}, T`${expr.atleast} מתוך (`, inner, ")");
  return el("span", {}, top ? "" : "(", inner, top ? "" : ")");
}

// the plan as one printable page: a summary, then a table per semester with what matters about each course
function buildPrint() {
  const ids = semesterIds();
  const gaps = degreeGaps();
  // the column names, repeated under every semester heading (guy: once at the top alone looked odd)
  const head = () => el("tr", { class: "col-head" }, [T("מספר"), T("קורס"), T("נ\"ז"), T("מתקדמות"), T("תנאים"), T("הערות")].map((t) => el("th", { scope: "col", text: capital(t) })));
  // a condition part that an unticked background requirement would also meet says so
  const orBackground = (e, n) => backgroundsFor(n)
    .filter((b) => !(state.background || []).includes(b.id) && satisfied(e, coursesIn(b.courses)))
    .map((b) => T`, או ${b.name} מהתיכון`).join("");
  // what is missing, not only that something is: "חסר ידע קודם: 20125 או (20113 וגם 20114), או ..."
  const problemLine = (p) => {
    if (p.key === "prior") return el("div", { text: priorText(p.prior) });
    const open = p.parts.filter((e) => !satisfied(e, p.have));
    const same = new Set(state.semesters[p.i]);
    // a part met in the same semester is not missing: it gets a line of its own (it read as missing, guy's PDF)
    const parallel = (e) => p.level !== "soft" && satisfied(e, new Set([...p.have, ...same]));
    const missing = open.filter((e) => !parallel(e));
    const together = open.filter(parallel);
    return el("div", {},
      missing.length || p.level === "soft" ? el("div", {}, el("b", { text: p.level === "soft" ? `${p.tag}: ` : T`חסר ${p.label}: ` }),
        (p.level === "soft" ? open : missing).map((e, k) => el("span", {}, k ? "; " : "", printFormula(e, true, false, p.n), orBackground(e, p.n)))) : null,
      together.length ? el("div", {}, el("b", { text: T("ידע קודם במקביל: ") }),
        together.map((e, k) => el("span", {}, k ? "; " : "", printFormula(e, true, false, p.n), T(" (באותו סמסטר)")))) : null);
  };
  const coordinator = (c) => el("div", { class: "who" }, T("מרכז/ת ההוראה: "),
    c.coordinator || c.coordinatorEmail
      // the email on its own line: next to the name it wrapped and left a separator dangling at the line's end
      ? [c.coordinator ? el("bdi", { text: c.coordinator }) : null,
        c.coordinatorEmail ? el("div", {}, el("bdi", { text: c.coordinatorEmail })) : null]
      : T("עדיין לא הוזן"));
  const row = (n, i) => {
    const c = DATA.courses[n] || {};
    const remarks = [];
    if (typeof i === "number") {
      problems.filter((p) => p.n === n && p.i === i).forEach((p) => remarks.push(problemLine(p)));
      if (c.semesters && c.semesters.length && !c.semesters.includes(ids[i].slice(4))) remarks.push(T`לא מוצע בסמסטר ${letterName(ids[i].slice(4))}`);
      if (missingSkills(n).length) remarks.push(skillsTag(missingSkills(n)));
    }
    if (c.offered === false && i !== "done") remarks.push(T("לא מוצע עוד"));
    if (c.notYet && i !== "done") remarks.push(T("עוד לא מוצע"));
    if (overlapLine(n)) remarks.push(overlapLine(n).text);
    if (backgroundFor(n)) remarks.push(onlyWithoutBackground(backgroundFor(n)));
    if (prepNote(n, i)) remarks.push(prepNote(n, i));
    const conds = [
      c.admission && el("div", {}, el("b", { text: T("תנאי קבלה: ") }), printFormula(c.admission, true, false, n)),
      c.required && el("div", {}, el("b", { text: T("ידע קודם: ") }), printFormula(c.required, true, false, n)),
      c.priorCredits && el("div", { text: T`לפחות ${c.priorCredits} נ"ז קודמים (${T(c.priorField)})` }),
    ].filter(Boolean);
    return el("tr", {},
      el("td", { class: "num", text: n }),
      el("td", {}, el("bdi", { text: c.name || "" }), coordinator(c)),
      el("td", { class: "n", text: c.credits === null || c.credits === undefined ? "" : String(c.credits) }),
      el("td", { class: "n", text: c.advanced ? String(c.advanced) : "" }),
      el("td", { class: "conds" }, conds),
      el("td", { class: "rem" }, remarks.map((t) => (typeof t === "string" ? el("div", { text: t }) : t))));
  };
  // the choice groups still short of credits, each with the courses that could fill it
  const electives = gaps.filter((g) => g.kind === "credits").map((g) => {
    const group = program.sections.flatMap((s) => s.groups).find((x) => `group-${x.id}` === g.target);
    const planned = new Set(plannedCourses());
    const options = new Set();
    group.items.forEach((it) => it.courses && coursesIn(it.courses, options));
    const list = [...options].filter((n) => !planned.has(n) && DATA.courses[n] && DATA.courses[n].offered !== false);
    return {
      title: [T`עוד חסר: ${g.text}`, el("small", { text: T(" · אפשר לבחור מהקורסים האלה, בכל סמסטר שבו הם מוצעים") })],
      rows: list.map((n) => {
        const c = DATA.courses[n];
        return el("tr", {},
          el("td", { class: "num", text: n }),
          el("td", {}, el("bdi", { text: c.name }), coordinator(c)),
          el("td", { class: "n", text: c.credits === null ? "" : String(c.credits) }),
          el("td", { class: "n", text: c.advanced ? String(c.advanced) : "" }),
          el("td", { class: "conds" }, [
            c.admission && el("div", {}, el("b", { text: T("תנאי קבלה: ") }), printFormula(c.admission, true, false, n)),
            c.required && el("div", {}, el("b", { text: T("ידע קודם: ") }), printFormula(c.required, true, false, n)),
            c.priorCredits && el("div", { text: T`לפחות ${c.priorCredits} נ"ז קודמים (${T(c.priorField)})` }),
            SKILLS.some((s) => c[s.key]) && el("div", { text: SKILLS.filter((s) => c[s.key]).map((s) => s.short).join(", ") }),
          ].filter(Boolean)),
          el("td", { class: "rem", text: c.notYet ? T("קורס חדש, עוד לא מוצע") : T`מוצע בסמסטרים ${letterList(c.semesters)}${c.offeredUntil ? T`, עד ${semName(c.offeredUntil)}` : ""}${c.offeredFrom ? T`, מ-${semName(c.offeredFrom)}` : ""}` }));
      }),
    };
  });
  // English / library (what the degree or a planned course asks for) and the background requirements, ticked or not
  const needs = skillNeeds();
  const asked = askedSkills();
  const ticks = [
    ...asked.map((s) => {
      const need = needs.find((x) => x.skill === s);
      return { ok: hasSkill(s.id), text: s.short, note: need ? T`לא סומן, נדרש לפני ${semesterLabel(ids[need.courses[0].i])}`
        : degreeAsks(s) ? T("לא סומן, דרישה כללית של התואר") : T("לא סומן") };
    }),
  ];
  // a background requirement is printed as what it is, an alternative: "20125 או (20113 וגם 20114), או בגרות ..."
  const planned = new Set(plannedCourses());
  const basics = (program.background || []).map((b) => {
    const ticked = (state.background || []).includes(b.id);
    const viaCourses = satisfied(b.courses, planned);
    return { ok: ticked || viaCourses,
      text: [printFormula(b.courses, true, true), T`, או ${b.name} מהתיכון`],
      note: ticked ? T("סימנת שיש לך את הרקע") : viaCourses ? [printFormula(b.courses), T(" בתכנית")] : T("עוד לא בתכנית") };
  });
  // the summary at the top: the credits against the program's minimums, what the degree still lacks,
  // and the general requirements, each line with a clear ✓ or ✗
  const mark = (ok) => el("span", { class: `mk ${ok ? "ok" : "no"}`, text: ok ? "✓" : "✗" });
  const creditsTable = el("table", { class: "credits" },
    el("thead", {}, el("tr", {}, ["", T("בתכנית"), T("נדרש"), T("חסר")].map((t) => el("th", { text: t })))),
    el("tbody", {}, creditTotals().map(([label, value, target]) => [capital(label), value, target]).map(([label, value, target]) => el("tr", {},
      el("th", { text: label }),
      el("td", { class: "n", text: String(value) }),
      el("td", { class: "n", text: target ? String(target) : "" }),
      el("td", { class: "n" }, !target ? "" : value >= target ? mark(true) : el("b", { class: "miss", text: String(target - value) })))),
      creditCaps().map(([label, value, max]) => el("tr", {},
        el("th", { text: capital(label) }),
        el("td", { class: "n", text: String(value) }),
        el("td", { class: "n", text: T`לכל היותר ${max}` }),
        el("td", { class: "n" }, value <= max ? mark(true) : el("b", { class: "miss", text: `+${value - max}` }))))));
  const todo = gaps.filter((g) => g.kind !== "total");
  // while the plan is not finished, a banner over the summary says so (guy, 2026-11-03: the PDF goes to advisers
  // and colleagues, who read it as a finished plan)
  const openSteps = planSteps().filter((x) => !x.done);
  const draft = openSteps.length ? el("div", { class: "draft" },
    el("strong", { text: T("טיוטה: התכנית עוד לא גמורה.") }), " ",
    T`נשארו ${openSteps.length === 1 ? T("צעד 1") : T`${openSteps.length} צעדים`}: ${openSteps.map((x) => x.text).join("; ")}.`) : null;
  const summary = el("div", { class: "summary" },
    el("div", {}, el("h3", { text: T("נקודות זכות") }), creditsTable),
    el("div", {},
      el("h3", { text: T("עוד חסר לתואר") }),
      todo.length
        ? el("ul", {}, todo.map((g) => el("li", {}, mark(false), " ", g.kind === "item" ? T`פריט חובה: ${g.text}` : g.text,
          g.where ? el("span", { class: "where", text: ` (${g.where})` }) : null)))
        : el("p", {}, mark(true), T(" כל פריטי החובה והבחירה בתכנית")),
      basics.length ? el("h3", { text: T("יסודות (אחד מהשניים)") }) : null,
      basics.length ? el("ul", {}, basics.map((t) => el("li", {}, mark(t.ok), " ", t.text,
        el("span", { class: "where" }, " (", t.note, ")")))) : null,
      ticks.length ? el("h3", { text: T("דרישות נוספות") }) : null,
      ticks.length ? el("ul", {}, ticks.map((t) => el("li", {}, mark(t.ok), " ", capital(t.text),
        t.ok ? null : el("span", { class: "where" }, " (", t.note, ")")))) : null));
  const sum = (list) => list.reduce((s, n) => s + ((DATA.courses[n] || {}).credits || 0), 0);
  // a table per semester, all with the same fixed column widths, so the columns line up down the page.
  // A semester is never split between pages ("keep"); the long elective list may be, and then its
  // heading and column names repeat at the top of the next page (they sit in the table's thead)
  const widths = ["9%", "27%", "6%", "9%", "33%", "16%"];
  const block = (title, rows, keep) => el("table", { class: `plan-table${keep ? " keep" : ""}` },
    el("colgroup", {}, widths.map((w) => el("col", { style: `width:${w}` }))),
    el("thead", {}, el("tr", { class: "sem-row" }, el("th", { colspan: 6 }, title)), head()),
    el("tbody", {}, rows));
  const semester = (title, list, i) => block([title, el("small", { text: T` · ${sum(list)} נ"ז` })], list.map((n) => row(n, i)), true);
  const tables = [
    ...(state.done.length ? [semester(T("קורסים שכבר עשיתי"), state.done, "done")] : []),
    ...state.semesters.flatMap((list, i) => (list.length ? [semester(T`סמסטר ${semesterLabel(ids[i])}`, list, i)] : [])),
    ...electives.map((e) => block(e.title, e.rows, false)),
  ];
  const today = new Date();
  $("#print-sheet").replaceChildren(...[
    // the title on the right, the university logo (the same vector as in the header, in black) small on the left
    el("div", { class: "sheet-top" },
      el("div", {},
        // the degree is the big title, so it is clear at a glance which degree the plan is for (guy, 2026-10-31)
        el("p", { class: "kicker", text: T("תכנית הלימודים שלי") }),
        el("h1", { class: "sheet-head", text: program.name }),
        el("p", { class: "sub", text: T`מתחיל ב-${semesterLabel(state.start)} · הודפס ב-${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}` }),
        program.link ? el("p", { class: "sub" }, T("תכנית הלימודים הרשמית: "),
          el("a", { href: program.link, target: "_blank", rel: "noopener" }, el("bdi", { text: program.link.replace(/^https?:\/\//, "") }))) : null,
        // the same link as "שיתוף": in the saved PDF a click opens this plan in the tool, to go on working on it
        // (guy, 2026-10-31). Only a link on the published site works for someone else (see "שיתוף")
        el("p", { class: "sub" }, el("a", { href: `${location.origin}${location.pathname}#plan=${encodePlan()}`, target: "_blank", rel: "noopener",
          text: T("פתיחת התכנית הזו בכלי התכנון, להמשך עבודה עליה") }))),
      $(".ou-logo svg").cloneNode(true)),
    el("div", { class: "approval" }, el("strong", { text: T("חשוב: ") }), APPROVAL()),
    draft,
    summary,
    ...tables,
    el("p", { class: "foot" }, el("strong", {}, T("הכלי נועד לעזרה בלבד, ועשויים לחול שינויים בהיצע הקורסים ובתכניות הלימודים. המידע המעודכן ביותר על הקורסים נמצא בקטלוג הקורסים של האוניברסיטה הפתוחה: "),
      // never broken across lines (guy saw "Catalog" alone on the next line), and clickable in a saved PDF
      el("a", { href: "https://www.openu.ac.il/academic/Catalog/", class: "nowrap" }, el("bdi", { dir: "ltr", text: "www.openu.ac.il/academic/Catalog" })), " ", APPROVAL()), el("br"),
      T("תקלה או טעות במידע? כתבו לי (ד\"ר גיא עמית): "),
      el("a", { href: "mailto:guyam@openu.ac.il", class: "nowrap" }, el("bdi", { dir: "ltr", text: "guyam@openu.ac.il" }))),
  ].filter(Boolean)); // replaceChildren would print a null as the text "null"
}

function setShowPlaced(on) {
  showPlaced = on;
  $("#show-placed").checked = on;
  renderTree();
}

function setupSearch() {
  // not remembered (guy, 2026-11-03): a refresh starts with the switch off
  $("#show-placed").checked = showPlaced;
  $("#show-placed").addEventListener("change", (e) => setShowPlaced(e.target.checked));
  // toggle does not bubble, so it is caught on the way down
  $("#tree").addEventListener("toggle", (e) => {
    const id = e.target.dataset && e.target.dataset.group;
    if (id) { if (e.target.open) openGroups.add(id); else openGroups.delete(id); }
  }, true);
  // while searching the whole tree is shown (a placed course is found too, with its semester)
  // one search for everything: the tree is filtered, and courses outside the degree are offered under it
  $("#tree-search").addEventListener("input", () => { showAllOutside = false; renderTree(); });
  // the × in the search box empties it and shows the whole tree again (guy)
  $("#tree-search-clear").addEventListener("click", () => {
    $("#tree-search").value = "";
    showAllOutside = false;
    renderTree();
    $("#tree-search").focus();
  });
  $("#outside").addEventListener("click", (e) => {
    if (e.target.closest("[data-all-outside]")) { showAllOutside = true; renderTree(); }
  });
}

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

// a reload (refresh, or a change of language) starts at the top of the page, not where the browser left it, which
// came out in the middle of the page (guy, 2026-10-31)
history.scrollRestoration = "manual";

async function main() {
  setupThemeToggle();
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
