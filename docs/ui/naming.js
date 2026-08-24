/* Note naming for display. Port of flutetrainer/ui/naming.py.
 *
 * Presentation only: the model stays a SpelledPitch and nothing here feeds
 * back into tuning, so a naming choice can never change a target frequency.
 * Solfège is fixed do (C is always Do), the Romance convention. */

import { SpelledPitch } from "../core/pitch.js";

export const SOLFEGE = "solfege";
export const LETTERS = "letters";
export const STYLES = [SOLFEGE, LETTERS];

const SYLLABLES = { C: "Do", D: "Ré", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };
const ACCIDENTALS = { "-2": "♭♭", "-1": "♭", "0": "", "1": "♯", "2": "♯♯" };

export function noteName(pitch, style = SOLFEGE, octave = true) {
  if (style === LETTERS) {
    return octave ? pitch.name : pitch.name.replace(/-?\d+$/, "");
  }
  if (style !== SOLFEGE) throw new Error(`unknown naming style ${style}`);
  const accidental = ACCIDENTALS[String(pitch.alter)];
  if (accidental === undefined) throw new Error(`no display accidental for alter ${pitch.alter}`);
  const body = `${SYLLABLES[pitch.letter]}${accidental}`;
  return octave ? `${body}${pitch.octave}` : body;
}

export function pitchClassName(letter, alter, style = SOLFEGE) {
  return noteName(new SpelledPitch(letter, alter, 4), style, false);
}
