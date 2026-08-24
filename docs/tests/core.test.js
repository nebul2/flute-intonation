/* Golden tests for the ported core, carried over from
 * flutetrainer/tests/test_core.py with the same tolerances. Passing this file
 * is what proves the port: the .scl data, the ratio table and these expected
 * values are the durable assets DESIGN.md section 11 says must survive a port
 * unchanged.
 *
 * Run: node --test docs/tests/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpelledPitch, intervalBetween, centsBetween } from "../core/pitch.js";
import {
  BAROQUE_415, DEFAULT_RATIOS, HarmonicContext, PureIntervalTuning,
  TemperamentTuning, parseScala,
} from "../core/tuning.js";
import { TEMPERAMENTS, TEMPERAMENT_ORDER } from "../core/temperaments.js";

const P = (s) => SpelledPitch.parse(s);
const approx = (got, want, abs, label = "") =>
  assert.ok(Math.abs(got - want) <= abs, `${label} expected ${want} ± ${abs}, got ${got}`);
const temperament = (name, root = "C", reference = BAROQUE_415) =>
  new TemperamentTuning(parseScala(TEMPERAMENTS[name].scl), P(`${root}4`), reference);

/* ---- spelled pitch and intervals ---------------------------------- */

test("enharmonics are distinct objects but share pitch class", () => {
  const dSharp = P("D#4"), eFlat = P("Eb4");
  assert.ok(!dSharp.equals(eFlat));
  assert.equal(dSharp.pitchClass, eFlat.pitchClass);
});

test("interval spelling", () => {
  for (const [lower, upper, expected] of [
    ["C4", "E4", "M3"], ["C4", "Fb4", "d4"], ["D4", "F#4", "M3"], ["D4", "A4", "P5"],
    ["F4", "A4", "M3"], ["B3", "F4", "d5"], ["F4", "B4", "A4"], ["C4", "C4", "P1"],
    ["A4", "G5", "m7"],
  ]) {
    assert.equal(intervalBetween(P(lower), P(upper)).simpleName, expected, `${lower}->${upper}`);
  }
});

test("C->E and C->Fb select different ratios", () => {
  const m3 = intervalBetween(P("C4"), P("E4")).simpleName;
  const d4 = intervalBetween(P("C4"), P("Fb4")).simpleName;
  assert.notEqual(DEFAULT_RATIOS[m3], DEFAULT_RATIOS[d4]);
});

test("compound and descending intervals", () => {
  const up = intervalBetween(P("D4"), P("F#5"));
  assert.deepEqual([up.simpleName, up.octaves], ["M3", 1]);
  const down = intervalBetween(P("D5"), P("F#4"));
  assert.deepEqual([down.simpleName, down.octaves], ["M3", -1]);
});

test("pitch names round-trip", () => {
  for (const name of ["C4", "F#5", "Bb3", "Eb5", "C##4", "Abb4", "D-1"]) {
    assert.equal(P(name).name, name);
  }
});

/* ---- Scala parsing ------------------------------------------------- */

test("parses cents and ratio values", () => {
  const scl = parseScala("! test.scl\n!\nmixed values\n 3\n!\n 100.0\n 3/2\n 2/1\n");
  assert.equal(scl.noteCount, 3);
  approx(scl.degreesCents[1], 100.0, 1e-9);
  approx(scl.degreesCents[2], 701.955, 1e-3);
  approx(scl.periodCents, 1200.0, 1e-9);
});

test("rejects wrong note count", () => {
  assert.throws(() => parseScala("desc\n 3\n 100.0\n 1200.0\n"), /declares 3/);
});

test("rejects non-ascending scale", () => {
  assert.throws(() => parseScala("desc\n 3\n 300.0\n 100.0\n 1200.0\n"), /ascending/);
});

test("rejects non-twelve-note temperament", () => {
  const scl = parseScala("desc\n 3\n 100.0\n 700.0\n 1200.0\n");
  assert.throws(() => new TemperamentTuning(scl, P("C4"), BAROQUE_415), /12-note/);
});

test("every bundled temperament parses to twelve notes", () => {
  assert.deepEqual(TEMPERAMENT_ORDER.length, 5);
  for (const name of TEMPERAMENT_ORDER) {
    const scl = parseScala(TEMPERAMENTS[name].scl);
    assert.equal(scl.noteCount, 12, name);
    assert.ok(TEMPERAMENTS[name].help.en && TEMPERAMENTS[name].help.fr, name);
  }
});

/* ---- temperament targets: golden values ---------------------------- */

test("equal temperament places the reference exactly", () => {
  const et = temperament("equal");
  approx(et.targetHz(P("A4")), 415.0, 1e-9);
  approx(et.targetHz(P("A5")), 830.0, 1e-9);
  approx(et.targetHz(P("A3")), 207.5, 1e-9);
});

test("equal temperament D5 at 415", () => {
  approx(temperament("equal").targetHz(P("D5")), 415.0 * Math.pow(2, 5 / 12), 1e-6);
});

test("reference placement is independent of root", () => {
  for (const root of ["C", "D", "F", "A"]) {
    approx(temperament("vallotti", root).targetHz(P("A4")), 415.0, 1e-9, root);
  }
});

test("Vallotti D major third is narrower than Pythagorean", () => {
  const v = temperament("vallotti");
  const cents = centsBetween(v.targetHz(P("D5")), v.targetHz(P("F#5")));
  assert.ok(cents > 386.0 && cents < 408.0);
  approx(cents, 396.09, 0.01);
});

test("temperament collapses enharmonics by design", () => {
  const v = temperament("vallotti");
  approx(v.targetHz(P("D#5")), v.targetHz(P("Eb5")), 1e-9);
});

test("Vallotti all twelve degrees, golden to 0.01 Hz", () => {
  const v = temperament("vallotti");
  const expected = {
    C5: 495.1957, "C#5": 522.8672, D5: 554.5845, Eb5: 588.2256,
    E5: 621.0957, F5: 661.7538, "F#5": 697.1563, G5: 741.1179,
    "G#5": 784.3009, A5: 830.0000, Bb5: 882.3385, B5: 929.5418,
  };
  for (const [name, hz] of Object.entries(expected)) {
    approx(v.targetHz(P(name)), hz, 0.01, name);
  }
});

test("quarter-comma meantone has a pure C-E third", () => {
  const m = temperament("meantone_quarter");
  approx(m.targetHz(P("E5")) / m.targetHz(P("C5")), 1.25, 1e-6);
});

/* ---- pure-interval targets ---------------------------------------- */

test("pure third over the drone is exactly five fourths", () => {
  const anchor = temperament("vallotti");
  const pure = new PureIntervalTuning(anchor);
  const drone = P("D5");
  const got = pure.targetHz(P("F#5"), new HarmonicContext(drone));
  approx(got, anchor.targetHz(drone) * 1.25, 1e-9);
});

test("pure mode distinguishes A as third and as fifth", () => {
  const pure = new PureIntervalTuning(temperament("equal"));
  const asThird = pure.targetHz(P("A5"), new HarmonicContext(P("F4")));
  const asFifth = pure.targetHz(P("A5"), new HarmonicContext(P("D4")));
  approx(centsBetween(asFifth, asThird), -15.641, 0.01);
});

test("pure intervals deviate from equal by textbook amounts", () => {
  const anchor = temperament("equal");
  const pure = new PureIntervalTuning(anchor);
  const bass = P("C4");
  const context = new HarmonicContext(bass);
  const bassHz = anchor.targetHz(bass);
  for (const [name, semis, cents] of [
    ["E4", 4, -13.686], ["G4", 7, 1.955], ["Eb4", 3, 15.641], ["A4", 9, -15.641],
  ]) {
    const got = pure.targetHz(P(name), context);
    approx(centsBetween(bassHz * Math.pow(2, semis / 12), got), cents, 0.01, name);
  }
});

test("pure interval requires context", () => {
  const pure = new PureIntervalTuning(temperament("equal"));
  assert.throws(() => pure.targetHz(P("A4"), null), /requires harmonic context/);
});

test("ratio table override", () => {
  const anchor = temperament("equal");
  const pure = new PureIntervalTuning(anchor, { ...DEFAULT_RATIOS, M2: 10 / 9 });
  const bassHz = anchor.targetHz(P("C4"));
  approx(pure.targetHz(P("D4"), new HarmonicContext(P("C4"))), bassHz * 10 / 9, 1e-9);
});

test("cross-validation: meantone tempered F# over D equals the pure 5:4", () => {
  // Two independent paths -- Scala cents arithmetic vs a rational ratio --
  // must agree, since quarter-comma meantone has pure major thirds.
  const m = temperament("meantone_quarter");
  const tempered = m.targetHz(P("F#4"));
  const pure = new PureIntervalTuning(m).targetHz(P("F#4"), new HarmonicContext(P("D4")));
  approx(centsBetween(tempered, pure), 0.0, 0.01);
});
