"use strict";
// COURSES: WHEN THEY ARE OFFERED AND WHAT THEY REQUIRE
// The rules of a single course: in which semesters it may be placed, its conditions (admission, required and
// recommended knowledge, prior credits), conditions that change from a given semester, and the high-school
// background that can stand for some courses. findProblems() lists every unmet condition in the plan.
// Pure logic: nothing here draws on the page (the texts go through T, for the messages that use them).

// ---------- when a course is offered ----------

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

// ---------- conditions, and conditions that change from a semester ----------

// Conditions that change from a known semester (guy, 2026-11-10: six courses, "החל מסמסטר ב2028"). c.future holds only
// the fields that change, from c.future.from on. condsFor(n, id): the course as it is in semester id, with the
// conditions that apply there; every check goes through it (or condsAt, by the plan's semester index)
const usesFuture = (c, id) => !!(c && c.future && id && semesterOrder(id) >= semesterOrder(c.future.from));

const condsFor = (n, id) => { const c = DATA.courses[n]; return usesFuture(c, id) ? { ...c, ...c.future } : c; };

const condsAt = (n, i) => (typeof i === "number" && i >= 0 ? condsFor(n, semesterIds()[i]) : DATA.courses[n]);

// before the semester is known (choosing what the auto-fill adds): the new conditions, which is what a student who
// starts now mostly meets; the placement itself checks the version of each semester
const latestConds = (n) => { const c = DATA.courses[n]; return c && c.future ? { ...c, ...c.future } : c; };

const CONDITIONS = [
  { key: "admission", level: "bad", tag: T("חסר תנאי קבלה"), label: T("תנאי קבלה") },
  { key: "required", level: "warn", tag: T("חסר ידע קודם דרוש"), label: T("ידע קודם דרוש") },
];

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

// ---------- the high-school background (a matriculation instead of courses) ----------

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

// a condition as a list a student can scan: one row per requirement, alternatives listed under "one of",
// and next to every course a control to find it or add it
// a background requirement (for example a 5-unit matriculation) that would meet this part of a condition:
// shown as one more alternative, with a button that ticks it
// the courses the student really has: "have" without the ones that only count because a background box is ticked
function withoutBackground(have) {
  const bg = backgroundCourses();
  return new Set([...have].filter((x) => !bg.has(x) || locationOf(x) !== null));
}

// ---------- what is taken before a semester, and what is missing ----------

// what is taken before semester i, for the conditions of course n (by default the course skipped)
function takenBefore(i, skip, n = skip) {
  const real = new Set(state.done);
  state.semesters.slice(0, i).forEach((s) => s.forEach((x) => real.add(x)));
  if (skip) real.delete(skip);
  const have = new Set([...real, ...backgroundCourses()]);
  if (skip) have.delete(skip);
  return n ? forCourse(n, have, real) : have;
}

// a "prior credits" condition of course n in semester i (for example 40 credits in physics before it): what the
// courses before it give in that field, after the overlap cuts among them, and whether it is short. The background
// courses a ticked box stands for give no credits. null when the course has no such condition (guy, 2026-11-01)
function priorCheck(n, i) {
  const c = condsAt(n, i);
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
      const c = condsAt(n, i);
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
