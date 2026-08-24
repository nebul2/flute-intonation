/* Headless acceptance test for the detector port: node docs/audio/yin.test.js
 *
 * Mirrors the Python suite's synthetic gate: flute-like tones across D4-A6
 * at 44.1 and 48 kHz must read within 2 cents; noise must stay unvoiced;
 * near-silence must be gated. Run it after any change to yin.js.
 */
import { Detector } from "./yin.js";

const centsBetween = (a, b) => 1200 * Math.log2(b / a);

function run(hz, sr, secs = 1.0) {
  const n = Math.floor(secs * sr);
  const sig = new Float32Array(n);
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x40000000 - 1;
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * hz * i) / sr;
    sig[i] = 0.3 * (Math.sin(t) + 0.25 * Math.sin(2 * t) + 0.10 * Math.sin(3 * t))
           + 0.002 * rand();
  }
  const det = new Detector(sr);
  const heard = [];
  for (let i = 0; i + 512 <= n; i += 512) {
    const f = det.process(sig.subarray(i, i + 512));
    if (f.hz > 0) heard.push(f.hz);
  }
  heard.sort((a, b) => a - b);
  return { voiced: heard.length, median: heard[heard.length >> 1] || 0 };
}

let failures = 0;
const check = (ok, label) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
};

for (const sr of [44100, 48000]) {
  for (const hz of [277.18, 348.58, 415.0, 554.37, 830.61, 1244.51, 1661.22]) {
    const r = run(hz, sr);
    const err = r.voiced ? centsBetween(hz, r.median) : NaN;
    check(r.voiced > 40 && Math.abs(err) < 2.0,
      `${hz} Hz @ ${sr}: ${r.median.toFixed(2)} Hz (${err.toFixed(2)}c, ${r.voiced} frames)`);
  }
}

{ // pure noise: unvoiced, and must not throw (the breath-noise crash case)
  const sr = 44100, n = sr, sig = new Float32Array(n);
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x40000000 - 1;
  for (let i = 0; i < n; i++) sig[i] = 0.3 * rand();
  const det = new Detector(sr);
  let voiced = 0;
  for (let i = 0; i + 512 <= n; i += 512) if (det.process(sig.subarray(i, i + 512)).hz > 0) voiced++;
  check(voiced <= 4, `noise: ${voiced}/86 voiced frames`);
}

{ // near-silence is gated on the window
  const det = new Detector(44100);
  const f = det.process(new Float32Array(512).fill(1e-5));
  check(f.hz === 0 && f.levelDb < -50, `silence gated (level ${f.levelDb.toFixed(1)} dB)`);
}

console.log(failures ? `\n${failures} FAILURES` : "\nall checks passed");
process.exit(failures ? 1 : 0);
