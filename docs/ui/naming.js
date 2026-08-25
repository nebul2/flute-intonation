/* Note naming for display. Port of flutetrainer/ui/naming.py, extended with
 * register names.
 *
 * Presentation only: the model stays a SpelledPitch and nothing here feeds
 * back into tuning, so a naming choice can never change a target frequency.
 * Solfège is fixed do (C is always Do), the Romance convention.
 *
 * Octaves can read as scientific numbers (Ré4, Ré5, Ré6) or as the flute's
 * registers (Ré grave, Ré médium, Ré aigu). Where the bands break is a
 * setting, because it depends on the instrument. The default is **D**: on the
 * one-keyed flute D4-C#5 is the first register, D5-C#6 the second, D6 upward
 * the third, so the three D's of the stopper check read exactly as low, middle
 * and high -- how a flutist names them -- whereas breaking at C would call C#5
 * a "medium" note although it is played as a low-register one. A flute with a
 * C foot wants the break at C, which also makes the register names line up
 * with the octave numbers. Below the lowest band and above the third there is
 * no register to name, so the number is kept. */

import { t } from "../i18n.js";
import { SpelledPitch } from "../core/pitch.js";

export const SOLFEGE = "solfege";
export const LETTERS = "letters";
export const STYLES = [SOLFEGE, LETTERS];

export const NUMBER = "number";
export const REGISTER = "register";
export const OCTAVE_STYLES = [REGISTER, NUMBER];

const SYLLABLES = { C: "Do", D: "Ré", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };
const ACCIDENTALS = { "-2": "♭♭", "-1": "♭", "0": "", "1": "♯", "2": "♯♯" };

const REGISTER_KEYS = ["octave.low", "octave.middle", "octave.high"];
/* Where the registers break. D is the one-keyed flute; C suits a C foot. */
export const REGISTER_BREAKS = ["D", "C"];
export const DEFAULT_REGISTER_BREAK = "D";

/* The register word for a pitch, or null when it lies outside the three
 * bands and only a number can honestly describe it. */
export function registerWord(pitch, registerBreak = DEFAULT_REGISTER_BREAK) {
  const letter = REGISTER_BREAKS.includes(registerBreak) ? registerBreak : DEFAULT_REGISTER_BREAK;
  const base = new SpelledPitch(letter, 0, 4).chromaticIndex;
  const band = Math.floor((pitch.chromaticIndex - base) / 12);
  return band >= 0 && band < REGISTER_KEYS.length ? t(REGISTER_KEYS[band]) : null;
}

/* `options` may be `{octave, octaveStyle}` or, for older call sites, the
 * boolean that `octave` used to be. */
export function noteName(pitch, style = SOLFEGE, options = {}) {
  const { octave = true, octaveStyle = NUMBER, registerBreak = DEFAULT_REGISTER_BREAK } =
    typeof options === "boolean" ? { octave: options } : options;

  let body;
  if (style === LETTERS) {
    body = pitch.name.replace(/-?\d+$/, "");
  } else if (style === SOLFEGE) {
    const accidental = ACCIDENTALS[String(pitch.alter)];
    if (accidental === undefined) throw new Error(`no display accidental for alter ${pitch.alter}`);
    body = `${SYLLABLES[pitch.letter]}${accidental}`;
  } else {
    throw new Error(`unknown naming style ${style}`);
  }

  if (!octave) return body;
  if (octaveStyle === REGISTER) {
    const word = registerWord(pitch, registerBreak);
    if (word) return `${body} ${word}`;
  }
  return `${body}${pitch.octave}`;
}

export function pitchClassName(letter, alter, style = SOLFEGE) {
  return noteName(new SpelledPitch(letter, alter, 4), style, { octave: false });
}
