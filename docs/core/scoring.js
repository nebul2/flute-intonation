/* Per-note statistics and session aggregation. Port of core/scoring.py. */

import { SpelledPitch } from "./pitch.js";

export const IN_TUNE_CENTS = 5.0;
export const CLOSE_CENTS = 15.0;
export const SETTLE_CENTS = 10.0;
/* Flute attacks scoop, so the first moments of a note describe the attack
 * rather than the note. Every path that reduces frames to statistics discards
 * them -- the exercises through analyseNote, free play in views/listen.js. */
export const ATTACK_SKIP_SECONDS = 0.060;

export function centsDeviation(detectedHz, targetHz) {
  if (!(detectedHz > 0) || !(targetHz > 0)) throw new Error("frequencies must be positive");
  return 1200.0 * Math.log2(detectedHz / targetHz);
}

/* 'sharp', 'flat' or 'in tune' -- for comparing against a player's own call.
 * The boundary is the display band, so the verdict never disagrees with the
 * colour the number would have shown. */
export function judgeDirection(meanCents, inTuneCents = IN_TUNE_CENTS) {
  if (meanCents > inTuneCents) return "sharp";
  if (meanCents < -inTuneCents) return "flat";
  return "in tune";
}

export function band(meanCents) {
  const m = Math.abs(meanCents);
  return m <= IN_TUNE_CENTS ? "in tune" : m <= CLOSE_CENTS ? "close" : "off";
}

export class NoteResult {
  constructor(pitch, targetHz, meanCents, stdevCents, settleSeconds, frameCount) {
    this.pitch = pitch;
    this.targetHz = targetHz;
    this.meanCents = meanCents;
    this.stdevCents = stdevCents;
    this.settleSeconds = settleSeconds;
    this.frameCount = frameCount;
    Object.freeze(this);
  }
  get band() { return band(this.meanCents); }
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/* The frames of a note that describe the note rather than its attack, with
 * any parallel series (levels) trimmed to match. At least one frame always
 * survives, so a note barely longer than the skip still yields something. */
export function postAttack(framesHz, frameSeconds, ...parallel) {
  const skip = frameSeconds > 0
    ? Math.min(framesHz.length - 1, Math.round(ATTACK_SKIP_SECONDS / frameSeconds)) : 0;
  return [framesHz.slice(skip), ...parallel.map((series) => series.slice(skip))];
}

/* Reduce a note's voiced frames to statistics. The first `skipAttackSeconds`
 * are discarded: flute attacks scoop, and including them would bias every
 * note flat. */
export function analyseNote(pitch, targetHz, framesHz, frameSeconds, skipAttackSeconds = ATTACK_SKIP_SECONDS) {
  const skip = frameSeconds > 0 ? Math.round(skipAttackSeconds / frameSeconds) : 0;
  const usable = framesHz.slice(skip).filter((hz) => hz > 0);
  if (!usable.length) return null;

  const deviations = usable.map((hz) => centsDeviation(hz, targetHz));
  const avg = mean(deviations);
  const stdev = deviations.length > 1
    ? Math.sqrt(mean(deviations.map((d) => (d - avg) ** 2))) : 0.0;

  let settle = null;
  for (let i = 0; i < deviations.length; i++) {
    if (Math.abs(deviations[i]) < SETTLE_CENTS
        && deviations.slice(i).every((d) => Math.abs(d) < SETTLE_CENTS)) {
      settle = i * frameSeconds;
      break;
    }
  }
  return new NoteResult(pitch, targetHz, avg, stdev, settle, usable.length);
}

/* The frequency the player actually produced. */
export function soundedHz(result) {
  return result.targetHz * Math.pow(2.0, result.meanCents / 1200.0);
}

/* Adjacent-octave pairs of the same spelled pitch class, with each pair's
 * width error in cents (0 = a true 2:1 octave; positive = wide). Computed
 * between *sounded* frequencies, so it is independent of the targets and of
 * where the flute sat against the tuner -- the stopper check's arithmetic. */
export function octavePairs(results) {
  const pairs = [];
  for (const lower of results) {
    for (const upper of results) {
      if (upper.pitch.letter === lower.pitch.letter && upper.pitch.alter === lower.pitch.alter
          && upper.pitch.octave === lower.pitch.octave + 1) {
        const width = 1200.0 * Math.log2(soundedHz(upper) / soundedHz(lower));
        pairs.push({ lower, upper, width: width - 1200.0 });
      }
    }
  }
  return pairs;
}

export class SessionSummary {
  constructor() { this.results = []; }

  add(result) { if (result) this.results.push(result); }

  get meanAbsoluteCents() {
    return this.results.length ? mean(this.results.map((r) => Math.abs(r.meanCents))) : 0.0;
  }

  /* Mean signed deviation grouped by note name: "your F# runs 12 cents sharp". */
  byPitchClass() {
    const buckets = new Map();
    for (const r of this.results) {
      const key = r.pitch.letter + (r.pitch.alter > 0 ? "#".repeat(r.pitch.alter) : "b".repeat(-r.pitch.alter));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r.meanCents);
    }
    return Object.fromEntries([...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, mean(v)]));
  }

  /* Same schema as the Python version's saved sessions (v: 1). */
  toDict() {
    const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
    return {
      v: 1,
      notes: this.results.map((r) => ({
        pitch: r.pitch.name,
        target_hz: round(r.targetHz, 4),
        mean_cents: round(r.meanCents, 2),
        stdev_cents: round(r.stdevCents, 2),
        settle_s: r.settleSeconds === null ? null : round(r.settleSeconds, 3),
        frames: r.frameCount,
      })),
      mean_absolute_cents: round(this.meanAbsoluteCents, 2),
      by_pitch_class: Object.fromEntries(Object.entries(this.byPitchClass()).map(([k, v]) => [k, round(v, 2)])),
    };
  }

  /* Rebuild results from a saved record, for history comparisons. */
  static fromDict(record) {
    const s = new SessionSummary();
    for (const n of record.notes ?? []) {
      s.add(new NoteResult(SpelledPitch.parse(n.pitch), n.target_hz, n.mean_cents,
                           n.stdev_cents ?? 0, n.settle_s ?? null, n.frames ?? 0));
    }
    return s;
  }
}
