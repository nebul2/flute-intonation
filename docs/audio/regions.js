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

/* A trill is not one region behaving oddly -- it is a *run* of regions
 * alternating between two pitches. Real recordings settled this: in five
 * accelerating trills the blip mechanism never fired once, because every
 * alternation lasted long enough to be confirmed as its own region. The
 * measured alternations ran 0.49 s down to 0.05 s as each trill sped up, so
 * the slow half was being reported as a series of ordinary notes and the
 * fast half as a shower of too-short ones.
 *
 * The signature that does hold is the alternation itself: contiguous short
 * regions stepping between two pitches and returning. Checked against a
 * recorded prelude, this catches the ornaments and leaves the scales and
 * plain notes alone. */
export const TRILL_MIN_RUN = 4;              // alternations before it is an ornament
export const TRILL_MAX_GAP_SECONDS = 0.08;   // silence between them ends the run
export const TRILL_MAX_NOTE_SECONDS = 0.6;   // slower than this is melody
export const TRILL_STEP_MIN_CENTS = 40;      // less is one note wobbling
export const TRILL_STEP_MAX_CENTS = 350;     // more is a leap, not an ornament
export const TRILL_RETURN_CENTS = 60;        // how nearly it must come back
/* A trill's closing note is longer than its alternations and is a real note:
 * trailing regions this much longer than the run's median are left out. */
export const TRILL_TAIL_RATIO = 2.5;
/* How far the substituted note may sit from the written one when a trill
 * changes fingering mid-way, should the change be abrupt enough to break the
 * alternation. Measured on three trills on B and three on E, the substitution
 * is gentler than the written notes suggest: the upper pole drifts up by 16
 * to 60 cents over the course of the trill rather than jumping a semitone,
 * and settles about 155 cents above the main note -- between the written
 * auxiliary and its neighbour, not squarely on either. Largest single step
 * observed, 47 cents, sits inside TRILL_RETURN_CENTS, so on that evidence the
 * alternation usually survives intact and this join is insurance against a
 * player who switches in one move. */
export const TRILL_SUBSTITUTION_CENTS = 150;

/* Index ranges [start, end) of regions that alternate. Regions need only
* {atSeconds, seconds, medianHz}. */
export function alternationRuns(regions, {
  minRun = TRILL_MIN_RUN, maxGap = TRILL_MAX_GAP_SECONDS,
  maxNote = TRILL_MAX_NOTE_SECONDS, stepMin = TRILL_STEP_MIN_CENTS,
  stepMax = TRILL_STEP_MAX_CENTS, returnCents = TRILL_RETURN_CENTS,
  tailRatio = TRILL_TAIL_RATIO, substitutionCents = TRILL_SUBSTITUTION_CENTS,
} = {}) {
  const median = (xs) => { const o = [...xs].sort((a, b) => a - b); return o[o.length >> 1]; };

  /* The one or two pitches a chain alternates between. */
  const poles = (members) => {
    const pitches = members.map((i) => regions[i].medianHz);
    const near = pitches.filter((hz) => Math.abs(centsBetween(pitches[0], hz)) <= returnCents);
    const far = pitches.filter((hz) => Math.abs(centsBetween(pitches[0], hz)) > returnCents);
    return far.length ? [median(near), median(far)] : [median(near)];
  };

  /* ---- 1. chains of strict alternation ------------------------------- */
  const chains = [];
  let chain = [];
  const closeChain = () => { if (chain.length >= 2) chains.push(chain); chain = []; };

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (!(region.seconds <= maxNote) || !(region.medianHz > 0)) { closeChain(); continue; }
    if (!chain.length) { chain = [i]; continue; }

    const previous = regions[chain[chain.length - 1]];
    const gap = region.atSeconds - (previous.atSeconds + previous.seconds);
    const step = Math.abs(centsBetween(previous.medianHz, region.medianHz));
    const twoBack = chain.length >= 2 ? regions[chain[chain.length - 2]] : null;
    const returns = !twoBack
      || Math.abs(centsBetween(twoBack.medianHz, region.medianHz)) <= returnCents;

    if (gap <= maxGap && step >= stepMin && step <= stepMax && returns) chain.push(i);
    else { closeChain(); chain = [i]; }
  }
  closeChain();

  /* ---- 2. join chains across a change of fingering -------------------
   * A baroque trill often changes its upper note partway through, because
   * the written auxiliary is awkward and its neighbour is not: a trill on B
   * begins C-B-C-B and continues C#-B-C#-B, and one on E becomes E-F#. The
   * upper pole steps by a semitone, which breaks strict alternation, so the
   * opening alternations were being left behind and measured as notes -- a
   * phantom C reported as if it had been meant.
   *
   * The join is deliberately narrow: both sides must be two-pole
   * alternations, one pole must be held in common, and the two odd poles must
   * be a substitution apart. Merely sharing a pitch is not enough -- tried on
   * a recorded prelude that swallowed a fifth of its notes, joining trills to
   * whatever happened to touch them. */
  const substitutes = (previous, current) => {
    const a = poles(previous), b = poles(current);
    if (a.length !== 2 || b.length !== 2) return false;
    for (const [keptA, movedA] of [[a[0], a[1]], [a[1], a[0]]]) {
      for (const [keptB, movedB] of [[b[0], b[1]], [b[1], b[0]]]) {
        if (Math.abs(centsBetween(keptA, keptB)) <= returnCents
            && Math.abs(centsBetween(movedA, movedB)) <= substitutionCents) return true;
      }
    }
    return false;
  };

  const joined = [];
  for (const current of chains) {
    const previous = joined[joined.length - 1];
    if (previous) {
      const before = regions[previous[previous.length - 1]];
      const after = regions[current[0]];
      const contiguous = after.atSeconds - (before.atSeconds + before.seconds) <= maxGap;
      if (contiguous && substitutes(previous, current)) {
        joined[joined.length - 1] = previous.concat(current);
        continue;
      }
    }
    joined.push(current);
  }

  /* ---- 3. drop a held closing note, then keep the long enough --------- */
  const runs = [];
  for (let members of joined) {
    while (members.length > minRun) {
      const durations = members.map((i) => regions[i].seconds);
      const last = regions[members[members.length - 1]].seconds;
      if (last <= median(durations) * tailRatio) break;
      members = members.slice(0, -1);
    }
    if (members.length >= minRun) runs.push({ start: members[0], end: members[members.length - 1] + 1 });
  }
  return runs;
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
      atSeconds: region.startIndex * this.frameSeconds,
      medianHz: sorted[sorted.length >> 1],
      blips: region.blips ?? 0,
      meanDb,
      short: seconds < this.minSeconds,
    };
  }
}
