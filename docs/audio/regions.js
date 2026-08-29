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
 * sharp when it gets louder.
 *
 * The reference a new note is judged against is the *anchor* -- the median of
 * the region's first frames -- not a trailing median of its most recent ones.
 * A trailing reference slides along with a slur, so the difference never
 * reaches the threshold and two slurred notes are absorbed into one region
 * whose median lands between them: playing E to F# in a G major prelude
 * produced a steady stream of F naturals, F being exactly the midpoint of
 * that whole tone. An anchor cannot be dragged, so a glide diverges from it
 * and splits.
 *
 * A region also counts the frames it threw away as blips. One or two are an
 * octave error or a dropout; a steady stream of them means the pitch kept
 * leaving and returning, which is a trill. That matters because a fast trill
 * -- one whose upper note lasts fewer frames than it takes to confirm a new
 * note -- otherwise has its upper notes discarded one by one and is reported
 * as an immaculate sustained note on the lower one. The drift test cannot
 * catch it: a trill oscillates rather than travels, so its drift is zero. */

import { centsBetween } from "../core/pitch.js";

/* Frames used to fix a region's anchor: long enough to outlast an attack
 * transient, short enough that the anchor is settled almost at once. */
const ANCHOR_FRAMES = 8;

/* How far a note's pitch may travel between its first frames and its last
 * before it is a transition rather than a note. A semitone is 100 cents and
 * vibrato oscillates rather than drifts, so this catches slurs without
 * catching playing. */
export const GLIDE_CENTS = 60.0;

/* Share of a region's frames that may be blips before it is an oscillation
 * rather than a note, and the fewest blips worth judging on. A fast trill
 * spends a quarter of its frames on the upper note; a sustained note blips
 * about one frame in a hundred. */
export const TRILL_BLIP_RATIO = 0.2;
export const TRILL_MIN_BLIPS = 3;

/* Did the pitch keep leaving and returning? A trill or a shake, not a note. */
export function isOscillating(region, { ratio = TRILL_BLIP_RATIO, minBlips = TRILL_MIN_BLIPS } = {}) {
  const blips = region?.blips ?? 0;
  if (blips < minBlips) return false;
  return blips / (blips + region.framesHz.length) >= ratio;
}

/* Cents from the start of a run of frames to its end, by thirds, so a single
 * stray frame at either end cannot masquerade as drift. */
export function driftCents(framesHz) {
  if (!framesHz || framesHz.length < 6) return 0;
  const third = Math.max(2, Math.floor(framesHz.length / 3));
  const median = (xs) => { const o = [...xs].sort((a, b) => a - b); return o[o.length >> 1]; };
  return centsBetween(median(framesHz.slice(0, third)), median(framesHz.slice(-third)));
}

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
        this.current = { framesHz: [hz], framesDb: [db], startIndex: i, blips: 0 };
        return null;
      }
      const anchor = [...this.current.framesHz.slice(0, ANCHOR_FRAMES)].sort((a, b) => a - b);
      const reference = anchor[anchor.length >> 1];
      if (Math.abs(centsBetween(reference, hz)) > this.splitCents) {
        this.pending.push({ hz, db });
        if (this.pending.length >= this.confirmFrames) {
          const closed = this.close();
          this.current = {
            framesHz: this.pending.map((p) => p.hz),
            framesDb: this.pending.map((p) => p.db),
            startIndex: i - this.pending.length + 1,
            blips: 0,
          };
          this.pending = [];
          return closed;
        }
        return null;
      }
      // A blip, not a note change: the frames are dropped, but counted, so
      // a note that keeps blipping can be recognised as a trill later.
      this.current.blips += this.pending.length;
      this.pending = [];
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
      blips: region.blips ?? 0,
      meanDb,
      short: seconds < this.minSeconds,
    };
  }
}
