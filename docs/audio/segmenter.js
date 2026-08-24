/* Guided note segmentation. Port of flutetrainer/audio/segmenter.py.
 *
 *   WAITING  --(enough voiced frames near target)--------> SOUNDING
 *   SOUNDING --(sounded for requiredSeconds)-------------> DONE
 *   SOUNDING --(goes silent, not yet long enough)--------> WAITING (frames kept)
 *   SOUNDING --(wanders off target, not yet long enough)-> WAITING (frames dropped)
 *
 * Duration is the only route to DONE. A release on its own never completes
 * a note, or a hesitation just after the attack would score it from a
 * fragment (observed live at 20 bpm).
 *
 * `onsetDb` closes the drone-unison hole: where the drone's pitch and the
 * expected pitch coincide, only level can tell a played note from bleed. It
 * applies to the onset alone, so a sounding note may decay freely. */

import { centsBetween } from "../core/pitch.js";

export const State = Object.freeze({ WAITING: "waiting", SOUNDING: "sounding", DONE: "done" });

export const ACCEPTANCE_CENTS = 80.0;

export class NoteSegmenter {
  constructor({ targetHz, frameSeconds, requiredSeconds, acceptanceCents = ACCEPTANCE_CENTS,
                onsetFrames = 4, releaseFrames = 6, onsetDb = null }) {
    this.targetHz = targetHz;
    this.frameSeconds = frameSeconds;
    this.requiredSeconds = requiredSeconds;
    this.acceptanceCents = acceptanceCents;
    this.onsetFrames = onsetFrames;
    this.releaseFrames = releaseFrames;
    this.onsetDb = onsetDb;
    this.state = State.WAITING;
    this.framesHz = [];
    this.candidate = [];
    this.silentRun = 0;
    this.offTargetRun = 0;
  }

  nearTarget(hz) {
    return hz > 0 && Math.abs(centsBetween(this.targetHz, hz)) <= this.acceptanceCents;
  }

  loudEnough(levelDb) {
    if (this.onsetDb === null || levelDb === null || levelDb === undefined) return true;
    return levelDb >= this.onsetDb;
  }

  /* Feed one frame's frequency (0 for unvoiced). Returns the new state. */
  push(hz, levelDb = null) {
    if (this.state === State.DONE) return this.state;

    if (this.state === State.WAITING) {
      if (this.nearTarget(hz) && this.loudEnough(levelDb)) {
        this.candidate.push(hz);
        if (this.candidate.length >= this.onsetFrames) {
          this.state = State.SOUNDING;
          this.framesHz.push(...this.candidate);
          this.candidate.length = 0;
          this.silentRun = 0;
        }
      } else {
        this.candidate.length = 0;
      }
      return this.state;
    }

    // SOUNDING
    if (this.nearTarget(hz)) {
      this.framesHz.push(hz);
      this.silentRun = 0;
      this.offTargetRun = 0;
      if (this.elapsedSeconds >= this.requiredSeconds) this.state = State.DONE;
    } else {
      this.silentRun += 1;
      if (hz > 0) this.offTargetRun += 1;
      if (this.silentRun >= this.releaseFrames) this.release();
    }
    return this.state;
  }

  /* Gone silent keeps the frames (a breath); gone off-target drops them (a
   * different note). Completes only if the duration was already met. */
  release() {
    if (this.elapsedSeconds >= this.requiredSeconds) { this.state = State.DONE; return; }
    this.state = State.WAITING;
    if (this.offTargetRun >= this.releaseFrames) this.framesHz.length = 0;
    this.silentRun = 0;
    this.offTargetRun = 0;
    this.candidate.length = 0;
  }

  get elapsedSeconds() { return this.framesHz.length * this.frameSeconds; }
  get complete() { return this.state === State.DONE; }
}

/* The level a note must exceed to open, or null if pitch already suffices.
 * The check exists for one situation only: a sounding drone whose pitch
 * coincides with the expected note. Everywhere else the acceptance window
 * already rejects the drone, and a level floor there refuses notes played
 * more quietly than the drone even though their pitch is read correctly. */
export function onsetThresholdFor(targetHz, droneHz, onsetDb, acceptanceCents = ACCEPTANCE_CENTS) {
  if (onsetDb === null || onsetDb === undefined || !droneHz) return null;
  if (Math.abs(centsBetween(droneHz, targetHz)) > acceptanceCents) return null;
  return onsetDb;
}
