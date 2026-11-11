"use strict";
// WINDOWS (DIALOGS)
// The course window (ⓘ, showInfo), the conditions window ("פירוט", showConditions), the background window, and
// the window after a fill. They share one <dialog id="info">.

// ---------- the shared window ----------

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

// ---------- the course window ----------

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
  // conditions that change from a known semester: the version of the semester the course is in (today's when it is
  // not in a semester), and the other one in a row of its own (guy, 2026-11-10)
  const fut = c.future;
  const usesNew = typeof where === "number" && usesFuture(c, semesterIds()[where]);
  const cv = usesNew ? { ...c, ...fut } : c;
  add(T("תנאי קבלה"), cv.admission && conditionList(cv.admission, planned, check("admission"), n));
  add(T("נ\"ז קודמים"), cv.priorCredits ? T`לפחות ${cv.priorCredits} נ"ז (${T(cv.priorField)})` : null);
  const extras = SKILLS.filter((s) => c[s.key]);
  add(T("דרישות נוספות"), extras.length ? el("span", {}, extras.map((s, k) => el("span", {}, k ? " · " : "", s.short, " ",
    hasSkill(s.id) ? el("span", { class: "mark yes", text: "✓" }) : el("span", { class: "tag need", text: s.optional ? T("לא סימנת פטור") : T("עוד לא סימנת") })))) : null);
  add(T("ידע קודם דרוש"), cv.required && conditionList(cv.required, planned, check("required"), n));
  add(T("ידע קודם מומלץ"), cv.recommended && conditionList(cv.recommended, planned, check("recommended"), n));
  if (fut) {
    const other = usesNew ? c : { ...c, ...fut };
    const none = el("span", { class: "muted", text: T("אין") });
    const sub = [];
    const put = (label, value) => sub.push(el("dt", { text: label }), el("dd", {}, value));
    if ("admission" in fut) put(T("תנאי קבלה"), other.admission ? conditionList(other.admission, planned, null, n) : none.cloneNode(true));
    if ("priorCredits" in fut) put(T("נ\"ז קודמים"), other.priorCredits ? T`לפחות ${other.priorCredits} נ"ז (${T(other.priorField)})` : none.cloneNode(true));
    if ("required" in fut) put(T("ידע קודם דרוש"), other.required ? conditionList(other.required, planned, null, n) : none.cloneNode(true));
    if ("recommended" in fut) put(T("ידע קודם מומלץ"), other.recommended ? conditionList(other.recommended, planned, null, n) : none.cloneNode(true));
    add(usesNew ? T`התנאים עד ${semName(prevSemester(fut.from))}` : T`התנאים מ-${semName(fut.from)}`, el("div", { class: "future-conds" },
      el("p", { class: "cond-note", text: usesNew
        ? T`הקורס משובץ ב-${semName(semesterIds()[where])}, ולכן למעלה מוצגים התנאים החדשים. כך היו התנאים שהשתנו לפני ${semName(fut.from)}:`
        : T`מסמסטר ${semName(fut.from)} התנאים של הקורס משתנים. מי שילמד אותו מאז, אלה התנאים שמשתנים (השאר כמו למעלה):` }),
      el("dl", {}, sub)));
  }
  // a program background requirement that this course accepts (guy, 2026-11-03: not every course in its field)
  backgroundsFor(n).forEach((b) => {
    if (coursesIn(b.courses).has(n)) return;
    const ticked = (state.background || []).includes(b.id);
    add(b.name, el("span", {}, b.explanation, " ", ticked ? el("span", { class: "tag ok", text: T("✓ סימנת שיש לך") }) : null));
  });
  const bgOf = backgroundFor(n);
  if (bgOf && bgOf.prep && DATA.courses[bgOf.prep] && !(state.background || []).includes(bgOf.id)) add(T("הכנה"), prepLine(bgOf));
  const prepFor = prepOf(n);
  if (prepFor && prepFor.prepTest) {
    const line = el("span", {},
      el("a", { href: prepFor.prepTest, target: "_blank", rel: "noopener", text: T("מבחן התאמה") }),
      T` (כשעה) ימליץ אם כדאי לך ללמוד את הסדנה לפני ${firstCourses(prepFor.courses).join(T(" או "))}.`);
    linkNumsIn(line);   // the course numbers jump to the courses, like every number in the window (guy, 2026-11-06)
    add(T("מבחן התאמה"), line);
  }
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
    typeof where === "number" && (cv.admission || cv.required || cv.recommended)
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

// ---------- the conditions window ----------

// the conditions of course n in semester i as a checklist: one row per condition, ✓ or ✗, alternatives listed under it
function showConditions(n, i) {
  reopenWindow = () => showConditions(n, i);
  const c = condsAt(n, i);
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
    // which version of the conditions (guy, 2026-11-10)
    c.future ? el("p", { class: "cond-note future-note", text: usesFuture(c, id)
      ? T`לפי התנאים החדשים של הקורס, שחלים מ-${semName(c.future.from)}.`
      : T`לפי התנאים הנוכחיים של הקורס. מ-${semName(c.future.from)} הם משתנים (ראו "כל פרטי הקורס").` }) : null,
    ...sections,
    el("p", {}, el("button", { type: "button", class: "link", "data-info": n, text: T("כל פרטי הקורס") })));
  if (!$("#info").open) $("#info").showModal();
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

// ---------- the background window ----------

function showBackground(id) {
  const b = program.background.find((x) => x.id === id);
  reopenWindow = () => showBackground(id);
  const replaced = coursesIn(b.courses);
  const mentions = (e) => [...coursesIn(e || "")].some((x) => replaced.has(x));
  const asking = Object.entries(DATA.courses)
    .filter(([n, c]) => !replaced.has(n) && c.offered !== false && (mentions(c.admission) || mentions(c.required)
      || (c.future && (mentions(c.future.admission) || mentions(c.future.required)))))
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

// ---------- after a fill: what is still left to do ----------

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


// Fills the semesters with the required courses the plan still lacks, around what the student already placed
// (nothing placed or done is moved). Rules: every admission and required-knowledge condition comes in an
// earlier semester; prior-credit conditions are met; each course only in a semester it is offered in; at most
// two courses in a summer; about the same load in every semester; no electives (the student chooses them).
