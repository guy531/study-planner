"use strict";
// DRAWING THE PLAN
// render() draws the page again from `state` after every change, keeping the scroll position and the focus.
// This file draws the plan column (right side): the status card ("התכנית עוד לא גמורה"), the credit counters, the
// floating summary bar, "רקע ודרישות", "קורסים שכבר עשיתי" and the semesters. The tree is in tree.js.

// ---------- render: draw everything again, without the page jumping ----------

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
  armBoxes();
  // one line: the "+ שיבוץ כאן" buttons explain themselves; the how-to is left for a screen reader, which does not see them
  if (selected !== null) $("#pick-text").replaceChildren(T`נבחר: ${selected} ${courseName(selected)}`,
    el("span", { class: "sr-only", text: T(". לוחצים על \"שיבוץ כאן\" בסמסטר, או על קורס אחר כדי לבחור אותו.") }));
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

// with a course picked, a button in the head of each place it can go
function putHere(zone) {
  if (selected === null || zone.classList.contains("no-drop")) return null;
  return el("button", { type: "button", class: "put-here", text: T("+ שיבוץ כאן") });
}

// ---------- the status card and its steps ----------

const knowledgeText = (list) => (list.length === 1 ? T("בקורס 1 חסר ידע קודם דרוש. ניתן להירשם, אבל מומלץ להשלים את הידע לפני.")
  : T`ב-${list.length} קורסים חסר ידע קודם דרוש. ניתן להירשם, אבל מומלץ להשלים את הידע לפני.`);

const knowledgeNote = (list) => (list.length ? el("p", { class: "knowledge-note" }, el("span", { class: "mark", "aria-hidden": "true", text: "ⓘ" }), " ",
  knowledgeText(list), " ", el("button", { type: "button", class: "link", "data-show-turn": list.join(",") }, eyeIcon(), T("הצגה"))) : null);

function renderStatus() {
  const steps = planSteps();
  const open = steps.filter((x) => !x.done);
  const box = $("#status");
  const knowledge = knowledgeOnly();
  if (!open.length) {
    box.className = "status done";
    box.replaceChildren(el("span", { class: "big", text: "✓" }),
      el("span", {}, el("strong", { text: T("התכנית כוללת את כל דרישות התואר") }), T(", וכל הקורסים בה עומדים בתנאי הקבלה שלהם."),
        el("span", { class: "next" }, approvalFinal()), knowledgeNote(knowledge)));
    return;
  }
  box.className = "status todo";
  box.replaceChildren(
    el("div", { class: "steps-head" }, el("strong", { text: T("התכנית עוד לא גמורה") }), " ",
      el("span", { text: open.length === 1 ? T("נשאר צעד 1") : T`נשארו ${open.length} צעדים` })),
    stepsList(steps),
    knowledgeNote(knowledge) || "");
}

// "הצגה" over several courses shows one at a time: each click the next (guy, 2026-11-04: it always showed the first)
const showNext = new Map();

function showInTurn(list) {
  if (!list.length) return;
  const key = list.join(",");
  const i = (showNext.get(key) || 0) % list.length;
  showNext.set(key, i + 1);
  flashInTree([list[i]]);
  if (list.length > 1) announce(T`${list[i]} (${i + 1} מתוך ${list.length})`);
}

function stepsList(steps) {
  return el("ol", { class: "steps" }, steps.map((x) => el("li", { class: x.done ? "done" : "open" },
      el("span", { class: "mark", "aria-label": x.done ? T("בוצע") : T("עוד לא"), text: x.done ? "✓" : "○" }),
      el("div", {},
        el("span", { class: "step-text", text: x.text }),
        x.problems ? el("span", {}, " ", el("button", { type: "button", class: "link show-problem" }, eyeIcon(), T("הצגה"))) : null,
        x.target ? el("span", {}, " ", el("button", { type: "button", class: "link", "data-goto": x.target, text: T("סימון") })) : null,
        x.show && x.show.length ? el("span", {}, " ", el("button", { type: "button", class: "link", "data-show-turn": x.show.join(",") }, eyeIcon(), T("הצגה"))) : null,
        x.detail ? el("div", { class: "step-sub" }, linkNums(x.detail)) : null,
        // a few gaps inline; many (an empty plan has some 20 required courses) folded under "הצגה"
        x.subs && x.subs.length <= 4 ? el("div", { class: "step-sub" }, x.subs.flatMap((g, k) => [k ? " · " : null, gapLink(g)])) : null,
        x.subs && x.subs.length > 4 ? el("details", { class: "step-sub" }, el("summary", { text: T`הצגת ${x.subs.length} הפריטים` }),
          el("ul", {}, x.subs.map((g) => el("li", {}, gapLink(g), g.where ? el("span", { class: "where", text: ` (${g.where})` }) : null)))) : null,
        x.hint ? el("div", { class: "step-sub hint" }, linkNums(x.hint)) : null))));
}

// ---------- the credit counters and the floating summary ----------

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
    // "at most" (M8, KS): within it, green with ✓ like a met counter; over it, red with ✗ (guy, 2026-11-04)
    ...caps.map(([label, value, max]) => el("div", { class: `meter cap${value > max ? " over" : " full"}` },
      el("div", { class: "label", text: capital(label) }),
      el("div", { class: "value" }, el("span", { dir: "ltr" }, el("small", { text: `${value} / ` }), String(max)), el("small", { class: "at-most", text: T(" לכל היותר") })),
      el("div", { class: "bar" }, el("span", { style: `width:${Math.min(100, (value / max) * 100)}%` })))),
    el("p", { class: "meters-note", text: meterNote() }));
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
  // the panel above the bar: the steps, as in the status card, while open
  const panel = $("#mini-panel");
  // green like the bar when nothing is left (guy, 2026-11-04)
  panel.classList.toggle("done", done);
  if (!panel.hidden) panel.replaceChildren(
    el("div", { class: "steps-head" }, el("strong", { text: done ? T("✓ כל דרישות התואר בתכנית") : T("התכנית עוד לא גמורה") }),
      done ? null : el("span", { text: ` ${leftText}` }),
      el("button", { type: "button", class: "mini-close", "aria-label": T("סגירה"), title: T("סגירה"), text: "×" })),
    stepsList(planSteps()), knowledgeNote(knowledgeOnly()) || "");
  // an arrow at the start says the bar opens (▴) and, while open, closes (▾) (guy, 2026-11-04)
  box.replaceChildren(
    el("span", { class: "mini-chev", "aria-hidden": "true", text: panel.hidden ? "▴" : "▾" }),
    el("span", { class: "mini-head" }, done ? el("strong", { text: T("✓ כל דרישות התואר בתכנית") })
      : [el("span", { class: "l", text: T("התכנית עוד לא גמורה") }), el("strong", { text: leftText })]),
    ...creditTotals().map(([label, value, target]) => el("span", { class: `mini-meter${target && value >= target ? " full" : ""}` },
      el("span", { class: "l", text: capital(label) }),
      el("span", { class: "v" }, target ? el("span", { dir: "ltr" }, `${value} / `, el("strong", { text: String(target) })) : el("strong", { text: String(value) })),
      el("span", { class: "bar" }, el("span", { style: `width:${target ? Math.min(100, (value / target) * 100) : 0}%` })))),
    el("span", { class: "mini-short", text: done ? T("✓ כל דרישות התואר בתכנית")
      : [leftText, total ? T`חסר ${total.credits} נ"ז` : null].filter(Boolean).join(" · ") }));
}

// shown once the counters are above the screen (not while they are in sight); checked on scroll, on resize and after
// every render
function placeMini() {
  const above = $("#meters").getBoundingClientRect().bottom < 0;
  if ($("#mini-wrap").hidden === !above) return;
  $("#mini-wrap").hidden = !above;
  if (!above) setMiniOpen(false);
  document.body.classList.toggle("mini-on", above);
}

function setupMini() {
  // capture: also a scroll of any box inside the page, not only of the page itself
  document.addEventListener("scroll", placeMini, { passive: true, capture: true });
  addEventListener("resize", placeMini);
  // a click opens the steps above the bar, a second one closes them (guy, 2026-11-04: scrolling up was annoying)
  $("#mini-status").addEventListener("click", () => setMiniOpen($("#mini-panel").hidden));
  $("#mini-panel").addEventListener("click", (e) => { if (e.target.closest(".mini-close")) setMiniOpen(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#mini-panel").hidden) setMiniOpen(false); });
}

function setMiniOpen(open) {
  $("#mini-panel").hidden = !open;
  $("#mini-status").setAttribute("aria-expanded", open ? "true" : "false");
  $("#mini-wrap").classList.toggle("open", open);
  renderMini();
}

// ---------- warnings, background and requirements ----------

// only what stops a registration (guy, 2026-11-04: an orange bar for missing required knowledge alone scared
// students; the gray note in the status card says it)
function renderProblems() {
  const bad = new Set(problems.filter((p) => p.level === "bad").map((p) => p.n));
  const box = $("#problems");
  box.hidden = !bad.size;
  if (!bad.size) return;
  box.className = "problems bad";
  box.replaceChildren(el("span", { text: T`בתכנית: ${bad.size === 1 ? T("קורס 1 לא עומד בתנאי הקבלה") : T`${bad.size} קורסים לא עומדים בתנאי הקבלה`}.` }),
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
      // each requirement under a title of its own, so the background's title does not read as theirs too (guy, 2026-11-08)
      el("p", { class: "bg-title", text: s.title }),
      el("label", { class: "check" },
        el("input", { type: "checkbox", "data-skill": s.id, checked: hasSkill(s.id) }),
        // the link inside the text, so a long text wraps beside the checkbox and not under it (guy, 2026-11-01: phone)
        el("span", {}, s.checkbox, " ", el("a", { href: s.link, target: "_blank", rel: "noopener", class: "muted", text: T("מה זה? ↗") }))),
      s.optional && !hasSkill(s.id) ? el("p", { class: "need-line" }, linkNums([T("לא חובה. אם יש לך פטור, סמנו אותו."),
        need ? T`בלי פטור, צריך לעמוד בדרישות האנגלית לפני ${semesterLabel(ids[need.courses[0].i])}, בשביל ${fewCourses(need.courses.map((x) => x.n))}.` : "",
      ].filter(Boolean).join(" ")))
      : need || (degreeAsks(s) && !hasSkill(s.id)) ? el("p", { class: "need-line" }, linkNums([
        degreeAsks(s) ? T("דרישה כללית של התואר.") : "",
        need ? T`נדרש לפני ${semesterLabel(ids[need.courses[0].i])}, בשביל ${fewCourses(need.courses.map((x) => x.n))}.` : "",
      ].filter(Boolean).join(" "))) : null);
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
  // the exemption is not a must: it does not hold the card open, and folded it reads "✓ פטור מאנגלית" or "בלי פטור מאנגלית"
  const skills = SKILLS.filter((s) => $(`#skills [data-skill='${s.id}']`)).map((s) => (s.optional
    ? { text: hasSkill(s.id) ? T("פטור מאנגלית") : T("בלי פטור מאנגלית"), ok: true, bare: !hasSkill(s.id) }
    : { text: s.short, ok: hasSkill(s.id) }));
  const all = [...bg, ...skills];
  card.hidden = !all.length;
  $("#prereq-sum").textContent = all.map((x) => (x.bare ? x.text : `${x.ok ? "✓" : "○"} ${x.text}`)).join(" · ");
  const done = all.every((x) => x.ok);
  if (done !== prereqDone) card.open = !done;
  prereqDone = done;
}

// ---------- courses already done, and the semesters ----------

function renderDone() {
  const zone = $("#done");
  zone.dataset.empty = T("גוררים לכאן קורסים שכבר סיימתם");
  zone.replaceChildren(...state.done.map((n) => chip(n, "done")));
  const credits = state.done.reduce((s, n) => s + ((DATA.courses[n] || {}).credits || 0), 0);
  $("#done-sum").textContent = state.done.length ? T`${credits} נ"ז` : "";
  $("#clear-done").hidden = !state.done.some((n) => !isLocked(n));
  $("#clear-semesters").hidden = !state.semesters.flat().some((n) => !isLocked(n));
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
