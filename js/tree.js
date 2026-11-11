"use strict";
// THE COURSE TREE (left side)
// The program's sections, groups and courses, shrinking as the plan fills; search in the tree; the courses outside
// the degree ("קורסים נוספים", the broadening list); and, on a phone, the tree as a layer over the page.

// ---------- the tree ----------

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
        ...(isBroadeningList(expr) ? broadeningParts(expr.or, (list) => el("ul", { class: "zone chips" }, list.map((n) => chip(n, "tree"))), "tree")
          : [el("ul", { class: "zone chips" }, expr.or.map((n) => chip(n, "tree")))])));
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

// The tree empties as the plan fills (guy): an item already met shrinks to one line with its courses and where
// they are (its other alternatives are gone), and a finished group shrinks to its heading, which opens on a
// click. The switch above the tree, or a search, shows everything in full
function renderTree() {
  const have = new Set(plannedCourses());
  const treeCourses = programCourses();
  const full = showPlaced || !!$("#tree-search").value.trim();
  // with the exemption ticked and fewer than two content courses in English in the plan, every list that holds an
  // unplaced one opens again, also a finished one, and a met item shows its options (guy, 2026-11-04)
  const content = contentCourses();
  const contentShort = hasSkill("english") ? Math.max(0, CONTENT_NEEDED - [...content].filter((n) => have.has(n)).length) : 0;
  const contentLeft = new Set(contentShort ? [...content].filter((n) => !have.has(n) && DATA.courses[n].offered !== false && !DATA.courses[n].notYet) : []);
  const holdsContent = (expr) => !!expr && [...coursesIn(expr)].some((n) => contentLeft.has(n));
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
    // met: shrunk to one line, which opens to the whole choice like a finished group (guy, 2026-11-04)
    const body = ok && !full
      ? el("details", { class: "item ok compact basics-done", id: `item-${id}`, "data-group": id, open: openGroups.has(id) },
        el("summary", {},
          el("div", { class: "ih" }, el("span", { text: plainCourses(b.courses) }), el("span", { class: "mark", text: "✓" })),
          el("div", { class: "placed-list" }, [...coursesIn(b.courses)].filter((n) => have.has(n)).map((n, k) => el("span", {}, k ? ", " : "",
            el("span", { class: "num", text: n }), " ", placeButton(n))))),
        renderExpr(b.courses, have))
      : el("div", { class: `item${ok ? " ok" : ""}`, id: `item-${id}` }, renderExpr(b.courses, have));
    const prep = !ok && b.prep && DATA.courses[b.prep] ? el("div", { class: "item prep" },
      el("div", { class: "ih" }, el("span", { text: T("הכנה, לא חובה") })),
      el("ul", { class: "zone chips" }, chip(b.prep, "tree")),
      el("p", { class: "desc" }, prepLine(b))) : null;
    return el("div", { class: "section basics", id: `group-${id}` },
      // a formal title, the details under it (guy, 2026-11-08; was "במקום בגרות (רק למי שצריך)")
      el("h3", { text: T(`עמידה בדרישות ה${b.name_he || b.name}`) }),
      el("div", { class: "desc", text: T`הדרישה: ${backgroundWhat(b)} - מקנה פטור מן הקורסים המופיעים למטה. ניתן לסמן את הפטור ב"רקע ודרישות". מי שאינו עומד בדרישה מחויב בקורסים הבאים:` }),
      body, prep); // the courses right after "...בקורסים הבאים:", the optional workshop under them (guy, 2026-11-08)
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
            T`${p.label} ל-${p.n}: `, el("span", { class: `dot ${p.level}`, text: DOT[p.level] }),
            k === 1 ? T(" אחת מהאפשרויות המסומנות") : T` לפחות ${k} מהאפשרויות המסומנות`,
            `, ${deadline(p.i)}`, hint ? ` · ${hint}` : "");
        });
        if (ok && !full && !holdsContent(item.courses)) {
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
      if (finished && group.items.some((it) => holdsContent(it.courses))) {
        return el("div", { class: "group", id: `group-${group.id}` },
          el("div", { class: "gh" }, el("span", { text: group.name }), el("span", { class: "rule done-mark", text: `✓ ${progress}` })),
          el("div", { class: "rule", text: T`${rule}. יש כאן קורסי תוכן באנגלית, ועוד חסרים לך ${contentShort} כאלה.` }),
          items);
      }
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
      // a formal title, the box and details under it (guy, 2026-11-08), as at the top of the tree
      el("p", { class: "bg-title", text: T(`עמידה בדרישות ה${b.name_he || b.name}`) }),
      el("label", { class: `check${viaCourses ? " auto" : ""}`,
        title: viaCourses ? T("יש לך בגרות כזו? לחיצה מסמנת אותה, ואז הקורסים האלה לא נדרשים ממך.") : null },
        el("input", { type: "checkbox", "data-background": b.id, checked: ticked || viaCourses, class: viaCourses ? "auto" : null }),
        el("span", {}, b.checkbox, " ", el("button", { type: "button", class: "link", "data-background-info": b.id, text: T("הסבר") }))),
      // ticked: nothing to explain; otherwise either the courses are already in the plan, or where to find them
      ticked ? null : el("p", { class: `bg-note${viaCourses ? " ok" : ""}` }, linkNums(viaCourses
        ? T`✓ ${plainCourses((b.courses.or || [b.courses]).find((p) => satisfied(p, planned)))} בתכנית שלך, ולכן הדרישה מתקיימת.`
        : T`אפשר לעמוד בדרישה גם בקורסים: ${plainCourses(b.courses).replace(" + ", T(" ו-"))} (בראש העץ).`)),
      ticked || viaCourses || !b.prep || !DATA.courses[b.prep] ? null : el("p", { class: "bg-note" }, prepLine(b)));
  }));
}

// ---------- search ----------

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
// what a course's tags say, searched with its name (guy, 2026-11-04: "תוכן באנגלית" finds the content courses).
// Without the word "קורס", which every course would then match
function tagWords(n) {
  const c = DATA.courses[n] || {};
  // in Hebrew and in the site's language, so both find it
  // the levels of its credits too (guy, 2026-11-04): "פתיחה", "רגילה", "מתקדמת" (and the plural, as on the card)
  const parts = levelParts(c);
  const words = [contentCourses().has(n) && "תוכן באנגלית", c.seminar === "חובה" && "סמינריוני",
    ((c.broadening && c.broadening !== "מדעים") || programBroadening(n)) && "מרחיב-דעת",
    parts && parts.opening && "פתיחה", parts && parts.regular && "רגילה רגילות", parts && parts.advanced && "מתקדמת מתקדמות"].filter(Boolean);
  return [...words, ...(LANG === "he" ? [] : words.map((w) => T(w)))].join(" ");
}

function searchScore(n, words) {
  const nameWords = searchText(`${courseName(n)} ${tagWords(n)}`).split(" ");
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
  // an option of one course is a box of its own (a zone, with a minimum height): an empty one left a gap (guy, 2026-11-04)
  hideEmpty(".zone.chips");
  hideEmpty(".broad-part");
  hideEmpty(".alt");
  hideEmpty(".choice");
  tree.querySelectorAll(".long-list details").forEach((d) => { if (d.querySelector(".chip:not(.f-hide)")) d.open = true; });
  hideEmpty(".item");
  hideEmpty(".group");
  hideEmpty(".section");
  $("#tree-empty").hidden = !!tree.querySelector(".chip:not(.f-hide)") || !!outside.length;
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
  document.addEventListener("toggle", (e) => {
    const part = e.target.dataset && e.target.dataset.part;
    if (part) { if (e.target.open) openParts.add(part); else openParts.delete(part); }
  }, true);
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

// ---------- outside the degree ----------

// the broadening-courses list of another program (CB), folded under the tree of every program that does not have it,
// so any student can look through it and drag one, like a search result (guy, 2026-10-31). The texts name it, and say
// nothing of CB's own rule, which does not apply here (guy). Only this list: other long lists (EL's 27 computer
// science seminars and workshops) belong to their own program and showed up here by mistake (guy)
let listsOpen = new Set();

function renderLists() {
  const shown = otherLists();
  $("#lists").replaceChildren(...shown.map(([key, l]) =>
    el("details", { class: "lists-block", "data-list": key, ...(listsOpen.has(key) ? { open: "" } : {}) },
      el("summary", { text: T`קורסים מרחיבי-דעת (${l.courses.length})` }),
      el("p", { class: "hint" }, T("מותר ללמוד גם קורסים מרחיבי-דעת. זו לא דרישה של התואר שלך. גוררים קורס לסמסטר, והוא נשמר ב\"קורסים נוספים\"."), " ", whatBroadening()),
      ...(listsOpen.has(key) ? broadeningParts(l.courses, (list) => el("ul", { class: "outside-list" }, list.map((n) => chip(n, "outside"))), "outside") : []))));
}

function renderExtra() {
  const zone = $("#extra");
  zone.dataset.empty = T("קורס שאינו חלק מהתואר: מחפשים אותו בחיפוש שבראש העץ וגוררים לכאן");
  // a course the tree already shows (kept here before keepOutside knew of "במקום בגרות") is not shown twice
  const shown = treeShows();
  zone.replaceChildren(...state.extra.filter((n) => !shown.has(n)).map((n) => chip(n, "extra")));
}

// a course from the search results outside the degree is kept in "קורסים נוספים" wherever it is dropped, so taking
// it out of a semester later leaves it in the tree instead of losing it
function keepOutside(n) {
  // not a course the tree shows anyway, like 20125 in "במקום בגרות" (guy, 2026-11-04)
  if (DATA.courses[n] && !treeShows().has(n) && !state.extra.includes(n)) state.extra.push(n);
}

// ---------- jumping to a course in the tree ----------

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
  // every folded box around the card (a broadening part sits inside the folded list; guy, 2026-11-08)
  chips.forEach((c) => { for (let d = c.closest("details"); d; d = d.parentElement.closest("details")) d.open = true; });
  if (chips.length && treeIsLayer()) setTreeOpen(!!chips[0].closest(".tree"));
  if (!chips.length) {
    toast(T`${wanted.join(", ")} לא נמצאים בעץ, כי הם לא חלק מהתכנית. אפשר להוסיף אותם ל"קורסים נוספים" בכפתור שליד הקורס, או בחיפוש שבראש העץ.`);
    return;
  }
  // a card in the tree beside the plan (not a phone's layer): only the tree scrolls, the page stays where it is (guy,
  // 2026-11-04: a click on a number in a semester scrolled the plan down too)
  const tree = chips[0].closest(".tree");
  if (tree && !treeIsLayer()) {
    const r = chips[0].getBoundingClientRect(), t = tree.getBoundingClientRect();
    tree.scrollBy({ top: r.top - t.top - (t.height - r.height) / 2, behavior: SMOOTH() });
  } else chips[0].scrollIntoView({ behavior: SMOOTH(), block: "center" });
  if (flash) chips.forEach((c) => { c.classList.add("flash"); setTimeout(() => c.classList.remove("flash"), 2400); });
}

// ---------- the tree on a phone ----------

// phones: the tree is a full-screen layer, opened by the floating button
function setTreeOpen(open) {
  document.body.classList.toggle("tree-open", open);
}

const treeIsLayer = () => matchMedia("(max-width: 900px)").matches;
