/* Naming a heard frequency.
 *
 * Pure arithmetic over a tuning and a spelled pitch, and it lived in ui/ only
 * by accident of who first needed it. That mattered: core/ may not import
 * ui/, and tests/wavpipe.js -- which runs the shipped detector over a real
 * recording -- cannot import ui/widgets.js either, because that reaches
 * audio/engine.js and its browser APIs. So a WAV could never be turned into
 * *named* notes outside a browser, and anything built on note names could
 * only ever be tested on synthetic input.
 *
 * A caution for anything built on these names: SPELLINGS is a fixed list and
 * the nearest candidate wins on cents alone, so the spelling that comes back
 * is proximity, not musical sense -- the A flat of an E flat scale arrives
 * here as G sharp. Compare by chromaticIndex, never by SpelledPitch.equals,
 * and re-derive the spelling from the key once the key is known.
 *
 * Re-exported from ui/widgets.js, so no caller changed.
 */

import { SpelledPitch, mod } from "./pitch.js";
import { KEY_SIGNATURES } from "./generator.js";

/* Every named pitch in a range with its frequency in `tuning`, and the one
 * nearest a heard frequency. Spellings as in the desktop tuner: flats where
 * the flute's keys prefer them; cosmetic in a 12-note temperament. */
const SPELLINGS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];

export function tunerCandidates(tuning, low = 3, high = 7) {
  const out = [];
  for (let octave = low; octave <= high; octave++) {
    for (const spelling of SPELLINGS) {
      const pitch = SpelledPitch.parse(`${spelling}${octave}`);
      out.push({ pitch, hz: tuning.targetHz(pitch) });
    }
  }
  return out;
}

export function nearestCandidate(candidates, hz) {
  let best = null;
  for (const c of candidates) {
    const cents = 1200 * Math.log2(hz / c.hz);
    if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { ...c, cents };
  }
  return best;
}

/* Semitones above C for each letter, so a chroma can be turned back into a
 * spelling rather than merely a pitch class. */
const LETTER_CHROMA = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });

/**
 * Spell a chromatic index the way a key would write it, or null.
 *
 * Proximity naming picks from a fixed list and so calls E major's D sharp
 * "Eb". Once the key is known the spelling can be put right: the signature
 * says which letter carries each of the key's seven pitch classes, and the
 * chroma says which octave. A note outside the key -- a chromatic passing
 * note, a wrong note -- comes back null, and the caller keeps whatever it
 * had, because inventing a spelling would be worse than a proximity guess.
 */
export function spellInKey(chroma, keyName) {
  const signature = KEY_SIGNATURES[keyName];
  if (!signature) return null;
  for (const letter of "CDEFGAB") {
    const alter = signature[letter] ?? 0;
    if (mod(LETTER_CHROMA[letter] + alter, 12) === mod(chroma, 12)) {
      return new SpelledPitch(letter, alter, (chroma - LETTER_CHROMA[letter] - alter) / 12);
    }
  }
  return null;
}
