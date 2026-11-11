"use strict";
// THE KEYBOARD (accessibility)
// Enter on a course card picks it and moves the focus to the semesters; the arrows go between them, Enter places it
// there. The "לאן להעביר" window lists every place, for the button in the course window and for phones.

// ---------- the "where to?" window ----------

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

// ---------- placing a course with the arrows ----------

// Enter (or space) on a card picks it, as a click does, and the focus goes to the places it can go: "done" and the
// semesters, colored by its conditions as while dragging. The arrows move between them by their position on the
// screen (so right and left follow the page, in Hebrew and in English, and a phone's single column too), Enter puts
// the course there, Esc or Tab gives up and the focus goes back to the card. Each place reads its state to a screen
// reader. The "where to?" window stays for the button in the course's window (ⓘ), on a phone or as a plain list
let kbdPlacing = null; // { n, back }: the course and the focus key of its card, while the focus is among the places

const placeBoxes = () => [$("#done").closest(".zone-card"), ...document.querySelectorAll("#semesters .semester")];

const boxTarget = (b) => { const z = b.querySelector("[data-zone]").dataset.zone; return z === "done" ? "done" : Number(z.slice(1)); };

function boxState(n, t) {
  if (locationOf(n) === t) return { cls: "here", text: T("הקורס כאן עכשיו") };
  if (t === "done") return { cls: "ok", text: "" };
  const reason = blockedReason(n, t);
  if (reason) return { cls: "no", text: T("לא אפשרי"), reason, short: blockedShort(n, t) };
  const issues = dropIssues(n, t);
  return issues.admission ? { cls: "bad", text: T("חסר תנאי קבלה") }
    : issues.required ? { cls: "warn", text: T("חסר ידע קודם דרוש") } : { cls: "ok", text: T("אפשר") };
}

// after every render while placing (the boxes are new): focusable, with a name that says the state
function armBoxes() {
  if (kbdPlacing && selected !== kbdPlacing.n) kbdPlacing = null; // the pick ended some other way (a click)
  const on = !!kbdPlacing && selected === kbdPlacing.n;
  $("#plan-start").toggleAttribute("data-placing", on);
  // a screen reader passes the arrows to the page only inside an application; only while placing (Tab ends it)
  if (on) $("#plan-start").setAttribute("role", "application"); else $("#plan-start").removeAttribute("role");
  placeBoxes().forEach((b) => {
    if (!on) { b.removeAttribute("tabindex"); b.removeAttribute("aria-label"); b.removeAttribute("aria-describedby"); b.classList.remove("kbd-place"); return; }
    const t = boxTarget(b), s = boxState(kbdPlacing.n, t);
    const name = t === "done" ? T("קורסים שכבר עשיתי") : T`סמסטר ${semesterLabel(semesterIds()[t])}`;
    b.tabIndex = -1;
    b.classList.add("kbd-place");
    b.setAttribute("aria-label", [name, s.text, s.short].filter(Boolean).join(": "));
    b.setAttribute("aria-describedby", "kbd-hint-place");
  });
}

function startKbdPlace(card) {
  const n = card.dataset.n;
  if (isLocked(n)) { toast(T`${n} נעול. כדי להזיז אותו, לוחצים על המנעול שבכרטיס.`); return; }
  // from the tree: the courses around it there, so after placing it the focus goes on to the next course in the tree,
  // not back to the plan (guy, 2026-11-05: Tab many times to get back to the tree). Not on a phone, where the tree is
  // a closed layer
  const tree = treeIsLayer() ? null : card.closest(".tree");
  const around = tree ? [...tree.querySelectorAll(".chip[tabindex]")].map((x) => x.dataset.n) : [];
  const k = around.indexOf(n);
  kbdPlacing = { n, back: focusKey(card),
    nextInTree: tree && k >= 0 ? [...around.slice(k + 1), ...around.slice(0, k).reverse()].filter((x) => x !== n) : null };
  selected = n;
  if (card.closest(".tree")) setTreeOpen(false);
  if (!$("#mini-panel").hidden) setMiniOpen(false);
  moveFocus = () => {
    // the focus starts where openMove's list did: the first semester with nothing missing, after the course's place
    const where = locationOf(n);
    const boxes = placeBoxes();
    const is = (b, cls) => boxTarget(b) !== "done" && cls.includes(boxState(n, boxTarget(b)).cls);
    const after = (b) => typeof where !== "number" || boxTarget(b) > where;
    // else the first semester it can go to at all (with something missing), else "done"
    const start = boxes.find((b) => is(b, ["ok"]) && after(b)) || boxes.find((b) => is(b, ["ok"]))
      || boxes.find((b) => is(b, ["warn", "bad"]) && after(b)) || boxes.find((b) => is(b, ["warn", "bad"])) || boxes[0];
    focusBox(start);
  };
  render();
}

function focusBox(b) {
  b.focus({ preventScroll: true });
  b.scrollIntoView({ block: "nearest", behavior: SMOOTH() });
}

function endKbdPlace() {
  if (!kbdPlacing) return;
  const back = kbdPlacing.back;
  kbdPlacing = null;
  selected = null;
  moveFocus = () => refocus(back);
  render();
}

// the nearest place in the direction of the arrow, by the boxes' positions on the screen
function nextBox(from, key) {
  const dx = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0, dy = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
  const boxes = placeBoxes();
  // from "done" (the whole width) down: the first semester, not the one under its middle
  if (boxTarget(from) === "done") return dy > 0 ? boxes[1] || null : null;
  const r = from.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, score = Infinity;
  boxes.forEach((b) => {
    if (b === from) return;
    const q = b.getBoundingClientRect();
    const along = dx ? (dx > 0 ? q.left - r.right : r.left - q.right) : (dy > 0 ? q.top - r.bottom : r.top - q.bottom);
    if (along < -4) return; // not in that direction
    const across = dx ? Math.abs(q.top + q.height / 2 - cy) : cx < q.left ? q.left - cx : cx > q.right ? cx - q.right : 0;
    const s = along + 3 * across;
    if (s < score) { score = s; best = b; }
  });
  return best;
}

function setupKbdPlace() {
  document.addEventListener("keydown", (e) => {
    if (!kbdPlacing) return;
    const box = e.target.closest && e.target.closest(".kbd-place");
    if (!box) return;
    if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); endKbdPlace(); return; }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const next = nextBox(box, e.key);
      if (next) focusBox(next);
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const n = kbdPlacing.n, t = boxTarget(box), s = boxState(n, t);
    if (s.reason) { toast(s.reason); announce(s.reason); return; }
    if (s.cls === "here") { endKbdPlace(); return; }
    const nextInTree = kbdPlacing.nextInTree;
    kbdPlacing = null;
    selected = null;
    keepOutside(n);
    // the next course in the tree that is not in the plan yet (then any still there), else the course itself
    moveFocus = !nextInTree ? n : () => {
      // one that can be seen: not in a part of the tree that folded with the placing (20114 beside 20113)
      const card = (x) => [...document.querySelectorAll(`.tree .chip[tabindex][data-n='${x}']`)]
        .find((c) => !c.closest("details:not([open])") && c.getClientRects().length);
      const next = nextInTree.map(card).find((x) => x && locationOf(x.dataset.n) === null) || nextInTree.map(card).find(Boolean);
      if (!next) { focusMoved(n); return; }
      next.focus({ preventScroll: true });
      const tree = next.closest(".tree"), r = next.getBoundingClientRect(), t = tree.getBoundingClientRect();
      if (r.top < t.top || r.bottom > t.bottom) tree.scrollBy({ top: r.top - t.top - (t.height - r.height) / 2 });
    };
    place(n, t);
    const now = locationOf(n);
    announce(now === "done" ? T`${n} נמצא ב"קורסים שכבר עשיתי"` : typeof now === "number" ? T`${n} שובץ בסמסטר ${semesterLabel(semesterIds()[now])}` : "");
  }, true);
  // the focus left the places some other way (the mouse): the keyboard mode ends; a pick by mouse goes on as before
  document.addEventListener("focusout", (e) => {
    if (!kbdPlacing || !e.target.classList || !e.target.classList.contains("kbd-place")) return;
    const to = e.relatedTarget;
    if (to && to.classList && to.classList.contains("kbd-place")) return;
    if (!to) return; // a render replaced the box, or the window lost the focus
    kbdPlacing = null;
    armBoxes();
  });
}
