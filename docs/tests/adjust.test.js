/* The same written note over two basses.
 *
 * The measurement is a difference between two soundings and never a distance
 * from a reference. That is the property most worth pinning: it is what makes
 * the verdict survive a reference pitch set wrong, which has produced wrong
 * answers twice already in this app. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { compareAdjustment, SAME_NOTE_CENTS, ENOUGH, TOO_FAR } from "../core/adjust.js";
import { intervalAdjust } from "../core/generator.js";
import { SpelledPitch, centsBetween } from "../core/pitch.js";
import { parseScala, TemperamentTuning, ReferencePitch, PureIntervalTuning } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";

const approx = (got, want, abs, label = "") =>
  assert.ok(Math.abs(got - want) <= abs, `${label} expected ${want} ± ${abs}, got ${got}`);

const tuningAt = (hz = 415, temperament = "vallotti") => new TemperamentTuning(
  parseScala(TEMPERAMENTS[temperament].scl), SpelledPitch.parse("C4"),
  new ReferencePitch(SpelledPitch.parse("A4"), hz));

/** The two targets for a tonic, and how far the note has to travel. */
function targets(tonic, hz = 415, temperament = "vallotti") {
  const tuning = tuningAt(hz, temperament);
  const pure = new PureIntervalTuning(tuning);
  const [third, fifth] = intervalAdjust(tonic);
  const pitch = third.notes[0].pitch;
  const a = pure.targetHz(pitch, third.notes[0].context);
  const b = pure.targetHz(pitch, fifth.notes[0].context);
  return { pitch, a, b, required: centsBetween(a, b) };
}

/** A sounding: the note played `err` cents from its target. */
const sounding = (pitch, targetHz, err) => ({ pitch, targetHz, meanCents: err });

test("the exercise puts the same written note over two basses", () => {
  for (const tonic of ["D", "G", "A", "C", "F"]) {
    const [third, fifth] = intervalAdjust(tonic);
    assert.equal(third.notes.length, 1);
    assert.equal(fifth.notes.length, 1);
    assert.ok(third.notes[0].pitch.equals(fifth.notes[0].pitch),
      `${tonic}: the written note must not change between the two`);
    assert.ok(!third.drone.equals(fifth.drone), `${tonic}: the bass must change`);
    // Each drone sits below the note it supports.
    for (const ex of [third, fifth]) {
      assert.ok(ex.drone.chromaticIndex < ex.notes[0].pitch.chromaticIndex,
        `${tonic}: the drone must be below the note`);
    }
  }
});

test("the note is the mediant, and the second bass makes it a fifth", () => {
  // D major: F# is a third over D and a fifth over B -- the example
  // Lazarevitch demonstrates.
  const [third, fifth] = intervalAdjust("D");
  assert.equal(third.notes[0].pitch.name, "F#4");
  assert.equal(third.drone.name, "D4");
  assert.equal(fifth.drone.name, "B3");
  assert.equal(fifth.notes[0].pitch.chromaticIndex - fifth.drone.chromaticIndex, 7,
    "seven semitones is a fifth");
  assert.equal(third.notes[0].pitch.chromaticIndex - third.drone.chromaticIndex, 4,
    "four semitones is a major third");
});

test("the note has to rise, by an amount the temperament decides", () => {
  for (const tonic of ["D", "G", "A", "C", "F"]) {
    const { required } = targets(tonic);
    assert.ok(required > 5, `${tonic}: must rise by something playable, got ${required.toFixed(1)}`);
    assert.ok(required < 25, `${tonic}: ${required.toFixed(1)} cents is implausibly large`);
  }
  // Equal temperament places every bass identically, so every key asks the
  // same amount -- a pure third is 13.7 flat and a pure fifth 2 sharp.
  const equal = ["D", "G", "A", "C", "F"].map((t) => targets(t, 415, "equal").required);
  for (const r of equal) approx(r, 15.6, 0.2, "equal temperament");
  // A historical temperament does not, which is itself worth seeing.
  const vallotti = ["D", "G", "A", "C", "F"].map((t) => targets(t).required);
  assert.ok(new Set(vallotti.map((r) => r.toFixed(1))).size > 1,
    "Vallotti should not ask the same of every key");
});

test("playing it identically both times is recognised as not having moved", () => {
  // Where everyone starts, and the habit the exercise exists to undo -- so it
  // must be told apart from a wrong-direction move, not lumped in with it.
  const { pitch, a, b, required } = targets("D");
  const compared = compareAdjustment(
    sounding(pitch, a, 0), sounding(pitch, b, -required));
  assert.equal(compared.verdict, "same");
  approx(compared.actual, 0, 1e-6);
});

test("moving with the bass is recognised, and moving against it is not", () => {
  const { pitch, a, b, required } = targets("D");
  const at = (err) => compareAdjustment(sounding(pitch, a, 0), sounding(pitch, b, err));

  assert.equal(at(0).verdict, "moved", "the whole way");
  approx(at(0).actual, required, 1e-6);
  approx(at(0).share, 1, 1e-6);

  assert.equal(at(-required / 2).verdict, "moved", "half way is still moving");
  assert.equal(at(-required * 2).verdict, "opposite", "the wrong way");
  assert.equal(at(required).verdict, "far", "much too far");
});

test("the verdict survives a reference pitch set wrong", () => {
  // The property the whole design rests on. Both notes move together when the
  // reference is wrong, so the difference between them is untouched -- unlike
  // every other measurement in this app, which needed the offset removing.
  const right = targets("D", 415);
  const wrong = targets("D", 440);
  approx(wrong.required, right.required, 0.01, "the required move is the same");

  const play = (t, err) => compareAdjustment(
    sounding(t.pitch, t.a, err), sounding(t.pitch, t.b, err));
  for (const err of [0, 12, -20]) {
    assert.equal(play(right, err).verdict, "moved");
    assert.equal(play(wrong, err).verdict, "moved");
    approx(play(wrong, err).actual, play(right, err).actual, 0.01,
      `a flute sitting ${err} cents off must not change the answer`);
  }
});

test("a missing sounding yields no verdict rather than a wrong one", () => {
  const { pitch, a } = targets("D");
  assert.equal(compareAdjustment(null, sounding(pitch, a, 0)), null);
  assert.equal(compareAdjustment(sounding(pitch, a, 0), null), null);
  assert.equal(compareAdjustment(null, null), null);
});

test("the thresholds are constants, and sit where they are described", () => {
  assert.ok(SAME_NOTE_CENTS > 0 && SAME_NOTE_CENTS < 6, "a few cents is not a move");
  assert.ok(ENOUGH > 0 && ENOUGH < 1, "partial credit is partial");
  assert.ok(TOO_FAR > 1, "overshooting means going past the whole way");
});
