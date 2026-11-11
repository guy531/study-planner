"use strict";
// MOVING COURSES: DRAG AND DROP, CLICKS AND BUTTONS
// place() moves a course to a semester or to "עשיתי". Dragging, clicking a course and then a place, the colors of the
// semesters while a course is dragged, picked or under the mouse, and the buttons of the page (setupControls).

// ---------- placing a course ----------

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

// ---------- colors of the places while a course is dragged, picked or under the mouse ----------

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
  const c = condsAt(n, i);
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
  const treeChip = (t) => t && t.closest ? t.closest(".chip[draggable]") : null;
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
    // every course that can be moved: in the tree column and also one already in a semester or in "עשיתי" (guy,
    // 2026-11-04: on trial again; on 2026-11-01 it was only the tree column)
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

// ---------- drag and drop ----------

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

// ---------- clicks and buttons ----------

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
      const bad = [...new Set(problems.filter((x) => x.level === "bad").map((x) => x.n))];
      showInTurn(bad.length ? bad : knowledgeOnly());
      return;
    }
    const turn = e.target.closest("[data-show-turn]");
    if (turn) { showInTurn(turn.dataset.showTurn.split(",")); return; }
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
      // the steps panel over the floating bar closes too, so the semesters are free to take the course (guy, 2026-11-04)
      if (selected !== null && !$("#mini-panel").hidden) setMiniOpen(false);
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
    if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); startKbdPlace(card); return; }
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
  $("#fill-recommended").addEventListener("click", () => fillRecommended());
  $("#auto-fill").addEventListener("click", autoFill);
  $("#share").addEventListener("click", sharePlan);
  $("#help").addEventListener("click", showHelp);
  $("#news").addEventListener("click", showNews);
  markNews();
  // focus goes into the layer, but not to the search: on a phone that opens the keyboard (guy, 2026-11-01)
  $("#tree-fab").addEventListener("click", () => { setTreeOpen(true); $("#tree-close").focus({ preventScroll: true }); });
  $("#skip-tree").addEventListener("click", (e) => { e.preventDefault(); if (treeIsLayer()) setTreeOpen(true); $("#tree-search").focus(); });
  $("#skip-plan").addEventListener("click", (e) => { e.preventDefault(); $("#plan-start").focus(); });
  $("#a11y-open").addEventListener("click", showAccessibility);
  setupMove();
  setupKbdPlace();
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
  // the program's name, not its code: "CC" says nothing to a student (guy, 2026-11-10); no characters a file name refuses
  window.addEventListener("beforeprint", () => { buildPrint(); document.title = T`תכנית לימודים - ${(program.name || program.code).replace(/[\\/:*?"<>|]/g, "")}`; });
  window.addEventListener("afterprint", () => { document.title = title; });
}
