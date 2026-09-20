/* How loud the room is with the drone sounding.
 *
 * A drone played through speakers comes back into the microphone, and where
 * its pitch and the played note's coincide no pitch test can separate them --
 * only level can. So before a drone session starts, listen for a moment with
 * the drone already sounding and nothing being played: whatever level that
 * shows is the floor a real note has to clear.
 *
 * Extracted from the practice runner so free play can take the same
 * measurement. The two surfaces differ in what they do with the number -- the
 * exercises gate one expected note's onset, free play gates every frame --
 * but not in how it is taken, and a second implementation of "what is the
 * background" is exactly the sort of thing that drifts apart.
 *
 * Timed by the frames themselves rather than by the wall clock: the frames
 * are what is being measured, a stalled audio thread should stall the
 * measurement with it, and it makes the whole thing testable without a
 * browser. */

/* How far above the measured background a note must reach. Ten dB is a
 * comfortable margin over speaker bleed at a sane drone level and still well
 * under normal playing, which sits far louder than that. */
export const ONSET_MARGIN_DB = 10.0;

/* How long to listen. The drone's own attack ramp is 0.3 s, so this is long
 * enough to measure it at full level and short enough not to feel like a
 * wait. */
export const CALIBRATE_MS = 1500;

/* Roughly what playing measures at the microphone. A sanity check only: when
 * the computed threshold lands above this, the drone is so loud that the
 * player would have to out-shout it, and the view says so rather than
 * silently refusing to hear anything. */
export const PLAYING_LEVEL_DB = -20.0;

/* Where in the sorted levels to read the background. The high end rather than
 * the middle, because what matters is the loudest the bleed gets, not its
 * average -- but not the maximum, which one cough or one chair would set. */
const BACKGROUND_PERCENTILE = 0.9;

/* Used when not a single frame arrived: quiet enough to be harmless, loud
 * enough not to gate a real note out. */
const NO_MEASUREMENT_DB = -60.0;

export class BackgroundCalibration {
  constructor({ ms = CALIBRATE_MS, marginDb = ONSET_MARGIN_DB } = {}) {
    this.ms = ms;
    this.marginDb = marginDb;
    this.levels = [];
    this.startedAt = null;     // the first frame's clock, whatever it counts in
    this.elapsedMs = 0;
    this.done = false;
  }

  /* Feed one frame {levelDb, t}. Returns true once the window has passed,
   * and goes on returning true without collecting more. */
  push(frame) {
    if (this.done) return true;
    if (Number.isFinite(frame?.levelDb)) this.levels.push(frame.levelDb);
    const now = frame?.t;
    if (Number.isFinite(now)) {
      if (this.startedAt === null) this.startedAt = now;
      this.elapsedMs = now - this.startedAt;
      if (this.elapsedMs >= this.ms) this.done = true;
    }
    return this.done;
  }

  get backgroundDb() {
    if (!this.levels.length) return NO_MEASUREMENT_DB;
    const sorted = [...this.levels].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(BACKGROUND_PERCENTILE * sorted.length))];
  }

  /* The level a note must reach to count as played rather than as bleed. */
  get onsetDb() { return this.backgroundDb + this.marginDb; }

  /* The drone is loud enough that playing over it will be a struggle. */
  get tooLoud() { return this.onsetDb > PLAYING_LEVEL_DB; }

  /* For a progress bar: 0 at the first frame, 1 when the window has passed. */
  get fraction() { return Math.max(0, Math.min(1, this.elapsedMs / this.ms)); }
  get remainingSeconds() { return Math.max(0, (this.ms - this.elapsedMs) / 1000); }
}
