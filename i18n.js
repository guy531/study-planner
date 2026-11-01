"use strict";
// The site's languages: Hebrew (the source), Arabic and English. Every text in app.js is written in Hebrew and
// passed through T, which looks it up in the dictionaries in lang-ar.js / lang-en.js (by the Hebrew text itself)
// and falls back to the Hebrew. Course names stay in Hebrew in every language, as in the catalog.

const LANGS = { he: { name: "עברית", dir: "rtl" }, ar: { name: "العربية", dir: "rtl" }, en: { name: "English", dir: "ltr" } };
const I18N = {}; // filled by lang-ar.js and lang-en.js: { ar: { "Hebrew text": "translation" }, en: {...} }

let LANG = "he";
try { LANG = localStorage.getItem("physics-planner-v1:lang") || "he"; } catch (e) { /* no storage */ }
if (!LANGS[LANG]) LANG = "he";
document.documentElement.lang = LANG;
document.documentElement.dir = LANGS[LANG].dir;

// T("text") or T`text ${a} more ${b}`: the Hebrew text (with {0}, {1}... where the values go) is the key.
// A translation may move the values around: "{1} credits of {0}"
function T(strings, ...values) {
  const key = typeof strings === "string" ? strings : strings.reduce((k, s, i) => k + (i ? `{${i - 1}}` : "") + s, "");
  const text = (LANG !== "he" && I18N[LANG] && I18N[LANG][key]) || key;
  if (LANG !== "he" && I18N[LANG] && !I18N[LANG][key] && typeof console !== "undefined") console.warn("missing translation:", key);
  return text.replace(/\{(\d+)\}/g, (m, i) => (values[Number(i)] === undefined ? m : values[Number(i)]));
}

// a label that begins a line (a credit counter) starts with a capital letter, even where the same text sits
// inside a sentence elsewhere ("6 credits advanced in physics")
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// semester letters as each language writes them: 2027א, 2027 أ, 2027a
const LETTER_NAMES = { he: { א: "א", ב: "ב", ג: "ג" }, ar: { א: "أ", ב: "ب", ג: "ج" }, en: { א: "a", ב: "b", ג: "c" } };
const letterName = (l) => LETTER_NAMES[LANG][l] || l;
const letterList = (list) => list.map(letterName).join(", ");
// a semester id ("2027א") as it is shown; ids themselves stay Hebrew inside the code and the saved plans
function semName(id) {
  if (!id || !/^\d{4}[אבג]$/.test(id)) return id || "";
  return LANG === "ar" ? `${id.slice(0, 4)} ${letterName(id.slice(4))}` : `${id.slice(0, 4)}${letterName(id.slice(4))}`;
}

// the program's own texts (section and group names, items, general requirements, background requirements) come
// translated from תכניות.xlsx as name_ar, name_en...; this puts the chosen language in place of the Hebrew
function localizeData(data) {
  if (LANG === "he") return;
  // the Hebrew stays in "<field>_he", for code that recognizes a text (renderLists: the broadening courses)
  const swap = (obj, fields) => fields.forEach((f) => { if (obj && obj[`${f}_${LANG}`]) { obj[`${f}_he`] = obj[f]; obj[f] = obj[`${f}_${LANG}`]; } });
  Object.values(data.programs).forEach((p) => {
    swap(p, ["name", "degree"]);
    p.sections.forEach((s) => {
      swap(s, ["name", "description"]);
      s.groups.forEach((g) => { swap(g, ["name", "mustLabel"]); g.items.forEach((it) => swap(it, ["label"])); });
    });
    (p.general || []).forEach((g) => swap(g, ["name", "details"]));
    (p.background || []).forEach((b) => swap(b, ["name", "checkbox", "explanation"]));
    (p.counters || []).forEach((m) => swap(m, ["label", "phrase"]));
  });
}

// the static texts of index.html: an element with data-t has its Hebrew text translated, data-t-title /
// data-t-placeholder / data-t-aria do the same for those attributes
function translatePage() {
  if (LANG === "he") return;
  document.querySelectorAll("[data-t]").forEach((x) => { x.textContent = T(x.textContent.trim()); });
  [["data-t-title", "title"], ["data-t-placeholder", "placeholder"], ["data-t-aria", "aria-label"]].forEach(([mark, attr]) => {
    document.querySelectorAll(`[${mark}]`).forEach((x) => x.setAttribute(attr, T(x.getAttribute(attr))));
  });
  document.title = T(document.title);
}

function setLang(lang) {
  try { localStorage.setItem("physics-planner-v1:lang", lang); } catch (e) { /* no storage */ }
  location.reload(); // and the page starts at the top, as after any reload (see app.js) // every text is built in the chosen language from the start
}
