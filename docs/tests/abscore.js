/* Which scoring rule is better? Measured over real recordings, not argued.
 *
 * "It reads better when it works but it feels more fragile" is not a thing
 * an opinion can settle, and listening again does not settle it either: the
 * note is gone and the two rules cannot be heard side by side. So this runs
 * every candidate rule over the same real notes and prints three numbers a
 * decision can rest on.
 *
 *   node docs/tests/abscore.js recordings/*.wav
 *
 * The rules, all fed the same post-attack voiced frames:
 *
 *   whole   median of everything to the last frame          -- before 7.x
 *   taper   drop the final 100 ms, median the rest          -- the ask
 *   settled scoredWindow(): taper, then from where it       -- shipped
 *           settled to the taper
 *
 * And the three measurements:
 *
 *   SHIFT     how far a rule moves the reading against `whole`. Says how big
 *             a change this is at all; says nothing about which is right.
 *   FRAGILITY the same note, scored again with the region's edges nudged by
 *             one or two frames (~12 ms) -- a boundary the level gate places,
 *             not the player. A rule that swings when nothing musical
 *             changed is measuring the segmenter, not the flute. This is the
 *             number that answers "more fragile".
 *   NAMING    how often a rule names a different note than `whole` does, and
 *             how often a 12 ms nudge renames it. A wrong name is the visible
 *             failure -- it is what puts a mark in the wrong row of Compare
 *             temperaments -- so every one is listed with its timestamp, to
 *             be found in the file and listened to.
 *
 * None of that says which rule is *right*: the recordings carry no record of
 * what the player meant, so agreement, stability and self-consistency are all
 * that can be measured from them. For right and wrong there are the probe
 * tones -- notes synthesised to a stated shape, so the answer is known before
 * anything measures it (flutetrainer/tools/make_probe_tones.py). Hand this
 * tool any of those and it checks every rule against the truth instead:
 *
 *   python -m flutetrainer.tools.make_probe_tones
 *   node docs/tests/abscore.js recordings/probes/*.wav
 *
 * The two halves answer different questions and both are needed. Recordings
 * find where the rules disagree on real playing; probes say who was correct.
 */

import { analyse } from "./wavpipe.js";
import {
  TAPER_SKIP_SECONDS, TAPER_BODY_SECONDS, SETTLE_CENTS, scoredWindow,
} from "../core/scoring.js";
import { tunerCandidates, nearestCandidate } from "../core/naming.js";
import { SpelledPitch } from "../core/pitch.js";
import { parseScala, TemperamentTuning, ReferencePitch } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";

const median = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length % 2 ? o[o.length >> 1] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
};
const quantile = (xs, q) => {
  if (!xs.length) return NaN;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.round(q * (o.length - 1))))];
};

/* ---- the rules under test ------------------------------------------- */

const taperBody = (framesHz, frameSeconds) => {
  const seconds = framesHz.length * frameSeconds;
  const drop = Math.max(1, Math.round(TAPER_SKIP_SECONDS / frameSeconds));
  return seconds - TAPER_SKIP_SECONDS >= TAPER_BODY_SECONDS
    ? framesHz.slice(0, -drop) : framesHz;
};

const cents = (a, b) => 1200 * Math.log2(a / b);

/* Walk back from the note's end while it still sounds like the note's end,
 * tolerating `run` consecutive frames outside the band before giving up.
 * The shipped rule stops at the *first* such frame, which one glitched frame
 * or one half-cycle of vibrato is enough to do. */
export function settleBack(body, frameSeconds, { run = 1, probeSeconds = 0.150, minSeconds = 0.150 } = {}) {
  const inFrames = (s) => Math.max(1, Math.round(s / frameSeconds));
  const probe = inFrames(probeSeconds);
  if (body.length <= probe) return { frames: body, settled: false };
  const anchor = median(body.slice(-probe));
  let i = body.length - probe, best = i, out = 0;
  while (i > 0) {
    i -= 1;
    if (Math.abs(cents(body[i], anchor)) < SETTLE_CENTS) { out = 0; best = i; }
    else { out += 1; if (out >= run) break; }
  }
  const window = body.slice(best);
  if (window.length * frameSeconds < minSeconds) return { frames: body, settled: false };
  return { frames: window, settled: best > 0, settleSeconds: best * frameSeconds };
}

export const RULES = {
  /* Before 7.x: everything after the attack, taper included. */
  whole: (framesHz) => median(framesHz),
  /* What was actually asked for: drop the last 100 ms, keep the rest. */
  taper: (framesHz, frameSeconds) => median(taperBody(framesHz, frameSeconds)),
  /* Shipped in 7.x: taper, then back to the first frame out of band. */
  settled: (framesHz, frameSeconds) => {
    const w = scoredWindow(framesHz, frameSeconds);
    return median(w.frames.length ? w.frames : framesHz);
  },
  /* The same idea, made deaf to a single stray frame, and refusing to call
   * anything shorter than 300 ms a settled end. */
  settled3: (framesHz, frameSeconds) => {
    const body = taperBody(framesHz, frameSeconds);
    return median(settleBack(body, frameSeconds, { run: 3, minSeconds: 0.300 }).frames);
  },
  /* No scan at all: the last half second before the taper. */
  tail: (framesHz, frameSeconds) => {
    const body = taperBody(framesHz, frameSeconds);
    const want = Math.max(1, Math.round(0.500 / frameSeconds));
    return median(body.length > want ? body.slice(-want) : body);
  },
};
export const RULE_NAMES = Object.keys(RULES);

/* What the note ended on: the 300 ms before the taper, no scan, no cleverness.
 * Not a rule -- a yardstick. A rule meant to report a correction made late
 * should sit near this; one that averages the whole note will not. */
export function endedOn(framesHz, frameSeconds) {
  const body = taperBody(framesHz, frameSeconds);
  const want = Math.max(1, Math.round(0.300 / frameSeconds));
  return median(body.length > want ? body.slice(-want) : body);
}

/* The edges of a region are placed by a level gate, so nudging them by a
 * frame or two is a change the player did not make. Any reading that depends
 * on which of these variants it got is a reading of the segmenter. */
export function variants(framesHz) {
  return [
    framesHz,
    framesHz.slice(1),
    framesHz.slice(2),
    framesHz.slice(0, -1),
    framesHz.slice(0, -2),
  ].filter((v) => v.length >= 3);
}

const centsBetween = (a, b) => 1200 * Math.log2(a / b);

/* ---- probe tones: the reading that is known to be right --------------- */

/* Keyed by file name, in cents against the note's own target. Kept beside the
 * generator's shapes deliberately: if the two ever disagree the test fails,
 * which is the point -- a probe whose expected answer is copied from what the
 * code currently prints tests nothing at all. */
export const TRUTH = Object.freeze({
  steady: 0,          // dead on throughout
  sharp20: 20,        // held 20 cents sharp
  corrected: 0,       // 30 flat, corrected to 0 at 1.1s and held
  "late-sharp": 25,   // 0, pushed to +25 late and held
  droop: 0,           // dead on, then falls 60 cents as it dies
  vibrato: 0,         // centred on 0, +/-25 cents of vibrato
  ladder: 0,          // twelve pitch classes, every one exactly in tune
});

/* How near each rule comes to the answer the file was built to have. */
export function verify(files, { hop = 512, referenceHz = 415 } = {}) {
  const candidates = probeCandidates(referenceHz);
  const out = [];
  for (const file of files) {
    const name = file.split("/").pop().replace(/\.wav$/, "");
    const expected = TRUTH[name];
    if (expected === undefined) continue;
    const report = analyse(file, { hop, referenceHz });
    const frameSeconds = hop / report.sampleRate;
    for (const note of report.notes) {
      const voiced = note.framesHz.filter((hz) => hz > 0);
      if (voiced.length < 4) continue;
      const readings = {};
      for (const rule of RULE_NAMES) {
        const hz = RULES[rule](voiced, frameSeconds);
        // The note names itself: every probe is within a quarter-tone of a
        // real pitch, so the nearest candidate *is* the note it was built as,
        // and the target that names it is the target to measure against.
        const near = nearestCandidate(candidates, hz);
        readings[rule] = { error: near.cents - expected, pitch: near.pitch.toString() };
      }
      out.push({ file: name, at: note.atSeconds, expected, readings });
    }
  }
  return out;
}

function probeCandidates(referenceHz) {
  const tuning = new TemperamentTuning(
    parseScala(TEMPERAMENTS.vallotti.scl),
    SpelledPitch.parse("C4"),
    new ReferencePitch(SpelledPitch.parse("A4"), referenceHz),
  );
  return tunerCandidates(tuning);
}

export function compare(files, { hop = 512, referenceHz = 415 } = {}) {
  const tuning = new TemperamentTuning(
    parseScala(TEMPERAMENTS.vallotti.scl),
    SpelledPitch.parse("C4"),
    new ReferencePitch(SpelledPitch.parse("A4"), referenceHz),
  );
  const candidates = tunerCandidates(tuning);
  const nameOf = (hz) => (hz > 0 ? nearestCandidate(candidates, hz).pitch.toString() : "?");

  const per = {};
  for (const rule of RULE_NAMES) {
    per[rule] = { shift: [], spread: [], endGap: [], renamed: 0, disagreed: [] };
  }
  let notes = 0;

  for (const file of files) {
    const report = analyse(file, { hop, referenceHz });
    const frameSeconds = hop / report.sampleRate;
    for (const note of report.notes) {
      const voiced = note.framesHz.filter((hz) => hz > 0);
      if (voiced.length < 4) continue;
      notes += 1;
      const baseline = {};
      for (const rule of RULE_NAMES) baseline[rule] = RULES[rule](voiced, frameSeconds);
      const ended = endedOn(voiced, frameSeconds);
      for (const rule of RULE_NAMES) {
        const stat = per[rule];
        stat.shift.push(centsBetween(baseline[rule], baseline.whole));
        stat.endGap.push(Math.abs(centsBetween(baseline[rule], ended)));
        const readings = variants(voiced).map((v) => RULES[rule](v, frameSeconds));
        const names = new Set(readings.map(nameOf));
        stat.spread.push(centsBetween(Math.max(...readings), Math.min(...readings)));
        if (names.size > 1) stat.renamed += 1;
        const name = nameOf(baseline[rule]);
        if (rule !== "whole" && name !== nameOf(baseline.whole)) {
          stat.disagreed.push({
            file: report.file, at: note.atSeconds, seconds: note.seconds,
            whole: nameOf(baseline.whole), got: name,
            cents: centsBetween(baseline[rule], baseline.whole),
          });
        }
      }
    }
  }
  return { notes, per };
}

/* CLI */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("usage: node docs/tests/abscore.js <file.wav> [...]");
    process.exit(2);
  }
  const probes = files.filter((f) => TRUTH[f.split("/").pop().replace(/\.wav$/, "")] !== undefined);
  const takes = files.filter((f) => !probes.includes(f));

  if (probes.length) {
    const checked = verify(probes);
    console.log(`\nAgainst the known answer -- ${checked.length} probe notes, error in cents\n`);
    console.log("  probe                        want   " + RULE_NAMES.map((r) => r.padStart(9)).join(""));
    for (const row of checked) {
      console.log(`  ${(row.file + " " + row.at.toFixed(2) + "s").padEnd(26)} `
        + `${(row.expected >= 0 ? "+" : "") + row.expected}c`.padStart(6) + "   "
        + RULE_NAMES.map((r) => {
            const e = row.readings[r].error;
            return `${e >= 0 ? "+" : ""}${e.toFixed(1)}`.padStart(9);
          }).join(""));
    }
    console.log("\n  worst error per rule:  " + RULE_NAMES.map((r) =>
      `${r} ${Math.max(...checked.map((c) => Math.abs(c.readings[r].error))).toFixed(1)}c`).join("   "));
    const misnamed = checked.filter((c) => new Set(RULE_NAMES.map((r) => c.readings[r].pitch)).size > 1);
    console.log(`  notes the rules name differently:  ${misnamed.length}`);
  }

  if (!takes.length) process.exit(0);

  const { notes, per } = compare(takes);
  console.log(`\n${notes} scored notes over ${takes.length} recording(s) -- no ground truth, so:\n`);
  console.log("rule        shift vs whole    distance from      fragility (12 ms      naming");
  console.log("                              what you ended on  nudge to the edges)");
  console.log("            median   90th       median   90th     median   90th  worst   renamed differs");
  for (const rule of RULE_NAMES) {
    const s = per[rule];
    const abs = s.shift.map(Math.abs);
    const sp = s.spread;
    console.log(
      `  ${rule.padEnd(10)}`
      + `${median(abs).toFixed(1).padStart(5)}c ${quantile(abs, 0.9).toFixed(1).padStart(6)}c   `
      + `${median(s.endGap).toFixed(1).padStart(6)}c ${quantile(s.endGap, 0.9).toFixed(1).padStart(6)}c   `
      + `${median(sp).toFixed(1).padStart(6)}c ${quantile(sp, 0.9).toFixed(1).padStart(5)}c `
      + `${Math.max(...sp).toFixed(0).padStart(4)}c   `
      + `${String(s.renamed).padStart(6)}  ${String(s.disagreed.length).padStart(6)}`);
  }
  for (const rule of RULE_NAMES) {
    const bad = per[rule].disagreed;
    if (!bad.length) continue;
    console.log(`\n  ${rule}: named a different note than whole-note median, ${bad.length} of ${notes}`);
    for (const d of bad) {
      console.log(`    ${d.file} ${d.at.toFixed(2)}s (${d.seconds.toFixed(2)}s)  `
        + `${d.whole} -> ${d.got}  ${d.cents >= 0 ? "+" : ""}${d.cents.toFixed(0)}c`);
    }
  }
}
