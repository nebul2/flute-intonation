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

/* Only used when localStorage is unavailable -- private browsing, or node.
 * Otherwise storage is read through on every call rather than cached: a
 * profile is a few kilobytes, and a cache that is never invalidated goes
 * stale the moment the app is open in a second tab. Correctness is worth more
 * than the parse. */
let memory = null;

function read() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch (_error) {
    // Storage is unavailable at all -- private browsing. The session still
    // works, in memory, and nothing is claimed to have been saved.
    return memory ?? {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    // Present but unreadable. Starting clean is the only safe reading: an
    // in-memory copy from this session would look like the saved profile and
    // would overwrite whatever is actually there on the next write.
    return {};
  }
}

function write(next) {
  memory = next;
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

/**
 * Create an empty profile so a flute exists before it has been measured.
 *
 * Without this a newly named instrument is invisible until its first note is
 * stored, so the picker cannot show it and appears to have lost the name.
 */
export function ensure(name) {
  const key = name || "";
  const store = read();
  if (store[key]) return store[key];
  const next = { ...store, [key]: { name: key, notes: {}, tuning: null, at: null } };
  write(next);
  return next[key];
}

/**
 * Rename a flute, keeping everything measured under it.
 *
 * Renaming rather than creating-and-abandoning is what a player actually wants
 * the first time: the readings already exist under the unnamed default, and
 * they belong to the instrument, not to the blank string.
 *
 * Refuses to write over a different flute that already has that name --
 * merging two instruments' readings would describe a flute that does not
 * exist, and there would be no way back.
 */
export function rename(from, to) {
  const oldKey = from || "";
  const newKey = to || "";
  if (oldKey === newKey) return { ok: true };
  const store = read();
  if (!store[oldKey]) return { ok: false, reason: "missing" };
  if (store[newKey]) return { ok: false, reason: "taken" };
  const next = { ...store };
  next[newKey] = { ...next[oldKey], name: newKey };
  delete next[oldKey];
  write(next);
  return { ok: true };
}
