/* Statistics over the notes heard in free play. Pure functions; the view
 * decides how to show them.
 *
 * The question behind the volume figures is a real flute question: does this
 * note go sharp when played louder? Two fits answer it at two scales -- across
 * occurrences of the note (louder attempts vs quieter ones) and inside a
 * single held note (frame by frame). Both need a spread of levels to mean
 * anything, hence the minimums below. */

import { centsBetween, highestFirst } from "./pitch.js";

// A volume-pitch link is reported only across at least this many occurrences
// spanning at least this many dB; fewer or narrower and the fit is noise.
export const VOLUME_MIN_NOTES = 4;
export const VOLUME_MIN_DB_RANGE = 6.0;
// Below this slope, or this correlation, the honest verdict is "no clear link".
export const VOLUME_SLOPE_MIN = 0.5;     // cents per dB
export const VOLUME_R_MIN = 0.5;

export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const pstdev = (xs) => {
  if (xs.length < 2) return 0.0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/* Least-squares line y = slope*x + intercept, with Pearson r. Null when there
 * are fewer than three points or x does not vary. */
export function linearFit(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  if (sxx <= 1e-12) return null;
  const slope = sxy / sxx;
  const r = syy <= 1e-12 ? 0.0 : sxy / Math.sqrt(sxx * syy);
  return { slope, intercept: my - slope * mx, r, n };
}

/* Inside one note: cents (against `targetHz`) against level, frame by frame. */
export function withinNoteVolumeLink(framesHz, levelsDb, targetHz) {
  if (!framesHz?.length || !levelsDb?.length || !(targetHz > 0)) return null;
  const cents = framesHz.map((hz) => centsBetween(targetHz, hz));
  return linearFit(levelsDb, cents);
}

export function volumeVerdict(fit) {
  if (!fit) return null;
  if (Math.abs(fit.slope) < VOLUME_SLOPE_MIN || Math.abs(fit.r) < VOLUME_R_MIN) return "none";
  return fit.slope > 0 ? "sharper" : "flatter";
}

/* Per spelled pitch, over the notes heard. Each note: {pitch, primaryCents,
 * stdev, seconds, meanDb, index, withinFit?, framesHz?}. Rows come back
 * sorted by pitch. */
export function aggregate(notes) {
  const groups = new Map();
  for (const note of notes) {
    const key = note.pitch.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(note);
  }

  const rows = [];
  for (const [key, group] of groups) {
    const ordered = [...group].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const cents = ordered.map((n) => n.primaryCents);
    const levels = ordered.map((n) => n.meanDb).filter((x) => Number.isFinite(x));
    const dbRange = levels.length ? Math.max(...levels) - Math.min(...levels) : 0;

    let volume = null;
    if (ordered.length >= VOLUME_MIN_NOTES && dbRange >= VOLUME_MIN_DB_RANGE && levels.length === ordered.length) {
      volume = linearFit(levels, cents);
    }

    let withinVolume = null;
    const fitted = ordered.filter((n) => n.withinFit);
    if (fitted.length) {
      const weight = (n) => n.withinFit.n;
      const total = fitted.reduce((a, n) => a + weight(n), 0);
      withinVolume = {
        slope: fitted.reduce((a, n) => a + n.withinFit.slope * weight(n), 0) / total,
        r: fitted.reduce((a, n) => a + n.withinFit.r * weight(n), 0) / total,
        n: total,
      };
    }

    let trend = null;
    if (ordered.length >= 4) {
      const half = ordered.length >> 1;
      trend = mean(cents.slice(ordered.length - half)) - mean(cents.slice(0, half));
    }

    rows.push({
      pitch: ordered[0].pitch, key,
      n: ordered.length,
      meanCents: mean(cents),
      minCents: Math.min(...cents),
      maxCents: Math.max(...cents),
      spreadCents: pstdev(cents),
      stability: mean(ordered.map((n) => n.stdev)),
      totalSeconds: ordered.reduce((a, n) => a + n.seconds, 0),
      meanDb: levels.length ? mean(levels) : null,
      dbRange,
      volume, withinVolume, trend,
    });
  }
  return rows.sort((a, b) => highestFirst(a.pitch, b.pitch));
}

/* One session's tuning, over notes shaped {pitch?, n, mean, spread,
 * stability} -- which is what perNote() returns and what aggregate() rows map
 * to trivially, so a live session and a saved one score identically.
 *
 * Notes are weighted equally, not by how often each was played: a piece that
 * dwells on D must not let a badly-placed F# hide behind it, and the same
 * unweighted convention is what the two-instrument comparison uses, so the
 * figure shown at the end of a session is the figure that gets compared
 * later.
 *
 * The accuracy figure answers 'was I in tune' against the actual targets.
 * The offset is how much of that is one uniform pitch difference -- a
 * headjoint matter, not an intonation one -- and the relative figure is what
 * would remain once it was corrected. Reporting all three is the difference
 * between 'you are 6 cents out' and 'you are 5 cents sharp overall and 3
 * cents out within that'. */
export function sessionScore(notes) {
  if (!notes?.length) return null;
  const means = notes.map((n) => n.mean);
  const offset = mean(means);

  // Repeatability needs a note played more than once; averaging in the zero
  // spread of a single occurrence would flatter the player.
  const repeated = notes.filter((n) => n.n >= 2);

  let worst = notes[0];
  for (const note of notes) if (Math.abs(note.mean) > Math.abs(worst.mean)) worst = note;

  return {
    notes: notes.length,
    occurrences: notes.reduce((total, n) => total + n.n, 0),
    accuracy: mean(means.map(Math.abs)),
    offset,
    relative: mean(means.map((m) => Math.abs(m - offset))),
    repeatability: repeated.length ? mean(repeated.map((n) => n.spread)) : null,
    repeatedNotes: repeated.length,
    steadiness: mean(notes.map((n) => n.stability ?? 0)),
    worst,
  };
}

/* Beyond this many cents a note is not merely imprecise, it is out of tune:
 * the same boundary the app calls 'off' everywhere else, so a note named here
 * is a note the by-note table has already coloured. An absolute musical
 * standard rather than a share of the session, so a good session names
 * nothing instead of inventing its three least-good notes. */
export const STANDOUT_CENTS = 15.0;
/* Spread across a note's own occurrences beyond which it is not reliably
 * anywhere -- worth saying, because it wants different practice from a note
 * that is reliably in the wrong place. */
export const UNRELIABLE_SPREAD_CENTS = 10.0;
export const MAX_STANDOUTS = 5;

/* The notes actually out of tune, furthest first, both directions. Deviations
 * are the raw ones -- distance from the target, which is what the by-note
 * table shows and what the player hears -- so the two never disagree. */
export function standouts(notes, { threshold = STANDOUT_CENTS, limit = MAX_STANDOUTS } = {}) {
  if (!notes?.length) return { list: [], more: 0 };
  const flagged = notes
    .filter((note) => Math.abs(note.mean) >= threshold)
    .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
  return {
    list: flagged.slice(0, limit).map((note) => ({
      pitch: note.pitch,
      n: note.n,
      mean: note.mean,
      spread: note.spread,
      direction: note.mean > 0 ? 'sharp' : 'flat',
      once: note.n < 2,
      unreliable: note.n >= 2 && note.spread >= UNRELIABLE_SPREAD_CENTS,
    })),
    more: Math.max(0, flagged.length - limit),
  };
}

/* Which way to move the headjoint for a uniform pitch error. Pushing it in
 * shortens the air column and raises the pitch, so a sharp session needs
 * pulling OUT -- the opposite of the instinct to 'push it home', and a
 * direction worth a test of its own, since advice that is confidently
 * backwards is worse than no advice. Null when the offset is too small to
 * be worth touching. */
export function offsetAction(offsetCents, deadband = 1.0) {
  if (!Number.isFinite(offsetCents) || Math.abs(offsetCents) < deadband) return null;
  return offsetCents > 0 ? 'pullOut' : 'pushIn';
}

/* Aggregate rows in the shape sessionScore wants. */
export function scorableRows(rows) {
  return rows.map((row) => ({
    pitch: row.pitch, n: row.n, mean: row.meanCents,
    spread: row.spreadCents, stability: row.stability,
  }));
}

/* Plain numbers for the saved record. */
export function rowsToRecord(rows) {
  const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
  return rows.map((row) => ({
    pitch: row.key, n: row.n,
    mean_cents: r2(row.meanCents), min_cents: r2(row.minCents), max_cents: r2(row.maxCents),
    spread_cents: r2(row.spreadCents), stability_cents: r2(row.stability),
    total_s: r2(row.totalSeconds), mean_db: r2(row.meanDb), db_range: r2(row.dbRange),
    volume_slope: row.volume ? r2(row.volume.slope) : null,
    volume_r: row.volume ? r2(row.volume.r) : null,
    within_volume_slope: row.withinVolume ? r2(row.withinVolume.slope) : null,
    trend_cents: r2(row.trend),
  }));
}
