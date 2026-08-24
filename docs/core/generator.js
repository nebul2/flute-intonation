/* Exercise generation. Port of flutetrainer/core/generator.py.
 *
 * Every generated note carries its harmonic context: the generator *knows*
 * that the F# in a D major scale is a third above the D drone, because it put
 * it there. Spelling matters, so scales are built by walking letters and
 * applying the key signature, never by adding semitones. */

import { SpelledPitch, LETTERS } from "./pitch.js";
import { HarmonicContext } from "./tuning.js";
import { Exercise, TargetNote } from "./resolver.js";

export const DEFAULT_LOW = SpelledPitch.parse("D4");
export const DEFAULT_HIGH = SpelledPitch.parse("A6");

export const KEY_SIGNATURES = Object.freeze({
  C: {},
  G: { F: 1 },
  D: { F: 1, C: 1 },
  A: { F: 1, C: 1, G: 1 },
  F: { B: -1 },
  Bb: { B: -1, E: -1 },
  Eb: { B: -1, E: -1, A: -1 },
  Ab: { B: -1, E: -1, A: -1, D: -1 },
});

/* The relative major whose signature spells each natural minor scale. */
export const MINOR_RELATIVE = Object.freeze({ C: "Eb", D: "F", E: "G", F: "Ab", G: "Bb", A: "C", B: "D" });

export function scaleKeyFor(tonic, quality = "major") {
  if (quality === "minor") {
    const key = MINOR_RELATIVE[tonic];
    if (!key || !(key in KEY_SIGNATURES)) throw new Error(`no minor scale spelled for ${tonic}`);
    return key;
  }
  if (!(tonic in KEY_SIGNATURES)) throw new Error(`no major scale spelled for ${tonic}`);
  return tonic;
}

/* The distinct pitches of a scale, ascending, within the flute's range: the
 * pool an endless random exercise draws from. */
export function scalePool(tonic, quality = "major", { octaves = 1, startOctave = 4,
                                                       low = DEFAULT_LOW, high = DEFAULT_HIGH } = {}) {
  const ex = scale(tonic, { key: scaleKeyFor(tonic, quality), octaves, startOctave, descending: false, low, high });
  return ex.notes.map((n) => n.pitch);
}

/* A random element of `pool` other than `previous` (by spelling), so the
 * same note is never asked twice running. `rng` is injectable for tests. */
export function pickDifferent(pool, previous = null, rng = Math.random) {
  const choices = previous ? pool.filter((p) => !p.equals(previous)) : pool;
  if (!choices.length) return pool[0];
  return choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
}

const TRIAD_DEGREES = [0, 2, 4];

function spell(letter, octave, signature) {
  return new SpelledPitch(letter, signature[letter] ?? 0, octave);
}

/* Move `degrees` diatonic steps above `start`, spelled by the key. */
function ascend(start, degrees, signature) {
  const index = LETTERS.indexOf(start.letter) + degrees;
  const letter = LETTERS[((index % 7) + 7) % 7];
  const octave = start.octave + Math.floor(index / 7);
  return spell(letter, octave, signature);
}

export function inRange(pitch, low = DEFAULT_LOW, high = DEFAULT_HIGH) {
  return low.chromaticIndex <= pitch.chromaticIndex && pitch.chromaticIndex <= high.chromaticIndex;
}

function rootOf(tonic, startOctave, signature, low, high) {
  const root = spell(tonic, startOctave, signature);
  return inRange(root, low, high) ? root : spell(tonic, startOctave + 1, signature);
}

export function scale(tonic, { key = "", octaves = 1, startOctave = 4, descending = true,
                               beats = 2.0, tempoBpm = 60.0, drone = true,
                               low = DEFAULT_LOW, high = DEFAULT_HIGH } = {}) {
  const signature = KEY_SIGNATURES[key || tonic];
  const root = rootOf(tonic, startOctave, signature, low, high);
  let pitches = [];
  for (let d = 0; d <= octaves * 7; d++) pitches.push(ascend(root, d, signature));
  if (descending) pitches = pitches.concat(pitches.slice(0, -1).reverse());
  pitches = pitches.filter((p) => inRange(p, low, high));
  const context = new HarmonicContext(root);
  return new Exercise({
    name: `${tonic} ${(signature[tonic] ?? 0) >= 0 ? "major" : "minor"} scale`,
    notes: pitches.map((p) => new TargetNote(p, beats, context)),
    drone: drone ? root : null, tempoBpm, key: key || tonic,
  });
}

export function arpeggio(tonic, { key = "", octaves = 1, startOctave = 4, beats = 2.0,
                                  tempoBpm = 60.0, drone = true,
                                  low = DEFAULT_LOW, high = DEFAULT_HIGH } = {}) {
  const signature = KEY_SIGNATURES[key || tonic];
  const root = rootOf(tonic, startOctave, signature, low, high);
  const degrees = [];
  for (let o = 0; o < octaves; o++) for (const d of TRIAD_DEGREES) degrees.push(d + 7 * o);
  degrees.push(7 * octaves);
  let pitches = degrees.map((d) => ascend(root, d, signature));
  pitches = pitches.concat(pitches.slice(0, -1).reverse()).filter((p) => inRange(p, low, high));
  const context = new HarmonicContext(root);
  return new Exercise({
    name: `${tonic} arpeggio`,
    notes: pitches.map((p) => new TargetNote(p, beats, context)),
    drone: drone ? root : null, tempoBpm, key: key || tonic,
  });
}

/* Sustained notes at chosen diatonic distances above a fixed bass.
 * `intervals` are diatonic step counts (0 = unison, 2 = third, 4 = fifth). */
export function intervalDrill(bass, { intervals = [2, 4, 0], key = "", startOctave = 4,
                                      beats = 4.0, tempoBpm = 60.0, repeats = 1,
                                      low = DEFAULT_LOW, high = DEFAULT_HIGH } = {}) {
  const signature = KEY_SIGNATURES[key || bass];
  const root = rootOf(bass, startOctave, signature, low, high);
  const sequence = [];
  for (let r = 0; r < repeats; r++) sequence.push(...intervals);
  const context = new HarmonicContext(root);
  const pitches = sequence.map((d) => ascend(root, d, signature)).filter((p) => inRange(p, low, high));
  return new Exercise({
    name: `interval drill over ${root}`,
    notes: pitches.map((p) => new TargetNote(p, beats, context)),
    drone: root, tempoBpm, key: key || bass,
  });
}

/* The same written note twice: first tempered, then pure over the drone.
 * A context-free note resolves through the temperament even in pure mode,
 * so the first of each pair carries no context and the second carries the
 * drone bass. Defaults (2, 5): the third and the sixth, where pure and
 * tempered diverge most audibly. */
export function intervalInContext(tonic = "D", { degrees = [2, 5], startOctave = 4,
                                                beats = 4.0, tempoBpm = 60.0,
                                                low = DEFAULT_LOW, high = DEFAULT_HIGH } = {}) {
  const signature = KEY_SIGNATURES[tonic];
  const root = rootOf(tonic, startOctave, signature, low, high);
  const context = new HarmonicContext(root);
  const notes = [];
  for (const degree of degrees) {
    const pitch = ascend(root, degree, signature);
    if (!inRange(pitch, low, high)) continue;
    notes.push(new TargetNote(pitch, beats, null));      // tempered
    notes.push(new TargetNote(pitch, beats, context));   // pure over the drone
  }
  return new Exercise({ name: `interval in context over ${root}`, notes, drone: root, tempoBpm, key: tonic });
}

/* D# and Eb as different notes, each pure over the bass that wants it. Two
 * exercises because each needs its own drone. */
export function enharmonicPair({ beats = 4.0, tempoBpm = 60.0, repeats = 2 } = {}) {
  const pairs = [["D#5", "B3"], ["Eb5", "C4"]];
  return pairs.map(([p, b]) => {
    const pitch = SpelledPitch.parse(p), bass = SpelledPitch.parse(b);
    const context = new HarmonicContext(bass);
    const notes = [];
    for (let i = 0; i < repeats; i++) notes.push(new TargetNote(pitch, beats, context));
    return new Exercise({ name: `${pitch} over ${bass}`, notes, drone: bass, tempoBpm });
  });
}

/* The three D's and the three G's, set embouchure, no drone: the stopper
 * (bouchon) test. Targets exist only so the detector knows which note is
 * sounding; only the width of the octaves matters. Four octave pairs come
 * out of it: D4-D5, D5-D6, G4-G5, G5-G6. */
export function stopperCheck({ beats = 4.0, tempoBpm = 60.0 } = {}) {
  const notes = ["D4", "D5", "D6", "G4", "G5", "G6"].map((n) => new TargetNote(SpelledPitch.parse(n), beats, null));
  return new Exercise({ name: "stopper check", notes, drone: null, tempoBpm });
}

export function longTones(pitches, { bass = null, beats = 8.0, tempoBpm = 60.0 } = {}) {
  const root = bass ? SpelledPitch.parse(bass) : null;
  const context = root ? new HarmonicContext(root) : null;
  return new Exercise({
    name: "long tones",
    notes: pitches.map((p) => new TargetNote(SpelledPitch.parse(p), beats, context)),
    drone: root, tempoBpm,
  });
}
