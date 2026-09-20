/* What does a drone cost the detector?
 *
 *   node docs/tests/dronecost.js recordings/telemann8.wav <score>.midi --tonic E
 *
 * Free play with a drone has a problem the guided exercises do not: the drone
 * never stops, so it is in the microphone signal under every note as well as
 * between them. This asks what that costs, in the only currency that matters
 * -- notes of a real take heard where the score says they are.
 *
 * Real playing, synthetic drone, and that asymmetry is deliberate: the thing
 * being damaged has to be real, and the standing lesson of this project is
 * that synthetic tones hide defects that recordings expose in minutes. But
 * the drone here is exactly the three sinusoids audio/engine.js synthesises,
 * and the notch removes them exactly, where a real speaker adds distortion
 * and a room adds its own colour. So these numbers are a ceiling, not a
 * promise. Treat a drop between conditions as real and an absolute figure as
 * optimistic.
 *
 * This is what settled the notches in 8.4.3, against the reasoning in 8.4
 * that level alone could separate playing from bleed. It is kept runnable so
 * the next change to the drone is measured rather than argued.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { readWav } from "./wavpipe.js";
import { readScore } from "./midi.js";
import { Detector } from "../audio/yin.js";
import { RegionTracker, isOscillating, driftCents, GLIDE_CENTS } from "../audio/regions.js";
import { postAttack, notePitch } from "../core/scoring.js";
import { tunerCandidates, nearestCandidate } from "../core/naming.js";
import { SpelledPitch } from "../core/pitch.js";
import { parseScala, TemperamentTuning, ReferencePitch } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";
import { alignToTemplate } from "../core/scales.js";
import { ONSET_MARGIN_DB, CALIBRATE_MS } from "../audio/calibration.js";

const HOP = 512;
const NOTCH_Q = 25;              // audio/engine.js
const DRONE_WEIGHTS = [1.0, 0.25, 1 / 9];

/* The RBJ notch a BiquadFilterNode type="notch" implements, so the offline
 * measurement filters the same way the browser does. */
function notchInPlace(x, sampleRate, hz, q = NOTCH_Q) {
  const w0 = 2 * Math.PI * hz / sampleRate;
  const alpha = Math.sin(w0) / (2 * q), cw = Math.cos(w0), a0 = 1 + alpha;
  const [b0, b1, b2] = [1 / a0, -2 * cw / a0, 1 / a0];
  const [a1, a2] = [-2 * cw / a0, (1 - alpha) / a0];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xn = x[i];
    const yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xn; y2 = y1; y1 = yn;
    x[i] = yn;
  }
}

const rms = (xs) => Math.sqrt(xs.reduce((a, v) => a + v * v, 0) / xs.length);

/* The loudest second of the take, as the level the drone is set against. The
 * whole-file RMS would be dragged down by the rests and would make every
 * drone look louder than it is. */
function playingLevel(samples, sampleRate) {
  let loudest = 0;
  for (let at = 0; at + sampleRate <= samples.length; at += sampleRate) {
    loudest = Math.max(loudest, rms(samples.subarray(at, at + sampleRate)));
  }
  return loudest;
}

export function droneCost(wav, midi, { tonic = "D", referenceHz = 415, temperament = "vallotti",
                                       root = "C", droneDb = null, notch = false,
                                       marginDb = ONSET_MARGIN_DB, floor = true } = {}) {
  const tuning = new TemperamentTuning(parseScala(TEMPERAMENTS[temperament].scl),
    SpelledPitch.parse(`${root}4`), new ReferencePitch(SpelledPitch.parse("A4"), referenceHz));
  const candidates = tunerCandidates(tuning);
  const droneHz = tuning.targetHz(SpelledPitch.parse(`${tonic}4`));
  const { samples, sampleRate } = readWav(wav);
  const frameSeconds = HOP / sampleRate;

  // The take, preceded by the calibration window: drone alone, nobody playing.
  const lead = Math.round((CALIBRATE_MS / 1000) * sampleRate);
  const mixed = new Float32Array(samples.length + lead);
  mixed.set(samples, lead);
  if (droneDb !== null) {
    const amp = playingLevel(samples, sampleRate) * Math.pow(10, droneDb / 20)
      / DRONE_WEIGHTS.reduce((a, b) => a + b, 0);
    for (let i = 0; i < mixed.length; i++) {
      const t = i / sampleRate;
      for (let k = 0; k < DRONE_WEIGHTS.length; k++) {
        mixed[i] += amp * DRONE_WEIGHTS[k] * Math.sin(2 * Math.PI * droneHz * (k + 1) * t);
      }
    }
    if (notch) for (const hz of [1, 2, 3].map((k) => droneHz * k)) notchInPlace(mixed, sampleRate, hz);
  }

  const detector = new Detector(sampleRate);
  const frames = [], background = [];
  for (let at = 0; at + HOP <= mixed.length; at += HOP) {
    const frame = detector.process(mixed.subarray(at, at + HOP));
    frames.push(frame);
    if (at < lead) background.push(frame.levelDb);
  }
  const sorted = [...background].sort((a, b) => a - b);
  const quiet = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.9 * sorted.length))] : -60;
  const floorDb = droneDb !== null && floor ? quiet + marginDb : null;

  const tracker = new RegionTracker({ frameSeconds, floorDb });
  const regions = [];
  for (let i = Math.floor(lead / HOP); i < frames.length; i++) {
    const closed = tracker.push({ hz: frames[i].hz, levelDb: frames[i].levelDb });
    if (closed) regions.push(closed);
  }
  const last = tracker.flush(); if (last) regions.push(last);

  const heard = [], cents = new Map();
  let measured = 0;
  for (const region of regions) {
    const [framesHz] = postAttack(region.framesHz, frameSeconds, region.levelsDb);
    if (region.short || isOscillating(region) || Math.abs(driftCents(framesHz)) >= GLIDE_CENTS) continue;
    measured += 1;
    const near = nearestCandidate(candidates, notePitch(region.framesHz, frameSeconds).hz);
    heard.push(near.pitch.chromaticIndex);
    const key = near.pitch.name.replace(/-?\d+$/, "");
    if (!cents.has(key)) cents.set(key, []);
    cents.get(key).push(near.cents);
  }
  const expected = readScore(midi).map((n) => n.chroma);
  const fit = alignToTemplate(heard, expected);
  return { droneHz, backgroundDb: quiet, floorDb, measured, cents,
           fit, expected: expected.length, recall: fit.matched / expected.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [wav, midi, ...rest] = process.argv.slice(2);
  if (!wav || !midi) {
    console.error("usage: node docs/tests/dronecost.js <take>.wav <score>.midi [--tonic E] [--ref 415]");
    process.exit(2);
  }
  const flag = (name, fallback) => {
    const at = rest.indexOf(`--${name}`);
    return at >= 0 ? rest[at + 1] : fallback;
  };
  const tonic = flag("tonic", "D");
  const referenceHz = Number(flag("ref", 415));
  const opts = { tonic, referenceHz };

  const base = droneCost(wav, midi, opts);
  console.log(`${path.basename(wav)} against ${path.basename(midi)} `
    + `(${base.expected} notes), drone on ${tonic}4 = ${base.droneHz.toFixed(1)} Hz, A = ${referenceHz}\n`);
  console.log("condition                    floor   notes  matched  wrong  missing  extra  recall");
  const line = (label, r) => console.log(
    label.padEnd(27),
    (r.floorDb === null ? "   — " : r.floorDb.toFixed(0).padStart(5)),
    String(r.measured).padStart(6), String(r.fit.matched).padStart(8),
    String(r.fit.wrong).padStart(6), String(r.fit.missing).padStart(8),
    String(r.fit.extra).padStart(6), `${(100 * r.recall).toFixed(0)}%`.padStart(7));

  line("no drone", base);
  for (const droneDb of [-24, -18, -12, -6]) {
    line(`drone ${droneDb} dB, no notches`, droneCost(wav, midi, { ...opts, droneDb }));
    line(`drone ${droneDb} dB, notched`, droneCost(wav, midi, { ...opts, droneDb, notch: true }));
  }

  // What the notches do to the reading, on the drone's own note above all.
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const notched = droneCost(wav, midi, { ...opts, droneDb: -12, notch: true });
  console.log(`\nper-pitch mean cents, no drone against a notched drone at -12 dB `
    + `(${tonic} is the drone's own note):`);
  for (const [key, values] of [...base.cents].sort()) {
    const after = notched.cents.get(key);
    if (!after) continue;
    console.log(`  ${(key + (key === tonic ? " *" : "")).padEnd(5)}`
      + `${mean(values).toFixed(1).padStart(7)}¢ n=${String(values.length).padStart(3)}`
      + `  ->${mean(after).toFixed(1).padStart(7)}¢ n=${String(after.length).padStart(3)}`
      + `   ${(mean(after) - mean(values) >= 0 ? "+" : "")}${(mean(after) - mean(values)).toFixed(1)}`);
  }
}
