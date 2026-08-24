/* Tuning systems: the layer that answers "what frequency should this note be?"
 * Port of flutetrainer/core/tuning.py and core/context.py.
 *
 *  - TemperamentTuning: a fixed historical temperament from a Scala .scl file.
 *    Ignores harmonic context. Enharmonics collapse, which is what a 12-note
 *    keyboard temperament *is*, not a defect.
 *  - PureIntervalTuning: pure ratios above a sounding bass. Requires harmonic
 *    context. Distinguishes enharmonics.
 */

import { SpelledPitch, intervalBetween, floorDiv, mod } from "./pitch.js";

/* The sounding or implied reference against which a note is tuned. */
export class HarmonicContext {
  constructor(bass) { this.bass = bass; Object.freeze(this); }
  toString() { return `over ${this.bass}`; }
}

/* Anchors the whole system to a concert pitch, e.g. A4 = 415 Hz. */
export class ReferencePitch {
  constructor(pitch, hz) {
    if (!(hz > 0)) throw new Error("reference frequency must be positive");
    this.pitch = pitch;
    this.hz = hz;
    Object.freeze(this);
  }
}

export const BAROQUE_415 = new ReferencePitch(SpelledPitch.parse("A4"), 415.0);
export const MODERN_440 = new ReferencePitch(SpelledPitch.parse("A4"), 440.0);

/* ------------------------------------------------------------------ */
/* Scala .scl parsing                                                 */

export class ScalaScale {
  /* `degreesCents` includes the implicit 1/1 at index 0 and the period as
   * the final entry, so a 12-note scale yields 13 values. */
  constructor(description, degreesCents) {
    this.description = description;
    this.degreesCents = Object.freeze([...degreesCents]);
    Object.freeze(this);
  }
  get noteCount() { return this.degreesCents.length - 1; }
  get periodCents() { return this.degreesCents[this.degreesCents.length - 1]; }
}

/* A value containing '.' is cents; otherwise it is a ratio or integer. */
function parseScalaValue(line) {
  const token = line.trim().split(/\s+/)[0];
  if (token.includes(".")) {
    const cents = Number(token);
    if (!Number.isFinite(cents)) throw new Error(`invalid cents value: ${token}`);
    return cents;
  }
  if (token.includes("/")) {
    const [num, den] = token.split("/").map((s) => parseInt(s, 10));
    if (!(num > 0) || !(den > 0)) throw new Error(`non-positive ratio in scale: ${token}`);
    return 1200.0 * Math.log2(num / den);
  }
  const value = parseInt(token, 10);
  if (!(value > 0)) throw new Error(`non-positive ratio in scale: ${token}`);
  return 1200.0 * Math.log2(value);
}

/* Full-line comments start with '!'. First non-comment line: description;
 * second: note count; the rest: pitch values, the last being the period. */
export function parseScala(text) {
  const lines = text.split(/\r?\n/).filter((ln) => !ln.trimStart().startsWith("!"));
  if (lines.length < 2) throw new Error("scala file too short: missing description or note count");

  const description = lines[0].trim();
  const declared = parseInt(lines[1].trim().split(/\s+/)[0], 10);
  if (!Number.isInteger(declared)) throw new Error(`invalid note count line: ${lines[1]}`);

  const values = [];
  for (const line of lines.slice(2)) {
    if (!line.trim()) continue;
    values.push(parseScalaValue(line));
  }
  if (values.length !== declared) {
    throw new Error(`scale declares ${declared} notes but ${values.length} pitch values follow`);
  }
  if (!values.length) throw new Error("scale contains no pitch values");
  for (let i = 1; i < values.length; i++) {
    if (values[i] <= values[i - 1]) throw new Error("scale pitch values must be strictly ascending");
  }
  return new ScalaScale(description, [0.0, ...values]);
}

/* ------------------------------------------------------------------ */
/* Temperament tuning                                                 */

export class TemperamentTuning {
  /* A fixed temperament rooted on a pitch class, anchored to a reference.
   * v1 requires a 12-note, octave-repeating scale. */
  constructor(scale, root, reference) {
    if (scale.noteCount !== 12) {
      throw new Error(`v1 supports 12-note temperaments only; `
                      + `'${scale.description}' declares ${scale.noteCount}`);
    }
    if (Math.abs(scale.periodCents - 1200.0) > 1e-6) {
      throw new Error("v1 supports octave-repeating temperaments only");
    }
    this.scale = scale;
    this.root = root;
    this.reference = reference;
    // Solve for the frequency the root would have in octave 0, such that the
    // reference pitch lands exactly on its stated frequency.
    const offset = this.centsAboveRoot(reference.pitch);
    this.rootHzOctave0 = reference.hz / Math.pow(2.0, offset / 1200.0);
    Object.freeze(this);
  }

  centsAboveRoot(pitch) {
    const steps = pitch.chromaticIndex - this.root.pitchClass;
    const octaves = floorDiv(steps, 12);
    const degree = mod(steps, 12);
    return this.scale.degreesCents[degree] + 1200.0 * octaves;
  }

  /* Context is accepted and ignored: a temperament is context-free. */
  targetHz(pitch, _context = null) {
    return this.rootHzOctave0 * Math.pow(2.0, this.centsAboveRoot(pitch) / 1200.0);
  }

  get description() { return `${this.scale.description} on ${this.root.letter}`; }
}

/* ------------------------------------------------------------------ */
/* Pure-interval tuning                                               */

/* Ratios keyed by simple spelled interval. Ambiguous entries (M2, m7) are the
 * documented v1 defaults; the table is data and may be overridden. */
export const DEFAULT_RATIOS = Object.freeze({
  P1: 1 / 1,
  m2: 16 / 15,
  M2: 9 / 8,        // alternative: 10/9
  m3: 6 / 5,
  M3: 5 / 4,
  P4: 4 / 3,
  A4: 45 / 32,
  d5: 64 / 45,
  P5: 3 / 2,
  m6: 8 / 5,
  M6: 5 / 3,
  m7: 9 / 5,        // alternatives: 16/9, 7/4
  M7: 15 / 8,
  A1: 25 / 24,
  d4: 32 / 25,
  A5: 25 / 16,
  d7: 128 / 75,
  A2: 75 / 64,
  d3: 256 / 225,
});

export class PureIntervalTuning {
  /* Pure ratios above a bass whose own frequency comes from `anchor`. The
   * anchoring rule (DESIGN.md 3.5) is deliberate: changing temperament also
   * moves pure-mode targets, because the bass moves. That is musically
   * correct. */
  constructor(anchor, ratios = DEFAULT_RATIOS) {
    this.anchor = anchor;
    this.ratios = { ...ratios };
    Object.freeze(this);
  }

  targetHz(pitch, context) {
    if (!context) {
      throw new Error("pure-interval tuning requires harmonic context; "
                      + "the resolver should fall back to the temperament instead");
    }
    const interval = intervalBetween(context.bass, pitch);
    const ratio = this.ratios[interval.simpleName];
    if (ratio === undefined) {
      throw new Error(`no pure ratio defined for interval ${interval.simpleName} `
                      + `(${context.bass} -> ${pitch})`);
    }
    const bassHz = this.anchor.targetHz(context.bass, null);
    return bassHz * ratio * Math.pow(2.0, interval.octaves);
  }
}
