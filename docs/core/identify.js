/* Which temperament is this instrument tuned to?
 *
 * Play all twelve pitch classes and each one's deviation from equal is a
 * coordinate; together they are the tuning's fingerprint. The instrument's
 * overall pitch is unknown and says nothing about temperament, so the mean is
 * removed from every vector before anything is compared -- what remains is
 * the *shape*. The candidate whose shape sits closest wins.
 *
 * The root is unknown as well, so every temperament is offered at all twelve
 * roots: Vallotti on C and Vallotti on F are different shapes and only one of
 * them can be what you are hearing. Equal temperament is the exception, being
 * the same at every root, so it is offered once and reported without one.
 *
 * What this can and cannot answer, measured over the shipped temperaments
 * (flutetrainer/tools/temperament_separation.py prints the table):
 *
 *   meantone against anything else       9.6 cents apart   easy
 *   a well temperament against equal     3.5 cents apart   reliable
 *   the root of a well temperament       2.0 cents apart   borderline
 *   Vallotti / Werckmeister / Kirnberger 1.5 cents apart   out of reach
 *
 * One limit has no fix. Notes are named by proximity to the reference pitch,
 * so a reference set a whole semitone out names every note by its neighbour;
 * the shape is unchanged, fits perfectly, and the root is reported a semitone
 * adrift. A uniform semitone shift and a genuinely different root are the same
 * data, so no arithmetic can separate them. The one tell is the pitch the
 * instrument is reported to sound, which is why it is always shown.
 *
 * A harpsichord tuned by a careful human still carries one to two cents of
 * error per note, and that term belongs to the instrument, not to us: it
 * cannot be measured away. So the family is answerable and the individual
 * well temperament is not, and this module says so rather than picking the
 * nearest and sounding certain. Everything within CONTENTION_CENTS of the
 * best is reported as fitting equally well.
 */

import { parseScala } from "./tuning.js";
import { TEMPERAMENTS, TEMPERAMENT_ORDER } from "./temperaments.js";

/** Chromatic pitch classes, indexed as SpelledPitch.chromaticIndex is. */
export const PITCH_CLASSES = Object.freeze(
  ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]);

/** Where A sits in PITCH_CLASSES: the reference pitch is stated at A. */
export const A_INDEX = 9;
/** Below this many classes the shape is too under-determined to fit at all. */
export const MIN_CLASSES = 7;
/** All twelve: only then is every candidate fully constrained. */
export const FULL_CLASSES = 12;
/** Candidates this close to the best fit are not distinguishable from it. */
export const CONTENTION_CENTS = 1.5;
/** Beyond this the reference pitch is set wrong and notes may be misnamed. */
export const OFFSET_WARN_CENTS = 35;

/** Deviations from equal for one temperament rooted on C, mean not removed. */
export function temperamentShape(key) {
  const scale = parseScala(TEMPERAMENTS[key].scl);
  return scale.degreesCents.slice(0, 12).map((c, i) => c - i * 100);
}

/** Mean of the entries at `indices` only. */
function meanAt(values, indices) {
  return indices.reduce((sum, i) => sum + values[i], 0) / indices.length;
}

/** Every (temperament, root) worth offering: 4 x 12 wells plus equal once. */
export function candidates() {
  const out = [];
  for (const key of TEMPERAMENT_ORDER) {
    const shape = temperamentShape(key);
    if (key === "equal") {
      // Rotating equal temperament gives equal temperament; it has no root,
      // and offering twelve identical candidates would only crowd the table.
      out.push({ temperament: key, root: null, shape });
      continue;
    }
    for (let root = 0; root < 12; root++) {
      // Rooting on `root` moves degree 0 of the scale to that pitch class.
      out.push({
        temperament: key,
        root,
        shape: shape.map((_, i) => shape[(i - root + 12) % 12]),
      });
    }
  }
  return out;
}

/** RMS distance between two shapes over `indices`, each mean-removed first. */
export function shapeDistance(a, b, indices) {
  const ma = meanAt(a, indices);
  const mb = meanAt(b, indices);
  const sum = indices.reduce((acc, i) => acc + ((a[i] - ma) - (b[i] - mb)) ** 2, 0);
  return Math.sqrt(sum / indices.length);
}

/* Which family a temperament belongs to. The family is the answer this can
 * actually stand behind, so it is named explicitly rather than inferred. */
const FAMILY = Object.freeze({
  meantone_quarter: "meantone",
  vallotti: "well",
  werckmeister3: "well",
  kirnberger3: "well",
  equal: "equal",
});

/**
 * What a candidate predicts each pitch class should sound, in cents from equal.
 *
 * A temperament fixes the *intervals* between its notes, never their absolute
 * height: it says nothing about whether the instrument sits at 440 or 441. So
 * the candidate's shape is slid bodily until it best matches what was actually
 * heard -- by the difference of the two means over the classes played -- and
 * only then does it predict anything. Without that step every prediction would
 * be wrong by however far the instrument sits from the reference, which is the
 * one thing a temperament cannot be blamed for.
 */
export function predictedCents(deviations, shape) {
  const present = [];
  for (let i = 0; i < 12; i++) {
    if (Number.isFinite(deviations[i])) present.push(i);
  }
  if (!present.length) return shape.slice();
  const shift = meanAt(deviations, present) - meanAt(shape, present);
  return shape.map((c) => c + shift);
}

/** The frequency a pitch class should sound, given a predicted deviation. */
export function expectedHz(index, devCents, referenceHz, octave = 4) {
  // Pitch classes are indexed from C; the reference is stated at A4, which is
  // nine semitones above C4.
  const semis = (index - A_INDEX) + 12 * (octave - 4);
  return referenceHz * 2 ** (semis / 12) * 2 ** (devCents / 1200);
}

/**
 * One row per temperament: its best root, and how well it fits there.
 *
 * The full ranking is 49 rows and unreadable while playing. This is the
 * question actually being asked -- which temperaments are still standing --
 * with each one shown at whichever root suits it best.
 */
export function bestByTemperament(ranked) {
  const best = new Map();
  for (const c of ranked) {
    if (!best.has(c.temperament)) best.set(c.temperament, c);
  }
  return [...best.values()].sort((a, b) => a.distance - b.distance);
}

/**
 * Name a heard frequency by proximity, and say how far off it sits.
 *
 * The reference pitch is stated at A, so semitones are counted from there.
 * Proximity is safe because no temperament here moves a note more than about
 * 25 cents from equal -- only a badly set reference can misname one, which
 * `identify` flags through `offsetSuspect` rather than hiding.
 *
 * @returns {{index: number, cents: number}} pitch class, and cents from it.
 */
export function classifyHz(hz, referenceHz) {
  const semis = 12 * Math.log2(hz / referenceHz);
  const nearest = Math.round(semis);
  return {
    index: (((nearest % 12) + 12) + A_INDEX) % 12,
    cents: 100 * (semis - nearest),
  };
}

/**
 * Identify the temperament from measured deviations.
 *
 * @param deviations array of 12, cents from equal temperament at the current
 *   reference pitch, or null for a pitch class that was not played.
 * @returns the ranked candidates, what can be claimed, and the offset -- which
 *   is a by-product worth having: it is the instrument's actual pitch.
 */
export function identify(deviations, { referenceHz = 440 } = {}) {
  const present = [];
  for (let i = 0; i < 12; i++) {
    if (deviations[i] !== null && deviations[i] !== undefined && Number.isFinite(deviations[i])) {
      present.push(i);
    }
  }
  const offsetCents = present.length ? meanAt(deviations, present) : 0;
  // The instrument's pitch is what its A sounds, not the average of all its
  // notes: every temperament puts its own notes at its own heights, so the
  // mean carries the temperament's shape as well as the instrument's pitch.
  // Fall back to the mean only when A was not played, and say which was used.
  const aCents = deviations[A_INDEX];
  const fromA = Number.isFinite(aCents);
  const base = {
    present: present.length, offsetCents,
    measuredHz: referenceHz * 2 ** ((fromA ? aCents : offsetCents) / 1200),
    measuredFrom: fromA ? "a" : "mean",
    // Notes are named by proximity, so a reference set a long way from the
    // instrument renames every one of them and quietly rotates the root.
    offsetSuspect: Math.abs(offsetCents) > OFFSET_WARN_CENTS,
  };
  if (present.length < MIN_CLASSES) {
    return { ...base, ranked: [], best: null, contenders: [], verdict: "insufficient", root: null };
  }

  const ranked = candidates()
    .map((c) => ({ ...c, distance: shapeDistance(deviations, c.shape, present) }))
    .sort((a, b) => a.distance - b.distance);

  const best = ranked[0];
  const contenders = ranked.filter((c) => c.distance - best.distance <= CONTENTION_CENTS);
  const families = new Set(contenders.map((c) => FAMILY[c.temperament]));
  const roots = new Set(contenders.map((c) => c.root));
  const temperaments = new Set(contenders.map((c) => c.temperament));

  return {
    ...base,
    ranked,
    best,
    contenders,
    // One temperament left standing is a name; several of one family is a
    // family; several families is an honest shrug.
    verdict: temperaments.size === 1 ? "temperament"
      : families.size === 1 ? [...families][0]
        : "unsure",
    // A root is only claimed when every candidate still standing agrees on it.
    root: roots.size === 1 ? [...roots][0] : null,
    partial: present.length < FULL_CLASSES,
  };
}
