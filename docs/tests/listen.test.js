/* Free-play segmentation and the drone notch selection. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { RegionTracker } from "../audio/regions.js";
import { dronePartialsToNotch } from "../audio/engine.js";
import { NoteSegmenter } from "../audio/segmenter.js";

const FS = 512 / 44100;
const voiced = (hz) => ({ hz, levelDb: -20 });
const silent = () => ({ hz: 0, levelDb: -70 });

function feed(tracker, frames) {
  const closed = [];
  for (const f of frames) { const r = tracker.push(f); if (r) closed.push(r); }
  return closed;
}

test("a steady note closes on silence with its median and length", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  const frames = [...Array(40).fill(voiced(415.0)), ...Array(6).fill(silent())];
  const closed = feed(tr, frames);
  assert.equal(closed.length, 1);
  assert.ok(Math.abs(closed[0].medianHz - 415.0) < 1e-9);
  assert.ok(Math.abs(closed[0].seconds - 40 * FS) < 1e-9);
  assert.equal(closed[0].short, false);
  assert.ok(Math.abs(closed[0].meanDb - (-20)) < 1e-9, "level travels with pitch");
  assert.equal(closed[0].levelsDb.length, 40);
});

test("the confirming frames of a new note bring their levels with them", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  const frames = [...Array(30).fill(voiced(415.0)), ...Array(30).fill({ hz: 466.16, levelDb: -12 })];
  feed(tr, frames);
  const last = tr.flush();
  assert.equal(last.levelsDb.length, 30);
  assert.ok(Math.abs(last.meanDb - (-12)) < 1e-9);
});

test("two notes played legato split on the pitch change", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  const frames = [...Array(30).fill(voiced(415.0)), ...Array(30).fill(voiced(466.16))];
  const closed = feed(tr, frames);
  assert.equal(closed.length, 1);                       // first note closed by the change
  assert.ok(Math.abs(closed[0].medianHz - 415.0) < 1e-9);
  const last = tr.flush();
  assert.ok(Math.abs(last.medianHz - 466.16) < 1e-9);
  assert.equal(last.framesHz.length, 30, "the confirming frames belong to the new note");
});

test("a single stray frame is a blip, not a new note", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  const frames = [...Array(20).fill(voiced(415.0)), voiced(830.0), ...Array(20).fill(voiced(415.0)), ...Array(6).fill(silent())];
  const closed = feed(tr, frames);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].framesHz.length, 40);          // the blip was dropped
});

test("a short note is reported but flagged", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  const closed = feed(tr, [...Array(5).fill(voiced(554.37)), ...Array(6).fill(silent())]);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].short, true);
});

test("drone partials to notch: everything except the note being played", () => {
  const d4 = 277.29;
  const cents = (a, b) => 1200 * Math.log2(b / a);
  const near = (list, hz) => list.some((x) => Math.abs(cents(x, hz)) < 1);
  const a4 = dronePartialsToNotch(d4, 415.94);
  assert.equal(a4.length, 3);                          // A4 is far from all three partials
  const unison = dronePartialsToNotch(d4, d4);
  assert.equal(unison.length, 2);
  assert.ok(!near(unison, d4) && near(unison, 2 * d4) && near(unison, 3 * d4));
  const octave = dronePartialsToNotch(d4, 2 * d4);
  assert.ok(near(octave, d4) && !near(octave, 2 * d4) && near(octave, 3 * d4));
  const twelfth = dronePartialsToNotch(d4, 3 * d4);
  assert.ok(near(twelfth, d4) && near(twelfth, 2 * d4) && !near(twelfth, 3 * d4));
  assert.deepEqual(dronePartialsToNotch(null, 415), []);
});

/* ---- the tonic gate --------------------------------------------------- */

const TONIC_SECONDS = 0.45;
const tonicGate = () => new NoteSegmenter({
  targetHz: 277.29, frameSeconds: FS, requiredSeconds: TONIC_SECONDS,
});

test("the tonic is recognised despite the odd dropped frame", () => {
  // What an iPad actually delivers: a held note with occasional unvoiced
  // frames. Counting *consecutive* frames -- the original gate -- never
  // reached forty here and the session never started.
  const gate = tonicGate();
  let consecutive = 0, bestConsecutive = 0;
  const needed = Math.ceil(TONIC_SECONDS / FS);
  for (let i = 0; i < 200 && !gate.complete; i++) {
    const dropped = i % 9 === 8;
    gate.push(dropped ? 0 : 277.29, dropped ? -70 : -20);
    consecutive = dropped ? 0 : consecutive + 1;
    bestConsecutive = Math.max(bestConsecutive, consecutive);
  }
  assert.ok(gate.complete, "the gate opens");
  assert.ok(bestConsecutive < needed,
    `never ${needed} in a row (best run ${bestConsecutive}) -- the old gate would still be waiting`);
});

test("the tonic gate keeps progress across a breath, and is not opened by another note", () => {
  const gate = tonicGate();
  for (let i = 0; i < 20; i++) gate.push(277.29, -20);
  const held = gate.elapsedSeconds;
  for (let i = 0; i < 12; i++) gate.push(0, -70);        // a breath
  assert.ok(gate.elapsedSeconds >= held, "progress survives the breath");
  for (let i = 0; i < 40; i++) gate.push(277.29, -20);
  assert.ok(gate.complete);

  const wrong = tonicGate();
  for (let i = 0; i < 200; i++) wrong.push(415.0, -20);  // a fifth above
  assert.equal(wrong.complete, false, "a different note never opens the session");
});

test("the tonic is accepted in any octave the flute has it in", () => {
  // One gate per octave; whichever fills first opens the session.
  const gates = [277.29, 554.58, 1109.16].map((hz) =>
    new NoteSegmenter({ targetHz: hz, frameSeconds: FS, requiredSeconds: TONIC_SECONDS }));
  for (let i = 0; i < 60; i++) for (const g of gates) g.push(554.58, -20);
  assert.deepEqual(gates.map((g) => g.complete), [false, true, false]);
});
