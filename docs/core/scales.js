/* Recognising scales in something already played.
 *
 * The player practises scales for as long as they like, roaming between keys,
 * and afterwards is told what was heard. Nothing here judges intonation --
 * this only answers "was that a scale, and in what key", so that the notes can
 * then be measured against the right tonic.
 *
 * Everything below is shaped by one 175-second recording of this flute
 * (`recordings/scales.wav`), and every number that follows was set by looking
 * at it rather than by reasoning about it. That distinction matters here: this
 * project has produced three rules from simulation alone -- a detector gate, a
 * phantom F between E and F#, and a trill rule -- and all three were wrong
 * until real audio corrected them.
 *
 * Three findings from that recording drive the design.
 *
 * 1. SILENCE CANNOT SEPARATE SCALES. Within a scale the notes are contiguous:
 *    the median gap between them is 0.00 s, because the region tracker splits
 *    on a change of pitch and not on silence. Two scales deliberately run
 *    together with no breath were 0.05 s apart -- inside the within-scale
 *    range. So a gap threshold can never split them, and the contour has to
 *    lead. Gap survives only as a one-way veto: a long silence may split a
 *    chain, but a short one may never join two the contour has separated. A
 *    false split costs one recognised scale; a false join invents a key.
 *
 * 2. THE DETECTOR JUMPS OCTAVES, six times in 226 notes, always at a register
 *    crossing: D5 -> E4 -> E5, G5 -> F#4 -> F#5. Left alone each one breaks a
 *    chain in half and loses the scale. They are unmistakable -- a leap of
 *    more than six semitones that a 12-semitone shift turns into a step of two
 *    or less -- so they are repaired before anything else looks at the notes.
 *
 * 3. THE SPELLING THAT ARRIVES IS NOT MUSICAL. Note names come from
 *    `core/naming.js`, which picks the nearest of a fixed list by cents alone.
 *    In the recording, E major's D# came back as *Eb*. So comparison is on
 *    `chromaticIndex` throughout, `SpelledPitch.equals` is never used, and the
 *    spelling is re-derived from the key once the key is known.
 */

import { SpelledPitch, mod } from "./pitch.js";
import { KEY_SIGNATURES } from "./generator.js";

/** Tone tone semitone, tone tone tone semitone. */
export const MAJOR_STEPS = Object.freeze([2, 2, 1, 2, 2, 2, 1]);

/* ---- thresholds, all set from recordings/scales.wav -------------------- */

/** Fewest notes worth calling a scale. A six-note stepwise figure is melody. */
export const SCALE_MIN_NOTES = 6;
/** Largest step inside a run: 4 bridges exactly one dropped whole tone. */
export const SCALE_MAX_STEP = 4;
/** A silence this long splits a chain even where the contour continues.
 *  Between items in the recording the silences ran to 6.6 s; inside a scale
 *  they were 0.00 s. Anywhere in between is safe. */
export const SCALE_GAP_SECONDS = 0.9;
/** Beyond a leap this size, a 12-semitone shift is read as an octave error. */
export const OCTAVE_ERROR_LEAP = 6;
/** ...but only if the shift lands this close to the previous note. */
export const OCTAVE_ERROR_TOLERANCE = 2;

/* Alignment costs. A missing note is the common case -- notes too short to
 * measure never reach here at all -- so it is the cheapest real error. A
 * repeat costs almost nothing: players re-tongue the top note. */
export const COST_MISSING = 1.0;
export const COST_EXTRA = 1.0;
export const COST_WRONG = 1.0;
export const COST_REPEAT = 0.1;

/** Fit below this is not a scale. Fit is 1 minus cost per template note. */
export const SCALE_MIN_FIT = 0.7;
/** However good the fit, this many notes must actually have matched. */
export const SCALE_MIN_MATCHED = 6;
/** Two keys closer than this in fit are not distinguishable; say so. */
export const SCALE_KEY_MARGIN = 0.06;

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/* ---- octave errors ----------------------------------------------------- */

/**
 * Repair the detector's octave jumps, in place of nothing else touching them.
 *
 * @param chroma absolute semitone values, in play order
 * @returns {{ chroma: number[], repaired: number[] }} corrected values and the
 *   indices that were moved, so the caller can report rather than hide them.
 */
export function correctOctaveErrors(chroma) {
  const out = [...chroma];
  const repaired = [];
  for (let i = 1; i < out.length; i++) {
    const leap = out[i] - out[i - 1];
    if (Math.abs(leap) <= OCTAVE_ERROR_LEAP) continue;
    for (const shift of [12, -12]) {
      if (Math.abs(leap + shift) <= OCTAVE_ERROR_TOLERANCE) {
        out[i] += shift;
        repaired.push(i);
        break;
      }
    }
  }
  return { chroma: out, repaired };
}

/* ---- chains ------------------------------------------------------------ */

/**
 * Split the stream into stepwise passages, allowing one turn.
 *
 * A scale played up and back down is ONE run, so the reversal at the top is
 * expected rather than a break. A second reversal ends the chain: that is
 * melody, not a scale.
 */
export function stepwiseChains(notes, { maxStep = SCALE_MAX_STEP, gapSeconds = SCALE_GAP_SECONDS,
                                        minNotes = SCALE_MIN_NOTES } = {}) {
  const { chroma } = correctOctaveErrors(notes.map((n) => n.pitch.chromaticIndex));
  const chains = [];
  let start = 0;
  let direction = 0;      // +1 rising, -1 falling, 0 not yet known
  let turned = false;

  const close = (end) => {
    if (end - start >= minNotes) chains.push({ start, end });
  };

  for (let i = 1; i < notes.length; i++) {
    const step = chroma[i] - chroma[i - 1];
    // A silence may split a chain; it may never join one. See finding 1.
    const gap = timeBetween(notes[i - 1], notes[i]);
    const broken = (gap !== null && gap > gapSeconds) || Math.abs(step) > maxStep;

    if (broken) {
      close(i);
      start = i; direction = 0; turned = false;
      continue;
    }
    if (step === 0) continue;                       // a re-articulated repeat
    const way = step > 0 ? 1 : -1;
    if (direction === 0) { direction = way; continue; }
    if (way !== direction) {
      if (turned) { close(i); start = i - 1; direction = way; turned = false; continue; }
      turned = true;
      direction = way;
    }
  }
  close(notes.length);
  return chains;
}

/** Seconds of silence between two notes, or null when they carry no times. */
function timeBetween(a, b) {
  if (!Number.isFinite(a?.atSeconds) || !Number.isFinite(b?.atSeconds)) return null;
  return b.atSeconds - (a.atSeconds + (a.seconds ?? 0));
}

/* ---- templates --------------------------------------------------------- */

/**
 * The absolute semitones a major scale would sound.
 *
 * @param startChroma where the scale begins
 * @param shape "up" | "down" | "updown" -- a player who stops at the top has
 *   still played a scale, so all three are offered as hypotheses.
 */
export function majorTemplate(startChroma, { octaves = 1, shape = "updown" } = {}) {
  const up = [startChroma];
  for (let d = 0; d < 7 * octaves; d++) up.push(up[up.length - 1] + MAJOR_STEPS[d % 7]);
  if (shape === "up") return up;
  if (shape === "down") return [...up].reverse();
  return up.concat([...up].reverse().slice(1));
}

/* ---- alignment --------------------------------------------------------- */

/**
 * Align what was played against what was expected, tolerantly.
 *
 * A greedy walk is not good enough: a pickup note before the tonic is eaten as
 * the tonic, everything after shifts by one, and the scale is lost. This is a
 * standard monotone edit alignment, which can put that note back.
 *
 * A difference of one semitone is a wrong note and is kept as such -- for a
 * scales exercise that IS the finding, and the caller reports both what was
 * played and what was wanted. A difference of two or more is not a
 * substitution but an insert and a delete, so a wrong key loses instead of
 * absorbing the damage and scoring well anyway.
 */
export function alignToTemplate(observed, template, opts = {}) {
  const { costMissing = COST_MISSING, costExtra = COST_EXTRA,
          costWrong = COST_WRONG, costRepeat = COST_REPEAT } = opts;
  const n = observed.length, m = template.length;
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const from = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(""));

  for (let i = 1; i <= n; i++) { cost[i][0] = cost[i - 1][0] + costExtra; from[i][0] = "extra"; }
  for (let j = 1; j <= m; j++) { cost[0][j] = cost[0][j - 1] + costMissing; from[0][j] = "missing"; }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diff = Math.abs(observed[i - 1] - template[j - 1]);
      const step = diff === 0 ? 0 : diff === 1 ? costWrong : Infinity;
      // A repeat of the note just consumed is nearly free.
      const repeat = i > 1 && observed[i - 1] === observed[i - 2] ? costRepeat : costExtra;
      const options = [
        [cost[i - 1][j - 1] + step, diff === 0 ? "match" : "wrong"],
        [cost[i - 1][j] + repeat, repeat === costRepeat ? "repeat" : "extra"],
        [cost[i][j - 1] + costMissing, "missing"],
      ];
      let best = options[0];
      for (const o of options) if (o[0] < best[0]) best = o;
      cost[i][j] = best[0];
      from[i][j] = best[1];
    }
  }

  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const op = from[i][j];
    if (op === "match" || op === "wrong") { ops.push({ op, observed: i - 1, template: j - 1 }); i--; j--; }
    else if (op === "missing") { ops.push({ op, template: j - 1 }); j--; }
    else { ops.push({ op, observed: i - 1 }); i--; }
  }
  ops.reverse();

  const tally = (what) => ops.filter((o) => o.op === what).length;
  const matched = tally("match");
  return {
    cost: cost[n][m], ops, matched,
    wrong: tally("wrong"), missing: tally("missing"), extra: tally("extra"), repeats: tally("repeat"),
    // Per template note, so a two-octave scale is not penalised for its length.
    fit: 1 - cost[n][m] / m,
  };
}

/* ---- the whole thing --------------------------------------------------- */

/** The key name for a tonic pitch class, or null when it cannot be spelled. */
function keyNameFor(pitchClass) {
  for (const key of Object.keys(KEY_SIGNATURES)) {
    const tonic = SpelledPitch.parse(`${key}4`);
    if (tonic.pitchClass === pitchClass) return key;
  }
  return null;
}

/* Semitones above C for each letter, so a chroma can be turned back into a
 * spelling rather than merely into a pitch class. */
const LETTER_CHROMA = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });

/**
 * Re-derive the spelling from the decided key. Never trust what arrived.
 *
 * Driven by each note's own chroma rather than by counting degrees upward,
 * because a template that comes back down would otherwise keep walking up the
 * alphabet and spell the descent as a second ascent. The key signature says
 * which letter carries each pitch class; the chroma says which octave.
 */
function spellRun(keyName, template) {
  if (!keyName) return null;
  const signature = KEY_SIGNATURES[keyName];
  const byPitchClass = new Map();
  for (const letter of "CDEFGAB") {
    const alter = signature[letter] ?? 0;
    byPitchClass.set(mod(LETTER_CHROMA[letter] + alter, 12), { letter, alter });
  }
  const out = [];
  for (const chroma of template) {
    const spelling = byPitchClass.get(mod(chroma, 12));
    if (!spelling) return null;            // a note the key cannot spell
    const { letter, alter } = spelling;
    out.push(new SpelledPitch(letter, alter, (chroma - LETTER_CHROMA[letter] - alter) / 12));
  }
  return out;
}

/**
 * Find the major scales in a list of played notes.
 *
 * @param notes ordered, each with `.pitch` (a SpelledPitch); `.atSeconds` and
 *   `.seconds` are used when present and simply not used when absent.
 * @param options.expectTonic pitch class the player declared they would play.
 *   In guided and chosen modes this is known, which turns identification into
 *   verification and lets a damaged run be accepted that free mode would have
 *   to reject as unplaceable.
 * @returns half-open index ranges, as `alternationRuns` does, plus what was
 *   worked out about each.
 */
export function scaleRuns(notes, options = {}) {
  const { expectTonic = null, minFit = SCALE_MIN_FIT, minMatched = SCALE_MIN_MATCHED,
          keyMargin = SCALE_KEY_MARGIN } = options;
  if (!notes || notes.length < SCALE_MIN_NOTES) return [];

  const { chroma, repaired } = correctOctaveErrors(notes.map((n) => n.pitch.chromaticIndex));
  const repairedSet = new Set(repaired);
  const runs = [];

  for (const { start, end } of stepwiseChains(notes, options)) {
    const observed = chroma.slice(start, end);
    const tonics = expectTonic === null ? [...Array(12).keys()] : [mod(expectTonic, 12)];

    let best = null, runnerUp = null;
    for (const pc of tonics) {
      for (const octaves of [1, 2]) {
        for (const shape of ["updown", "up", "down"]) {
          // The scale must begin somewhere the player actually played.
          const anchors = shape === "down"
            ? [Math.max(...observed)] : [Math.min(...observed), observed[0]];
          for (const anchor of new Set(anchors)) {
            const startChroma = anchor + mod(pc - mod(anchor, 12), 12);
            const template = majorTemplate(startChroma, { octaves, shape });
            const fitted = alignToTemplate(observed, template, options);
            const candidate = { pc, octaves, shape, startChroma, template, ...fitted };
            if (!best || candidate.fit > best.fit) { runnerUp = best; best = candidate; }
            else if (!runnerUp || candidate.fit > runnerUp.fit) runnerUp = candidate;
          }
        }
      }
    }

    if (!best || best.fit < minFit || best.matched < minMatched) continue;
    const keyName = keyNameFor(best.pc);
    const ambiguous = !!runnerUp && runnerUp.pc !== best.pc
      && best.fit - runnerUp.fit < keyMargin;

    runs.push({
      start, end,
      tonicPitchClass: best.pc,
      tonicName: keyName,
      pitchClassName: PITCH_CLASSES[best.pc],
      spellable: keyName !== null,
      octaves: best.octaves,
      shape: best.shape,
      fit: best.fit,
      matched: best.matched,
      wrongNotes: best.wrong,
      missingNotes: best.missing,
      extraNotes: best.extra,
      octaveErrors: [...repairedSet].filter((i) => i >= start && i < end).length,
      expected: spellRun(keyName, best.template),
      ambiguous,
      runnerUpPitchClass: ambiguous ? runnerUp.pc : null,
    });
  }
  return runs;
}
