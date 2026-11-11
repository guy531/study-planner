"use strict";
// PRINT / PDF
// printPlan() asks first when the plan is not finished; buildPrint() builds the printed page (#print-sheet).

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
    const cv = typeof i === "number" ? condsAt(n, i) : c;
    const conds = [
      cv.admission && el("div", {}, el("b", { text: T("תנאי קבלה: ") }), printFormula(cv.admission, true, false, n)),
      cv.required && el("div", {}, el("b", { text: T("ידע קודם: ") }), printFormula(cv.required, true, false, n)),
      cv.priorCredits && el("div", { text: T`לפחות ${cv.priorCredits} נ"ז קודמים (${T(cv.priorField)})` }),
      c.future && i !== "done" && el("div", { class: "who", text: cv !== c ? T`לפי התנאים החדשים, מ-${semName(c.future.from)}`
        : T`מ-${semName(c.future.from)} התנאים משתנים` }),
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
            c.future && el("div", { class: "who", text: T`מ-${semName(c.future.from)} התנאים משתנים` }),
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
      if (s.optional) return { ok: hasSkill(s.id), text: s.short, note: hasSkill(s.id) ? T("סימנת שיש לך פטור מקורסי שפה")
        : need ? T`אין פטור מסומן, נדרש לפני ${semesterLabel(ids[need.courses[0].i])}` : T("אין פטור מסומן, דרישה כללית של התואר") };
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
  // always a draft (guy, 2026-11-04): even a finished plan needs the university's approval in Sheilta
  const draft = el("div", { class: "draft" }, ...(openSteps.length
    ? [el("strong", { text: T("טיוטה: התכנית עוד לא גמורה.") }), " ",
      T`נשארו ${openSteps.length === 1 ? T("צעד 1") : T`${openSteps.length} צעדים`}: ${openSteps.map((x) => x.text).join("; ")}.`,
      el("br"), ...APPROVAL()]
    : [el("strong", { text: T("טיוטה: התכנית כוללת את כל דרישות התואר, אבל אינה מאושרת.") }), " ", ...approvalFinal()]));
  const summary = el("div", { class: "summary" },
    el("div", {}, el("h3", { text: T("נקודות זכות") }), creditsTable),
    el("div", {},
      el("h3", { text: T("עוד חסר לתואר") }),
      todo.length
        ? el("ul", {}, todo.map((g) => el("li", {}, mark(false), " ", g.kind === "item" ? T`פריט חובה: ${g.text}` : g.text,
          g.where ? el("span", { class: "where", text: ` (${g.where})` }) : null)))
        : el("p", {}, mark(true), T(" כל פריטי החובה והבחירה בתכנית")),
      // the admission conditions of the placed courses, a line of their own (guy, 2026-11-04: "all the items are in
      // the plan" with a course that cannot be registered for read as too sure), and a gray note on required knowledge
      admissionLine(),
      knowledgeOnly().length ? el("p", { class: "where" }, "ⓘ ", T`${knowledgeText(knowledgeOnly())} (${knowledgeOnly().join(", ")})`) : null,
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
    // the title (the university logo that was on the left is off while the site is not approved: guy, 2026-11-08)
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
          text: T("פתיחת התכנית הזו בכלי התכנון, להמשך עבודה עליה") })))),
    // one box (guy, 2026-11-04: "חשוב" and "טיוטה" both said the plan is not approved): the draft, with the approval
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
