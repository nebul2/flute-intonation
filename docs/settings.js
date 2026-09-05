/* Settings: one versioned object in localStorage, read through get() and
 * changed through set(); every view that depends on a setting subscribes so
 * the status strip and the tuner re-render without a reload.
 *
 * Defaults are the desktop version's defaults: A = 415, Vallotti on C, pure
 * intervals, fixed-do solfège. */

const KEY = "flute-intonation.settings";

export const DEFAULTS = Object.freeze({
  v: 1,
  referenceHz: 415,
  temperament: "vallotti",
  root: "C",
  mode: "pure",
  naming: "solfege",
  lang: null,            // null = follow the browser
  droneLevel: 0.15,
  deviceId: null,
  headphones: false,
  listenLog: false,      // Listen to me: show the note-by-note log
  analytics: true,       // anonymous audience counts (section names only)
  lastLabel: "",         // remembered session name, e.g. "flute 1"
  octaveStyle: "register",  // "register" (Ré grave) or "number" (Ré4)
  registerBreak: "D",    // where the registers break: D (one-keyed) or C (C foot)
  explainOpen: false,    // page explanations start open rather than folded away
  feedbackAsked: false,  // the one-time "what do you think?" has been settled
  scalesMinutes: 15,     // Play scales stops itself after this long
  scalesMode: "guided",  // "guided" (app names a key) | "key" | "free"
  scalesKeyIndex: 0,     // where the guided sequence had got to
  practiceKeyIndex: 0,   // which key the key-choosing exercises are in
});

let state = null;
const listeners = new Set();

function storage() {
  // Node ships a placeholder `localStorage` global whose methods are missing
  // unless a storage file is configured, so check the method, not the name.
  try {
    return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function"
      ? localStorage : null;
  } catch (_e) { return null; }     // private mode, blocked storage
}

function load() {
  const store = storage();
  let saved = {};
  if (store) {
    try { saved = JSON.parse(store.getItem(KEY) || "{}") || {}; } catch (_e) { saved = {}; }
    // Phase 0 stored the language under its own key; carry it over once.
    if (saved.lang === undefined) {
      const old = store.getItem("lang");
      if (old === "fr" || old === "en") saved.lang = old;
    }
  }
  return { ...DEFAULTS, ...saved, v: 1 };
}

export function get() {
  if (!state) state = load();
  return state;
}

export function set(patch) {
  state = { ...get(), ...patch };
  const store = storage();
  if (store) {
    try { store.setItem(KEY, JSON.stringify(state)); } catch (_e) { /* full or blocked */ }
  }
  listeners.forEach((cb) => cb(state));
  return state;
}

export function subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }

/* For tests: forget the cached state so the next get() reloads. */
export function _reset() { state = null; }
