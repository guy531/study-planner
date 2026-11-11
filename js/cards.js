"use strict";
// SMALL PIECES OF THE PAGE
// Building elements (el), the course card (chip) that appears in the tree, the semesters and "עשיתי", course
// numbers that jump to the course (numLink, courseLink), icons, short texts, and the messages at the bottom (toast).

// ---------- building elements ----------

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

function announce(text) {
  const box = $("#announce");
  box.textContent = "";
  setTimeout(() => { box.textContent = text; }, 50); // a change the screen reader notices even for the same text
}

// ---------- icons ----------

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

// a trash-can icon (not an ×, which the course cards inside already use) for removing the last semester
const TRASH_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>';

function trashButton(id) {
  const b = el("button", { type: "button", class: "remove-semester", id: "remove-semester",
    title: T("הסרת הסמסטר (אפשר להסיר רק את הסמסטר האחרון)"), "aria-label": T`הסרת סמסטר ${semesterLabel(id)}` });
  b.innerHTML = TRASH_ICON;
  return b;
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

// an option for a missing condition: a circle for admission, a diamond for required knowledge, so the two differ
// by shape and not only by red and orange (color blindness; guy, 2026-11-08)
const DOT = { bad: "●", warn: "◆" };

// ---------- course names, credits and conditions as text ----------

function courseName(n) {
  return DATA.courses[n] ? DATA.courses[n].name : T("(קורס לא מוכר)");
}

// the credits of a course by level: opening, regular and advanced (guy, 2026-11-04: some programs count opening
// credits, KS and M8). A course without a known level (no catalog page) shows its credits only
function levelParts(c) {
  if (!c || !c.credits || !c.level) return null;
  const opening = c.level === "פתיחה" ? c.credits : c.opening || 0;
  const advanced = c.level === "מתקדמת" ? c.credits : c.advanced || 0;
  return { opening, regular: Math.max(0, c.credits - opening - advanced), advanced };
}

function creditsText(c) {
  if (!c || c.credits === null) return "";
  const parts = levelParts(c);
  if (!parts) return T`${c.credits} נ"ז`;
  const named = [[parts.opening, T("פתיחה")], [parts.regular, T("רגילות")], [parts.advanced, T("מתקדמות")]].filter(([x]) => x);
  // one level: "4 נ"ז רגילות"; two: "6 נ"ז: 3 פתיחה + 3 רגילות"
  return named.length === 1 ? T`${c.credits} נ"ז ${named[0][1]}` : T`${c.credits} נ"ז: ${named.map(([x, w]) => `${x} ${w}`).join(" + ")}`;
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
// the course a student starts with in each alternative: "20125 | (20113; 20114)" -> 20125, 20113
// (the workshop comes before the first course, not before 20114; guy, 2026-11-07)
function firstCourses(expr) {
  if (typeof expr === "string") return [expr];
  if (expr.and) return firstCourses(expr.and[0]);
  if (expr.or) return expr.or.flatMap(firstCourses);
  return [];
}

function plainCourses(expr) {
  if (typeof expr === "string") return expr;
  if (expr.and) return expr.and.map(plainCourses).join(" + ");
  if (expr.or) return expr.or.map(plainCourses).join(T(", או "));
  return T`${expr.atleast} מתוך ${expr.of.map(plainCourses).join(", ")}`;
}

// "דרוש", not "דורש" (guy, 2026-11-01)
const skillsTag = (list) => T`דרוש: ${list.map((s) => s.short).join(T(" ו"))}`;

// "לא בטוחים שאתם מוכנים ...? מבחן התאמה (כשעה) ימליץ אם כדאי ללמוד קודם את 91463 סדנת הכנה בפיסיקה (ללא נ"ז)."
// guy's words (2026-11-03): what the workshop is, and the test that says whether to take it
function prepLine(b) {
  return el("span", { class: "prep-line" }, T("קורס הקדמה ליסודות הפיסיקה לסטודנטים בלי רקע בפיסיקה. "),
    b.prepTest ? [T("בצעו את "), el("a", { href: b.prepTest, target: "_blank", rel: "noopener", text: T("מבחן ההתאמה") }),
      T(" ובדקו אם כדאי לכם להירשם לסדנה.")] : null);
}

// the head of a semester or of "done": how many courses and their credits, "3 קורסים · 20 נ"ז" (guy, 2026-11-11);
// the full credits, before overlap cuts, since it shows how much there is to study. Empty for an empty list
function sumText(list) {
  if (!list.length) return "";
  const credits = list.reduce((s, n) => s + ((DATA.courses[n] || {}).credits || 0), 0);
  return `${list.length === 1 ? T("קורס 1") : T`${list.length} קורסים`} · ${T`${credits} נ"ז`}`;
}

// ---------- course numbers that jump to the course ----------

// a course number in a window (conditions, overlaps...) jumps to the course where it is now, in the plan or in the
// tree, and flashes it, like the eye buttons (guy, 2026-11-01). A course that is nowhere on the page stays plain text
// a course that is nowhere on the page yet but is offered: a click adds it to "קורסים נוספים" and jumps there
// (guy, 2026-11-03: instead of a separate "+ הוספה" button)
const onPage = (n) => locationOf(n) !== null || treeShows().has(n) || state.extra.includes(n);

const canAdd = (n) => DATA.courses[n] && DATA.courses[n].offered !== false;

// a text with course numbers in it: every number of a course of ours a button that jumps to it (guy, 2026-11-04:
// numbers in a line like this should always be clickable)
const linkNums = (t) => (typeof t !== "string" ? t
  : t.split(/(\d{5})/).map((p, k) => (k % 2 && DATA.courses[p] ? numLink(p) : p)).filter((p) => p !== ""));

// the same inside an element already built: its text, not what is already in a button or a link
function linkNumsIn(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let t = walk.nextNode(); t; t = walk.nextNode()) if (/\d{5}/.test(t.data) && !t.parentNode.closest("button, a")) texts.push(t);
  texts.forEach((t) => t.replaceWith(...linkNums(t.data)));
}

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

// a gap as a link into the tree (or plain text), for the steps
const gapLink = (g) => (g.target ? el("button", { type: "button", class: "link", "data-goto": g.target, text: g.text }) : el("span", { text: g.text }));

// ---------- the course card ----------

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
  // a content course in English that counts here, once the exemption is ticked (guy, 2026-11-04: only then, and
  // only on the courses that count)
  if (context !== "outside" && hasSkill("english") && contentCourses().has(n)) tags.push(el("span", { class: "tag content-english", title: T("נספר בשני קורסי התוכן באנגלית שנדרשים ממי שיש לו פטור מקורסי שפה באנגלית"), text: T("קורס תוכן באנגלית") }));
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
    const cv = condsAt(n, context);
    if (!own.length && cv && (cv.admission || cv.required || cv.recommended || cv.priorCredits)) {
      tags.push(el("button", { type: "button", class: "link cond-link", "data-cond": `${n}|${context}`, text: T("תנאים") }));
    }
    // one short line per condition, naming what is missing in short (guy, 2026-10-29); the full checklist opens in a window
    own.forEach((p) => {
      const same = new Set([...p.have, ...state.semesters[context]]);
      const open = p.parts.filter((e) => !satisfied(e, p.have));
      const missing = fewCourses((p.level === "soft" ? open : open.filter((e) => !satisfied(e, same))).map(shortPart));
      notes.push(el("div", { class: `why ${p.level}` },
        // which course is studied in the same semester (guy, 2026-11-04: the line did not say)
        p.level === "soft" ? T("ידע קודם במקביל: ") + state.semesters[context].filter((x) => x !== n && open.some((e) => coursesIn(e).has(x))).join(", ") + " "
          : p.key === "prior" ? priorText(p.prior) + " "
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
        head.prepend(el("span", { class: `dot ${level}`, "aria-label": T`אפשרות לתנאי של ${options.map((p) => p.n).join(", ")}`, text: DOT[level] }));
      }
    }
  }
  // conditions that change from a known semester: said on the card in the tree, before it is placed (guy, 2026-11-10)
  if (inTree && !placed && c && c.future && c.offered !== false) {
    notes.push(el("div", { class: "why soft", text: T`התנאים של הקורס משתנים מ-${semName(c.future.from)}` }));
  }
  // a course whose credits an overlap cuts (in a semester or in "done"): what it counts, and with which course
  const cutLine = (typeof context === "number" || context === "done") ? overlapLine(n) : null;
  if (cutLine) {
    tags.push(el("span", { class: `tag ${cutLine.level === "bad" ? "bad" : "soft"}`, text: cutLine.level === "bad" ? T("אסור יחד") : T`נספרים ${counted(n)} נ"ז` }));
    notes.push(el("div", { class: `why ${cutLine.level}` }, cutLine.text + " ",
      el("button", { type: "button", class: "link", "data-info": n, text: T("פירוט") })));
  }
  // not placed yet: what an overlap with a course in the plan would do (guy, 2026-11-04)
  const willCut = cutLine ? null : wouldOverlap(n);
  if (willCut) {
    notes.push(el("div", { class: `why ${willCut.level}` }, willCut.text + " ",
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
    // a course outside the degree (search results, the broadening list): "+" keeps it in "קורסים נוספים" without
    // dragging it to the tree it is already in (guy, 2026-11-04)
    context === "outside" && !state.extra.includes(n)
      ? el("button", { type: "button", class: "add", "data-add-show": n, title: T("הוספה ל\"קורסים נוספים\""), "aria-label": T("הוספה ל\"קורסים נוספים\""), text: "+" })
      : null,
    el("button", { type: "button", class: "i", "data-info": n, "aria-label": T("פרטי הקורס"), text: "ⓘ" }),
    (!inTree || context === "extra") && !(lockable && isLocked(n))
      ? el("button", { type: "button", class: "x", "data-remove": n, "data-from": context === "extra" ? "extra" : "plan", "aria-label": T("הסרה"), text: "×" })
      : null));
  // the course numbers in the lines under the card jump to those courses (guy, 2026-11-04)
  notes.forEach(linkNumsIn);
  node.append(head, el("div", { class: "chip-tags" }, tags), ...notes);
  // what a screen reader says on reaching the card: number, name, credits and tags (not the buttons in it)
  if (!placed) node.setAttribute("aria-label", [n, courseName(n), ...tags.filter((t) => t.tagName === "SPAN").map((t) => t.textContent)].join(", "));
  return node;
}

// ---------- links to pages of the university ----------

// where to choose free electives: the catalog's list (guy, 2026-11-11)
const FREE_CHOICE_PAGE = "https://www3.openu.ac.il/ouweb/owal/yed.marchiv_daat";

// ---------- the approval note (שאילתא) ----------

// above the meters: green when the plan is a whole degree, otherwise "התכנית עוד לא גמורה" and the steps
// a plan built here is not an approved plan (guy, 2026-11-03: students must not think it is): the same words on the
// page, in the print and share windows and on the print page
// "מערכת השאילתא" links to Sheilta (guy, 2026-11-03), also in a saved PDF of the print page
const SHEILTA = "https://sheilta.apps.openu.ac.il/pls/dmyopt2/sheilta.main";

const sheiltaLink = () => el("a", { href: SHEILTA, target: "_blank", rel: "noopener", text: T("מערכת השאילתא") });

const approvalFinal = () => [T("אישור תכנית לימודים סופית מתקבל רק דרך "), sheiltaLink(), "."];

const APPROVAL = () => [T("תכנית שבונים כאן אינה מאושרת. "), ...approvalFinal()];

const approvalNote = () => el("p", { class: "approval" }, el("strong", { text: T("חשוב: ") }), APPROVAL());
