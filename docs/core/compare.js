/* Comparing two saved sessions -- in practice, the same music on two flutes.
 *
 * The central design decision is the offset correction. If one instrument
 * sits eight cents sharp throughout, a raw comparison reports "+8" on every
 * note, which describes its *pitch*, not its *tuning*. Subtracting each
 * session's own centre leaves the question actually being asked: on this
 * flute, does the F# sit higher or lower relative to the rest of the
 * instrument than it does on the other one? The overall pitch difference is
 * reported once, separately, where it belongs.
 *
 * Nothing here reads `by_note`: per-note figures are recomputed from
 * `notes[]`, which every record type carries, so a practice run and a Listen
 * session compare on the same footing. Pure functions; the view renders. */

import { SpelledPitch } from "./pitch.js";
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

/* Settings that must match, or the two sets of numbers are not on the same
 * scale at all. `tonic` is checked only when both records carry one: practice
 * records do not, since the exercise name implies it. */
const TUNING_FIELDS = ["mode", "temperament", "root", "reference_hz"];

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

export function sharedNotes(a, b) {
  const bNotes = perNote(b);
  return [...perNote(a).keys()].filter((key) => bNotes.has(key));
}

/* {ok, blockers, warnings, shared}. Blockers mean "refuse"; warnings mean
 * "compare, but say what is weak about it". */
export function comparable(a, b) {
  const blockers = [];
  for (const field of TUNING_FIELDS) {
    if (a[field] !== b[field]) blockers.push({ field, a: a[field], b: b[field] });
  }
  if (a.tonic && b.tonic && a.tonic !== b.tonic) {
    blockers.push({ field: "tonic", a: a.tonic, b: b.tonic });
  }

  const aNotes = perNote(a), bNotes = perNote(b);
  const shared = [...aNotes.keys()].filter((key) => bNotes.has(key));
  if (!shared.length) blockers.push({ field: "noSharedNotes" });

  const warnings = [];
  if (shared.length && shared.length < MIN_SHARED_NOTES) {
    warnings.push({ kind: "fewNotes", count: shared.length });
  }
  const single = shared.filter((key) => aNotes.get(key).n < 2 || bNotes.get(key).n < 2);
  if (single.length) warnings.push({ kind: "singleOccurrence", count: single.length });
  if ((a.exercise ?? "") !== (b.exercise ?? "")) {
    warnings.push({ kind: "differentKind", a: a.exercise, b: b.exercise });
  }

  return { ok: blockers.length === 0, blockers, warnings, shared };
}

const isStopper = (record) => (record.exercise ?? "").includes("stopper");

/* Octave widths side by side, for two stopper checks. Reuses the scoring
 * layer's pairing, so "same spelled note an octave apart" means exactly what
 * it means everywhere else. */
function octaveComparison(a, b) {
  const widths = (record) => {
    const map = new Map();
    for (const pair of octavePairs(SessionSummary.fromDict(record).results)) {
      map.set(`${pair.lower.pitch}->${pair.upper.pitch}`, pair);
    }
    return map;
  };
  const wa = widths(a), wb = widths(b);
  return [...wa.keys()].filter((key) => wb.has(key)).map((key) => ({
    key,
    lower: wa.get(key).lower.pitch,
    upper: wa.get(key).upper.pitch,
    a: wa.get(key).width,
    b: wb.get(key).width,
  }));
}

/* The full comparison. `a` should be the earlier session. */
export function compare(a, b) {
  const check = comparable(a, b);
  if (!check.ok) return { ok: false, ...check, rows: [] };

  const aNotes = perNote(a), bNotes = perNote(b);
  const { shared } = check;

  // Each session's own pitch centre, taken over the shared notes only: a note
  // played on one instrument and not the other must not tilt the correction.
  const offsetA = mean(shared.map((key) => aNotes.get(key).mean));
  const offsetB = mean(shared.map((key) => bNotes.get(key).mean));

  const rows = shared.map((key) => {
    const x = aNotes.get(key), y = bNotes.get(key);
    const aCorrected = x.mean - offsetA;
    const bCorrected = y.mean - offsetB;
    const diff = bCorrected - aCorrected;
    let verdict;
    if (x.n < 2 || y.n < 2) {
      verdict = "few";               // one occurrence tells us nothing about spread
    } else {
      const se = Math.sqrt((x.spread ** 2) / x.n + (y.spread ** 2) / y.n);
      const notable = Math.abs(diff) > SIGNIFICANCE_SE * se
                   && Math.abs(diff) >= MIN_NOTABLE_CENTS;
      verdict = notable ? "notable" : "noise";
    }
    return { key, pitch: x.pitch, aN: x.n, bN: y.n, aMean: x.mean, bMean: y.mean,
             aCorrected, bCorrected, diff, verdict };
  }).sort((p, q) => p.pitch.chromaticIndex - q.pitch.chromaticIndex);

  const result = {
    ok: true,
    blockers: [],
    warnings: check.warnings,
    shared,
    offsetA, offsetB, offsetDiff: offsetB - offsetA,
    // How far each instrument's notes sit from its own centre: the measure of
    // internal consistency, and the one the offset correction exists to expose.
    internalA: mean(rows.map((r) => Math.abs(r.aCorrected))),
    internalB: mean(rows.map((r) => Math.abs(r.bCorrected))),
    stabilityA: mean(rows.map((r) => aNotes.get(r.key).stability)),
    stabilityB: mean(rows.map((r) => bNotes.get(r.key).stability)),
    rows,
  };
  if (isStopper(a) && isStopper(b)) result.octaves = octaveComparison(a, b);
  return result;
}
