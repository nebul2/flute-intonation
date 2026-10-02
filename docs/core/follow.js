/* "Follow me": a partner who drifts, and whether you went with them.
 *
 * Every other exercise tunes against a bass that never moves. In a duo the
 * other flute warms up sharp or sags flat, and the skill is to hear it and go
 * there -- in tune with the partner, out of tune with a tuner. Kopiez (2003)
 * found even professionals did not: they played the same intonation whatever
 * the accompaniment did, and did not know it. See cr/010.
 *
 * The note's own figure is analyseNote() against the *shifted* target, as
 * anywhere else; only the target moves. What this file adds is the one new
 * figure, the follow ratio: how far you moved, as a share of how far the
 * partner moved.
 *
 * "How far you moved" is measured from where *you* played the same note
 * while the partner was in tune, never from where the tuning puts it. The
 * first real take (8.7, unison, 2 October 2026) sat 20-55 cents sharp of
 * the tuning on nearly every note whatever the partner did, and measured
 * from the tuning that read as 200% following a sharp partner and as going
 * the wrong way with a flat one. A flute sitting sharp is not following
 * anybody. So a session plays one set of notes in every block, the first
 * block is in tune and is the reference, and every in-tune block after it
 * refreshes the reference -- a difference between the player's own
 * soundings, as in Adjust to the drone.
 *
 * Pure: no audio, no DOM, no storage. What the flute can bend is passed in
 * as a predicate, because the per-flute profiles live outside core/.
 */

import { SpelledPitch, intervalBetween } from "./pitch.js";
import { HarmonicContext } from "./tuning.js";
import { Exercise, TargetNote } from "./resolver.js";
import { ascend, scaleKeyFor, KEY_SIGNATURES, inRange, shuffled } from "./generator.js";

/* The ladder, in the order it is offered. `steps` is how many diatonic steps
 * the partner sits *below* the player; `interval` is the spelled interval
 * from partner up to player that must result, so a diminished fifth or the
 * wrong kind of third is never asked for under the name of another. `low` and
 * `high` bound the player's note: long tones where a traverso is willing, and
 * the octave level in the second octave so the partner can sit beneath it. */
export const FOLLOW_LEVELS = Object.freeze({
  unison: Object.freeze({ steps: 0, interval: "P1", octaves: 0, low: "D4", high: "A5" }),
  octave: Object.freeze({ steps: 7, interval: "P1", octaves: 1, low: "D5", high: "D6" }),
  fifth: Object.freeze({ steps: 4, interval: "P5", octaves: 0, low: "A4", high: "E6" }),
  majorThird: Object.freeze({ steps: 2, interval: "M3", octaves: 0, low: "F4", high: "B5" }),
  minorThird: Object.freeze({ steps: 2, interval: "m3", octaves: 0, low: "F4", high: "B5" }),
});

/* Defaults, every one of them a spec or a setting rather than buried below.
 * 20 cents is past the app's own "off" line, so the first level is plainly
 * audible; it is a starting point, not a perceptual threshold. */
export const FOLLOW_DEFAULTS = Object.freeze({
  cents: 20,
  blocks: 6,           // a bounded session: about four minutes at six-second notes
  notesPerBlock: 4,    // long enough to be a situation rather than a note
  catchRate: 0.25,     // blocks after the first in which the partner is in tune
});

/* Below this the ratio is a quotient of noise: a 3-cent wobble over a 4-cent
 * offset reads as 75%, and a figure made from noise would be acted on. */
export const MIN_FOLLOW_OFFSET = 8.0;

/* What is said about the whole run: a difference between following flat and
 * following sharp is named only with this many blocks each way behind it,
 * and only when the two differ by this much. */
export const PATTERN_MIN_BLOCKS = 2;
export const PATTERN_GAP = 0.25;

/* Notes this traverso is reported not to bend one way, used only where the
 * flute has no measured profile for that note (Profile my flute measures
 * the real thing). Reported from playing, 31 August 2026; not measured. */
export const UNMEASURED_RIGID = Object.freeze({ C4: "up", "F#4": "up", F4: "down" });

/* "up" for a partner gone sharp, "down" for one gone flat, null for in tune. */
export function directionOf(offsetCents) {
  if (offsetCents > 0) return "up";
  if (offsetCents < 0) return "down";
  return null;
}

/* A frequency moved by some cents. */
export function shiftedHz(hz, cents) {
  return hz * Math.pow(2, cents / 1200);
}

/* The default bend check: the built-in list above, for a flute nobody has
 * measured. */
export function unmeasuredCanBend(pitch, direction) {
  return UNMEASURED_RIGID[pitch.name] !== direction;
}

/* The partner's offset for each block. The first block is always in tune --
 * the partner starts where the tuning says, so the ear has somewhere to start
 * from -- and the rest are a shuffled, balanced deck: a share in tune (the
 * catches, without which the lesson learned is "always move" rather than
 * "listen"), and the others split as evenly as they go between flat and
 * sharp. A deck rather than a coin per block, so a short session cannot come
 * out all one way and the end report has both directions to compare. */
export function offsetSequence({ blocks = FOLLOW_DEFAULTS.blocks, cents = FOLLOW_DEFAULTS.cents,
                                 catchRate = FOLLOW_DEFAULTS.catchRate, rng = Math.random } = {}) {
  if (blocks < 1) return [];
  const rest = blocks - 1;
  const catches = Math.round(catchRate * rest);
  const moving = rest - catches;
  const flatFirst = rng() < 0.5;
  const deck = [];
  for (let i = 0; i < moving; i++) deck.push(((i % 2 === 0) === flatFirst ? -1 : 1) * cents);
  for (let i = 0; i < catches; i++) deck.push(0);
  return [0, ...shuffled(deck, rng)];
}

/* The player's notes a level can ask for in a key: scale notes in the
 * level's range whose partner, the given steps below in the same key, makes
 * exactly the named interval. */
export function followPool(tonic, quality, level) {
  const spec = FOLLOW_LEVELS[level];
  if (!spec) throw new Error(`no follow level ${level}`);
  const signature = KEY_SIGNATURES[scaleKeyFor(tonic, quality)];
  const low = SpelledPitch.parse(spec.low), high = SpelledPitch.parse(spec.high);
  // `tonic` may be a key's name ("Bb"): the letter is its first character,
  // the signature spells the rest.
  const start = new SpelledPitch(tonic[0], signature[tonic[0]] ?? 0, 3);
  const pool = [];
  for (let d = 0; d < 7 * 4; d++) {
    const pitch = ascend(start, d, signature);
    if (!inRange(pitch, low, high)) continue;
    const partner = ascend(pitch, -spec.steps, signature);
    const iv = intervalBetween(partner, pitch);
    if (iv.simpleName === spec.interval && iv.octaves === spec.octaves) pool.push({ pitch, partner });
  }
  return pool;
}

/* One block: `notesPerBlock` long tones over a partner sitting `offsetCents`
 * from in tune. Each note carries its own partner as its harmonic context,
 * so the pure target is the interval above the partner and the runner knows
 * what to sound. Notes the flute cannot bend the way the partner went are
 * left out; if that leaves nothing, the whole pool is used rather than an
 * empty block. Drawn without repeats while the pool lasts. */
export function followBlock(pool, { offsetCents = 0, notesPerBlock = FOLLOW_DEFAULTS.notesPerBlock,
                                    beats = 6, canBend = unmeasuredCanBend, rng = Math.random,
                                    key = "" } = {}) {
  const direction = directionOf(offsetCents);
  const bendable = direction ? pool.filter((p) => canBend(p.pitch, direction)) : pool;
  const usable = bendable.length ? bendable : pool;
  const picks = [];
  let deck = [];
  while (picks.length < notesPerBlock && usable.length) {
    if (!deck.length) deck = shuffled(usable, rng);
    picks.push(deck.pop());
  }
  return new Exercise({
    name: `follow ${offsetCents >= 0 ? "+" : ""}${offsetCents}`,
    notes: picks.map(({ pitch, partner }) => new TargetNote(pitch, beats, new HarmonicContext(partner))),
    drone: null, key, offsetCents,
  });
}

/* The notes a whole session plays: drawn once, and played in every block in
 * a fresh order, so each has an in-tune reference to be measured against.
 * Notes the flute can bend both ways are preferred, since the partner will
 * go both ways; if there are too few, the rest of the pool fills the set. */
export function followSet(pool, { notesPerBlock = FOLLOW_DEFAULTS.notesPerBlock,
                                  canBend = unmeasuredCanBend, rng = Math.random } = {}) {
  const either = (p) => canBend(p.pitch, "up") && canBend(p.pitch, "down");
  const preferred = shuffled(pool.filter(either), rng);
  const rest = shuffled(pool.filter((p) => !either(p)), rng);
  return [...preferred, ...rest].slice(0, notesPerBlock);
}

/* A whole session: one block per offset in the sequence, every block the
 * same set of notes. The set's own bend check has already been made, so the
 * blocks are not filtered again -- a note left out of one block would have
 * nothing to compare with. */
export function followRun(tonic, quality, level, { blocks, cents, catchRate, notesPerBlock,
                                                   beats, canBend, rng = Math.random } = {}) {
  const pool = followPool(tonic, quality, level);
  const key = scaleKeyFor(tonic, quality);
  const set = followSet(pool, { notesPerBlock, canBend, rng });
  return offsetSequence({ blocks, cents, catchRate, rng })
    .map((offsetCents) => followBlock(set, { offsetCents, notesPerBlock: set.length, beats,
                                             canBend: () => true, rng, key }));
}

/* The reference: for each note, where it was last played while the partner
 * was in tune, in cents from the tuning's target. Built from the blocks
 * before the one being read, in order. `blocks` is [{offsetCents, readings}]
 * where a reading is {name, vsPartner} -- the spelled name and analyseNote's
 * meanCents against the partner. */
export function referenceFrom(blocks) {
  const reference = new Map();
  for (const { offsetCents, readings } of blocks) {
    if (Math.abs(offsetCents) >= MIN_FOLLOW_OFFSET) continue;
    for (const r of readings) {
      if (Number.isFinite(r.vsPartner)) reference.set(r.name, r.vsPartner + offsetCents);
    }
  }
  return reference;
}

/* One block, read.
 *
 * `vsPartner` is the mean against the partner over the notes played: where
 * you sat relative to them, which is worth saying on its own. `shift` is how
 * far you moved from your own reference for the same notes, over the notes
 * that have one; `ratio` is that over the partner's offset -- 1 is all the
 * way with the partner, 0 is where you played the note when it was in tune.
 * Null when nothing was played, `shift` null when no note has a reference
 * yet (the first block), `ratio` null when the partner did not move far
 * enough for it to mean anything. */
export function blockFollow(readings, offsetCents, reference = new Map()) {
  const played = readings.filter((r) => Number.isFinite(r.vsPartner));
  if (!played.length) return null;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const shifts = played.filter((r) => reference.has(r.name))
    .map((r) => r.vsPartner + offsetCents - reference.get(r.name));
  const shift = shifts.length ? mean(shifts) : null;
  const ratio = shift !== null && Math.abs(offsetCents) >= MIN_FOLLOW_OFFSET ? shift / offsetCents : null;
  return { vsPartner: mean(played.map((r) => r.vsPartner)), shift, ratio, offsetCents,
           notes: played.length, compared: shifts.length };
}

/* Across a session: the mean ratio each way, and whether one direction is
 * followed more readily than the other -- named only when the session holds
 * enough blocks each way and the gap is real. An in-tune block after the
 * first contributes how far you moved when nothing asked you to. */
export function followPattern(blocks) {
  const of = (dir) => blocks.filter((b) => b && directionOf(b.offsetCents) === dir && b.ratio !== null);
  const meanRatio = (list) => (list.length ? list.reduce((a, b) => a + b.ratio, 0) / list.length : null);
  const flat = of("down"), sharp = of("up");
  const catches = blocks.filter((b) => b && Math.abs(b.offsetCents) < MIN_FOLLOW_OFFSET && b.shift !== null);
  const result = {
    flat: meanRatio(flat), flatBlocks: flat.length,
    sharp: meanRatio(sharp), sharpBlocks: sharp.length,
    catchMoved: catches.length ? catches.reduce((a, b) => a + b.shift, 0) / catches.length : null,
    catchBlocks: catches.length,
    readier: null,
  };
  if (flat.length >= PATTERN_MIN_BLOCKS && sharp.length >= PATTERN_MIN_BLOCKS) {
    const gap = result.flat - result.sharp;
    if (Math.abs(gap) >= PATTERN_GAP) result.readier = gap > 0 ? "flat" : "sharp";
  }
  return result;
}

/* The warm-up: the first block, partner in tune, played until every note is
 * with the partner -- the player's own request after the first session,
 * which started lost. It doubles as the reference every later block is
 * measured from, so a reference taken while the player was nowhere near the
 * partner was not much of one.
 *
 * Passes when every one of the `expected` notes was played and sat within
 * `withinCents` of the partner. `allSame` names the direction when every
 * note played missed, and all the same way -- the shape a flute set up sharp or flat leaves,
 * which no amount of listening fixes. */
export function warmupVerdict(readings, withinCents, expected = readings.length) {
  const notes = readings.map((r) => {
    const played = Number.isFinite(r.vsPartner);
    const ok = played && Math.abs(r.vsPartner) <= withinCents;
    const way = !played || ok ? null : r.vsPartner > 0 ? "sharp" : "flat";
    return { name: r.name, vsPartner: played ? r.vsPartner : null, ok, way };
  });
  const passed = notes.length >= expected && notes.every((n) => n.ok);
  // Every note played, every one out, all the same way: the whole flute.
  const played = notes.filter((n) => n.vsPartner !== null);
  const ways = new Set(played.map((n) => n.way));
  const allSame = played.length && played.every((n) => !n.ok) && ways.size === 1 ? [...ways][0] : null;
  return { passed, notes, allSame };
}

/* The held note: the partner starts in tune, you join and settle, and partway
 * through the note it glides to the block's offset while you hold. The real
 * case is a long note sagging under you in a duo. One note long, it needs
 * room: `before` seconds of settled playing to measure from, a `glide` of the
 * partner, and enough after it to settle again -- so a note of `seconds`,
 * of which the segmenter asks for 60%, which must exceed before + glide. */
export const HELD = Object.freeze({ seconds: 12, before: 3.0, glide: 1.5 });

/* Where each note sat before the partner moved, as the reference for the
 * same note after -- the reference is inside the note itself, so nothing
 * from any other block is needed. `readings` are {name, before} with
 * `before` analyseNote's meanCents over the frames before the glide. */
export function heldReference(readings) {
  return new Map(readings.filter((r) => Number.isFinite(r.before)).map((r) => [r.name, r.before]));
}
