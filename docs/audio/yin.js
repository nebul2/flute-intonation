/* Pitch detection: a port of flutetrainer/audio/detector.py.
 *
 * The difference function is computed directly (the O(N·tau) form) rather
 * than via FFT: at a 2048 window and tau <= sampleRate/200 this is ~250k
 * multiply-adds per frame against an 11.6 ms budget, and the direct form is
 * the very reference the Python FFT implementation was validated against to
 * 1e-12. Fewer moving parts, same numbers.
 *
 * Lessons from real flute audio, all carried over -- do not simplify away:
 *  - the parabolic refinement is bounded to +/-0.5 samples: on breath noise
 *    the parabola degenerates and the unbounded correction once leapt +908
 *    samples past the end of the array (a live crash in the Python version);
 *  - the silence gate reads the whole analysis window, not the last hop;
 *  - the median history clears on ANY unvoiced frame, not only on silence,
 *    or the outgoing note's pitch bleeds into the next note's first frames.
 */

export const MIN_HZ = 200.0;
export const MAX_HZ = 2200.0;
const THRESHOLD = 0.15;

/* Returns {hz, confidence}; hz is 0 when unvoiced. `block` must be the full
 * analysis window (2048 samples). */
export function yin(block, sampleRate) {
  const size = block.length;
  const half = size >> 1;
  if (half < 32) return { hz: 0, confidence: 0 };

  const tauMin = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const tauMax = Math.min(half - 1, Math.floor(sampleRate / MIN_HZ));
  if (tauMax <= tauMin) return { hz: 0, confidence: 0 };

  // d(tau) = sum_{j<half} (x[j] - x[j+tau])^2 -- the half-window slid
  // against the full block, exactly as in the Python version.
  const diff = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0.0;
    for (let j = 0; j < half; j++) {
      const d = block[j] - block[j + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Cumulative mean normalised difference.
  const cmnd = new Float64Array(tauMax + 1);
  cmnd[0] = 1.0;
  let running = 0.0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += diff[tau];
    cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1.0;
  }

  // First dip below threshold, then descend to its local minimum;
  // otherwise the global minimum of the search range.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < THRESHOLD) {
      tau = t;
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      break;
    }
  }
  if (tau < 0) {
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    tau = best;
  }

  // Bounded parabolic refinement (the breath-noise fix).
  let refined = tau;
  if (tau >= 1 && tau + 1 <= tauMax) {
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const denom = 2.0 * (2.0 * b - a - c);
    if (Math.abs(denom) > 1e-12) {
      const shift = (c - a) / denom;
      refined = tau + Math.max(-0.5, Math.min(0.5, shift));
    }
  }
  if (refined <= 0) return { hz: 0, confidence: 0 };

  const hz = sampleRate / refined;
  const idx = Math.max(0, Math.min(tauMax, Math.round(refined)));
  const confidence = Math.max(0, Math.min(1, 1.0 - cmnd[idx]));
  if (hz < MIN_HZ || hz > MAX_HZ) return { hz: 0, confidence: 0 };
  return { hz, confidence };
}

export function rmsDb(block) {
  let sum = 0.0;
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
  const rms = Math.sqrt(sum / (block.length || 1));
  return rms <= 1e-12 ? -120.0 : 20.0 * Math.log10(rms);
}

/* Frame-by-frame detection with gating and median smoothing, fed hop-sized
 * blocks. Mirrors PitchDetector in the Python version. */
export class Detector {
  constructor(sampleRate, { window = 2048, hop = 512, confidenceThreshold = 0.85,
                            silenceDb = -50.0, medianFrames = 5 } = {}) {
    this.sampleRate = sampleRate;
    this.window = window;
    this.hop = hop;
    this.confidenceThreshold = confidenceThreshold;
    this.silenceDb = silenceDb;
    this.medianFrames = medianFrames;
    this.buffer = new Float32Array(window);
    this.history = [];
  }

  get frameSeconds() { return this.hop / this.sampleRate; }

  reset() {
    this.buffer.fill(0);
    this.history.length = 0;
  }

  /* Consume one hop-sized block; returns {hz, confidence, levelDb}. */
  process(block) {
    if (block.length !== this.hop) {
      throw new Error(`expected ${this.hop} samples, got ${block.length}`);
    }
    this.buffer.copyWithin(0, this.hop);
    this.buffer.set(block, this.window - this.hop);

    const levelDb = rmsDb(block);
    // The gate reads the analysis window: pitch is computed from the whole
    // buffer, so one quiet 11.6 ms hop must not discard the frame.
    if (rmsDb(this.buffer) < this.silenceDb) {
      this.history.length = 0;
      return { hz: 0, confidence: 0, levelDb };
    }

    const { hz, confidence } = yin(this.buffer, this.sampleRate);
    if (hz <= 0 || confidence < this.confidenceThreshold) {
      this.history.length = 0;   // clear on ANY unvoiced frame
      return { hz: 0, confidence, levelDb };
    }

    this.history.push(hz);
    if (this.history.length > this.medianFrames) this.history.shift();
    const sorted = [...this.history].sort((a, b) => a - b);
    return { hz: sorted[sorted.length >> 1], confidence, levelDb };
  }
}
