/* Comparing two sessions: grouping, refusal rules, and above all the offset
 * correction that separates an instrument's pitch from its tuning. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { compare, comparable, perNote, MIN_SHARED_NOTES } from "../core/compare.js";

const approx = (got, want, abs, label = "") =>
  assert.ok(Math.abs(got - want) <= abs, `${label} expected ${want} ± ${abs}, got ${got}`);

const SETTINGS = { mode: "pure", temperament: "vallotti", root: "C", reference_hz: 415, tonic: "D4" };

/* A record whose notes repeat `occurrences` times per pitch, each occurrence
 * offset from the note's mean by the given jitter so spread is controllable. */
function record(cents, { occurrences = 3, jitter = 0, exercise = "listen", ...rest } = {}) {
  const notes = [];
  for (const [pitch, mean] of Object.entries(cents)) {
    for (let i = 0; i < occurrences; i++) {
      const wobble = occurrences > 1 ? jitter * (i - (occurrences - 1) / 2) : 0;
      notes.push({ pitch, target_hz: 440, mean_cents: mean + wobble, stdev_cents: 2 });
    }
  }
  return { v: 1, exercise, ...SETTINGS, ...rest, notes };
}

const FIVE = { "D4": 0, "E4": 4, "F#4": -6, "G4": 2, "A4": -1 };

/* ---- grouping -------------------------------------------------------- */

test("perNote groups by spelled pitch and counts occurrences, without by_note", () => {
  const practice = { exercise: "practice: calibration", ...SETTINGS, notes: [
    { pitch: "D4", mean_cents: 4, stdev_cents: 2 },
    { pitch: "D4", mean_cents: 8, stdev_cents: 4 },
    { pitch: "A4", mean_cents: -3, stdev_cents: 1 },
  ] };
  assert.equal(practice.by_note, undefined, "practice records carry no aggregate");
  const rows = perNote(practice);
  assert.deepEqual([...rows.keys()].sort(), ["A4", "D4"]);
  assert.equal(rows.get("D4").n, 2);
  approx(rows.get("D4").mean, 6, 1e-9);
  approx(rows.get("D4").spread, 2, 1e-9);
  approx(rows.get("D4").stability, 3, 1e-9);
  assert.equal(rows.get("D4").pitch.name, "D4");
});

test("D#4 and Eb4 are different notes here too", () => {
  const rows = perNote({ notes: [
    { pitch: "D#4", mean_cents: 0 }, { pitch: "Eb4", mean_cents: 0 },
  ] });
  assert.equal(rows.size, 2);
});

/* ---- refusal --------------------------------------------------------- */

test("comparable blocks when the readings are not on the same scale", () => {
  const a = record(FIVE);
  for (const [field, value] of [["temperament", "equal"], ["reference_hz", 440],
                                ["mode", "temperament"], ["root", "D"], ["tonic", "G4"]]) {
    const check = comparable(a, record(FIVE, { [field]: value }));
    assert.equal(check.ok, false, field);
    assert.ok(check.blockers.some((b) => b.field === field), `${field} named as the blocker`);
  }
  assert.equal(comparable(a, record(FIVE)).ok, true);
});

test("no note in common is a refusal, not a warning", () => {
  const check = comparable(record({ "D4": 0 }), record({ "A5": 0 }));
  assert.equal(check.ok, false);
  assert.ok(check.blockers.some((b) => b.field === "noSharedNotes"));
});

test("practice records without a tonic are not blocked on it", () => {
  const a = record(FIVE, { exercise: "practice: calibration", tonic: undefined });
  const b = record(FIVE, { exercise: "practice: calibration", tonic: undefined });
  assert.equal(comparable(a, b).ok, true);
});

/* ---- the offset correction ------------------------------------------- */

test("a uniformly sharper instrument shows as offset, not as per-note differences", () => {
  // The case the whole design exists for: B is +8 cents on every note.
  const a = record(FIVE);
  const b = record(Object.fromEntries(Object.entries(FIVE).map(([k, v]) => [k, v + 8])));
  const result = compare(a, b);
  assert.equal(result.ok, true);
  approx(result.offsetDiff, 8, 1e-9, "the pitch difference is reported once");
  for (const row of result.rows) {
    approx(row.diff, 0, 1e-9, `${row.key} corrected difference`);
    assert.equal(row.verdict, "noise");
  }
  approx(result.internalA, result.internalB, 1e-9, "equally consistent with themselves");
});

test("a real per-note difference survives the correction and is marked notable", () => {
  const a = record(FIVE);
  const b = record({ ...FIVE, "F#4": FIVE["F#4"] + 20 });
  const result = compare(a, b);
  const fs = result.rows.find((r) => r.key === "F#4");
  // F# moved 20c; the mean of five notes moved 4c, so 16c survives correction.
  approx(fs.diff, 16, 1e-9);
  assert.equal(fs.verdict, "notable");
  assert.ok(result.internalB > result.internalA, "B is less consistent with itself");
});

test("rows come back in pitch order, with both counts", () => {
  const result = compare(record(FIVE), record(FIVE));
  assert.deepEqual(result.rows.map((r) => r.key), ["A4", "G4", "F#4", "E4", "D4"]);
  assert.ok(result.rows.every((r) => r.aN === 3 && r.bN === 3));
});

/* ---- honesty about small samples ------------------------------------- */

test("a difference inside the spread is noise; the same one with a single occurrence is unjudged", () => {
  const spread = { occurrences: 4, jitter: 12 };       // wide spread per note
  const a = record(FIVE, spread);
  const b = record({ ...FIVE, "G4": FIVE["G4"] + 3 }, spread);
  assert.equal(compare(a, b).rows.find((r) => r.key === "G4").verdict, "noise");

  const once = { occurrences: 1 };
  const single = compare(record(FIVE, once), record({ ...FIVE, "G4": FIVE["G4"] + 3 }, once));
  assert.ok(single.rows.every((r) => r.verdict === "few"), "one occurrence proves nothing");
});

test("few shared notes warns without blocking", () => {
  const three = { "D4": 0, "E4": 2, "G4": -2 };
  const result = compare(record(three), record(three));
  assert.equal(result.ok, true);
  const warning = result.warnings.find((w) => w.kind === "fewNotes");
  assert.ok(warning && warning.count === 3 && warning.count < MIN_SHARED_NOTES);
});

test("different session kinds warn", () => {
  const result = compare(record(FIVE), record(FIVE, { exercise: "practice: calibration" }));
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.kind === "differentKind"));
});

/* ---- stopper checks compare by octave width -------------------------- */

test("two stopper checks also compare their octave widths", () => {
  const stopper = (widthCents) => ({
    exercise: "practice: stopper", ...SETTINGS, tonic: undefined,
    notes: [
      { pitch: "D4", target_hz: 277.29, mean_cents: 0, stdev_cents: 1 },
      { pitch: "D5", target_hz: 554.58, mean_cents: widthCents, stdev_cents: 1 },
    ],
  });
  const result = compare(stopper(4), stopper(-6));
  assert.ok(result.octaves, "octave comparison present");
  assert.equal(result.octaves.length, 1);
  approx(result.octaves[0].a, 4, 0.01);
  approx(result.octaves[0].b, -6, 0.01);
  assert.equal(compare(record(FIVE), record(FIVE)).octaves, undefined,
    "only for stopper checks");
});
