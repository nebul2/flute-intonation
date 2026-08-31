/* What each flute can do, kept on this device.
 *
 * A profile is a slow measurement: three readings a note, and nobody sits down
 * and does the whole instrument at once. So it accumulates -- add a few notes
 * today, a few more next week -- and it is keyed by the instrument's name, so
 * a player with two flutes keeps two profiles and does not average them into
 * one flute that does not exist.
 *
 * localStorage rather than IndexedDB: a profile is small, is read on every
 * page that wants to check a recommendation, and wants to be there
 * synchronously when it is asked for.
 *
 * Readings are stored in cents against the app's target for that pitch, which
 * depends on temperament, root and reference pitch. Those are recorded with
 * the profile so a reading taken under a different tuning can be spotted
 * rather than silently compared against one it does not belong with.
 */

const KEY = "flute-intonation.profiles";

const listeners = new Set();
let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    cache = {};              // private mode, or a corrupt entry: start clean
  }
  if (!cache || typeof cache !== "object") cache = {};
  return cache;
}

function write(next) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (_error) { /* full or unavailable: the session still works */ }
  listeners.forEach((fn) => fn(next));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Every instrument that has been measured, newest first. */
export function all() {
  return Object.values(read()).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

export function names() {
  return Object.keys(read()).sort();
}

/** One instrument's profile, or null. An empty name is the unnamed flute. */
export function get(name) {
  return read()[name || ""] ?? null;
}

/** Every note measured for an instrument, as an array. */
export function entries(name) {
  const profile = get(name);
  if (!profile) return [];
  return Object.entries(profile.notes ?? {})
    .map(([pitch, entry]) => ({ pitch, ...entry }));
}

/**
 * Record one note's three readings, replacing any earlier take of that note.
 *
 * @param tuning {temperament, root, referenceHz, mode} the readings were taken
 *   under -- kept so a profile measured at 415 in Vallotti is not quietly
 *   compared against one taken at 440 in meantone.
 */
export function setNote(name, pitch, entry, tuning, at) {
  const store = { ...read() };
  const key = name || "";
  const profile = store[key] ?? { name: key, notes: {}, tuning: null, at: null };
  store[key] = {
    ...profile,
    name: key,
    tuning: tuning ?? profile.tuning,
    at: at ?? profile.at,
    notes: { ...profile.notes, [pitch]: { ...entry, at } },
  };
  write(store);
  return store[key];
}

export function removeNote(name, pitch) {
  const store = { ...read() };
  const key = name || "";
  const profile = store[key];
  if (!profile) return;
  const notes = { ...profile.notes };
  delete notes[pitch];
  store[key] = { ...profile, notes };
  write(store);
}

export function remove(name) {
  const store = { ...read() };
  delete store[name || ""];
  write(store);
}

/** True when a profile was taken under a different tuning than the one asked. */
export function staleFor(name, tuning) {
  const profile = get(name);
  if (!profile || !profile.tuning) return false;
  const p = profile.tuning;
  return p.temperament !== tuning.temperament || p.root !== tuning.root
    || Math.abs((p.referenceHz ?? 0) - (tuning.referenceHz ?? 0)) > 0.01
    || p.mode !== tuning.mode;
}
