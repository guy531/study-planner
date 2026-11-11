"use strict";
// FILLING THE PLAN AUTOMATICALLY
// Two buttons: "מילוי לפי התכנית המומלצת" (fillRecommended: the program's recommended plan replaces the semesters)
// and "השלמה אוטומטית" (autoFill: the missing required courses are added around what the student placed).
// Both end in a window that says what is still left to do (windows.js: showStartWindow).

// ---------- the recommended plan ----------

// the recommended plans of the program by length in years (3, 4...)
function planLengths() {
  return [...new Set((program.recommended || []).map((r) => r.years))].sort();
}
// the length chosen next to the fill button (the only thing here read from the page)
const chosenLength = () => Number($("#plan-length").value) || planLengths()[0];

// fill the semesters from the program's recommended plan of `years` years. Electives are left to the student: the
// plan only says how many credits of them remain, not when to take them
function fillRecommended(years = chosenLength()) {
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

// ---------- automatic completion ----------

// The button: place what planAutoFill decided, then the window with what is still left to do
function autoFill() {
  const result = planAutoFill(chosenLength());
  if (!result) {
    toast(T("אין קורסי חובה שחסרים בתכנית. את קורסי הבחירה בוחרים בעצמכם, מהעץ."), 7000);
    return;
  }
  const { semesters, toPlace, remaining, target, parallel, endParallel, endStrict } = result;
  state.semesters = semesters;
  selected = null;
  save();
  render();
  const credits = (n) => (DATA.courses[n] || {}).credits || 0;
  const placed = toPlace.size - remaining.size;
  // a window like the one after the recommended fill (guy, 2026-11-03), instead of a message that went by itself:
  // what was placed, and what is still left to do, which here depends on the plan around it
  const notes = [T`כל מה שכבר היה בתכנית נשאר במקומו. בערך ${Math.round(target)} נ"ז בסמסטר.`];
  if (parallel) {
    const n = problems.filter((p) => p.level === "soft" && toPlace.has(p.n)).length; // only the courses added now
    notes.push(T`כדי לסיים ב-${semesterLabel(endParallel)} ולא ב-${semesterLabel(endStrict)}, ${n === 1 ? T("קורס 1 נלמד") : T`${n} קורסים נלמדים`} במקביל לידע הקודם שלהם (מסומנים "ידע קודם במקביל").`);
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

// The decision, without changing the plan or the page: which required courses to add and where. Returns null when
// nothing is missing, or { semesters (the new semesters), toPlace (the courses it adds), remaining (those it found no
// place for), target (credits per semester), parallel (some required knowledge in the same semester), and the
// last semester with and without that (endParallel, endStrict) }. years: the recommended plan to break ties with
function planAutoFill(years) {
  const usable = (n) => DATA.courses[n] && DATA.courses[n].offered !== false && !DATA.courses[n].notYet;
  const planned = new Set(plannedCourses());
  // courses a background requirement replaces are never added: ticked or not, the student decides about them
  const assumed = new Set();
  (program.background || []).forEach((b) => coursesIn(b.courses, assumed));
  // where the recommended plan puts a course (the plan length chosen next to the fill button): a tie-breaker
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
      const missingAdmission = need.filter((x) => latestConds(x).admission && !satisfied(latestConds(x).admission, known_)).length;
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
    add(choose(latestConds(n).admission, n));
    add(choose(latestConds(n).required));
  });
  const items = program.sections.flatMap((s) => s.groups.filter((g) => g.rule === "כל הפריטים")
    .flatMap((g) => g.items.filter((it) => it.courses && !isLongList(it.courses))));
  items.forEach((it) => add(choose(it.courses)));
  // then drop what nothing needs any more (guy, 2026-11-04: in KS the item took 20125, and 20497's required
  // knowledge, 20113 + 20114 only, brought those too, so 20125 was there for nothing): a course goes when every
  // required item and every condition that was met is still met without it; the bigger ones are tried first
  const metWith = (set) => {
    const all = new Set([...planned, ...set, ...assumed]);
    return { items: items.filter((it) => satisfied(it.courses, all)).length,
      conds: [...set].filter((n) => ["admission", "required"].every((k) => !latestConds(n)[k]
        || satisfied(latestConds(n)[k], k === "admission" ? forCourse(n, all, new Set([...planned, ...set])) : all))) };
  };
  const before = metWith(toPlace);
  const size = (n) => (DATA.courses[n] || {}).credits || 0;
  [...toPlace].sort((a, b) => size(b) - size(a)).forEach((x) => {
    const rest = new Set([...toPlace].filter((n) => n !== x));
    const now = metWith(rest);
    if (now.items === before.items && before.conds.filter((n) => rest.has(n)).every((n) => now.conds.includes(n))) toPlace.delete(x);
  });
  if (!toPlace.size) return null;

  // 2. order: a course that more of the remaining courses wait for goes first
  const deps = (n) => [...coursesIn(latestConds(n).admission || ""), ...coursesIn(latestConds(n).required || "")].filter((x) => toPlace.has(x));
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
  // can the required knowledge of n be met by courses that will really be in the plan (not the background)?
  const eventually = new Set([...state.done, ...state.semesters.flat(), ...toPlace]);
  const meetsForReal = (n, c) => satisfied(c.required, forCourse(n, new Set([...eventually, ...assumed]), eventually));

  // 4-5. one full scheduling run. parallel = false: required knowledge too must come in an earlier semester;
  // parallel = true: it may be in the same semester (as the recommended plan does with 20215 and 20406)
  const run = (parallel) => {
    const fitsAt = (n, i, plan, same = parallel) => {
      if (isBlockedSemester(i)) return false; // a semester the student blocked
      const c = condsFor(n, idsFor(i + 1)[i]);
      if (!c) return true;
      const real = new Set(state.done);
      plan.slice(0, i).forEach((x) => x.forEach((y) => real.add(y)));
      const have = new Set([...base, ...real]);
      if (c.semesters.length && !c.semesters.includes(idsFor(i + 1)[i].slice(4))) return false;
      if (afterLastOffer(c, idsFor(i + 1)[i]) || beforeFirstOffer(c, idsFor(i + 1)[i])) return false;
      if (c.admission && !satisfied(c.admission, forCourse(n, have, real))) return false;
      if (c.required) {
        const sameSem = same ? plan[i].filter((x) => x !== n) : [];
        const h = new Set([...have, ...sameSem]);
        // a condition the plan can meet with real courses waits for them; only one it cannot (20482: the foundations,
        // and its page says nothing about a matriculation) leans on the background, as "הנחתי שיש לך" (2026-11-11:
        // 20409 has 20213 + 20215 too, and was put in the first summer, before them, with a warning)
        if (!satisfied(c.required, meetsForReal(n, c) ? forCourse(n, h, new Set([...real, ...sameSem])) : h)) return false;
      }
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
        const late = x.reduce((a, n) => a + [...coursesIn((condsFor(n, idsFor(i + 1)[i]) || {}).recommended || "")]
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
  const parallel = loose.remaining.size < strict.remaining.size
    || (loose.remaining.size === strict.remaining.size && loose.last < strict.last);
  const { sems, remaining, target } = parallel ? loose : strict;
  return { semesters: sems, toPlace, remaining, target, parallel,
    endParallel: idsFor(loose.last + 1)[loose.last], endStrict: idsFor(strict.last + 1)[strict.last] };
}
