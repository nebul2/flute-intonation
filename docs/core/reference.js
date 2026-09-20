/* Setting the reference pitch from playing.
 *
 * A baroque flute is not at A=415 every day: the headjoint sits where the
 * player left it, the room is cold, the instrument is new to them. When the
 * reference is wrong every session opens by announcing an offset that is the
 * tuning of the flute rather than the playing, and the number that matters --
 * how far the notes sit from each other -- is buried under it.
 *
 * The rule this follows, and the reason it is a module rather than three
 * lines in the settings page: the reference is never taken from a single
 * note. One note carries its own error, and on this instrument some notes
 * carry a lot of it -- an F that sits sharp and will not come down would
 * drag the whole reference with it. So it is the offset over a spread of
 * *different* notes, which is exactly what sessionScore() already computes
 * for the end-of-session report, and the same figure is shown here before
 * anything is written.
 */

/* Enough to be a measurement rather than an anecdote: distinct spelled
 * pitches, and soundings across them. Three notes is the fewest that can
 * outvote one bad one; five soundings means at least one was played twice. */
export const MIN_NOTES = 3;
export const MIN_OCCURRENCES = 5;

/* Past this, the notes disagree too much among themselves for their centre to
 * mean anything -- the reading is of playing that is not settled, not of an
 * instrument sitting at a pitch. Roughly the point at which the app stops
 * calling a note 'close' and starts calling it out of tune. */
export const MAX_SPREAD_CENTS = 15.0;

/* The app's own limits on a reference pitch: below or above these it is a
 * typo, not an instrument. Matches the custom-pitch field in Settings. */
export const MIN_REFERENCE_HZ = 380.0;
export const MAX_REFERENCE_HZ = 470.0;

/* Where the instrument is sitting, over the notes played.
 *
 * The *median* of the per-note offsets, not their mean, and this is the whole
 * point of the module. A mean is moved by every note in proportion to how
 * wrong it is, so one note the instrument will not place -- an F that sits
 * sharp and will not come down, a low C that will not come up -- drags the
 * reference with it in proportion to its own defect. A median does not move
 * at all until half the notes agree with it. Four notes at +2, +3, +4 and
 * +40 cents put the mean at +12 and the median at +4, and +4 is the answer.
 *
 * Takes scorableRows()-shaped notes: one entry per distinct pitch, already
 * averaged over its occurrences, so a note played ten times gets one vote.
 * That is deliberate too -- a piece that dwells on D must not let D decide
 * the pitch of the instrument. */
export function instrumentOffset(notes) {
  if (!notes?.length) return null;
  const sorted = notes.map((n) => n.mean).sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/* The reference that would put the playing at zero.
 *
 * If the notes sat `offsetCents` sharp of targets built on `referenceHz`,
 * then the instrument's A is that much above the reference, and moving the
 * reference there leaves the same notes reading zero on average. Returns
 * null when the answer is outside what the app will accept, so a wild
 * measurement declines rather than writing nonsense. */
export function referenceFromOffset(referenceHz, offsetCents) {
  if (!(referenceHz > 0) || !Number.isFinite(offsetCents)) return null;
  const hz = Math.round(referenceHz * Math.pow(2.0, offsetCents / 1200.0) * 10) / 10;
  if (hz < MIN_REFERENCE_HZ || hz > MAX_REFERENCE_HZ) return null;
  return hz;
}

/* Is this measurement worth acting on? Takes a sessionScore() result.
 *
 * `relative` is the part of the error that is *not* the uniform shift: how
 * far the notes sit from their own centre. A large one means the offset is an
 * average over notes that do not agree, and an average over disagreement is
 * not a pitch. */
export function referenceVerdict(score, { minNotes = MIN_NOTES, minOccurrences = MIN_OCCURRENCES,
                                          maxSpread = MAX_SPREAD_CENTS } = {}) {
  if (!score) return { ready: false, reason: "none" };
  if (score.notes < minNotes || score.occurrences < minOccurrences) {
    return { ready: false, reason: "more", need: Math.max(0, minNotes - score.notes) };
  }
  if (score.relative > maxSpread) return { ready: false, reason: "scattered" };
  return { ready: true, reason: "ok" };
}
