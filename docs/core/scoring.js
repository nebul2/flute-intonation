/* Per-note statistics and session aggregation. Port of core/scoring.py. */

import { SpelledPitch } from "./pitch.js";

export const IN_TUNE_CENTS = 5.0;
export const CLOSE_CENTS = 15.0;
export const SETTLE_CENTS = 10.0;
/* Flute attacks scoop, so the first moments of a note describe the attack
 * rather than the note. Every path that reduces frames to statistics discards
 * them -- the exercises through analyseNote, free play in views/listen.js. */
export const ATTACK_SKIP_SECONDS = 0.060;
/* And flute notes fall as they die. The last moments of a held note are the
 * player letting go, not the player playing, and averaging them in reports
 * every corrected note as flatter than it was played. Measured on real takes:
 * a note held 26 cents flat and corrected to nothing over two seconds read
 * -13.7 cents whole-note and -6.6 from where it settled. */
export const TAPER_SKIP_SECONDS = 0.100;
/* How much note must survive both trims before the taper is worth removing,
 * and before looking for a settled end is worth doing at all. Below these the
 * policy steps down a rung rather than measuring noise: the floor is real
 * (~46 ms to fill the detector window plus the 60 ms attack skip) and a short
 * note has no end to speak of. */
export const TAPER_BODY_SECONDS = 0.150;
export const SETTLE_BODY_SECONDS = 0.350;
/* The tail the settled pitch is read from, and the shortest run that may call
 * itself settled. Both, deliberately: measured against recordings/arpeggio.wav
 * a single stray frame 120 ms from the end of a note that drifted +13 to +25
 * cents would otherwise have scored that note at -0.4 cents -- "in tune", off
 * one glitched frame. A median over this probe ignores the stray, and
 * requiring the window to be at least this long stops the scan calling two
 * frames a settled note. */
export const SETTLE_PROBE_SECONDS = 0.150;

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

/* ---- predict-then-see: what the calls were worth ---------------------- */

/* The three calls a player can make, in the order the buttons offer them. */
export const CALL_DIRECTIONS = Object.freeze(["sharp", "flat", "in tune"]);

/* Reduce a run of {called, actual, agreed} judgements to a score.
 *
 * Split by what the measurement actually said, not by what the player called:
 * "I never hear myself flat" is a specific, fixable blind spot, and an overall
 * percentage hides it completely. `played` is how many notes really came out
 * that way; `agreed` is how many of those the ear named correctly. */
export function judgementTally(judgements) {
  const byActual = {};
  for (const direction of CALL_DIRECTIONS) byActual[direction] = { played: 0, agreed: 0 };
  let agreed = 0;
  for (const j of judgements) {
    if (j.agreed) agreed += 1;
    const bucket = byActual[j.actual];
    if (!bucket) continue;
    bucket.played += 1;
    if (j.agreed) bucket.agreed += 1;
  }
  return { total: judgements.length, agreed, byActual };
}

/* Which closing line a run has earned.
 *
 * Generous at the bottom on purpose. Calling a note before seeing the number
 * is genuinely hard -- chance alone is around a third -- and an ear-training
 * drill that scolds is a drill that gets closed. The thresholds are on the
 * share of notes where ear and measurement agreed. */
export function encouragement({ total, agreed }) {
  if (!total) return null;
  const share = agreed / total;
  if (share >= 0.9) return "excellent";
  if (share >= 0.7) return "good";
  if (share >= 0.5) return "progress";
  return "keepGoing";
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
const median = (xs) => { const o = [...xs].sort((a, b) => a - b); return o[o.length >> 1]; };

/* The frames of a note that describe the note rather than its attack, with
 * any parallel series (levels) trimmed to match. At least one frame always
 * survives, so a note barely longer than the skip still yields something. */
export function postAttack(framesHz, frameSeconds, ...parallel) {
  const skip = frameSeconds > 0
    ? Math.min(framesHz.length - 1, Math.round(ATTACK_SKIP_SECONDS / frameSeconds)) : 0;
  return [framesHz.slice(skip), ...parallel.map((series) => series.slice(skip))];
}

/* The part of a held note that is the note.
 *
 * A player asked which pitch a two-second note reports, having spent the first
 * second arriving at it, is asking this question. The answer is: after the
 * attack, before the taper, from the point the pitch settled -- and the app
 * reports how long that took, so a correction is visible as a correction
 * rather than averaged into the figure that provoked it.
 *
 * `framesHz` must already be post-attack and voiced. Stability is measured
 * against the note's own tail, not against a target, so the window is a
 * property of the note alone: a note held steadily thirty cents sharp settled
 * immediately, and the cents figure is what says it was sharp.
 *
 * `settleSeconds` is null when no settled run was found. That is a finding,
 * not a failure -- it means the pitch never stopped moving -- and the whole
 * body is scored instead, so a wandering note still reports something.
 */
export function scoredWindow(framesHz, frameSeconds) {
  const unsettled = (frames) => ({ frames, settleSeconds: null, settled: false });
  if (!framesHz.length || !(frameSeconds > 0)) return unsettled(framesHz);
  const inFrames = (seconds) => Math.max(1, Math.round(seconds / frameSeconds));
  const seconds = framesHz.length * frameSeconds;

  const body = seconds - TAPER_SKIP_SECONDS >= TAPER_BODY_SECONDS
    ? framesHz.slice(0, -inFrames(TAPER_SKIP_SECONDS))
    : framesHz;

  const probe = inFrames(SETTLE_PROBE_SECONDS);
  if (body.length * frameSeconds < SETTLE_BODY_SECONDS || body.length <= probe) return unsettled(body);

  const anchor = median(body.slice(-probe));
  let i = body.length - 1;
  while (i > 0 && Math.abs(centsDeviation(body[i - 1], anchor)) < SETTLE_CENTS) i--;
  if (body.length - i < probe) return unsettled(body);
  return { frames: body.slice(i), settleSeconds: i * frameSeconds, settled: true };
}

/* Reduce a note's voiced frames to statistics, over the window above. The
 * first `skipAttackSeconds` are discarded: flute attacks scoop, and including
 * them would bias every note flat. */
export function analyseNote(pitch, targetHz, framesHz, frameSeconds, skipAttackSeconds = ATTACK_SKIP_SECONDS) {
  // Clamped like postAttack(): a note barely longer than the skip keeps a
  // frame rather than vanishing. These two disagreed until now.
  const skip = frameSeconds > 0
    ? Math.min(Math.max(framesHz.length - 1, 0), Math.round(skipAttackSeconds / frameSeconds)) : 0;
  const usable = framesHz.slice(skip).filter((hz) => hz > 0);
  if (!usable.length) return null;

  const window = scoredWindow(usable, frameSeconds);
  const scored = window.frames.length ? window.frames : usable;
  const deviations = scored.map((hz) => centsDeviation(hz, targetHz));
  const avg = mean(deviations);
  const stdev = deviations.length > 1
    ? Math.sqrt(mean(deviations.map((d) => (d - avg) ** 2))) : 0.0;

  return new NoteResult(pitch, targetHz, avg, stdev, window.settleSeconds, scored.length);
}

/* The pitch a note was played at, for the paths that name a note rather than
 * score it against a target. Median of the same window, because naming wants
 * the typical frame and one octave-halved frame should not move it. */
export function notePitch(framesHz, frameSeconds) {
  const voiced = framesHz.filter((hz) => hz > 0);
  if (!voiced.length) return { hz: 0, settleSeconds: null, frameCount: 0 };
  const window = scoredWindow(voiced, frameSeconds);
  const scored = window.frames.length ? window.frames : voiced;
  return { hz: median(scored), settleSeconds: window.settleSeconds, frameCount: scored.length };
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

/* Where an octave's width sits on the stopper check's drawn scale.
 *
 * The scale is fixed, not fitted to the data: two consecutive runs are meant
 * to be compared by eye, and a scale that resized itself would make a run that
 * improved look unchanged. So anything past the end is pinned to it and
 * flagged, and the caller shows the figure alongside -- a clamped mark must
 * never be able to read as a near miss.
 */
export const BAR_SPAN_CENTS = 40.0;   // half-width of the track
export const BAR_TRUE_CENTS = 5.0;    // as good as true: the shaded centre

export function octaveBarGeometry(widthCents, span = BAR_SPAN_CENTS) {
  const clamped = Math.max(-span, Math.min(span, widthCents));
  return {
    clamped,
    // 0% is `span` cents narrow, 50% a true octave, 100% `span` cents wide.
    percent: 50.0 + (clamped / span) * 50.0,
    beyond: Math.abs(widthCents) > span,
  };
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
