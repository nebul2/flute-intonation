/* What each note on this particular flute can actually do.
 *
 * The app has always assumed every note is equally correctable. It is not.
 * On a one-keyed traverso some notes sit where they sit: the lowest note will
 * not come up, a cross-fingered F sits sharp and will not come down, and no
 * amount of telling the player they are twelve cents out changes that. Advice
 * that asks for a bend the instrument cannot make is not advice, it is noise.
 *
 * Three readings per note, in the order the player proposed, which is the
 * right order: as it comes with no correction, then as flat as it will go,
 * then as sharp. The first is the datum -- it is where the flute puts the
 * note -- and the other two are measured from it. All three are stored in
 * cents against the app's target for that pitch, positive meaning sharp, so a
 * profile stays meaningful when the temperament or reference pitch changes
 * only if it is re-measured; the profile records what it was taken under.
 *
 * The bend is nearly always asymmetric, which is the whole point. A note with
 * 30 cents down and 3 up is a different instrument to play than one with 15
 * either side, even though both "bend 33 cents".
 */

/** Below this, a note is effectively fixed: it is where it is. */
export const RIGID_CENTS = 5.0;

/** How far a note moves from where it naturally sits, each way. */
export function reach(entry) {
  return {
    down: entry.natural - entry.floor,
    up: entry.ceiling - entry.natural,
    total: entry.ceiling - entry.floor,
  };
}

/** A note that will barely move at all, in the direction asked for. */
export function isRigid(entry, direction) {
  const r = reach(entry);
  if (direction === "up") return r.up < RIGID_CENTS;
  if (direction === "down") return r.down < RIGID_CENTS;
  return r.total < RIGID_CENTS;
}

/**
 * Sanity-check a correction before it is offered as advice.
 *
 * `wanted` is the correction the app would ask for, in cents: negative to play
 * flatter, positive sharper. Returns what the instrument has to say about it.
 */
export function checkCorrection(entry, wanted) {
  const r = reach(entry);
  const available = wanted < 0 ? r.down : r.up;
  const needed = Math.abs(wanted);
  if (needed <= available) return { possible: true, available, needed, shortfall: 0 };
  return {
    possible: false,
    available,
    needed,
    // How much of the asked-for correction the instrument simply cannot give.
    shortfall: needed - available,
  };
}

/**
 * The offsets of the whole flute at which this note can be played in tune.
 *
 * Moving the headjoint shifts every note by roughly the same amount, so after
 * a shift of `o` cents the note reaches anywhere in [floor + o, ceiling + o].
 * It can be played in tune when that window contains its target, which it does
 * for o between -ceiling and -floor.
 */
export function offsetWindow(entry) {
  return { low: -entry.ceiling, high: -entry.floor };
}

/**
 * Where to put the headjoint, given what the notes can and cannot do.
 *
 * Not the mean. The mean treats a note that cannot move as though it were as
 * correctable as any other, which is exactly backwards: the notes that cannot
 * move are the ones the flute must be built around, and the flexible ones can
 * be bent to meet them.
 *
 * So: find the offset lying inside the most notes' windows. Among the offsets
 * that tie -- and they usually do, since the answer is a range rather than a
 * point -- prefer the one asking for the least bending overall, because a note
 * that can be reached only by bending it to its limit is not really playable.
 *
 * The constant-shift model is a first approximation: the end correction grows
 * with frequency, so a headjoint move flattens the upper register more than
 * the lower. The stopper check is what handles that part.
 */
export function bestOffset(entries) {
  if (!entries.length) return null;
  const windows = entries.map(offsetWindow);
  // Two kinds of offset can be optimal, and testing only one of them is wrong.
  // Which notes are reachable changes only at a window edge, so those decide
  // the first question. But among offsets that reach the same notes the effort
  // is a sum of absolute values, minimised where one of them turns -- that is,
  // at minus some note's natural pitch, which is generally not a window edge.
  const candidates = [...new Set([
    ...windows.flatMap((w) => [w.low, w.high]),
    ...entries.map((e) => -e.natural),
  ])].sort((a, b) => a - b);

  let best = null;
  for (const offset of candidates) {
    let reachable = 0, effort = 0;
    for (let i = 0; i < entries.length; i++) {
      if (offset >= windows[i].low - 1e-9 && offset <= windows[i].high + 1e-9) {
        reachable += 1;
        // How far this note must be bent from where it naturally sits.
        effort += Math.abs(entries[i].natural + offset);
      }
    }
    if (!best || reachable > best.reachable
        || (reachable === best.reachable && effort < best.effort - 1e-9)) {
      best = { offset, reachable, effort };
    }
  }

  const unreachable = entries.filter((e, i) =>
    best.offset < windows[i].low - 1e-9 || best.offset > windows[i].high + 1e-9);
  return {
    offset: best.offset,
    reachable: best.reachable,
    total: entries.length,
    unreachable,
    // Mean bend asked of the notes that can be reached: the cost of this
    // placement, in effort rather than in error.
    meanBend: best.reachable ? best.effort / best.reachable : 0,
  };
}

/**
 * Was this note out of tune because of the player, or because of the flute?
 *
 * The distinction the profile exists to make. A note played outside what the
 * instrument can reach is the instrument's; inside it, the player's.
 */
export function attribute(entry, playedCents) {
  if (playedCents > entry.ceiling + 1e-9) return "beyond-sharp";
  if (playedCents < entry.floor - 1e-9) return "beyond-flat";
  return "within-reach";
}

/** Three readings in the wrong order are a mis-take, not a measurement. */
export function validEntry(entry) {
  return Number.isFinite(entry.natural) && Number.isFinite(entry.floor)
    && Number.isFinite(entry.ceiling)
    && entry.floor <= entry.natural + 1e-9 && entry.natural <= entry.ceiling + 1e-9;
}

/**
 * Sanity-check what the app is about to tell a player, against their flute.
 *
 * This is the reason the profile exists. Without it every recommendation
 * silently assumes the note can be moved; with it, a recommendation that the
 * instrument cannot carry out is caught before it is offered, and the player
 * is told the truth instead -- that this one is the flute, not them.
 *
 * @param profile map of pitch name to {natural, floor, ceiling}
 * @param notes   [{pitch, meanCents}] as measured in a session, where
 *                meanCents is how far from target the note was played
 * @returns one verdict per note that the profile can speak to. Notes it has
 *          never measured are absent: silence is the honest answer there.
 */
export function reviewSession(profile, notes) {
  const out = [];
  for (const note of notes) {
    const entry = profile[note.pitch];
    if (!entry || !validEntry(entry)) continue;
    const wanted = -note.meanCents;          // the correction the app would ask for
    const check = checkCorrection(entry, wanted);
    out.push({
      pitch: note.pitch,
      playedCents: note.meanCents,
      wanted,
      attribution: attribute(entry, note.meanCents),
      possible: check.possible,
      shortfall: check.shortfall,
      available: check.available,
    });
  }
  return out;
}

/** The notes in a session that no amount of playing could have fixed. */
export function impossible(reviews) {
  return reviews.filter((r) => !r.possible);
}
