/* Statistics over free-play notes: fits, verdict thresholds, aggregation. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpelledPitch } from "../core/pitch.js";
import {
  linearFit, withinNoteVolumeLink, volumeVerdict, aggregate, rowsToRecord,
  sessionScore, scorableRows, VOLUME_MIN_NOTES, VOLUME_MIN_DB_RANGE,
} from "../core/stats.js";

const P = (s) => SpelledPitch.parse(s);
const approx = (got, want, abs, label = "") =>
  assert.ok(Math.abs(got - want) <= abs, `${label} expected ${want} ± ${abs}, got ${got}`);

test("linearFit recovers a known line and refuses degenerate input", () => {
  const fit = linearFit([-30, -25, -20, -15], [-4, -1.5, 1, 3.5]);   // 0.5 c/dB exactly
  approx(fit.slope, 0.5, 1e-9);
  approx(fit.r, 1.0, 1e-9);
  assert.equal(fit.n, 4);
  assert.equal(linearFit([1, 2], [1, 2]), null);                     // too few
  assert.equal(linearFit([5, 5, 5], [1, 2, 3]), null);               // x does not vary
  const flat = linearFit([1, 2, 3, 4], [2, 2, 2, 2]);
  approx(flat.slope, 0.0, 1e-9);
  approx(flat.r, 0.0, 1e-9);
});

test("withinNoteVolumeLink relates frame cents to frame level", () => {
  const target = 415.0;
  const levels = [-30, -26, -22, -18, -14];
  // one cent sharper per dB louder
  const hz = levels.map((db) => target * Math.pow(2, (db + 30) / 1200));
  const fit = withinNoteVolumeLink(hz, levels, target);
  approx(fit.slope, 1.0, 1e-6);
  approx(fit.r, 1.0, 1e-6);
  assert.equal(withinNoteVolumeLink([], [], target), null);
});

test("volumeVerdict thresholds", () => {
  assert.equal(volumeVerdict(null), null);
  assert.equal(volumeVerdict({ slope: 1.2, r: 0.8, n: 5 }), "sharper");
  assert.equal(volumeVerdict({ slope: -0.9, r: -0.7, n: 5 }), "flatter");
  assert.equal(volumeVerdict({ slope: 0.2, r: 0.9, n: 5 }), "none");   // too shallow
  assert.equal(volumeVerdict({ slope: 2.0, r: 0.2, n: 5 }), "none");   // too noisy
});

function note(pitchName, cents, { stdev = 2, seconds = 1, db = -25, index = 0 } = {}) {
  return { pitch: P(pitchName), primaryCents: cents, stdev, seconds, meanDb: db, index, withinFit: null };
}

test("aggregate groups by spelled pitch with counts, range, spread, stability, time", () => {
  const notes = [
    note("F#4", 10, { stdev: 2, seconds: 1.0, index: 0 }),
    note("A4", 0, { stdev: 4, seconds: 0.5, index: 1 }),
    note("F#4", 14, { stdev: 6, seconds: 2.0, index: 2 }),
    note("Gb4", 3, { index: 3 }),                       // a different spelling is a different row
  ];
  const rows = aggregate(notes);
  assert.deepEqual(rows.map((r) => r.key), ["A4", "F#4", "Gb4"]);   // high notes first
  const fs = rows.find((r) => r.key === "F#4");
  assert.equal(fs.n, 2);
  approx(fs.meanCents, 12, 1e-9);
  approx(fs.minCents, 10, 1e-9);
  approx(fs.maxCents, 14, 1e-9);
  approx(fs.spreadCents, 2, 1e-9);
  approx(fs.stability, 4, 1e-9);
  approx(fs.totalSeconds, 3.0, 1e-9);
  assert.equal(fs.volume, null);          // too few occurrences
  assert.equal(fs.trend, null);           // fewer than four
  const gb = rows.find((r) => r.key === "Gb4");
  assert.equal(gb.n, 1);
  approx(gb.spreadCents, 0, 1e-9);
});

test("volume fit appears only with enough occurrences over enough dB, and trend needs four", () => {
  const sharpWhenLoud = Array.from({ length: VOLUME_MIN_NOTES }, (_, i) =>
    note("D5", 2 + i * 3, { db: -30 + i * 4, index: i }));            // 0.75 c/dB, 12 dB range
  const row = aggregate(sharpWhenLoud)[0];
  assert.ok(row.volume, "fit present");
  approx(row.volume.slope, 0.75, 1e-9);
  assert.equal(volumeVerdict(row.volume), "sharper");
  assert.ok(row.trend > 0, "second half sharper than the first");

  const narrow = Array.from({ length: VOLUME_MIN_NOTES }, (_, i) =>
    note("D5", 2 + i * 3, { db: -30 + i * (VOLUME_MIN_DB_RANGE / 5), index: i }));
  assert.equal(aggregate(narrow)[0].volume, null, "dB range too narrow");
});

test("rowsToRecord yields plain rounded numbers", () => {
  const rows = aggregate([note("A4", 1.23456, { db: -25.5 }), note("A4", -0.5, { db: -20, index: 1 })]);
  const rec = rowsToRecord(rows);
  assert.equal(rec[0].pitch, "A4");
  assert.equal(rec[0].n, 2);
  approx(rec[0].mean_cents, 0.37, 0.005);
  assert.equal(rec[0].volume_slope, null);
});

/* ---- the session score ------------------------------------------------ */

const scored = (means, extra = {}) => sessionScore(means.map((mean, i) => ({
  pitch: P(["D4", "E4", "F#4", "G4", "A4", "B4"][i] ?? "D5"),
  n: extra.n ?? 3, mean, spread: extra.spread ?? 2, stability: extra.stability ?? 1.5,
})));

test("a session sitting uniformly sharp is offset, not bad intonation", () => {
  // Every note 8 cents sharp: 8 cents out against the targets, but perfectly
  // consistent with itself, and correcting the headjoint would fix it all.
  const score = scored([8, 8, 8, 8, 8]);
  approx(score.accuracy, 8, 1e-9);
  approx(score.offset, 8, 1e-9);
  approx(score.relative, 0, 1e-9, "nothing left once the offset is removed");
  assert.equal(score.notes, 5);
  assert.equal(score.occurrences, 15);
});

test("scattered notes keep their error after the offset is removed", () => {
  const score = scored([10, -10, 10, -10]);
  approx(score.accuracy, 10, 1e-9);
  approx(score.offset, 0, 1e-9);
  approx(score.relative, 10, 1e-9, "the scatter is real, not a uniform shift");
});

test("the worst note is named, by absolute deviation", () => {
  const score = scored([2, -3, 14, -1, 0]);
  assert.equal(score.worst.pitch.name, "F#4");
  approx(score.worst.mean, 14, 1e-9);
});

test("repeatability ignores notes played only once", () => {
  // A note heard once has zero spread; averaging it in would flatter the
  // player into looking more repeatable than the evidence supports.
  const notes = [
    { pitch: P("D4"), n: 4, mean: 0, spread: 6, stability: 1 },
    { pitch: P("A4"), n: 1, mean: 0, spread: 0, stability: 1 },
  ];
  const score = sessionScore(notes);
  approx(score.repeatability, 6, 1e-9);
  assert.equal(score.repeatedNotes, 1);

  const once = sessionScore([{ pitch: P("D4"), n: 1, mean: 0, spread: 0, stability: 1 }]);
  assert.equal(once.repeatability, null, "nothing repeated, nothing to report");
  assert.equal(once.repeatedNotes, 0);
});

test("steadiness is the within-note wobble, and an empty session has no score", () => {
  approx(scored([0, 0], { stability: 4 }).steadiness, 4, 1e-9);
  assert.equal(sessionScore([]), null);
  assert.equal(sessionScore(null), null);
});

test("scorableRows feeds aggregate output straight in, and matches perNote's shape", () => {
  const rows = aggregate([note("F#4", 10), note("F#4", 14, { index: 1 }), note("A4", -2, { index: 2 })]);
  const score = sessionScore(scorableRows(rows));
  assert.equal(score.notes, 2);
  assert.equal(score.occurrences, 3);
  approx(score.accuracy, (12 + 2) / 2, 1e-9);
  // The keys sessionScore reads are exactly those perNote produces.
  for (const key of ["n", "mean", "spread", "stability", "pitch"]) {
    assert.ok(key in scorableRows(rows)[0], key);
  }
});

test("the offset and the note-to-note figure do not subtract", () => {
  // The arithmetic that surprises: both are averages of *distances*, so a
  // uniform shift only helps to the extent the errors point the same way.
  const bothWays = scored([12, -12, 12, -12]);
  approx(bothWays.offset, 0, 1e-9);
  approx(bothWays.accuracy, 12, 1e-9);
  approx(bothWays.relative, 12, 1e-9, "scattered errors: correcting pitch changes nothing");

  const allFlat = scored([-10, -2]);
  approx(allFlat.accuracy, 6, 1e-9);
  approx(allFlat.offset, -6, 1e-9);
  approx(allFlat.relative, 4, 1e-9, "6 cents of offset removes only 2 cents of error");
  assert.notEqual(allFlat.relative, allFlat.accuracy - Math.abs(allFlat.offset));

  // Correcting can even leave more, because a mean is not a median.
  const skewed = scored([-20, 5, -3, 1]);
  assert.ok(skewed.relative > skewed.accuracy,
    "removing the mean can increase the mean distance");
});
