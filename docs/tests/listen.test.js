/* Free-play segmentation and the drone notch selection. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { RegionTracker } from "../audio/regions.js";
import { dronePartialsToNotch } from "../audio/engine.js";

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
