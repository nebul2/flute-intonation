/* Spelled pitch representation and interval arithmetic.
 * Port of flutetrainer/core/pitch.py.
 *
 * Pitches are *spelled*, never reduced to MIDI numbers or pitch-class
 * integers. In meantone and just systems D-sharp and E-flat are different
 * frequencies; collapsing enharmonics here would poison every target computed
 * downstream. See DESIGN.md section 3.1.
 */

const LETTERS = "CDEFGAB";
const DIATONIC = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const CHROMA = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Semitone span of each perfect/major simple interval, indexed by generic size.
const REFERENCE_SEMITONES = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
const PERFECT_SIZES = new Set([1, 4, 5]);

const ALTER_TO_TEXT = { "-2": "bb", "-1": "b", "0": "", "1": "#", "2": "##" };
const TEXT_TO_ALTER = {
  "": 0, n: 0,
  "#": 1, s: 1, "##": 2, x: 2, "###": 3,
  b: -1, f: -1, bb: -2, ff: -2,
};

const PITCH_RE = /^([A-Ga-g])([#bsfnx]*)(-?\d+)$/;

// Python's floor-division and modulo, which JS lacks for negatives.
export const floorDiv = (a, b) => Math.floor(a / b);
export const mod = (a, b) => ((a % b) + b) % b;

export class SpelledPitch {
  constructor(letter, alter, octave) {
    if (!(letter in DIATONIC)) throw new Error(`letter must be one of A-G, got ${letter}`);
    if (!(alter >= -3 && alter <= 3)) throw new Error(`alter out of supported range: ${alter}`);
    this.letter = letter;
    this.alter = alter;
    this.octave = octave;
    Object.freeze(this);
  }

  /* Parse names like 'F#5', 'Bb3', 'D4', 'C##4'. */
  static parse(text) {
    const match = PITCH_RE.exec(String(text).trim());
    if (!match) throw new Error(`cannot parse pitch name: ${text}`);
    const [, letter, accidental, octave] = match;
    const key = accidental.toLowerCase();
    if (!(key in TEXT_TO_ALTER)) throw new Error(`unrecognised accidental in ${text}`);
    return new SpelledPitch(letter.toUpperCase(), TEXT_TO_ALTER[key], parseInt(octave, 10));
  }

  /* Absolute diatonic step count; contiguous across octaves (C4 -> 28). */
  get diatonicIndex() { return this.octave * 7 + DIATONIC[this.letter]; }

  /* Absolute semitone count from C0, including the accidental. */
  get chromaticIndex() { return this.octave * 12 + CHROMA[this.letter] + this.alter; }

  /* Chromatic pitch class 0-11. Enharmonics collapse here by design. */
  get pitchClass() { return mod(this.chromaticIndex, 12); }

  transposeOctaves(n) { return new SpelledPitch(this.letter, this.alter, this.octave + n); }

  get name() { return `${this.letter}${ALTER_TO_TEXT[String(this.alter)] ?? "?"}${this.octave}`; }

  toString() { return this.name; }

  equals(other) {
    return other instanceof SpelledPitch && other.letter === this.letter
      && other.alter === this.alter && other.octave === this.octave;
  }
}

/* A directed interval described by quality and generic size. `generic` is the
 * simple (octave-reduced) size 1-7; `octaves` carries the compound part and
 * may be negative for descending intervals. */
export class SpelledInterval {
  constructor(quality, generic, octaves) {
    this.quality = quality;
    this.generic = generic;
    this.octaves = octaves;
    Object.freeze(this);
  }
  get simpleName() { return `${this.quality}${this.generic}`; }
  toString() {
    return this.octaves ? `${this.simpleName}${this.octaves > 0 ? "+" : ""}${this.octaves}oct`
                        : this.simpleName;
  }
}

function qualityFrom(generic, semitones) {
  const deviation = semitones - REFERENCE_SEMITONES[generic];
  const table = PERFECT_SIZES.has(generic)
    ? { 0: "P", 1: "A", 2: "AA", "-1": "d", "-2": "dd" }
    : { 0: "M", "-1": "m", 1: "A", 2: "AA", "-2": "d", "-3": "dd" };
  const quality = table[String(deviation)];
  if (quality === undefined) {
    throw new Error(`interval of generic size ${generic} spanning ${semitones} semitones `
                    + "is outside the supported quality range");
  }
  return quality;
}

/* The spelled interval from `lower` to `upper`. Descending intervals produce
 * a negative `octaves` component. */
export function intervalBetween(lower, upper) {
  const diatonicDelta = upper.diatonicIndex - lower.diatonicIndex;
  const semitoneDelta = upper.chromaticIndex - lower.chromaticIndex;
  const octaves = floorDiv(diatonicDelta, 7);
  const generic = mod(diatonicDelta, 7) + 1;
  const simpleSemitones = semitoneDelta - 12 * octaves;
  return new SpelledInterval(qualityFrom(generic, simpleSemitones), generic, octaves);
}

/* Display order for lists of notes: high at the top, low at the bottom, the
 * way they sit on a stave. Ties (enharmonics) keep their insertion order. */
export function highestFirst(a, b) {
  return b.chromaticIndex - a.chromaticIndex;
}

/* Cents from `lowerHz` to `upperHz`. Positive means sharp. */
export function centsBetween(lowerHz, upperHz) {
  if (!(lowerHz > 0) || !(upperHz > 0)) throw new Error("frequencies must be positive");
  return 1200.0 * Math.log2(upperHz / lowerHz);
}

export { LETTERS };
