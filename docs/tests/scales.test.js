/* Recognising scales.
 *
 * The synthetic cases below pin the arithmetic and nothing else. What decides
 * whether this works is `recordings.test.js`, which runs the whole shipped
 * pipeline over real playing -- because every rule this project has reasoned
 * out from simulation alone has been wrong until a flute corrected it. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  scaleRuns, stepwiseChains, majorTemplate, alignToTemplate, correctOctaveErrors,
  MAJOR_STEPS, SCALE_MIN_NOTES, SCALE_MIN_FIT,
} from "../core/scales.js";
import { SpelledPitch } from "../core/pitch.js";
import { scale } from "../core/generator.js";

/** Notes as the view supplies them, one every half second. */
function played(names, { start = 0, spacing = 0.5, hold = 0.45 } = {}) {
  return names.map((name, i) => ({
    pitch: SpelledPitch.parse(name),
    index: i,
    atSeconds: start + i * spacing,
    seconds: hold,
  }));
}

/** The real thing, straight from the generator, so the test cannot drift. */
const majorScale = (tonic, opts = {}) =>
  scale(tonic, { descending: true, ...opts }).notes.map((n) => n.pitch.name);

test("a major scale up and back down is one run, not two", () => {
  const runs = scaleRuns(played(majorScale("D")));
  assert.equal(runs.length, 1, `expected one run, got ${runs.length}`);
  assert.equal(runs[0].tonicName, "D");
  assert.equal(runs[0].shape, "updown");
  assert.equal(runs[0].octaves, 1);
  assert.ok(runs[0].fit > 0.99, `fit ${runs[0].fit}`);
});

test("two octaves is told from one", () => {
  const one = scaleRuns(played(majorScale("G")));
  const two = scaleRuns(played(majorScale("G", { octaves: 2 })));
  assert.equal(one[0].octaves, 1);
  assert.equal(two[0].octaves, 2);
  assert.equal(two[0].tonicName, "G");
});

test("a scale that stops at the top is still a scale", () => {
  const runs = scaleRuns(played(majorScale("D", { descending: false })));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].shape, "up");
});

test("the key is worked out, not assumed from the first note", () => {
  for (const tonic of ["D", "G", "A", "E", "C", "F"]) {
    const runs = scaleRuns(played(majorScale(tonic)));
    assert.equal(runs.length, 1, `${tonic}: ${runs.length} runs`);
    assert.equal(runs[0].tonicName, tonic, `${tonic} heard as ${runs[0].tonicName}`);
  }
});

test("the spelling is re-derived from the key, never taken from what arrived", () => {
  // The trap this exists for: naming picks the nearest of a fixed list by
  // cents alone, so E major's D# arrives as Eb. Real audio confirmed it. The
  // same pitch class must come back as D# in E major and Eb in Bb major.
  const e = scaleRuns(played(["E4", "F#4", "G#4", "A4", "B4", "C#5", "Eb5", "E5"]));
  assert.equal(e.length, 1);
  assert.equal(e[0].tonicName, "E");
  assert.ok(e[0].expected.map((p) => p.name).includes("D#5"),
    `E major should spell D#5, got ${e[0].expected.map((p) => p.name).join(" ")}`);

  const bflat = scaleRuns(played(majorScale("B", { key: "Bb" })));
  assert.equal(bflat[0].tonicName, "Bb");
  assert.ok(bflat[0].expected.map((p) => p.name).includes("Eb5"),
    `Bb major should spell Eb5, got ${bflat[0].expected.map((p) => p.name).join(" ")}`);
});

test("an octave error is repaired rather than allowed to break the run", () => {
  // Measured six times in 226 real notes, always at a register crossing.
  const { chroma, repaired } = correctOctaveErrors([62, 52, 64, 66]);   // D5 E4 E5 F#5
  assert.deepEqual(repaired, [1]);
  assert.deepEqual([...chroma], [62, 64, 64, 66]);

  const names = majorScale("D", { octaves: 2 });
  const withError = [...names];
  withError[8] = "E4";                                   // E5 heard an octave low
  const runs = scaleRuns(played(withError));
  assert.equal(runs.length, 1, "the run survives the jump");
  assert.equal(runs[0].tonicName, "D");
  assert.equal(runs[0].octaveErrors, 1, "and the repair is reported, not hidden");
});

test("a wrong note costs one note, not the whole scale", () => {
  const names = majorScale("C");
  // Sharpen whichever F this scale actually contains -- C major starts on C5,
  // not C4, because rootOf lifts a root that falls below the flute's bottom D.
  const fluffed = names.map((n) => (/^F\d/.test(n) ? n.replace("F", "F#") : n));
  assert.ok(fluffed.some((n) => n.startsWith("F#")), "the test must actually fluff something");
  const runs = scaleRuns(played(fluffed));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].tonicName, "C");
  assert.ok(runs[0].wrongNotes >= 1, "the wrong note is counted");
  assert.ok(runs[0].fit < 1.0 && runs[0].fit >= SCALE_MIN_FIT, `fit ${runs[0].fit}`);
});

test("a missing note is the ordinary case and barely costs anything", () => {
  // Notes too short to measure never reach this function at all, so a gap in
  // the middle of a scale is normal rather than exceptional.
  const names = majorScale("D").filter((n) => n !== "G4");
  const runs = scaleRuns(played(names));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].tonicName, "D");
  assert.ok(runs[0].missingNotes >= 1);
});

test("a re-articulated note costs almost nothing", () => {
  const names = majorScale("D", { descending: false });
  const doubled = [...names, "D5"];              // the apex tongued twice
  const runs = scaleRuns(played(doubled));
  assert.equal(runs.length, 1);
  assert.ok(runs[0].fit > 0.9, `fit ${runs[0].fit}`);
});

test("an arpeggio is not a scale", () => {
  const runs = scaleRuns(played(["D4", "F#4", "A4", "D5", "A4", "F#4", "D4"]));
  assert.deepEqual(runs, []);
});

test("a chromatic scale is not a major scale", () => {
  const runs = scaleRuns(played(["C4", "C#4", "D4", "Eb4", "E4", "F4", "F#4", "G4"]));
  assert.deepEqual(runs, [], `got ${runs.map((r) => r.tonicName).join()}`);
});

test("a scale abandoned half way is not counted", () => {
  const runs = scaleRuns(played(["G4", "A4", "B4", "C5", "D5"]));
  assert.deepEqual(runs, []);
  assert.ok(5 < SCALE_MIN_NOTES, "and it is short of the minimum on purpose");
});

test("two scales run together with no breath are split by contour alone", () => {
  // The case silence cannot solve: measured at 0.05 s apart in real playing,
  // which is inside the within-scale range. Here they share no gap at all.
  const names = [...majorScale("D", { descending: false }),
                 ...majorScale("G", { descending: false })];
  const runs = scaleRuns(played(names, { spacing: 0.3, hold: 0.3 }));
  assert.equal(runs.length, 2, `expected two runs, got ${runs.map((r) => r.tonicName).join()}`);
  assert.deepEqual(runs.map((r) => r.tonicName), ["D", "G"]);
});

test("a long silence splits a chain the contour would have continued", () => {
  const names = [...majorScale("D", { descending: false }), "E5", "F#5", "G5", "A5", "B5", "C#6", "D6"];
  const together = scaleRuns(played(names));
  const apart = scaleRuns([
    ...played(names.slice(0, 8)),
    ...played(names.slice(8), { start: 20 }),
  ]);
  assert.equal(together[0].octaves, 2, "unbroken, it is one two-octave scale");
  assert.equal(apart[0].octaves, 1, "with a silence in the middle, it is not");
});

test("timings are optional; without them the contour still works", () => {
  const bare = majorScale("D").map((name, i) => ({ pitch: SpelledPitch.parse(name), index: i }));
  const runs = scaleRuns(bare);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].tonicName, "D");
});

test("a declared tonic is verified rather than searched for", () => {
  // Guided and chosen modes know the key, which is what lets them accept a
  // run too damaged for free mode to place.
  const names = majorScale("D");
  const damaged = names.filter((_, i) => i !== 2 && i !== 9);
  const free = scaleRuns(played(damaged));
  const told = scaleRuns(played(damaged), { expectTonic: SpelledPitch.parse("D4").pitchClass });
  assert.equal(told.length, 1, "declared, it is found");
  assert.equal(told[0].tonicName, "D");
  assert.ok(free.length === 0 || free[0].tonicName === "D",
    "and free mode either agrees or declines, but never names another key");
});

test("a key outside the palette is reported by pitch class, not refused", () => {
  // F# major cannot be spelled -- KEY_SIGNATURES does not carry it -- but the
  // player still played it, and saying nothing would be the feature failing.
  const fsharp = ["F#4", "G#4", "A#4", "B4", "C#5", "D#5", "F5", "F#5"];
  const runs = scaleRuns(played(fsharp));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].spellable, false);
  assert.equal(runs[0].tonicName, null);
  assert.equal(runs[0].pitchClassName, "F#");
  assert.equal(runs[0].expected, null, "and no spelling is invented");
});

test("the template is the major scale and nothing else", () => {
  assert.deepEqual([...MAJOR_STEPS], [2, 2, 1, 2, 2, 2, 1]);
  assert.deepEqual(majorTemplate(60, { octaves: 1, shape: "up" }), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.deepEqual(majorTemplate(60, { octaves: 1, shape: "down" }), [72, 71, 69, 67, 65, 64, 62, 60]);
  assert.equal(majorTemplate(60, { octaves: 1, shape: "updown" }).length, 15);
  assert.equal(majorTemplate(60, { octaves: 2, shape: "up" }).length, 15);
});

test("alignment recovers from a note added before the tonic", () => {
  // The case a greedy walk cannot survive: it eats the pickup as the tonic,
  // everything after shifts by one, and the scale is lost.
  const template = majorTemplate(62, { octaves: 1, shape: "up" });
  const withPickup = [61, ...template];
  const fitted = alignToTemplate(withPickup, template);
  assert.equal(fitted.matched, template.length, "every template note still matched");
  assert.equal(fitted.extra, 1, "and the pickup is reported as the extra it is");
});

test("chains are found without judging what they are", () => {
  const chains = stepwiseChains(played(majorScale("D")));
  assert.equal(chains.length, 1);
  assert.deepEqual(chains[0], { start: 0, end: 15 });
});

test("a flat key is expected by its own tonic, not by its first letter", () => {
  // The defect this pins: guided mode derived the expected tonic from key[0],
  // so asking for Bb major told the recogniser to expect B -- a semitone out,
  // which can never match. The flat keys silently never advanced.
  for (const [key, tonic] of [["Bb", "B"], ["Eb", "E"], ["Ab", "A"]]) {
    assert.notEqual(SpelledPitch.parse(`${key}4`).pitchClass,
      SpelledPitch.parse(`${key[0]}4`).pitchClass,
      `${key} and ${key[0]} must not share a pitch class`);

    const names = majorScale(tonic, { key });
    const told = scaleRuns(played(names), {
      expectTonic: SpelledPitch.parse(`${key}4`).pitchClass,
    });
    assert.equal(told.length, 1, `${key} major should be found when correctly expected`);
    assert.equal(told[0].tonicName, key);
  }
});

test("only the notes that landed on a degree are offered for measuring", () => {
  // A fluffed or misheard note measured against the pitch it was named as is
  // measuring the detector, not the player -- on this flute, E major's G#
  // was heard as A at the wrong reference and read 38 cents flat.
  const names = majorScale("D", { descending: false });
  const fluffed = [...names];
  fluffed[3] = "G#4";                                  // G natural played sharp
  const runs = scaleRuns(played(fluffed));
  assert.equal(runs.length, 1);
  assert.ok(runs[0].wrongIndices.includes(3), "the fluff is named as wrong");
  assert.ok(!runs[0].matchedIndices.includes(3), "and kept out of the matched set");
  assert.equal(runs[0].matchedIndices.length + runs[0].wrongIndices.length, names.length);
  for (const i of runs[0].matchedIndices) {
    assert.ok(i >= runs[0].start && i < runs[0].end, "indices are absolute, not chain-relative");
  }
});
