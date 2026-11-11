"use strict";
// THE DEGREE: ITS REQUIREMENTS AND THE CREDITS
// The rules of a program (degree): its groups of courses, the credit counters, overlapping courses and how their
// credits are cut, English and the library requirement, and what the plan still lacks (degreeGaps, planSteps).
// Pure logic, like courses.js.

// ---------- fields: which courses count where ----------

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
  // An affiliation is a category inside a category ("מדעים / מדעי הטבע / פיסיקה"): the course counts in every level
  // of it, matched whole (guy, 2026-11-05; a search for words counted physics under "מדעי הטבע והחיים" as life
  // sciences). A combined field ("פיסיקה ומתמטיקה") is either of its parts.
  const parts = field === "מדעי הטבע והחיים" ? ["מדעי הטבע"] : field.split(" ו");
  return c.affiliation.some((a) => {
    const levels = affiliationLevels(a);
    return parts.some((p) => p === "מדעי הטבע" ? levels.some((l) => NATURAL.has(l)) : levels.includes(levelName(p)));
  });
}

// "כדור-הארץ" and "כדור הארץ" are one name
const levelName = (s) => s.replace(/-/g, " ").replace(/\s+/g, " ").trim();

// "מדעי הטבע והחיים" is the old name of the department, left in some affiliations: it is "מדעי הטבע" (guy, 2026-11-05)
const affiliationLevels = (a) => a.split(" / ").map(levelName).map((l) => l === "מדעי הטבע והחיים" ? "מדעי הטבע" : l);

// natural sciences: physics, chemistry, life sciences and earth sciences, under whichever parent the catalog put
// them (20614 and 20615 are "מדעים / מדעי החיים"); not mathematics or computer science, departments of their own
const NATURAL = new Set(["מדעי הטבע", "פיסיקה", "כימיה", "מדעי החיים", "מדעי כדור הארץ"]);

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

// ---------- the program's groups and lists ----------

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

function slotName(id) {
  for (const s of program.sections) {
    if (s.id === id) return s.name;
    const g = s.groups.find((x) => x.id === id);
    if (g) return g.name;
  }
  return id;
}

function programCourses() {
  const set = new Set();
  program.sections.forEach((s) => s.groups.forEach((g) => g.items.forEach((it) => it.courses && coursesIn(it.courses, set))));
  return set;
}

// each alternative gets its own box, with an "או" divider between boxes; the alternative already covered turns green
// a choice of one course from a long list (CB's broadening course: 145 courses), not alternatives to weigh
const LONG_LIST = 12;

// "מה זה?" beside a broadening list, to the catalog page (guy, 2026-11-04)
const whatBroadening = () => el("a", { href: BROADENING_LINK, target: "_blank", rel: "noopener", class: "muted", text: T("מה זה? ↗") });

const isLongList = (expr) => !!(expr && expr.or && expr.or.length > LONG_LIST && expr.or.every((e) => typeof e === "string"));

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

// ---------- courses that broaden knowledge (מרחיבי-דעת) ----------

// the lists shown under the tree, as [key, { name, program, courses }]
// one broadening list, shared by all programs (guy, 2026-11-04): the catalog's, from the column "מרחיב-דעת" of the courses file.
// Its part "במדעים" is left out of science programs (all of ours): a broadening course comes from outside the
// student's field. A program's own extra courses (22006 in 15, OJ, OH) are only in its own item, with a tag
const BROADENING_LINK = "https://www3.openu.ac.il/ouweb/owal/yed.marchiv_daat";

const isScience = (p) => (p.fields || []).some((f) => FIELD_ORDER.includes(f));

const broadeningCourses = (p = program) => (DATA.broadening || []).filter((b) => !(isScience(p) && b.part === "מדעים")).map((b) => b.n);

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

// the broadening list in the catalog's parts, each under its own heading, in the catalog's order (guy, 2026-11-08);
// a program's own extra course (22006) in a part of its own at the end. list(courses) builds the courses of one part
const BROADENING_PARTS = [["מדעי הרוח", "במדעי הרוח"], ["מדעי החברה", "במדעי החברה"], ["מדעים", "במדעים"], ["באנגלית", "באנגלית"], ["בערבית", "בערבית"]];

// each part folds and opens on its own, closed at first (guy, 2026-11-08); the parts opened are kept through renders
const openParts = new Set();

function broadeningParts(courses, list, where) {
  const partOf = (n) => (DATA.courses[n] || {}).broadening;
  const parts = BROADENING_PARTS.map(([part, title]) => [T(title), courses.filter((n) => partOf(n) === part)]);
  parts.push([T("ייחודיים לתכנית שלך"), courses.filter((n) => !BROADENING_PARTS.some(([part]) => partOf(n) === part))]);
  return parts.filter(([, list]) => list.length).map(([title, part]) =>
    el("details", { class: "broad-part", "data-part": `${where}:${title}`, open: openParts.has(`${where}:${title}`) },
      el("summary", { class: "broad-head", text: T`${title} (${part.length})` }), list(part)));
}

// the shared list under "מחוץ לתואר שלך", unless the program has a broadening item of its own (then it is in the tree)
function otherLists() {
  if (broadeningItems().length || !(DATA.broadening || []).length) return [];
  return [["broadening", { courses: broadeningCourses() }]];
}

// ---------- overlapping courses ----------

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

// before placing: a course not in the plan yet that overlaps one already in it says what placing it would do (guy,
// 2026-11-04). The same cuts as after placing, with the course added as the last one studied
function wouldOverlap(n) {
  const c = DATA.courses[n];
  if (!c || locationOf(n) !== null) return null;
  const planned = new Set(plannedCourses());
  const combos = (c.overlaps || []).filter((o) => o.with.every((m) => planned.has(m)));
  if (!combos.length) return null;
  const forbidden = combos.find((o) => o.total === null);
  if (forbidden) return { level: "bad", text: T`אסור ללמוד יחד עם ${forbidden.with.join(" + ")} שבתכנית: מי שלמד אחד מהם לא יכול ללמוד את השני.` };
  const order = new Map();
  state.done.forEach((x) => order.set(x, -1));
  state.semesters.forEach((list, i) => list.forEach((x) => order.set(x, i)));
  order.set(n, state.semesters.length);
  const now = overlapCuts();
  const after = cutsFor([...planned, n], order);
  const others = [...new Set(combos.flatMap((o) => o.with))].join(", ");
  const own = after.get(n) ? after.get(n).cut : 0;
  const lost = [...after].filter(([x]) => x !== n).map(([x, v]) => [x, v.cut - (now.get(x) ? now.get(x).cut : 0)]).filter(([, d]) => d > 0);
  if (own >= (c.credits || 0)) return { level: "soft", text: T`חופף ל-${others} שבתכנית: אם תשבצו אותו, הוא לא ייספר בכלל (0 נ"ז מתוך ${c.credits}).` };
  if (own) return { level: "soft", text: T`חופף ל-${others} שבתכנית: אם תשבצו אותו, ייספרו לו ${Math.max(0, (c.credits || 0) - own)} נ"ז מתוך ${c.credits}.` };
  if (lost.length === 1) return { level: "soft", text: T`חופף ל-${others} שבתכנית: הוא ייספר במלואו, ומ-${lost[0][0]} יירדו ${lost[0][1]} נ"ז.` };
  if (lost.length) return { level: "soft", text: T`חופף ל-${others} שבתכנית: הוא ייספר במלואו, ומ-${lost.map(([x, d]) => T`${x} (${d} נ"ז)`).join(", ")} יירדו נ"ז.` };
  return null;
}

// ---------- credit counters ----------

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

// ---------- English, the library, and content courses in English ----------

// general requirements some courses ask for (English, the library course): the student ticks them,
// and until then every course that asks for one carries a tag, so they are not missed
const SKILLS = [
  // English (guy, 2026-11-04): the one box is the exemption from the language courses, which is not a must ("לא חובה");
// what the degree and the courses ask for is meeting the English requirements. All the courses are taken to ask for
// that, also the 38 whose page says "פטור" (an anomaly, "ניסוח האנגלית" in the anomalies file). Without the exemption
// the requirement stays open: the other English levels are not built yet
{ id: "english", key: "needsEnglish", checkbox: T("יש לי פטור מקורסי שפה באנגלית"), short: T("עמידה בדרישות האנגלית"), title: T("עמידה בדרישות האנגלית"), optional: true,
    link: "https://academic.openu.ac.il/yedion/english/pages/default.aspx" },
  { id: "library", key: "needsLibrary", checkbox: T("עמדתי בדרישות ההדרכה הביבליוגרפית"), short: T("הדרכה ביבליוגרפית"), title: T("הדרכה ביבליוגרפית"),
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
  const english = list.some((s) => s.optional);
  list = list.filter((s) => !s.optional);
  const byCourse = list.filter((s) => courseAsks(s, planned)), general = list.filter((s) => !courseAsks(s, planned));
  const names = (l) => l.map((sk) => sk.short).join(T(" ו"));
  return [
    ...(byCourse.length ? [T`להשלים ${names(byCourse)} לפני הקורסים שדורשים אותם, ולסמן את זה ב"רקע ודרישות"`] : []),
    ...(general.length ? [T`להשלים ${names(general)} (דרישה כללית של התואר), ולסמן את זה ב"רקע ודרישות"`] : []),
    ...(english ? [T("לעמוד בדרישות האנגלית של התואר (אם יש לך פטור מקורסי שפה, סמנו אותו ב\"רקע ודרישות\")")] : []),
  ];
}

// the general requirements course n asks for that the student has not ticked yet
function missingSkills(n) {
  const c = DATA.courses[n];
  return c ? SKILLS.filter((s) => c[s.key] && !hasSkill(s.id)) : [];
}

// for each requirement not ticked yet: the planned courses that ask for it, in plan order (the first one sets the deadline)
function skillNeeds() {
  return SKILLS.filter((s) => !hasSkill(s.id)).map((skill) => {
    const courses = [];
    state.semesters.forEach((list, i) => list.forEach((n) => { if ((DATA.courses[n] || {})[skill.key]) courses.push({ n, i }); }));
    return { skill, courses };
  }).filter((x) => x.courses.length);
}

// academic content courses in English that count for this program: on the university's list and in the program's
// own lists (guy, 2026-11-04). Two are needed by a student exempt from the English language courses
const CONTENT_NEEDED = 2;

const contentCache = new Map();

const contentCourses = () => {
  if (!contentCache.has(program.code)) contentCache.set(program.code, new Set([...programCourses()].filter((n) => (DATA.courses[n] || {}).contentEnglish)));
  return contentCache.get(program.code);
};

const fewCourses = (list) => (list.length > 3 ? T`${list.slice(0, 3).join(", ")} ועוד ${list.length - 3}` : list.join(", "));

// ---------- what the plan still lacks ----------

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
  // only what stops a registration: admission conditions and prior credits. Missing required knowledge does not
  // (one may register without it), so it is a note beside the steps, not a step (guy, 2026-11-04)
  const open = new Set(problems.filter((x) => x.level === "bad").map((x) => x.n)).size;
  // only with courses in the semesters: an empty plan does not "meet every condition" (guy, 2026-11-03)
  if (open) steps.push({ done: false, text: open === 1 ? T("לתקן קורס 1 שחסרים לו תנאי קבלה") : T`לתקן ${open} קורסים שחסרים להם תנאי קבלה`, problems: true });
  else if (state.semesters.some((x) => x.length)) steps.push({ done: true, text: T("כל הקורסים עומדים בתנאי הקבלה שלהם") });
  // a background box neither ticked nor replaced by its courses in the plan, and English / library a course needs
  const planned = new Set(plannedCourses());
  const bg = (program.background || []).filter((b) => !(state.background || []).includes(b.id) && !satisfied(b.courses, planned));
  // English / library: also those the degree itself asks for, with no course yet (guy, 2026-11-04)
  const openSkills = askedSkills().filter((sk) => !hasSkill(sk.id) && !sk.optional);
  if (bg.length || openSkills.length) {
    steps.push({ done: false, text: T("לסמן את \"רקע ודרישות\""), target: "prereq-card",
      detail: [...bg.map((b) => T`${backgroundWhat(b)}, או ${plainCourses(b.courses)} בתכנית`), ...openSkills.map((sk) => sk.short)].join(" · ") });
  } else if ((program.background || []).length || askedSkills().length) {
    steps.push({ done: true, text: T("\"רקע ודרישות\"") });
  }
  // without the exemption: meeting the English requirements of the degree, a step of its own (guy, 2026-11-04)
  const english = SKILLS.find((sk) => sk.optional);
  if (!hasSkill(english.id) && askedSkills().includes(english)) {
    const need = skillNeeds().find((x) => x.skill === english);
    steps.push({ done: false, text: T("לעמוד בדרישות האנגלית של התואר"), target: "prereq-card",
      detail: need ? T`נדרש לפני ${semesterLabel(semesterIds()[need.courses[0].i])}, בשביל ${fewCourses(need.courses.map((x) => x.n))}. אם יש לך פטור מקורסי שפה, סמנו אותו.`
        : T("אם יש לך פטור מקורסי שפה, סמנו אותו.") });
  }
  // with the exemption from the English language courses ticked: two academic content courses in English, from the
  // program itself (guy, 2026-11-04; CHE: courses of the student's regular program). The other English levels have
  // rules of their own, not built yet
  if (hasSkill("english")) {
    const all = [...contentCourses()];
    const taken = all.filter((n) => plannedCourses().includes(n));
    steps.push(taken.length >= CONTENT_NEEDED
      ? { done: true, text: T`${CONTENT_NEEDED} קורסי תוכן באנגלית בתכנית` }
      : { done: false, text: T`ללמוד ${CONTENT_NEEDED} קורסי תוכן באנגלית (יש לך פטור מקורסי שפה)`, show: all.filter((n) => !taken.includes(n)),
        // the course numbers jump to the courses (guy, 2026-11-04)
        detail: all.length ? [T`בתכנית: ${taken.length} מתוך ${CONTENT_NEEDED}. בתואר שלך: `,
          ...all.filter((n) => !taken.includes(n)).flatMap((n, k) => [k ? ", " : "", numLink(n)])] : T("בתואר שלך אין קורסי תוכן באנגלית") });
  }
  return steps;
}

// placed courses that miss only required knowledge (no admission problem): allowed, but better completed first
function knowledgeOnly() {
  const bad = new Set(problems.filter((x) => x.level === "bad").map((x) => x.n));
  return [...new Set(problems.filter((x) => x.level === "warn" && !bad.has(x.n)).map((x) => x.n))];
}

// for the print summary: the placed courses that cannot be registered for, with what each lacks, or a ✓
function admissionLine() {
  if (!state.semesters.some((x) => x.length)) return null;
  const mk = (ok) => el("span", { class: `mk ${ok ? "ok" : "no"}`, text: ok ? "✓" : "✗" });
  const bad = new Map();
  problems.filter((x) => x.level === "bad").forEach((x) => bad.set(x.n, [...new Set([...(bad.get(x.n) || []), x.tag])]));
  if (!bad.size) return el("p", {}, mk(true), T(" כל הקורסים עומדים בתנאי הקבלה"));
  const list = [...bad].map(([n, tags]) => `${n} (${tags.join(", ")})`).join(", ");
  return el("p", {}, mk(false), " ", bad.size === 1 ? T`קורס 1 לא עומד בתנאי הקבלה: ${list}` : T`${bad.size} קורסים לא עומדים בתנאי הקבלה: ${list}`);
}
