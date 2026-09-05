/* What the scales page says after a session.
 *
 * This lives in core and is tested here for one reason: the report was
 * silently broken three times, and nobody could tell me why, because it was
 * computed inside a view that cannot run without a browser. The last break
 * was a variable used a line above the one that declared it, thrown inside an
 * async method nobody awaited -- so the summary vanished without a word while
 * the live tally cheerfully counted scales. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { scaleReport, CROSS_KEY_NOTABLE_CENTS } from "../core/scaleReport.js";
import { recogniseSession } from "../core/scales.js";
import { SpelledPitch } from "../core/pitch.js";
import { parseScala, TemperamentTuning, ReferencePitch, PureIntervalTuning } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";
import { scale } from "../core/generator.js";

const FRAME = 512 / 44100;
const tuningAt = (hz = 415) => new TemperamentTuning(
  parseScala(TEMPERAMENTS.vallotti.scl), SpelledPitch.parse("C4"),
  new ReferencePitch(SpelledPitch.parse("A4"), hz));

/* A note as the view supplies it: frames around a target, so analyseNote has
 * something to measure. `off` bends the whole note by that many cents. */
function noteAt(tuning, name, { off = 0, frames = 40, index = 0 } = {}) {
  const pitch = SpelledPitch.parse(name);
  const hz = tuning.targetHz(pitch) * 2 ** (off / 1200);
  return {
    pitch, index, seconds: frames * FRAME, atSeconds: index * 0.5,
    framesHz: new Array(frames).fill(hz),
  };
}

function session(tuning, names, bends = {}) {
  return names.map((n, i) => noteAt(tuning, n, { off: bends[n] ?? 0, index: i }));
}

const majorScale = (tonic, opts = {}) =>
  scale(tonic, { descending: true, ...opts }).notes.map((n) => n.pitch.name);

test("a report is produced for a single scale in a single key", () => {
  // The case the cross-key table cannot speak to, and the one that reported
  // nothing at all: one key, and the page must still say something.
  const tuning = tuningAt();
  const notes = session(tuning, majorScale("D"), { "F#4": 25, "F#5": 25 });
  const runs = recogniseSession(notes);
  assert.equal(runs.length, 1);

  const report = scaleReport({ notes, runs, tuning, pure: new PureIntervalTuning(tuning),
                               frameSeconds: FRAME });
  assert.equal(report.scaleCount, 1);
  assert.equal(report.keys.length, 1);
  assert.ok(report.measuredNotes > 10, `only ${report.measuredNotes} notes measured`);
  assert.ok(report.overall, "a session score is produced");
  assert.ok(report.best, "and a key to lead with");
  assert.ok(report.standouts.list.length >= 1,
    "the bent F# must be named even though there is only one key");
  assert.deepEqual(report.crossKey, [], "and the cross-key table stays empty, as it must");
});

test("the note that was bent is the note that is named", () => {
  const tuning = tuningAt();
  const notes = session(tuning, majorScale("G"), { "C5": 30 });
  const report = scaleReport({ notes, runs: recogniseSession(notes), tuning,
    pure: new PureIntervalTuning(tuning), frameSeconds: FRAME });
  const named = report.standouts.list.map((n) => n.pitch.name);
  assert.ok(named.includes("C5"), `expected C5 among ${named.join(" ")}`);
  const c = report.standouts.list.find((n) => n.pitch.name === "C5");
  assert.equal(c.direction, "sharp");
});

test("the same note in two keys is compared, once there are two keys", () => {
  const tuning = tuningAt();
  // F# sharp in D, clean in G: the finding a scales session exists to make.
  const notes = [
    ...session(tuning, majorScale("D", { descending: false }), { "F#4": 30 }),
    ...session(tuning, majorScale("G", { descending: false })),
  ].map((n, i) => ({ ...n, index: i, atSeconds: i * 0.5 }));

  const report = scaleReport({ notes, runs: recogniseSession(notes), tuning,
    pure: new PureIntervalTuning(tuning), frameSeconds: FRAME });
  assert.equal(report.keys.length, 2);
  assert.ok(report.crossKey.length >= 1, "something is comparable across the two");
  const fsharp = report.crossKey.find((r) => r.pitch.pitchClass === SpelledPitch.parse("F#4").pitchClass);
  assert.ok(fsharp, "F# occurs in both keys and must be compared");
  assert.ok(fsharp.spread > CROSS_KEY_NOTABLE_CENTS,
    `F# was bent in one key only, so it must spread: got ${fsharp.spread.toFixed(1)}`);
  assert.equal(fsharp.cells.length, 2);
});

test("a uniform offset is reported once and taken out of every key", () => {
  // A flute sitting sharp, or a reference set wrong, must not read as bad
  // playing in every key at once.
  const tuning = tuningAt();
  const names = [...majorScale("D", { descending: false }), ...majorScale("G", { descending: false })];
  const flat = session(tuning, names);
  const sharp = names.map((n, i) => noteAt(tuning, n, { off: 25, index: i }));

  const of = (notes) => scaleReport({ notes, runs: recogniseSession(notes), tuning,
    pure: new PureIntervalTuning(tuning), frameSeconds: FRAME });
  const a = of(flat), b = of(sharp);

  assert.ok(Math.abs(b.offsetCents - a.offsetCents - 25) < 1.5,
    `the offset should carry the whole 25 cents: ${a.offsetCents} -> ${b.offsetCents}`);
  for (let i = 0; i < a.keys.length; i++) {
    assert.ok(Math.abs(a.keys[i].score.relative - b.keys[i].score.relative) < 0.5,
      `${a.keys[i].label}: evenness must not move with the offset`);
  }
  assert.equal(b.action, "pullOut", "and sharp means pull the headjoint out");
});

test("keys that were suggested but never played are listed, and only those", () => {
  const tuning = tuningAt();
  const notes = session(tuning, majorScale("D"));
  const report = scaleReport({ notes, runs: recogniseSession(notes), tuning,
    pure: new PureIntervalTuning(tuning), frameSeconds: FRAME,
    expectedKeys: ["D", "G", "A", "E"] });
  assert.deepEqual(report.missed, ["G", "A", "E"]);
});

test("an empty session reports nothing rather than throwing", () => {
  const tuning = tuningAt();
  const report = scaleReport({ notes: [], runs: [], tuning,
    pure: new PureIntervalTuning(tuning), frameSeconds: FRAME });
  assert.deepEqual(report.keys, []);
  assert.equal(report.overall, null);
  assert.equal(report.best, null);
  assert.equal(report.action, null);
  assert.deepEqual(report.standouts.list, []);
  assert.deepEqual(report.crossKey, []);
  assert.equal(report.measuredNotes, 0);
});
