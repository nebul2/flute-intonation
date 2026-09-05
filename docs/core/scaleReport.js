/* What to say after a session of scales.
 *
 * This lives in core rather than in the view for one reason: the view cannot
 * be run without a browser, and the report was wrong three times before
 * anybody could tell me why. Everything below is arithmetic over plain data
 * and can be run over a real recording in a terminal, which is the only way
 * this project has ever found out what it actually does.
 *
 * The view renders what comes back and decides nothing.
 */

import { SpelledPitch } from "./pitch.js";
import { HarmonicContext } from "./tuning.js";
import { analyseNote } from "./scoring.js";
import { aggregate, scorableRows, sessionScore, offsetAction, standouts } from "./stats.js";

/** A note differing this much between two keys is worth pointing at. */
export const CROSS_KEY_NOTABLE_CENTS = 8;
/** Rows in the same-note table, worst spread first. */
export const CROSS_KEY_ROWS = 8;

/**
 * Measure every scale against its own tonic, and say what stands out.
 *
 * @param notes the session's notes, each `{pitch, framesHz, seconds}`
 * @param runs what `recogniseSession` made of them
 * @param tuning the temperament, for notes no pure ratio covers
 * @param pure a PureIntervalTuning over that temperament
 * @param frameSeconds the detector's frame length
 * @param expectedKeys key names the player might have been asked for, so the
 *   ones they did not reach can be mentioned; optional
 */
export function scaleReport({ notes, runs, tuning, pure, frameSeconds, expectedKeys = [] }) {
  const byKey = new Map();
  const everyNote = [];

  for (const run of runs) {
    const label = run.tonicName ?? run.pitchClassName;
    if (!byKey.has(label)) {
      byKey.set(label, { label, spellable: run.spellable, runCount: 0, notes: [] });
    }
    const bucket = byKey.get(label);
    bucket.runCount += 1;
    // A key the app cannot spell can still be counted; it just cannot be
    // measured, because there is no target to measure against.
    if (!run.spellable || !run.expected) continue;

    const tonic = SpelledPitch.parse(`${run.tonicName}${run.expected[0].octave}`);
    const context = new HarmonicContext(tonic);
    // Only notes that landed on a degree. A fluffed or misheard note measured
    // against the pitch it was named as is measuring the detector.
    for (const index of run.matchedIndices) {
      const note = notes[index];
      if (!note || !note.framesHz || !note.framesHz.length) continue;
      let targetHz = null;
      try { targetHz = pure.targetHz(note.pitch, context); } catch (_e) { /* no ratio */ }
      if (targetHz === null || !Number.isFinite(targetHz)) targetHz = tuning.targetHz(note.pitch);
      const measured = analyseNote(note.pitch, targetHz, note.framesHz, frameSeconds);
      if (!measured) continue;
      const scored = {
        pitch: note.pitch, primaryCents: measured.meanCents, stdev: measured.stdevCents,
        seconds: note.seconds ?? 0, meanDb: null, index: bucket.notes.length,
      };
      bucket.notes.push(scored);
      everyNote.push(scored);
    }
  }

  const keys = [...byKey.values()].map((bucket) => {
    const rows = bucket.notes.length ? aggregate(bucket.notes) : [];
    return { ...bucket, noteCount: bucket.notes.length, score: rows.length ? sessionScore(scorableRows(rows)) : null };
  });

  /* Where the whole session sat is one number and it belongs to the
   * headjoint, or to a reference pitch set wrong. It comes off before any key
   * is compared with any other: a flute sitting twenty cents sharp otherwise
   * reads as bad playing in every key at once. */
  const overall = everyNote.length ? sessionScore(scorableRows(aggregate(everyNote))) : null;
  const shift = overall ? overall.offset : 0;

  const measurable = keys.filter((k) => k.score);
  // Best is the key you were most consistent WITHIN, not the one that landed
  // nearest the tuner -- that is the session offset again.
  const best = measurable.length
    ? measurable.reduce((a, b) => (b.score.relative < a.score.relative ? b : a)) : null;

  const corrected = everyNote.map((n) => ({ ...n, primaryCents: n.primaryCents - shift }));
  const flagged = corrected.length
    ? standouts(scorableRows(aggregate(corrected))) : { list: [], more: 0 };

  /* The same note, key by key. What a scales session can say that nothing
   * else in the app can: a note is rarely simply sharp or flat on a flute --
   * it is sharp in one key and fine in another, because the fingering, its
   * neighbours and the harmony it sits in all change. Grouped by pitch class,
   * so the two octaves of a D count as the same note. */
  const byClass = new Map();
  for (const bucket of keys) {
    for (const note of bucket.notes) {
      const pc = note.pitch.pitchClass;
      if (!byClass.has(pc)) byClass.set(pc, { pitch: note.pitch, perKey: new Map() });
      const entry = byClass.get(pc);
      if (!entry.perKey.has(bucket.label)) entry.perKey.set(bucket.label, []);
      entry.perKey.get(bucket.label).push(note.primaryCents - shift);
    }
  }

  const crossKey = [...byClass.values()]
    .filter((entry) => entry.perKey.size >= 2)          // two keys to compare
    .map((entry) => {
      const cells = [...entry.perKey.entries()].map(([key, cents]) => ({
        key, n: cents.length, mean: cents.reduce((a, b) => a + b, 0) / cents.length,
      }));
      const means = cells.map((c) => c.mean);
      return { pitch: entry.pitch, cells, spread: Math.max(...means) - Math.min(...means) };
    })
    .sort((a, b) => b.spread - a.spread);

  const played = new Set(keys.map((k) => k.label));
  return {
    keys, overall, best, crossKey,
    offsetCents: shift,
    action: overall ? offsetAction(overall.offset) : null,
    standouts: flagged,
    missed: expectedKeys.filter((k) => !played.has(k)),
    scaleCount: runs.length,
    measuredNotes: everyNote.length,
  };
}
