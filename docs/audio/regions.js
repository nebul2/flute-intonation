/* Free-play segmentation: turn a stream of frames into notes without knowing
 * what will be played. The online form of analyse_recording.py's region
 * finder.
 *
 * A note ends when the sound stops for `gapFrames`, or when the pitch moves
 * more than `splitCents` away and *stays* there for `confirmFrames` -- a
 * single stray frame is a blip and is dropped, not a new note. Notes shorter
 * than `minSeconds` are reported but flagged `short`: measured on real
 * tongued onsets, ~100 ms is the floor for a trustworthy reading. */

import { centsBetween } from "../core/pitch.js";

export class RegionTracker {
  constructor({ frameSeconds, splitCents = 70.0, confirmFrames = 3, gapFrames = 6, minSeconds = 0.12 }) {
    this.frameSeconds = frameSeconds;
    this.splitCents = splitCents;
    this.confirmFrames = confirmFrames;
    this.gapFrames = gapFrames;
    this.minSeconds = minSeconds;
    this.index = 0;
    this.current = null;      // { framesHz: [], startIndex }
    this.pending = [];        // off-pitch frames not yet confirmed as a new note
    this.gap = 0;
  }

  /* Feed one frame; returns a closed region or null. */
  push(frame) {
    const i = this.index++;
    const hz = frame.hz;
    if (hz > 0) {
      this.gap = 0;
      if (!this.current) {
        this.current = { framesHz: [hz], startIndex: i };
        return null;
      }
      const recent = this.current.framesHz.slice(-5).sort((a, b) => a - b);
      const reference = recent[recent.length >> 1];
      if (Math.abs(centsBetween(reference, hz)) > this.splitCents) {
        this.pending.push(hz);
        if (this.pending.length >= this.confirmFrames) {
          const closed = this.close();
          this.current = { framesHz: this.pending, startIndex: i - this.pending.length + 1 };
          this.pending = [];
          return closed;
        }
        return null;
      }
      this.pending = [];                 // a blip, not a note change
      this.current.framesHz.push(hz);
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
    return {
      framesHz: region.framesHz,
      startIndex: region.startIndex,
      seconds,
      medianHz: sorted[sorted.length >> 1],
      short: seconds < this.minSeconds,
    };
  }
}
