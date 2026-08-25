/* Comparing saved sessions -- in practice, the same music on two or three
 * flutes.
 *
 * The central design decision is the offset correction. If one instrument
 * sits eight cents sharp throughout, a raw comparison reports "+8" on every
 * note, which describes its *pitch*, not its *tuning*. Subtracting each
 * session's own centre leaves the question actually being asked: on this
 * flute, does the F# sit higher or lower relative to the rest of the
 * instrument than it does on the others? The overall pitch difference is
 * reported once, separately, where it belongs.
 *
 * Any number of sessions from two upward compare on the same footing: every
 * per-note figure is an array, one entry per session, and the spread across
 * that array is what the table shows. Two sessions are simply the case where
 * the array has two entries.
 *
 * Nothing here reads `by_note`: per-note figures are recomputed from
 * `notes[]`, which every record type carries, so a practice run and a Listen
 * session compare on the same footing. Pure functions; the view renders. */

import { SpelledPitch, highestFirst } from "./pitch.js";
import { mean, pstdev } from "./stats.js";
import { SessionSummary, octavePairs } from "./scoring.js";

/* Below this many notes in common, the comparison is thin and says so. */
export const MIN_SHARED_NOTES = 5;
/* A difference is only called real when it clears this many combined standard
 * errors. With two or three occurrences a few cents is noise, and a table
 * that does not say so invites chasing ghosts. */
export const SIGNIFICANCE_SE = 2.0;
/* ...and must also be at least this large in plain cents. Without a floor,
 * two notes measured identically give a standard error of zero and any
 * floating-point dust would be announced as a finding. A cent is below the
 * detector's own accuracy and a fifth of the "in tune" band, so nothing
 * musical is lost by refusing to call it. */
export const MIN_NOTABLE_CENTS = 1.0;
/* A verdict on which instrument is better tuned needs at least this many
 * shared notes; below it the paired test has nothing to work with. */
export const MIN_NOTES_FOR_VERDICT = 3;
/* More than this and the table stops being readable on a phone. */
export const MAX_COMPARE = 3;

/* Settings that must match, or the sets of numbers are not on the same
 * scale at all. `tonic` is checked only when every record carries one:
 * practice records do not, since the exercise name implies it. */
const TUNING_FIELDS = ["mode", "temperament", "root", "reference_hz"];

const asList = (args) => (Array.isArray(args[0]) ? args[0] : args);

/* pitchName -> {pitch, n, mean, spread, stability} from a record's notes. */
export function perNote(record) {
  const groups = new Map();
  for (const note of record.notes ?? []) {
    if (!note || typeof note.mean_cents !== "number") continue;
    if (!groups.has(note.pitch)) groups.set(note.pitch, []);
    groups.get(note.pitch).push(note);
  }
  const out = new Map();
  for (const [key, notes] of groups) {
    const cents = notes.map((n) => n.mean_cents);
    out.set(key, {
      pitch: SpelledPitch.parse(key),
      n: notes.length,
      mean: mean(cents),
      spread: pstdev(cents),
      stability: mean(notes.map((n) => n.stdev_cents ?? 0)),
    });
  }
  return out;
}

/* {ok, blockers, warnings, shared}. Blockers mean "refuse"; warnings mean
 * "compare, but say what is weak about it". */
export function comparable(...args) {
  const records = asList(args);
  if (records.length < 2 || records.length > MAX_COMPARE) {
    return { ok: false, blockers: [{ field: "count", a: records.length }], warnings: [], shared: [] };
  }

  const blockers = [];
  const first = records[0];
  for (const field of TUNING_FIELDS) {
    const differing = records.find((r) => r[field] !== first[field]);
    if (differing) blockers.push({ field, a: first[field], b: differing[field] });
  }
  if (records.every((r) => r.tonic)) {
    const differing = records.find((r) => r.tonic !== first.tonic);
    if (differing) blockers.push({ field: "tonic", a: first.tonic, b: differing.tonic });
  }

  const maps = records.map(perNote);
  const shared = [...maps[0].keys()].filter((key) => maps.every((m) => m.has(key)));
  if (!shared.length) blockers.push({ field: "noSharedNotes" });

  const warnings = [];
  if (shared.length && shared.length < MIN_SHARED_NOTES) {
    warnings.push({ kind: "fewNotes", count: shared.length });
  }
  const single = shared.filter((key) => maps.some((m) => m.get(key).n < 2));
  if (single.length) warnings.push({ kind: "singleOccurrence", count: single.length });
  const kinds = new Set(records.map((r) => r.exercise ?? ""));
  if (kinds.size > 1) {
    warnings.push({ kind: "differentKind", a: records[0].exercise, b: records[1].exercise });
  }

  return { ok: blockers.length === 0, blockers, warnings, shared };
}

const isStopper = (record) => (record.exercise ?? "").includes("stopper");

/* Octave widths side by side. Reuses the scoring layer's pairing, so "same
 * spelled note an octave apart" means exactly what it means everywhere else. */
function octaveComparison(records) {
  const widths = (record) => {
    const map = new Map();
    for (const pair of octavePairs(SessionSummary.fromDict(record).results)) {
      map.set(`${pair.lower.pitch}->${pair.upper.pitch}`, pair);
    }
    return map;
  };
  const maps = records.map(widths);
  return [...maps[0].keys()]
    .filter((key) => maps.every((m) => m.has(key)))
    .sort((p, q) => highestFirst(maps[0].get(p).lower.pitch, maps[0].get(q).lower.pitch))
    .map((key) => ({
      key,
      lower: maps[0].get(key).lower.pitch,
      upper: maps[0].get(key).upper.pitch,
      widths: maps.map((m) => m.get(key).width),
    }));
}

/* A paired test on two sets of per-note values: is the mean difference real,
 * or is it inside the note-to-note scatter? Paired because it is the *same*
 * notes on each instrument, which removes the scatter the notes share. */
function pairedDifference(before, after) {
  if (before.length < MIN_NOTES_FOR_VERDICT) return { gap: 0, notable: false, n: before.length };
  const differences = after.map((value, i) => value - before[i]);
  const gap = mean(differences);
  const se = pstdev(differences) / Math.sqrt(differences.length);
  const notable = Math.abs(gap) > SIGNIFICANCE_SE * se && Math.abs(gap) >= MIN_NOTABLE_CENTS;
  return { gap, notable, n: differences.length };
}

/* The full comparison of two or three sessions, earliest first. */
export function compare(...args) {
  const records = asList(args);
  const check = comparable(records);
  if (!check.ok) return { ok: false, ...check, rows: [], sessions: [] };

  const maps = records.map(perNote);
  const { shared } = check;

  // Each session's own pitch centre, taken over the shared notes only: a note
  // played on one instrument and not another must not tilt the correction.
  const offsets = maps.map((m) => mean(shared.map((key) => m.get(key).mean)));

  const rows = shared.map((key) => {
    const values = maps.map((m, i) => {
      const note = m.get(key);
      return { n: note.n, mean: note.mean, spread: note.spread,
               stability: note.stability, corrected: note.mean - offsets[i] };
    });
    const corrected = values.map((v) => v.corrected);
    const range = Math.max(...corrected) - Math.min(...corrected);
    let verdict;
    if (values.some((v) => v.n < 2)) {
      verdict = "few";                 // one occurrence tells us nothing about spread
    } else {
      const se = Math.sqrt(values.reduce((sum, v) => sum + (v.spread ** 2) / v.n, 0));
      verdict = (range > SIGNIFICANCE_SE * se && range >= MIN_NOTABLE_CENTS) ? "notable" : "noise";
    }
    return { key, pitch: maps[0].get(key).pitch, values, range, verdict };
  }).sort((p, q) => highestFirst(p.pitch, q.pitch));

  /* Three figures per instrument, all in cents and all lower-is-better:
   *  - internal: how far its notes sit from its own centre. The score, and
   *    the nearest thing to "how well is this flute in tune with itself";
   *  - repeatability: how differently the same note came out from one
   *    occurrence to the next;
   *  - steadiness: how much each note wobbled while it was held.
   * The last two are as much about the player as the instrument, which the
   * view says out loud. */
  const sessions = records.map((record, i) => ({
    index: i,
    label: record.label ?? null,
    offset: offsets[i],
    internal: mean(rows.map((r) => Math.abs(r.values[i].corrected))),
    repeatability: mean(rows.map((r) => r.values[i].spread)),
    steadiness: mean(rows.map((r) => r.values[i].stability)),
  }));
  for (const session of sessions) session.score = session.internal;

  // Which is best, and is the lead real? Ranked by score, then the top two
  // tested against each other note by note.
  const ranked = [...sessions].sort((a, b) => a.score - b.score);
  const [winner, runnerUp] = ranked;
  const paired = pairedDifference(
    rows.map((r) => Math.abs(r.values[winner.index].corrected)),
    rows.map((r) => Math.abs(r.values[runnerUp.index].corrected)),
  );
  const best = {
    index: winner.index,
    runnerUp: runnerUp.index,
    gap: paired.gap,                   // how much worse the runner-up is, in cents
    notable: paired.notable,           // ...and whether that lead survives the scatter
  };

  const result = {
    ok: true,
    blockers: [],
    warnings: check.warnings,
    shared,
    offsets,
    sessions,
    best,
    rows,
  };
  if (records.every(isStopper)) result.octaves = octaveComparison(records);
  return result;
}
