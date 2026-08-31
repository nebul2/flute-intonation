/* Identifying a temperament from a played scale.
 *
 * The arithmetic is exact, so most of this is synthetic on purpose: a
 * temperament's own shape, fed back in, must come out named. What synthetic
 * data cannot tell us is how well a real harpsichord measures, which is why
 * the confidence rules here are deliberately pessimistic. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  identify, candidates, temperamentShape, shapeDistance,
  PITCH_CLASSES, CONTENTION_CENTS, MIN_CLASSES,
} from "../core/identify.js";

const ALL = [...Array(12).keys()];
/** A temperament's own shape as a measurement: exact, no error. */
const exact = (key) => temperamentShape(key);

test("a temperament played perfectly identifies itself", () => {
  for (const key of ["vallotti", "werckmeister3", "kirnberger3", "meantone_quarter", "equal"]) {
    const result = identify(exact(key));
    assert.equal(result.best.temperament, key, `${key} -> ${result.best.temperament}`);
    assert.ok(result.best.distance < 1e-9, `${key} fits exactly`);
  }
});

test("the root is found, and equal temperament is offered without one", () => {
  // Vallotti rooted on F: rotate its C-rooted shape by 5 semitones.
  const c = exact("vallotti");
  const onF = c.map((_, i) => c[(i - 5 + 12) % 12]);
  const result = identify(onF);
  assert.equal(result.best.temperament, "vallotti");
  assert.equal(result.best.root, 5, `root ${PITCH_CLASSES[result.best.root ?? 0]}`);

  assert.equal(identify(exact("equal")).best.root, null, "equal has no root");
  assert.equal(candidates().filter((x) => x.temperament === "equal").length, 1,
    "and is offered once, not twelve times");
});

test("overall pitch is removed, so the instrument's own pitch cannot mislead", () => {
  // The same temperament on an instrument sitting 18 cents sharp.
  const raw = exact("werckmeister3").map((c) => c + 18);
  const result = identify(raw, { referenceHz: 440 });
  assert.equal(result.best.temperament, "werckmeister3", "the shape is untouched by it");

  // The instrument's pitch is read off its A, not off the average of all its
  // notes: the average carries the temperament's own shape too, and would
  // report a pitch the instrument does not have.
  const expected = 440 * 2 ** ((exact("werckmeister3")[9] + 18) / 1200);
  assert.ok(Math.abs(result.measuredHz - expected) < 1e-9, "A is where the pitch is read");
  assert.equal(result.measuredFrom, "a");
});

test("without an A, the pitch is read from the mean and says so", () => {
  const raw = exact("equal").map((c, i) => (i === 9 ? null : c + 12));
  const result = identify(raw, { referenceHz: 415 });
  assert.equal(result.measuredFrom, "mean");
  assert.ok(Math.abs(result.measuredHz - 415 * 2 ** (12 / 1200)) < 1e-9);
});

test("a reference pitch set far from the instrument is flagged, not trusted", () => {
  const raw = exact("vallotti").map((c) => c + 44);
  assert.equal(identify(raw).offsetSuspect, true,
    "beyond ~35 cents every note is named by the wrong neighbour");
  assert.equal(identify(exact("vallotti")).offsetSuspect, false);
});

test("meantone is separable from everything; the well temperaments are not", () => {
  // The numbers this feature lives or dies by. Measured, not assumed.
  const dist = (a, b) => shapeDistance(exact(a), exact(b), ALL);
  for (const well of ["vallotti", "werckmeister3", "kirnberger3"]) {
    assert.ok(dist("meantone_quarter", well) > 9, `meantone vs ${well}: ${dist("meantone_quarter", well).toFixed(1)}c`);
    assert.ok(dist("equal", well) > 3, `equal vs ${well}: ${dist("equal", well).toFixed(1)}c`);
  }
  // Under two cents apart -- inside a good tuner's own error, so no claim.
  assert.ok(dist("vallotti", "kirnberger3") < 2);
  assert.ok(dist("vallotti", "werckmeister3") < 2.1);
  assert.ok(dist("werckmeister3", "kirnberger3") < 2);
});

test("a well temperament measured with realistic error names the family, not the temperament", () => {
  // Vallotti with about a cent of error per note: what a real, well-tuned
  // harpsichord actually offers. The family must survive; the name must not
  // be claimed, because the rivals are closer than the error.
  const error = [0.9, -1.1, 0.4, -0.6, 1.2, -0.9, 0.5, 1.0, -1.2, 0.7, -0.4, 0.8];
  const measured = exact("vallotti").map((c, i) => c + error[i]);
  const result = identify(measured);
  assert.equal(result.verdict, "well", `verdict ${result.verdict}`);
  assert.ok(result.contenders.length > 1, "several well temperaments fit equally");
  assert.ok(result.contenders.every((c) => c.temperament !== "meantone_quarter" && c.temperament !== "equal"),
    "but meantone and equal are ruled out");
});

test("meantone survives the same error and is named outright", () => {
  const error = [0.9, -1.1, 0.4, -0.6, 1.2, -0.9, 0.5, 1.0, -1.2, 0.7, -0.4, 0.8];
  const measured = exact("meantone_quarter").map((c, i) => c + error[i]);
  const result = identify(measured);
  assert.equal(result.verdict, "temperament");
  assert.equal(result.best.temperament, "meantone_quarter");
});

test("an incomplete scale is fitted on the notes actually played", () => {
  // Seven of twelve: fewer constraints, so the fit is looser, but a diatonic
  // scale is what a player will often give and it must still say something.
  const full = exact("meantone_quarter");
  const partial = full.map((c, i) => ([0, 2, 4, 5, 7, 9, 11].includes(i) ? c : null));
  const result = identify(partial);
  assert.equal(result.present, 7);
  assert.equal(result.partial, true);
  assert.equal(result.best.temperament, "meantone_quarter");
});

test("too few notes yields no claim at all", () => {
  const full = exact("vallotti");
  const few = full.map((c, i) => (i < MIN_CLASSES - 1 ? c : null));
  const result = identify(few);
  assert.equal(result.verdict, "insufficient");
  assert.deepEqual(result.ranked, []);
  assert.equal(result.best, null);
});

test("contention is judged on distance, so a clear winner stands alone", () => {
  const result = identify(exact("meantone_quarter"));
  assert.equal(result.contenders.length, 1);
  assert.ok(result.ranked[1].distance > CONTENTION_CENTS, "the runner-up is far behind");
});

/* ---- from frequencies, as the detector reports them ------------------- */

import { classifyHz } from "../core/identify.js";
import { parseScala, TemperamentTuning, ReferencePitch } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";
import { SpelledPitch } from "../core/pitch.js";

/** The twelve frequencies an instrument in `key` on `rootName` would sound. */
function octaveHz(key, rootName, referenceHz) {
  const tuning = new TemperamentTuning(
    parseScala(TEMPERAMENTS[key].scl),
    SpelledPitch.parse(`${rootName}4`),
    new ReferencePitch(SpelledPitch.parse("A4"), referenceHz),
  );
  return ["C4", "C#4", "D4", "D#4", "E4", "F4", "F#4", "G4", "G#4", "A4", "A#4", "B4"]
    .map((n) => tuning.targetHz(SpelledPitch.parse(n)));
}

test("pitch classes are named from the reference A, over the whole range", () => {
  const ref = 441;
  const cases = { "C4": 0, "D4": 2, "G#4": 8, "A4": 9, "B4": 11, "C5": 0, "A5": 9, "F3": 5 };
  for (const [name, index] of Object.entries(cases)) {
    const semis = SpelledPitch.parse(name).chromaticIndex - SpelledPitch.parse("A4").chromaticIndex;
    const hz = ref * 2 ** (semis / 12);
    const got = classifyHz(hz, ref);
    assert.equal(got.index, index, `${name} -> ${PITCH_CLASSES[got.index]}`);
    assert.ok(Math.abs(got.cents) < 1e-9, `${name} is exactly on it`);
  }
});

test("a harpsichord in meantone at 441 is identified from its frequencies alone", () => {
  // The whole chain a real instrument goes through, minus the microphone:
  // sounded frequencies -> named by proximity -> deviations -> verdict.
  const ref = 441;
  const heard = octaveHz("meantone_quarter", "C", ref);
  const deviations = Array(12).fill(null);
  for (const hz of heard) {
    const { index, cents } = classifyHz(hz, ref);
    deviations[index] = cents;
  }
  assert.equal(deviations.filter((d) => d !== null).length, 12, "all twelve named distinctly");

  const result = identify(deviations, { referenceHz: ref });
  assert.equal(result.verdict, "temperament");
  assert.equal(result.best.temperament, "meantone_quarter");
  assert.equal(result.best.root, 0, `root ${PITCH_CLASSES[result.best.root ?? 0]}`);
  assert.ok(Math.abs(result.measuredHz - ref) < 0.05, `A reads ${result.measuredHz.toFixed(2)}`);
});

test("a reference a whole semitone out shifts the root, and only the pitch reveals it", () => {
  // 441 read against 415 is 105 cents: every note is named by its neighbour a
  // semitone up. The shape is unchanged by that -- it fits perfectly -- so the
  // temperament is still right and the root comes out one semitone sharp. No
  // amount of arithmetic can catch this, because a uniform semitone shift and
  // a genuinely different root are the same data. The only tell is the pitch
  // the instrument is reported to sound, which is why the view shows it.
  const heard = octaveHz("meantone_quarter", "C", 441);
  const deviations = Array(12).fill(null);
  for (const hz of heard) {
    const { index, cents } = classifyHz(hz, 415);
    deviations[index] = cents;
  }
  const result = identify(deviations, { referenceHz: 415 });
  assert.equal(result.best.temperament, "meantone_quarter", "the temperament survives");
  assert.ok(result.best.distance < 1e-9, "and fits perfectly, so nothing looks wrong");
  assert.equal(PITCH_CLASSES[result.best.root], "C#", "but the root is a semitone out");
  assert.equal(result.offsetSuspect, false, "and no offset warning can fire");
  // 412 Hz, for an instrument at 441: the player sees this and knows.
  assert.ok(Math.abs(result.measuredHz - 412.2) < 0.5, `A reads ${result.measuredHz.toFixed(1)}`);
});

/* ---- what each candidate predicts ------------------------------------- */

import { predictedCents, expectedHz, bestByTemperament, temperamentShape as shapeOf } from "../core/identify.js";

test("a candidate's prediction is slid to the instrument's own pitch", () => {
  // Vallotti on an instrument sitting 9 cents sharp: the prediction must come
  // out 9 cents sharp too, or every note would look wrong by the offset -- the
  // one thing a temperament says nothing about.
  const measured = shapeOf("vallotti").map((c) => c + 9);
  const predicted = predictedCents(measured, shapeOf("vallotti"));
  for (let i = 0; i < 12; i++) {
    assert.ok(Math.abs(predicted[i] - measured[i]) < 1e-9,
      `class ${PITCH_CLASSES[i]}: predicted ${predicted[i]}, measured ${measured[i]}`);
  }
});

test("the prediction is fitted only on the notes actually played", () => {
  const measured = Array(12).fill(null);
  [0, 4, 7].forEach((i) => { measured[i] = shapeOf("vallotti")[i] + 20; });
  const predicted = predictedCents(measured, shapeOf("vallotti"));
  for (const i of [0, 4, 7]) {
    assert.ok(Math.abs(predicted[i] - measured[i]) < 1e-9, `fitted on ${PITCH_CLASSES[i]}`);
  }
  assert.ok(Number.isFinite(predicted[1]), "and still predicts the ones that were not");
});

test("expected frequencies land on the reference and on true octaves", () => {
  assert.ok(Math.abs(expectedHz(9, 0, 441) - 441) < 1e-9, "A with no deviation is the reference");
  assert.ok(Math.abs(expectedHz(9, 0, 441, 5) - 882) < 1e-9, "an octave up is exactly double");
  assert.ok(Math.abs(expectedHz(9, 0, 441, 3) - 220.5) < 1e-9, "an octave down is exactly half");
  // C4 against A4 = 441: nine semitones below.
  assert.ok(Math.abs(expectedHz(0, 0, 441) - 441 * 2 ** (-9 / 12)) < 1e-9);
  // A deviation moves it by exactly that many cents.
  assert.ok(Math.abs(expectedHz(9, 12, 441) - 441 * 2 ** (12 / 1200)) < 1e-9);
});

test("the leaderboard shows each temperament once, at its best root", () => {
  const result = identify(exact("vallotti"));
  const rows = bestByTemperament(result.ranked);
  assert.equal(rows.length, 5, "five temperaments, not forty-nine candidates");
  assert.equal(new Set(rows.map((r) => r.temperament)).size, 5, "each appears once");
  assert.equal(rows[0].temperament, "vallotti", "best first");
  assert.equal(rows[0].root, 0);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].distance >= rows[i - 1].distance, "sorted by fit");
  }
});

/* ---- the teaching table ----------------------------------------------- */

import { temperamentTable, matchRow, INDISTINGUISHABLE_CENTS } from "../core/identify.js";

test("every temperament is anchored to the same A, which is what makes the columns comparable", () => {
  const table = temperamentTable({ referenceHz: 441, root: 0 });
  const a = table[9];
  assert.equal(a.name, "A");
  for (const cell of a.cells) {
    assert.ok(Math.abs(cell.hz - 441) < 1e-9, `${cell.temperament} puts A at ${cell.hz}`);
  }
  assert.ok(a.spreadCents < 1e-9, "so A cannot differ between them");
  assert.equal(a.indistinguishable, true);
});

test("the accidentals are where the temperaments part company", () => {
  // The lesson the table exists to teach, and the reason it is playable: the
  // naturals barely move, the accidentals swing about twenty cents.
  const table = temperamentTable({ referenceHz: 441, root: 0 });
  const by = Object.fromEntries(table.map((r) => [r.name, r]));
  assert.ok(by["G#"].spreadCents > 15, `G# spread ${by["G#"].spreadCents.toFixed(1)}c`);
  assert.ok(by["D#"].spreadCents > 15, `D# spread ${by["D#"].spreadCents.toFixed(1)}c`);
  assert.ok(by["A#"].spreadCents > 15, `A# spread ${by["A#"].spreadCents.toFixed(1)}c`);
  assert.ok(by["D"].spreadCents < 5, `D spread ${by["D"].spreadCents.toFixed(1)}c`);
  assert.ok(by["D"].indistinguishable, "and D is flagged as not worth hunting for");
  assert.ok(!by["G#"].indistinguishable);
});

test("the table follows the root it is given", () => {
  const onC = temperamentTable({ referenceHz: 441, root: 0 });
  const onF = temperamentTable({ referenceHz: 441, root: 5 });
  const vallotti = (table) => table.map((r) => r.cells.find((c) => c.temperament === "vallotti").cents);
  // Assert on the whole vector, not on one note: these temperaments have
  // repeating structure, so individual notes can happen to land at the same
  // height under two different roots. E does exactly that between C and F.
  assert.notDeepEqual(vallotti(onC).map((c) => c.toFixed(2)), vallotti(onF).map((c) => c.toFixed(2)),
    "Vallotti on C and on F are different instruments to play in");
  const moved = vallotti(onC).filter((c, i) => Math.abs(c - vallotti(onF)[i]) > 1).length;
  assert.ok(moved >= 5, `only ${moved} notes moved when the root changed`);

  // Equal is the same at every root, which is the whole of its character.
  for (let i = 0; i < 12; i++) {
    const c = onC[i].cells.find((x) => x.temperament === "equal");
    const f = onF[i].cells.find((x) => x.temperament === "equal");
    assert.ok(Math.abs(c.hz - f.hz) < 1e-9, `equal moved at ${onC[i].name}`);
  }
});

test("frequencies scale by exact octaves and follow the reference", () => {
  const four = temperamentTable({ referenceHz: 441, root: 0, octave: 4 });
  const five = temperamentTable({ referenceHz: 441, root: 0, octave: 5 });
  for (let i = 0; i < 12; i++) {
    for (let c = 0; c < five[i].cells.length; c++) {
      assert.ok(Math.abs(five[i].cells[c].hz - four[i].cells[c].hz * 2) < 1e-9,
        `${four[i].name} ${four[i].cells[c].temperament}`);
    }
    assert.ok(Math.abs(five[i].spreadCents - four[i].spreadCents) < 1e-9, "shape is octave-free");
  }
  const at415 = temperamentTable({ referenceHz: 415, root: 0 });
  assert.ok(Math.abs(at415[9].cells[0].hz - 415) < 1e-9, "A follows the reference");
});

test("a played note matches every candidate it cannot be separated from", () => {
  const table = temperamentTable({ referenceHz: 441, root: 0 });
  const gsharp = table[8];

  // Played exactly at meantone's G#, which sits far from the other four.
  const meantone = gsharp.cells.find((c) => c.temperament === "meantone_quarter");
  const hit = matchRow(gsharp, meantone.cents);
  assert.deepEqual(hit.matches, ["meantone_quarter"], "only meantone is that low");
  assert.equal(hit.nearest, "meantone_quarter");

  // Played on D, where four of them sit within a couple of cents: several
  // must light up, because claiming one would be inventing a distinction.
  const d = table[2];
  const many = matchRow(d, d.cells.find((c) => c.temperament === "vallotti").cents);
  assert.ok(many.matches.length > 1, `only ${many.matches.length} matched a note they all agree on`);
});

test("a note played nowhere near any of them matches nothing", () => {
  const table = temperamentTable({ referenceHz: 441, root: 0 });
  const wild = matchRow(table[0], table[0].cells[0].cents + 40);
  assert.deepEqual(wild.matches, [], "40 cents out is not a match for anything");
  assert.ok(wild.nearest !== null, "but the nearest is still named, so the miss can be measured");
  assert.ok(wild.nearestOff > INDISTINGUISHABLE_CENTS);
});
