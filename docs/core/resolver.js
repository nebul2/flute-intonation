/* The resolver: turns a target note into a frequency under the active mode.
 * Port of flutetrainer/core/resolver.py. A pure function of its inputs. */

import { PureIntervalTuning } from "./tuning.js";

export const Mode = Object.freeze({ TEMPERAMENT: "temperament", PURE: "pure" });

/* One note of an exercise, carrying its harmonic context by construction. */
export class TargetNote {
  constructor(pitch, beats = 1.0, context = null) {
    if (!(beats > 0)) throw new Error("beats must be positive");
    this.pitch = pitch;
    this.beats = beats;
    this.context = context;
    Object.freeze(this);
  }
}

/* `offsetCents` is how far the bass sounds from where the tuning puts it:
 * zero everywhere except "Follow me", whose partner goes flat or sharp and
 * expects to be followed. Every target in the exercise moves with it.
 *
 * `accompaniment`, when present, is one entry per note -- {voices, offsetCents}
 * -- for an exercise whose partner is a chord that changes under each note
 * (the cadence). Its voices are spelled pitches tuned pure above the note's
 * harmonic-context bass, moved by that note's own offset. */
export class Exercise {
  constructor({ name, notes, drone = null, tempoBpm = 60.0, key = "", offsetCents = 0,
                accompaniment = null }) {
    if (!(tempoBpm > 0)) throw new Error("tempo_bpm must be positive");
    this.name = name;
    this.notes = Object.freeze([...notes]);
    this.drone = drone;
    this.tempoBpm = tempoBpm;
    this.key = key;
    this.offsetCents = offsetCents;
    this.accompaniment = accompaniment ? Object.freeze([...accompaniment]) : null;
    if (this.accompaniment && this.accompaniment.length !== this.notes.length) {
      throw new Error("accompaniment needs one entry per note");
    }
    Object.freeze(this);
  }
  get secondsPerBeat() { return 60.0 / this.tempoBpm; }
  durationSeconds(note) { return note.beats * this.secondsPerBeat; }
}

export class TargetResolver {
  /* The temperament serves double duty: target source in TEMPERAMENT mode
   * and the *anchor* for the bass in PURE mode (DESIGN.md 3.5). */
  constructor(mode, temperament, ratios = null) {
    this.mode = mode;
    this.temperament = temperament;
    this.pure = ratios ? new PureIntervalTuning(temperament, ratios)
                       : new PureIntervalTuning(temperament);
  }

  /* In PURE mode a note without context falls back to the temperament. */
  resolve(note) {
    if (this.mode === Mode.PURE && note.context) {
      return this.pure.targetHz(note.pitch, note.context);
    }
    return this.temperament.targetHz(note.pitch, null);
  }

  setMode(mode) { this.mode = mode; }

  setTemperament(temperament) {
    this.temperament = temperament;
    this.pure = new PureIntervalTuning(temperament);
  }
}
