"use strict";
// SHARING A PLAN
// The whole plan goes into the link itself (#plan=...), so no server is needed and nothing is sent anywhere.

// The whole plan goes into the link itself (after #, so it never reaches any server): whoever opens the link
// sees the same plan. No accounts and no storage are needed, which suits a static site
function encodePlan() {
  const plan = { p: state.program, s: state.start, d: state.done, m: state.semesters, x: state.extra, b: state.background || [], k: state.skills || [], l: state.locked || [], o: state.blocked || [] };
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodePlan(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const p = JSON.parse(new TextDecoder().decode(bytes));
  const list = (v) => (Array.isArray(v) ? v.filter((n) => typeof n === "string") : []);
  if (!DATA.programs[p.p] || !/^\d{4}[אבג]$/.test(p.s) || !Array.isArray(p.m)) throw new Error("bad plan");
  const blocked = Array.isArray(p.o) ? p.o.filter((i) => Number.isInteger(i) && i >= 0 && i < p.m.length) : [];
  return fromYearStart({ program: p.p, start: p.s, done: list(p.d), semesters: p.m.map(list), extra: list(p.x), background: list(p.b), skills: list(p.k), locked: list(p.l), blocked });
}

// "התכנית עוד לא גמורה: נשארו N צעדים" and the steps, for the print and share windows (guy, 2026-11-03)
function unfinishedNote() {
  const open = planSteps().filter((x) => !x.done);
  if (!open.length) return null;
  return el("div", { class: "unfinished" },
    el("strong", { text: T("התכנית עוד לא גמורה.") }), " ",
    open.length === 1 ? T("נשאר צעד 1:") : T`נשארו ${open.length} צעדים:`,
    el("ul", {}, open.map((x) => el("li", { text: x.text }))));
}

function sharePlan() {
  const link = `${location.origin}${location.pathname}#plan=${encodePlan()}`;
  const input = el("input", { class: "share-link", readonly: true, value: link });
  fillInfo(
    el("h3", { text: T("שיתוף התכנית") }),
    // an unfinished plan says so first (guy, 2026-11-03): whoever gets the link should know it is a draft
    unfinishedNote(),
    approvalNote(),
    el("p", { text: T("הקישור הזה פותח את התכנית בדיוק כמו שהיא עכשיו, אצל כל מי שמקבל אותו (למשל יועץ אקדמי). אפשר לשלוח אותו במייל או בהודעה.") }),
    input,
    el("p", {}, el("button", { type: "button", class: "mini", id: "copy-link", text: T("העתקת הקישור") })),
    el("p", { class: "cond-note", text: T("מי שפותח את הקישור מקבל עותק: שינויים שהוא עושה לא משנים את התכנית שלך. התכנית לא נשמרת בשום שרת, היא כולה בתוך הקישור.") }));
  if (!$("#info").open) $("#info").showModal();
  input.select();
  $("#copy-link").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); } catch (e) { input.select(); document.execCommand("copy"); }
    $("#copy-link").textContent = T("✓ הקישור הועתק");
  });
}

// a shared link opened: show that plan (it replaces the current one, and "ביטול" brings the old one back)
function openSharedPlan() {
  const m = location.hash.match(/^#plan=([\w-]+)$/);
  if (!m) return false;
  history.replaceState(null, "", location.pathname + location.search); // a reload shows the student's own plan again
  let shared;
  try { shared = decodePlan(m[1]); } catch (e) {
    toast(T("הקישור לתכנית פגום, ולכן התכנית לא נפתחה."), 8000);
    return false;
  }
  $("#program").value = shared.program;
  selectProgram(shared.program);
  state = { ...defaultState(shared.program), ...shared };
  save();
  renderStatic();
  render();
  toast(T("נפתחה תכנית ששותפה איתך. היא נשמרה במקום התכנית שהייתה כאן. \"ביטול\" מחזיר את הקודמת."), 12000, { label: T("ביטול"), run: undo });
  return true;
}
