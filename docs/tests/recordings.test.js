/* The web pipeline against real flute recordings.
 *
 * Everything else in this suite is synthetic, and this project's standing
 * lesson is that synthetic tones repeatedly failed to reveal what real audio
 * found in minutes -- the detector crash on breath noise, the phantom F
 * between E and F#, and the trill rule below, which was reasoned out from
 * simulation and turned out never to fire on a real trill.
 *
 * Recordings are gitignored and nobody else has them, so every check skips
 * when its file is absent rather than failing. Capture them with
 * `python -m flutetrainer.tools.record --take trills`. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyse } from "./wavpipe.js";
import { scaleRuns, recogniseSession } from "../core/scales.js";
import { scaleReport } from "../core/scaleReport.js";
import { SpelledPitch } from "../core/pitch.js";
import { parseScala, TemperamentTuning, ReferencePitch, PureIntervalTuning } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const recording = (name) => path.join(root, "recordings", name);
const have = (name) => fs.existsSync(recording(name));

/* Plain playing: the false-positive side. No ornament rule may fire here, or
 * ordinary notes would be thrown away. */
test("long tones are measured, and are neither trills nor slurs", { skip: !have("longtones.wav") }, () => {
  const report = analyse(recording("longtones.wav"));
  assert.ok(report.counts.note >= 12, `notes measured: ${report.counts.note}`);
  assert.equal(report.trillRuns, 0, "a held note does not alternate");
  assert.equal(report.counts.slur ?? 0, 0);
  assert.ok(report.regions.every((r) => r.blipShare < 0.2), "clean notes barely blip");
});

test("tongued repetitions are measured, not mistaken for ornaments",
     { skip: !have("attacks.wav") }, () => {
  const report = analyse(recording("attacks.wav"));
  assert.ok(report.counts.note >= 8, `notes measured: ${report.counts.note}`);
  assert.equal(report.trillRuns, 0,
    "the same note tongued again is not an alternation: the pitch never changes");
});

/* Trills: the true-positive side, and the reason the rule had to change. A
 * baroque trill accelerates from slow to as fast as it will go, so one
 * gesture sweeps every alternation speed. Measured across five of them, the
 * alternations ran from 0.49 s down to 0.05 s -- every one long enough to
 * become a region of its own, which is why the blip rule never fired. */
test("recorded trills are recognised as ornaments", { skip: !have("trills.wav") }, () => {
  const report = analyse(recording("trills.wav"));
  assert.ok(report.trillRuns >= 4, `runs found: ${report.trillRuns}`);
  assert.ok(report.counts.trill > report.counts.note,
    `a recording of trills is mostly trill: ${JSON.stringify(report.counts)}`);
  // Almost nothing should be left over as unexplained fragments: before the
  // runs were recognised this file produced 112 too-short regions.
  assert.ok((report.counts.short ?? 0) <= 10,
    `few unexplained fragments: ${report.counts.short ?? 0}`);
});

/* A trill whose fingering changes part-way: the written auxiliary gives way
 * to its neighbour, so the upper pole steps by a semitone mid-ornament. */
test("a trill that changes fingering stays one ornament",
     { skip: !have("trillfingering.wav") }, () => {
  const report = analyse(recording("trillfingering.wav"));
  assert.ok(report.trillRuns >= 2, `ornaments found: ${report.trillRuns}`);
  assert.ok(report.counts.trill > report.counts.note,
    `mostly ornament: ${JSON.stringify(report.counts)}`);
  // The point of the join: no stray alternation left behind as a note. The
  // written auxiliary sounded once or twice before the swap and must not be
  // reported as something the player meant.
  assert.ok((report.counts.note ?? 0) <= report.trillRuns * 3,
    `few leftovers: ${report.counts.note} notes for ${report.trillRuns} ornaments`);
});

test("a piece keeps its notes while its ornaments are set aside",
     { skip: !have("piece.wav") }, () => {
  const report = analyse(recording("piece.wav"));
  assert.ok(report.trillRuns >= 5, `ornaments found: ${report.trillRuns}`);
  assert.ok(report.counts.note >= 50,
    `the music itself survives: ${JSON.stringify(report.counts)}`);
  // The scales and plain notes must outnumber what is set aside, or the rule
  // is eating the piece rather than its ornaments.
  assert.ok(report.counts.note > (report.counts.short ?? 0) + (report.counts.slur ?? 0),
    "measured notes outnumber the leftovers");
});

/* ---- scales, on the instrument ---------------------------------------- */

test("a scales session is recognised key by key", { skip: !have("scales.wav") }, () => {
  // 175 seconds of this flute: D one octave and two, G two, A one, E, Bb, a
  // C scale with a deliberate F#, a false start, a scale abandoned half way,
  // two scales run together with no breath, and one fast and one slow.
  const runs = scaleRuns(analyse(recording("scales.wav")).notes);
  const keys = runs.map((r) => r.tonicName ?? r.pitchClassName);

  for (const key of ["D", "G", "A", "E", "Bb", "C"]) {
    assert.ok(keys.includes(key), `${key} major was played and should be found: got ${keys.join(" ")}`);
  }
  // The two-octave scales are told from the one-octave ones.
  assert.ok(runs.some((r) => r.tonicName === "D" && r.octaves === 2), "D over two octaves");
  assert.ok(runs.some((r) => r.tonicName === "G" && r.octaves === 2), "G over two octaves");
  assert.ok(runs.some((r) => r.tonicName === "A" && r.octaves === 1), "A over one octave");
});

test("the two scales run together with no breath are split apart", () => {
  // The case that killed the obvious design: within a scale the notes are
  // contiguous -- median gap 0.00 s -- and these two were 0.05 s apart, well
  // inside that. No silence threshold could ever separate them, so the
  // contour has to, and this is the proof that it does.
  if (!have("scales.wav")) return;
  const runs = scaleRuns(analyse(recording("scales.wav")).notes);
  const ups = runs.filter((r) => r.shape === "up" && r.octaves === 1);
  const pair = ups.findIndex((r, i) =>
    i + 1 < ups.length && r.tonicName === "D" && ups[i + 1].tonicName === "G");
  assert.ok(pair >= 0, `expected a D-then-G pair among ${ups.map((r) => r.tonicName).join(" ")}`);
});

test("the spelling comes from the key, on real audio", () => {
  // E major's D# arrives from the detector named Eb, because naming picks the
  // nearest of a fixed list by cents alone. Confirmed in this recording.
  if (!have("scales.wav")) return;
  const e = scaleRuns(analyse(recording("scales.wav")).notes).find((r) => r.tonicName === "E");
  assert.ok(e, "E major should be found");
  assert.ok(e.expected.map((p) => p.name).includes("D#5"),
    `E major must spell D#5, got ${e.expected.map((p) => p.name).join(" ")}`);
});

test("real playing that is not scales yields no scales", () => {
  // The bound that matters most. piece.wav is 85 notes of a Hotteterre
  // prelude -- real music, full of stepwise motion, and exactly what a loose
  // recogniser would claim as scales. arpeggio.wav is the clean negative.
  for (const take of ["arpeggio", "piece", "attacks", "trills", "trillfingering"]) {
    if (!have(`${take}.wav`)) continue;
    const runs = scaleRuns(analyse(recording(`${take}.wav`)).notes);
    assert.deepEqual(runs, [], `${take}.wav gave ${runs.length} false scales: `
      + runs.map((r) => `${r.tonicName ?? r.pitchClassName} fit ${r.fit.toFixed(2)}`).join(", "));
  }
});

test("the long-tones take is the two-octave D major scale it actually is", () => {
  // Not planned as a scales fixture; it simply is one, played slowly up the
  // instrument. A free positive control that predates the feature.
  if (!have("longtones.wav")) return;
  const runs = scaleRuns(analyse(recording("longtones.wav")).notes);
  assert.equal(runs.length, 1, `expected one run, got ${runs.length}`);
  assert.equal(runs[0].tonicName, "D");
  assert.equal(runs[0].octaves, 2);
  assert.equal(runs[0].shape, "up", "played up only, never brought back down");
});

test("a real scales session produces an actual report, not an empty one", () => {
  // Three sessions were played before anyone could tell me the report was
  // throwing: the failure was silent, inside an async method, and the live
  // tally kept counting scales while the summary rendered nothing. This is
  // the check that would have caught it on the first session.
  if (!have("scales.wav")) return;
  const tuning = new TemperamentTuning(
    parseScala(TEMPERAMENTS.vallotti.scl), SpelledPitch.parse("C4"),
    new ReferencePitch(SpelledPitch.parse("A4"), 415));
  const notes = analyse(recording("scales.wav")).notes;
  const runs = recogniseSession(notes, { expectTonic: 2 });

  const report = scaleReport({
    notes, runs, tuning, pure: new PureIntervalTuning(tuning),
    frameSeconds: 512 / 44100,
    expectedKeys: ["D", "G", "A", "E", "C", "F", "Bb", "Eb"],
  });

  assert.ok(report.scaleCount >= 10, `only ${report.scaleCount} scales`);
  assert.ok(report.keys.length >= 5, `only ${report.keys.length} keys`);
  assert.ok(report.measuredNotes > 100,
    `only ${report.measuredNotes} notes measured -- the report would be empty`);
  assert.ok(report.overall, "a session score");
  assert.ok(report.best, "a key to lead with");
  assert.ok(report.standouts.list.length > 0, "notes worth naming");
  assert.ok(report.crossKey.length > 0, "and notes comparable across keys");
  for (const row of report.crossKey) {
    assert.ok(row.cells.length >= 2, "a cross-key row needs two keys by definition");
    assert.ok(Number.isFinite(row.spread) && row.spread >= 0, "with a real spread");
  }
  for (const key of report.keys) {
    assert.ok(key.runCount >= 1);
    if (key.score) assert.ok(Number.isFinite(key.score.relative));
  }
});
