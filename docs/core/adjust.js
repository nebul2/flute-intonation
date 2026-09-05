/* Did the player move the note when the bass moved under it?
 *
 * A written F sharp is a major third over D and must sit low for the third to
 * ring; the same F sharp is a fifth over B, and sounding it that low makes
 * the fifth beat. Nothing on the page changes. Moving it is the skill, and it
 * is the one a needle cannot teach -- a tuner would call both soundings of
 * that F sharp "the same note", which is exactly the confusion to undo.
 *
 * So this measures a *difference between two soundings*, never a distance
 * from a reference. That is not a stylistic choice: it means the verdict
 * survives a reference pitch set wrong, a flute sitting sharp, and a player
 * warming up over the course of a session -- all of which have already
 * produced wrong answers elsewhere in this app. Both notes move together, so
 * the error cancels.
 */

import { soundedHz } from "./scoring.js";
import { centsBetween } from "./pitch.js";

/** Below this, the two soundings are the same note played twice. */
export const SAME_NOTE_CENTS = 3.0;
/** Reaching this share of the required move counts as having made it. */
export const ENOUGH = 0.45;
/** Beyond this share, the note has been pushed further than the harmony asks. */
export const TOO_FAR = 1.8;

/**
 * Compare two soundings of one written note under two different basses.
 *
 * @param first  the NoteResult under the first bass
 * @param second the NoteResult under the second bass
 * @returns what the harmony asked for, what the player did, and a verdict --
 *   or null when either sounding is missing.
 */
export function compareAdjustment(first, second) {
  if (!first || !second) return null;
  // What the harmony asked: the distance between the two targets.
  const required = centsBetween(first.targetHz, second.targetHz);
  // What the player did: the distance between the two sounds they made.
  const actual = centsBetween(soundedHz(first), soundedHz(second));
  const share = Math.abs(required) < 1e-9 ? 0 : actual / required;

  let verdict;
  if (Math.abs(actual) < SAME_NOTE_CENTS) verdict = "same";
  else if (share < 0) verdict = "opposite";
  else if (share < ENOUGH) verdict = "short";
  else if (share > TOO_FAR) verdict = "far";
  else verdict = "moved";

  return {
    required, actual, share, verdict,
    // How each sounding sat against its own target, kept so a player who
    // moved correctly but sat sharp throughout can be told which is which.
    firstCents: first.meanCents,
    secondCents: second.meanCents,
    pitch: first.pitch,
  };
}
