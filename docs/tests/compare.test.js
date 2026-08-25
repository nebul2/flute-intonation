/* Comparing two sessions: grouping, refusal rules, and above all the offset
 * correction that separates an instrument's pitch from its tuning. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { compare, comparable, perNote, MIN_SHARED_NOTES, MAX_COMPARE } from "../core/compare.js";

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
  approx(result.offsets[1] - result.offsets[0], 8, 1e-9, "the pitch difference is reported once");
  for (const row of result.rows) {
    approx(row.range, 0, 1e-9, `${row.key} corrected difference`);
    assert.equal(row.verdict, "noise");
  }
  approx(result.sessions[0].internal, result.sessions[1].internal, 1e-9,
         "equally consistent with themselves");
});

test("a real per-note difference survives the correction and is marked notable", () => {
  const a = record(FIVE);
  const b = record({ ...FIVE, "F#4": FIVE["F#4"] + 20 });
  const result = compare(a, b);
  const fs = result.rows.find((r) => r.key === "F#4");
  // F# moved 20c; the mean of five notes moved 4c, so 16c survives correction.
  approx(fs.values[1].corrected - fs.values[0].corrected, 16, 1e-9);
  approx(fs.range, 16, 1e-9);
  assert.equal(fs.verdict, "notable");
  assert.ok(result.sessions[1].internal > result.sessions[0].internal,
            "B is less consistent with itself");
  assert.equal(result.best.index, 0, "A wins on the score");
});

test("rows come back in pitch order, with both counts", () => {
  const result = compare(record(FIVE), record(FIVE));
  assert.deepEqual(result.rows.map((r) => r.key), ["A4", "G4", "F#4", "E4", "D4"]);
  assert.ok(result.rows.every((r) => r.values.every((v) => v.n === 3)));
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
  approx(result.octaves[0].widths[0], 4, 0.01);
  approx(result.octaves[0].widths[1], -6, 0.01);
  assert.equal(compare(record(FIVE), record(FIVE)).octaves, undefined,
    "only for stopper checks");
});

/* ---- the score and its verdict --------------------------------------- */

test("the score is the internal deviation, and a consistent lead is called", () => {
  // B's notes sit twice as far from its own centre as A's do, on every note.
  const a = record(FIVE);
  const b = record({ "D4": 0.4, "E4": 8.4, "F#4": -11.6, "G4": 4.4, "A4": -1.6 });
  const result = compare(a, b);
  approx(result.sessions[0].score, result.sessions[0].internal, 1e-12);
  assert.ok(result.sessions[0].score < result.sessions[1].score);
  assert.equal(result.best.index, 0);
  assert.equal(result.best.runnerUp, 1);
  assert.ok(result.best.gap > 0, "the runner-up is worse by a positive amount");
  assert.equal(result.best.notable, true, "worse on every note is a real lead");
});

test("one badly-out note does not make the whole instrument worse", () => {
  // B is A with a single note 25 cents out. Its score is worse, but the
  // note-to-note scatter of the differences swamps the lead, so no verdict
  // is announced -- the guard that keeps the score from over-claiming.
  const result = compare(record(FIVE), record({ ...FIVE, "F#4": FIVE["F#4"] + 25 }));
  assert.ok(result.sessions[1].score > result.sessions[0].score, "the score does move");
  assert.equal(result.best.notable, false, "but one note is not a verdict");
});

test("two equally tuned instruments are too close to call", () => {
  const result = compare(record(FIVE), record(FIVE));
  approx(result.best.gap, 0, 1e-9);
  assert.equal(result.best.notable, false);
});

test("a lead built on too few notes is never called", () => {
  const two = { "D4": 0, "A4": 20 };
  const result = compare(record(two), record({ "D4": 0, "A4": 40 }));
  assert.equal(result.best.notable, false, "two notes cannot support a verdict");
});

test("repeatability and steadiness are reported per instrument", () => {
  const steady = record(FIVE, { occurrences: 4, jitter: 0 });
  const wobbly = record(FIVE, { occurrences: 4, jitter: 10 });
  const result = compare(steady, wobbly);
  assert.ok(result.sessions[1].repeatability > result.sessions[0].repeatability,
            "the jittery run lands the same note less consistently");
  approx(result.sessions[0].steadiness, 2, 1e-9);   // stdev_cents is 2 in the fixture
});

/* ---- three instruments ------------------------------------------------ */

test("three sessions compare on the same footing as two", () => {
  const a = record(FIVE);
  const b = record(Object.fromEntries(Object.entries(FIVE).map(([k, v]) => [k, v + 8])));
  const c = record({ ...FIVE, "G4": FIVE["G4"] + 18 });
  const result = compare([a, b, c]);
  assert.equal(result.ok, true);
  assert.equal(result.sessions.length, 3);
  assert.equal(result.rows[0].values.length, 3);

  // B is only a transposition of A, so after correction it matches A exactly
  // and the range across the three comes entirely from C.
  const g = result.rows.find((r) => r.key === "G4");
  approx(g.values[0].corrected, g.values[1].corrected, 1e-9);
  approx(g.range, Math.abs(g.values[2].corrected - g.values[0].corrected), 1e-9);
  assert.equal(g.verdict, "notable");

  // The offsets still describe pitch, not tuning.
  approx(result.offsets[1] - result.offsets[0], 8, 1e-9);
  // A and B are equally well tuned; C is the odd one out, so it cannot win.
  assert.notEqual(result.best.index, 2);
});

test("more than three at once is refused, and so is one", () => {
  const many = [record(FIVE), record(FIVE), record(FIVE), record(FIVE)];
  assert.equal(comparable(many).ok, false);
  assert.ok(comparable(many).blockers.some((b) => b.field === "count"));
  assert.equal(comparable([record(FIVE)]).ok, false);
  assert.equal(MAX_COMPARE, 3);
});

test("a blocker in any of three refuses the whole comparison", () => {
  const result = compare([record(FIVE), record(FIVE), record(FIVE, { temperament: "equal" })]);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((b) => b.field === "temperament"));
});

test("shared notes are those present in every session", () => {
  const a = record({ "D4": 0, "E4": 0, "G4": 0 });
  const b = record({ "D4": 0, "E4": 0 });
  const c = record({ "D4": 0, "G4": 0 });
  assert.deepEqual(comparable([a, b, c]).shared, ["D4"]);
});
