/* "Follow me" at a cadence: the chords lead in tune, and the arrival is not.
 *
 * approach -> V(7) -> I, the approach drawn each time from IV, ii6 and VI so
 * no one shape is learnt. The approach and the dominant are pure over their
 * own bass; the final chord, all of it, arrives shifted -- the band of strings
 * landing a shade flat together, which a keyboard never does -- or, one time
 * in four after the first, in tune. The question is whether the flute goes
 * with the arrival or plays the tonic where it "should" be. See cr/010.
 *
 * The flute is either the top voice or the bass. As the top voice its line
 * follows the approach, so the note is always a chord tone: 1-7-1 over IV,
 * 2-7-1 over ii6, 3-2-1 over VI. As the bass it plays the chords' own bass,
 * 4-5-1 or 6-5-1. Either way every cadence ends on the same note, so that
 * note has one reference -- where the player put it when the arrival was in
 * tune -- and the follow is measured from there, as in core/follow.js.
 *
 * Minor keys use the harmonic minor's dominant: the leading note raised.
 * Pure: spelled pitches in, Exercises out; no audio, no DOM. */

import { SpelledPitch } from "./pitch.js";
import { HarmonicContext } from "./tuning.js";
import { Exercise, TargetNote } from "./resolver.js";
import { ascend, scaleKeyFor, KEY_SIGNATURES } from "./generator.js";
import { offsetSequence, FOLLOW_DEFAULTS } from "./follow.js";

/* Chords as scale degrees, 0 = tonic. `bass` is the degree in the bass. */
export const CHORDS = Object.freeze({
  IV: Object.freeze({ tones: [3, 5, 0], bass: 3 }),
  ii6: Object.freeze({ tones: [1, 3, 5], bass: 3 }),
  VI: Object.freeze({ tones: [5, 0, 2], bass: 5 }),
  V: Object.freeze({ tones: [4, 6, 1], bass: 4 }),
  V7: Object.freeze({ tones: [4, 6, 1, 3], bass: 4 }),
  I: Object.freeze({ tones: [0, 2, 4], bass: 0 }),
});

export const APPROACHES = Object.freeze(["IV", "ii6", "VI"]);

/* The flute's three notes, as degrees, for each approach. Top voice: a chord
 * tone over every chord, ending on the tonic. Bass: the chords' own bass. */
export const LINES = Object.freeze({
  top: Object.freeze({ IV: [0, 6, 0], ii6: [1, 6, 0], VI: [2, 1, 0] }),
  bass: Object.freeze({ IV: [3, 4, 0], ii6: [3, 4, 0], VI: [5, 4, 0] }),
});

/* How often the dominant carries its seventh. */
export const SEVENTH_RATE = 0.5;

const mod7 = (d) => ((d % 7) + 7) % 7;

/* The key's spelling of a degree, as a letter and alteration: the scale's,
 * with the leading note raised in minor. */
function spelling(tonicPitch, degree, signature, quality) {
  const p = ascend(tonicPitch, mod7(degree), signature);
  const raise = quality === "minor" && mod7(degree) === 6 ? 1 : 0;
  return { letter: p.letter, alter: p.alter + raise };
}

const at = ({ letter, alter }, octave) => new SpelledPitch(letter, alter, octave);

/* The highest pitch of that spelling strictly below `ref`, and the lowest
 * strictly above it. */
function below(spelt, ref) {
  for (let o = ref.octave; o >= 0; o--) {
    const p = at(spelt, o);
    if (p.chromaticIndex < ref.chromaticIndex) return p;
  }
  throw new Error("nothing below");
}
function above(spelt, ref) {
  for (let o = ref.octave; o <= 9; o++) {
    const p = at(spelt, o);
    if (p.chromaticIndex > ref.chromaticIndex) return p;
  }
  throw new Error("nothing above");
}

/* Where the final tonic sits: the top voice in the fifth octave, where every
 * line stays between B4 and D6; the bass from D4 up, so a flute without a C
 * foot can play it. */
function homeTonic(tonicSpelt, role) {
  if (role === "top") return at(tonicSpelt, 5);
  const p = at(tonicSpelt, 4);
  return p.chromaticIndex >= SpelledPitch.parse("D4").chromaticIndex ? p : at(tonicSpelt, 5);
}

/* One cadence. Returns the flute's notes over their chords' basses, and for
 * each note the voices the accompaniment sounds. */
export function cadence(tonic, quality, { approach = "IV", seventh = false, role = "top",
                                         offsetCents = 0, beats = 6 } = {}) {
  const signature = KEY_SIGNATURES[scaleKeyFor(tonic, quality)];
  // `tonic` may be a key's name ("Bb"): its letter, spelled by the signature.
  const start = new SpelledPitch(tonic[0], signature[tonic[0]] ?? 0, 4);
  const spelt = (d) => spelling(start, d, signature, quality);
  const home = homeTonic(spelt(0), role);
  const names = [approach, seventh ? "V7" : "V", "I"];
  const line = LINES[role][approach];

  // The flute's notes: the final tonic is fixed; the two before it sit
  // nearest to it in the top voice -- a step or two away.
  const nearest = (spelling, ref) => {
    const a = above(spelling, ref), b = below(spelling, ref);
    const same = at(spelling, ref.octave);
    if (same.chromaticIndex === ref.chromaticIndex) return same;
    return a.chromaticIndex - ref.chromaticIndex <= ref.chromaticIndex - b.chromaticIndex ? a : b;
  };
  // The bass climbs to the dominant and falls to the tonic, so its first two
  // notes sit above the final one, never below the flute's range.
  const flute = line.map((d, i) => (i === 2 ? home
    : role === "bass" ? above(spelt(d), home) : nearest(spelt(d), home)));

  const notes = [], accompaniment = [];
  names.forEach((chordName, i) => {
    const chord = CHORDS[chordName];
    const pitch = flute[i];
    let bass, voices;
    if (role === "top") {
      // Inner voices: the chord's other tones, each just below the flute;
      // the bass an octave and more beneath them.
      const inner = chord.tones.filter((d) => mod7(d) !== mod7(line[i]))
        .map((d) => below(spelt(d), pitch));
      const lowestInner = inner.reduce((lo, p) => (p.chromaticIndex < lo.chromaticIndex ? p : lo), pitch);
      bass = below(spelt(chord.bass), lowestInner).transposeOctaves(-1);
      voices = [bass, ...inner];
    } else {
      // The flute is the bass; the chord sits just above it.
      bass = pitch;
      voices = chord.tones.filter((d) => mod7(d) !== mod7(chord.bass)).map((d) => above(spelt(d), pitch));
    }
    notes.push(new TargetNote(pitch, beats, new HarmonicContext(bass)));
    accompaniment.push(Object.freeze({ voices: Object.freeze(voices), offsetCents: i === 2 ? offsetCents : 0, chord: chordName }));
  });

  return new Exercise({
    name: names.join("–"), notes, drone: null, key: scaleKeyFor(tonic, quality),
    offsetCents, accompaniment,
  });
}

/* A session of cadences: the arrival in tune first -- the warm-up and the
 * reference -- then a balanced deck of flat, sharp and in-tune arrivals,
 * the same deck Follow me uses. The approach is drawn each time, never the
 * same twice running; the dominant takes its seventh about half the time. */
export function cadenceRun(tonic, quality, { role = "top", blocks = FOLLOW_DEFAULTS.blocks,
                                             cents = FOLLOW_DEFAULTS.cents,
                                             catchRate = FOLLOW_DEFAULTS.catchRate,
                                             beats = 6, rng = Math.random } = {}) {
  let previous = null;
  return offsetSequence({ blocks, cents, catchRate, rng }).map((offsetCents) => {
    const choices = APPROACHES.filter((a) => a !== previous);
    const approach = choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
    previous = approach;
    return cadence(tonic, quality, { approach, seventh: rng() < SEVENTH_RATE, role, offsetCents, beats });
  });
}
