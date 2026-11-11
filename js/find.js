"use strict";
// CTRL+F: FIND A COURSE ANYWHERE ON THE PAGE
// A search bar at the bottom: by name or number, first in the plan, then in the tree; Enter goes to the next one.

// A bar at the bottom: the courses whose name or number match (the tree search's rules), in the plan ("done", then the
// semesters in order) and then in the tree. Typing jumps to the first, Enter to the next, Shift+Enter back; each one
// flashes where it is now. A second Ctrl+F closes the bar (the browser's own find is not needed here)
let findHits = [];

let findAt = -1;

let findReturn = null; // the element that had the focus, back to it when the bar closes

// where Ctrl+F looks: the plan, the degree's tree, "קורסים נוספים", and the broadening-courses lists under the tree,
// also while they are folded (guy, 2026-11-01). Not the other courses outside the degree, for now (guy)
function findCandidates() {
  const placed = [...state.done, ...state.semesters.flat()];
  const tree = [...document.querySelectorAll(".tree .chip")].filter((c) => !c.closest("#outside, #lists")).map((c) => c.dataset.n);
  const lists = otherLists().flatMap(([, l]) => l.courses);
  const loose = [...tree, ...treeShows(), ...state.extra, ...lists].filter((n) => locationOf(n) === null);
  return [...new Set([...placed, ...loose])].filter((n) => DATA.courses[n]);
}

// while the bar is open, every course found is marked, the current one more strongly; yellow, like a browser's
// find, and not red, which here means a missing condition (guy, 2026-11-01). Again after every render
function markFound() {
  document.querySelectorAll(".chip.found, .chip.found-now").forEach((c) => c.classList.remove("found", "found-now"));
  if ($("#find-bar").hidden || !findHits.length) return;
  const hits = new Set(findHits);
  document.querySelectorAll("#semesters .chip, #done .chip, .tree .chip").forEach((c) => {
    if (!hits.has(c.dataset.n) || c.closest("#outside")) return;
    c.classList.add("found");
    if (c.dataset.n === findHits[findAt]) c.classList.add("found-now");
  });
}

function findShow() {
  const q = $("#find-input").value;
  const count = $("#find-count");
  $("#find-input").classList.toggle("none", !!q.trim() && !findHits.length);
  count.textContent = !q.trim() ? "" : !findHits.length ? T("לא נמצא") : T`${findAt + 1} מתוך ${findHits.length}`;
  $("#find-prev").disabled = $("#find-next").disabled = findHits.length < 2;
}

function findGo(step) {
  if (!findHits.length) return;
  findAt = (findAt + step + findHits.length) % findHits.length;
  findShow();
  const n = findHits[findAt];
  // a course of a folded list under the tree: open the list (its cards are built only then)
  if (locationOf(n) === null && !treeShows().has(n) && !state.extra.includes(n)) {
    const list = otherLists().find(([, l]) => l.courses.includes(n));
    if (list && !listsOpen.has(list[0])) { listsOpen.add(list[0]); renderLists(); }
  }
  flashInTree([n], false);
  markFound();
}

function findUpdate() {
  const words = searchText($("#find-input").value).split(" ").filter(Boolean);
  findHits = words.length ? findCandidates().filter((n) => searchScore(n, words) > 0) : [];
  findAt = -1;
  if (findHits.length) findGo(1); else { findShow(); markFound(); }
}

function openFind() {
  const bar = $("#find-bar");
  if (bar.hidden) findReturn = document.activeElement;
  bar.hidden = false;
  $("#find-input").focus();
  $("#find-input").select();
  if ($("#find-input").value.trim()) findUpdate();
}

function closeFind() {
  $("#find-bar").hidden = true;
  markFound();
  if (findReturn && document.contains(findReturn)) findReturn.focus({ preventScroll: true });
  findReturn = null;
}

function setupFind() {
  document.addEventListener("keydown", (e) => {
    // e.code: the F key in any keyboard language (in Hebrew it is "כ")
    if (!(e.ctrlKey || e.metaKey) || e.code !== "KeyF" || e.shiftKey || e.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    e.preventDefault();
    // a second Ctrl+F closes the bar, instead of opening the browser's own search (guy, 2026-11-01)
    if ($("#find-bar").hidden) openFind(); else closeFind();
  });
  $("#find-input").addEventListener("input", findUpdate);
  $("#find-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); }
    if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  $("#find-next").addEventListener("click", () => findGo(1));
  $("#find-prev").addEventListener("click", () => findGo(-1));
  $("#find-close").addEventListener("click", closeFind);
}
