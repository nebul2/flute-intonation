/* Telling playing from a drone bleeding back into the microphone: the
 * background measurement, and the level floor that uses it. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { BackgroundCalibration, ONSET_MARGIN_DB, CALIBRATE_MS,
         PLAYING_LEVEL_DB } from "../audio/calibration.js";
import { RegionTracker } from "../audio/regions.js";
import { dronePartials, dronePartialsToNotch } from "../audio/engine.js";

const FS = 512 / 44100;
const MS = FS * 1000;

function listen(calib, levels) {
  let done = false;
  levels.forEach((levelDb, i) => { done = calib.push({ levelDb, t: i * MS }); });
  return done;
}

test("the background is read near the top of the levels, not at their middle", () => {
  // What matters is the loudest the bleed gets, since that is what a note has
  // to clear -- but not the single loudest frame, which one chair would set.
  const calib = new BackgroundCalibration();
  const levels = Array.from({ length: 100 }, (_, i) => (i < 95 ? -60 : -20));
  listen(calib, levels);
  assert.equal(calib.backgroundDb, -60, "the five loudest frames do not set it");
  assert.equal(calib.onsetDb, -60 + ONSET_MARGIN_DB);
});

test("the window closes on the frames' own clock, not the wall clock", () => {
  const calib = new BackgroundCalibration();
  // One frame short of the window, then the frame that closes it.
  const frames = Math.ceil(CALIBRATE_MS / MS);
  assert.equal(listen(calib, Array(frames - 1).fill(-55)), false);
  assert.equal(calib.push({ levelDb: -55, t: CALIBRATE_MS }), true);
  assert.equal(calib.fraction, 1);
  // Later frames are ignored rather than dragging the measurement along.
  calib.push({ levelDb: 0, t: CALIBRATE_MS * 10 });
  assert.equal(calib.backgroundDb, -55);
});

test("a drone loud enough to have to be shouted over is called out", () => {
  const loud = new BackgroundCalibration();
  listen(loud, Array(80).fill(PLAYING_LEVEL_DB));
  assert.equal(loud.tooLoud, true, "background at playing level leaves no room");

  const sane = new BackgroundCalibration();
  listen(sane, Array(80).fill(-55));
  assert.equal(sane.tooLoud, false);
});

test("with no frames at all it does not gate everything out", () => {
  const calib = new BackgroundCalibration();
  assert.ok(calib.onsetDb < PLAYING_LEVEL_DB, "a silent measurement must not block playing");
});

/* ---- the level floor in free play ------------------------------------ */

const frame = (hz, levelDb) => ({ hz, levelDb });

function feed(tracker, frames) {
  const closed = [];
  for (const f of frames) { const r = tracker.push(f); if (r) closed.push(r); }
  return closed;
}

test("the drone going on after the player stops does not become a note", () => {
  // The failure this exists for: the drone never goes unvoiced, so a region
  // left open is continued by bleed and then split off into a phantom note
  // sitting on the drone's own pitch, between every phrase.
  const played = Array(40).fill(frame(370.0, -22));     // an F# over a D drone
  const bleed = Array(120).fill(frame(293.66, -52));    // the drone, alone

  const ungated = new RegionTracker({ frameSeconds: FS });
  const loose = feed(ungated, [...played, ...bleed]);
  loose.push(ungated.flush());
  assert.equal(loose.length, 2, "without a floor the drone is a second note");
  assert.ok(Math.abs(loose[1].medianHz - 293.66) < 1e-9);

  const gated = new RegionTracker({ frameSeconds: FS, floorDb: -45 });
  const closed = feed(gated, [...played, ...bleed]);
  assert.equal(closed.length, 1, "the played note closes");
  assert.ok(Math.abs(closed[0].medianHz - 370.0) < 1e-9);
  assert.equal(gated.flush(), null, "and nothing is left open");
});

test("the floor closes a note the way silence does, not by truncating it", () => {
  const gated = new RegionTracker({ frameSeconds: FS, floorDb: -45 });
  const closed = feed(gated, [...Array(40).fill(frame(415.0, -20)),
                              ...Array(10).fill(frame(415.0, -80))]);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].framesHz.length, 40, "quiet frames are not part of the note");
});

test("without a floor nothing changes: it is off unless a drone is sounding", () => {
  const tracker = new RegionTracker({ frameSeconds: FS });
  const closed = feed(tracker, [...Array(40).fill(frame(415.0, -80)),
                                ...Array(6).fill(frame(0, -110))]);
  assert.equal(closed.length, 1, "a quiet note is still a note with no drone to fear");
});

/* ---- what gets notched --------------------------------------------- */

test("free play notches the whole drone; a guided note keeps its own pitch", () => {
  // The distinction that cost 8.4 most of its notes. An exercise knows which
  // note is coming and must not notch it away, so it excludes any partial
  // within the acceptance window of its target. Free play has no target and
  // takes all three -- measured at 94% recall against 31% without, on real
  // playing with the drone 12 dB under it (docs/tests/dronecost.js).
  const drone = 310.5;
  assert.deepEqual(dronePartials(drone), [drone, drone * 2, drone * 3]);
  assert.deepEqual(dronePartials(0), [], "no drone, nothing to notch");

  // A guided note at the drone's own pitch keeps its fundamental...
  assert.deepEqual(dronePartialsToNotch(drone, drone), [drone * 2, drone * 3]);
  // ...and its octave keeps the partial sitting on it.
  assert.deepEqual(dronePartialsToNotch(drone, drone * 2), [drone, drone * 3]);
  // A note nowhere near the drone notches all three, same as free play.
  assert.deepEqual(dronePartialsToNotch(drone, drone * 1.26), dronePartials(drone));
  assert.deepEqual(dronePartialsToNotch(drone, 0), [], "no target, no notches");
});
