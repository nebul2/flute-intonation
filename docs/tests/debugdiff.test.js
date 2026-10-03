/* The debug record (docs/debug.js) and the comparison of two of them
 * (docs/tests/debugdiff.js). Synthetic records: two "devices" hearing the
 * same five notes, one started 2.4 s later and disagreeing on one note. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { FrameLog, AudioTape, wavBytes, debugRecord, deviceName, stamp } from "../debug.js";
import { align, pairRegions, reason, compare } from "./debugdiff.js";

const approx = (got, want, abs, label = "") =>
  assert.ok(Math.abs(got - want) <= abs, `${label} expected ${want} ± ${abs}, got ${got}`);

/* A record of notes [{hz, seconds, kind, pitch, cents}] separated by gaps,
 * with the device's clock starting `startS` before the first note. */
function record(name, notes, { startS = 0, gapS = 0.3, frameS = 512 / 48000 } = {}) {
  const log = new FrameLog();
  const regions = [];
  let at = startS, ms = 0;
  const step = frameS * 1000;
  for (let x = 0; x < startS; x += frameS) { log.push({ t: ms, hz: 0, levelDb: -70 }); ms += step; }
  for (const n of notes) {
    regions.push({ atSeconds: at, seconds: n.seconds, medianHz: n.hz, frames: Math.round(n.seconds / frameS),
                   blips: 0, kind: n.kind ?? "note",
                   note: (n.kind ?? "note") === "note" ? { pitch: n.pitch, cents: n.cents ?? 0, tempered_cents: n.cents ?? 0 } : null });
    for (let x = 0; x < n.seconds; x += frameS) { log.push({ t: ms, hz: n.hz, levelDb: -20 }); ms += step; }
    for (let x = 0; x < gapS; x += frameS) { log.push({ t: ms, hz: 0, levelDb: -70 }); ms += step; }
    at += n.seconds + gapS;
  }
  return { ...debugRecord({
    app: "test", device: { name, input_rate: 48000, context_rate: 48000 }, settings: {}, session: {},
    frameSeconds: frameS, log, trackerStartMs: 0, regions, notes: [], at: new Date(0),
  }), file: `${name}.json` };
}

const tune = [
  { hz: 415, seconds: 1.0, pitch: "A4", cents: 0 },
  { hz: 466, seconds: 0.8, pitch: "B4", cents: 0 },
  { hz: 554, seconds: 1.2, pitch: "D5", cents: -5 },
  { hz: 440, seconds: 0.62, pitch: "Bb4", cents: 2 },
  { hz: 370, seconds: 1.0, pitch: "F#4", cents: 1 },
];

test("two devices started at different times are lined up by their pitch", () => {
  const a = record("Mac", tune);
  const b = record("iPad", tune, { startS: 2.4 });
  const lag = align(a, b);
  approx(lag.lagS, -2.4, BIN_TOLERANCE, "lag");
  approx(lag.meanCents, 0, 0.5);
});
const BIN_TOLERANCE = 0.06;

test("matching regions pair up, and a note one device classed differently is explained", () => {
  const a = record("Mac", tune);
  const changed = tune.map((n, i) => (i === 3 ? { ...n, kind: "trill-run" } : n));
  const b = record("iPad", changed, { startS: 1.0 });
  const lag = align(a, b);
  const pairs = pairRegions(a, b, lag.lagS);
  assert.equal(pairs.length, 5);
  assert.ok(pairs.every((p) => p.a && p.b));
  const odd = pairs.find((p) => p.a.kind !== p.b.kind);
  assert.match(reason(odd), /trill run/);
  assert.match(reason(odd), /right on the line/, "0.62 s against the 0.6 s limit");
  const text = compare(a, b).join("\n");
  assert.match(text, /4 of 5 regions agree/);
});

test("a note only one device closed is listed as such", () => {
  const a = record("Mac", tune);
  const b = record("iPad", tune.filter((_, i) => i !== 1), { startS: 0.5 });
  const pairs = pairRegions(a, b, align(a, b).lagS);
  const lonely = pairs.filter((p) => !p.a || !p.b);
  assert.ok(lonely.length >= 1);
  assert.match(reason(lonely[0]), /only one device/);
});

test("a different name near the boundary says so", () => {
  const p = { a: { kind: "note", seconds: 1, note: { pitch: "A4", cents: 46, tempered_cents: 46 } },
              b: { kind: "note", seconds: 1, note: { pitch: "Bb4", cents: -52, tempered_cents: -52 } } };
  assert.match(reason(p), /named A4 \/ Bb4 -- 52 cents out, near the boundary/);
});

test("the frame log counts frames the page never received", () => {
  const log = new FrameLog();
  const step = 512 / 48;   // ms
  [0, 1, 2, 3, 7, 8].forEach((k) => log.push({ t: 1000 + k * step, hz: 400, levelDb: -20 }));
  const drops = log.drops(512 / 48000);
  assert.equal(drops.count, 1);
  approx(drops.longestMs, 4 * step, 0.2);
  assert.equal(drops.lost, 3, "frames 4, 5 and 6 never came");
  // Late in a bunch but all there: gaps, nothing lost.
  const bunched = new FrameLog();
  [0, 1, 2, 2.9, 3.0, 3.1, 6, 7].forEach((k) => bunched.push({ t: k * step, hz: 400, levelDb: -20 }));
  assert.equal(bunched.drops(512 / 48000).lost, 0);
  assert.ok(bunched.drops(512 / 48000).count >= 1);
  approx(log.t[0], 0, 1e-9, "times from the first frame");
});

test("the audio tape writes a WAV the analysis tools can read", async () => {
  const tape = new AudioTape(48000);
  tape.push(new Float32Array(512).fill(0.5));
  tape.push(new Float32Array(512).fill(-1.5));      // clipped, not wrapped
  approx(tape.seconds, 1024 / 48000, 1e-12);
  const bytes = tape.toWav();
  const view = new DataView(bytes.buffer);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(40, true), 2048);
  approx(view.getInt16(44, true) / 0x7fff, 0.5, 1e-3);
  assert.equal(view.getInt16(44 + 2 * 600, true), -32768);
  // And the pipeline's own reader agrees.
  const { readWav } = await import("./wavpipe.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const p = (await import("node:path")).join(os.tmpdir(), `tape-${process.pid}.wav`);
  fs.writeFileSync(p, bytes);
  const wav = readWav(p);
  fs.unlinkSync(p);
  assert.equal(wav.sampleRate, 48000);
  assert.equal(wav.samples.length, 1024);
  approx(wav.samples[0], 0.5, 1e-3);
  assert.equal(wavBytes([], 44100).length, 44);
});

test("device names and file stamps", () => {
  assert.equal(deviceName("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "iPad");
  assert.equal(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), "iPad", "iPadOS calls itself a Mac");
  assert.equal(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), "Mac");
  assert.equal(deviceName("Mozilla/5.0 (Linux; Android 14; FP5)"), "Android");
  assert.equal(stamp(new Date(2026, 9, 3, 18, 5, 2)), "20261003-180502");
});
