/* Free-play segmentation: turn a stream of frames into notes without knowing
 * what will be played. The online form of analyse_recording.py's region
 * finder.
 *
 * A note ends when the sound stops for `gapFrames`, or when the pitch moves
 * more than `splitCents` away and *stays* there for `confirmFrames` -- a
 * single stray frame is a blip and is dropped, not a new note. Notes shorter
 * than `minSeconds` are reported but flagged `short`: measured on real
 * tongued onsets, ~100 ms is the floor for a trustworthy reading.
 *
 * Level travels with pitch, frame by frame, so a closed note carries its
 * loudness profile: that is what lets the statistics ask whether a note goes
 * sharp when it gets louder. */

import { centsBetween } from "../core/pitch.js";

export class RegionTracker {
  constructor({ frameSeconds, splitCents = 70.0, confirmFrames = 3, gapFrames = 6, minSeconds = 0.12 }) {
    this.frameSeconds = frameSeconds;
    this.splitCents = splitCents;
    this.confirmFrames = confirmFrames;
    this.gapFrames = gapFrames;
    this.minSeconds = minSeconds;
    this.index = 0;
    this.current = null;      // { framesHz: [], framesDb: [], startIndex }
    this.pending = [];        // off-pitch frames not yet confirmed as a new note: [{hz, db}]
    this.gap = 0;
  }

  /* Feed one frame {hz, levelDb}; returns a closed region or null. */
  push(frame) {
    const i = this.index++;
    const hz = frame.hz;
    const db = frame.levelDb ?? -120;
    if (hz > 0) {
      this.gap = 0;
      if (!this.current) {
        this.current = { framesHz: [hz], framesDb: [db], startIndex: i };
        return null;
      }
      const recent = this.current.framesHz.slice(-5).sort((a, b) => a - b);
      const reference = recent[recent.length >> 1];
      if (Math.abs(centsBetween(reference, hz)) > this.splitCents) {
        this.pending.push({ hz, db });
        if (this.pending.length >= this.confirmFrames) {
          const closed = this.close();
          this.current = {
            framesHz: this.pending.map((p) => p.hz),
            framesDb: this.pending.map((p) => p.db),
            startIndex: i - this.pending.length + 1,
          };
          this.pending = [];
          return closed;
        }
        return null;
      }
      this.pending = [];                 // a blip, not a note change
      this.current.framesHz.push(hz);
      this.current.framesDb.push(db);
      return null;
    }
    // unvoiced
    this.pending = [];
    if (!this.current) return null;
    this.gap += 1;
    return this.gap >= this.gapFrames ? this.close() : null;
  }

  /* Close whatever is open (at the end of a session). */
  flush() { return this.current ? this.close() : null; }

  close() {
    const region = this.current;
    this.current = null;
    this.gap = 0;
    if (!region) return null;
    const sorted = [...region.framesHz].sort((a, b) => a - b);
    const seconds = region.framesHz.length * this.frameSeconds;
    const meanDb = region.framesDb.reduce((a, b) => a + b, 0) / region.framesDb.length;
    return {
      framesHz: region.framesHz,
      levelsDb: region.framesDb,
      startIndex: region.startIndex,
      seconds,
      medianHz: sorted[sorted.length >> 1],
      meanDb,
      short: seconds < this.minSeconds,
    };
  }
}
