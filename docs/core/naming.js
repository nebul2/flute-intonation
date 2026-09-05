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

import { SpelledPitch } from "./pitch.js";

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
