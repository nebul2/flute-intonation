/* Free-play segmentation and the drone notch selection. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { RegionTracker, driftCents, isOscillating, alternationRuns, GLIDE_CENTS } from "../audio/regions.js";
import { dronePartialsToNotch } from "../audio/engine.js";
import { NoteSegmenter } from "../audio/segmenter.js";
import * as attackModule from "../core/scoring.js";

const FS = 512 / 44100;
const voiced = (hz) => ({ hz, levelDb: -20 });
const silent = () => ({ hz: 0, levelDb: -70 });

function feed(tracker, frames) {
  const closed = [];
  for (const f of frames) { const r = tracker.push(f); if (r) closed.push(r); }
  return closed;
}

test("a steady note closes on silence with its median and length", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  const frames = [...Array(40).fill(voiced(415.0)), ...Array(6).fill(silent())];
  const closed = feed(tr, frames);
  assert.equal(closed.length, 1);
  assert.ok(Math.abs(closed[0].medianHz - 415.0) < 1e-9);
  assert.ok(Math.abs(closed[0].seconds - 40 * FS) < 1e-9);
  assert.equal(closed[0].short, false);
  assert.ok(Math.abs(closed[0].meanDb - (-20)) < 1e-9, "level travels with pitch");
  assert.equal(closed[0].levelsDb.length, 40);
});

test("the confirming frames of a new note bring their levels with them", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  const frames = [...Array(30).fill(voiced(415.0)), ...Array(30).fill({ hz: 466.16, levelDb: -12 })];
  feed(tr, frames);
  const last = tr.flush();
  assert.equal(last.levelsDb.length, 30);
  assert.ok(Math.abs(last.meanDb - (-12)) < 1e-9);
});

test("two notes played legato split on the pitch change", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  const frames = [...Array(30).fill(voiced(415.0)), ...Array(30).fill(voiced(466.16))];
  const closed = feed(tr, frames);
  assert.equal(closed.length, 1);                       // first note closed by the change
  assert.ok(Math.abs(closed[0].medianHz - 415.0) < 1e-9);
  const last = tr.flush();
  assert.ok(Math.abs(last.medianHz - 466.16) < 1e-9);
  assert.equal(last.framesHz.length, 30, "the confirming frames belong to the new note");
});

test("a single stray frame is a blip, not a new note", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  const frames = [...Array(20).fill(voiced(415.0)), voiced(830.0), ...Array(20).fill(voiced(415.0)), ...Array(6).fill(silent())];
  const closed = feed(tr, frames);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].framesHz.length, 40);          // the blip was dropped
});

test("a short note is reported but flagged", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  const closed = feed(tr, [...Array(5).fill(voiced(554.37)), ...Array(6).fill(silent())]);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].short, true);
});

test("drone partials to notch: everything except the note being played", () => {
  const d4 = 277.29;
  const cents = (a, b) => 1200 * Math.log2(b / a);
  const near = (list, hz) => list.some((x) => Math.abs(cents(x, hz)) < 1);
  const a4 = dronePartialsToNotch(d4, 415.94);
  assert.equal(a4.length, 3);                          // A4 is far from all three partials
  const unison = dronePartialsToNotch(d4, d4);
  assert.equal(unison.length, 2);
  assert.ok(!near(unison, d4) && near(unison, 2 * d4) && near(unison, 3 * d4));
  const octave = dronePartialsToNotch(d4, 2 * d4);
  assert.ok(near(octave, d4) && !near(octave, 2 * d4) && near(octave, 3 * d4));
  const twelfth = dronePartialsToNotch(d4, 3 * d4);
  assert.ok(near(twelfth, d4) && near(twelfth, 2 * d4) && !near(twelfth, 3 * d4));
  assert.deepEqual(dronePartialsToNotch(null, 415), []);
});

/* ---- the tonic gate --------------------------------------------------- */

const TONIC_SECONDS = 0.45;
const tonicGate = () => new NoteSegmenter({
  targetHz: 277.29, frameSeconds: FS, requiredSeconds: TONIC_SECONDS,
});

test("the tonic is recognised despite the odd dropped frame", () => {
  // What an iPad actually delivers: a held note with occasional unvoiced
  // frames. Counting *consecutive* frames -- the original gate -- never
  // reached forty here and the session never started.
  const gate = tonicGate();
  let consecutive = 0, bestConsecutive = 0;
  const needed = Math.ceil(TONIC_SECONDS / FS);
  for (let i = 0; i < 200 && !gate.complete; i++) {
    const dropped = i % 9 === 8;
    gate.push(dropped ? 0 : 277.29, dropped ? -70 : -20);
    consecutive = dropped ? 0 : consecutive + 1;
    bestConsecutive = Math.max(bestConsecutive, consecutive);
  }
  assert.ok(gate.complete, "the gate opens");
  assert.ok(bestConsecutive < needed,
    `never ${needed} in a row (best run ${bestConsecutive}) -- the old gate would still be waiting`);
});

test("the tonic gate keeps progress across a breath, and is not opened by another note", () => {
  const gate = tonicGate();
  for (let i = 0; i < 20; i++) gate.push(277.29, -20);
  const held = gate.elapsedSeconds;
  for (let i = 0; i < 12; i++) gate.push(0, -70);        // a breath
  assert.ok(gate.elapsedSeconds >= held, "progress survives the breath");
  for (let i = 0; i < 40; i++) gate.push(277.29, -20);
  assert.ok(gate.complete);

  const wrong = tonicGate();
  for (let i = 0; i < 200; i++) wrong.push(415.0, -20);  // a fifth above
  assert.equal(wrong.complete, false, "a different note never opens the session");
});

test("the tonic is accepted in any octave the flute has it in", () => {
  // One gate per octave; whichever fills first opens the session.
  const gates = [277.29, 554.58, 1109.16].map((hz) =>
    new NoteSegmenter({ targetHz: hz, frameSeconds: FS, requiredSeconds: TONIC_SECONDS }));
  for (let i = 0; i < 60; i++) for (const g of gates) g.push(554.58, -20);
  assert.deepEqual(gates.map((g) => g.complete), [false, true, false]);
});

/* ---- the attack is not part of the note ------------------------------- */

test("post-attack trimming drops the scoop and keeps parallel series aligned", () => {
  const { postAttack, ATTACK_SKIP_SECONDS } = attackModule;
  const skip = Math.round(ATTACK_SKIP_SECONDS / FS);          // ~5 frames
  const scoop = Array.from({ length: skip }, (_, i) => 415 * Math.pow(2, (-40 + i * 8) / 1200));
  const steady = new Array(30).fill(415);
  const levels = [...new Array(skip).fill(-35), ...new Array(30).fill(-20)];

  const [hz, db] = postAttack([...scoop, ...steady], FS, levels);
  assert.equal(hz.length, 30, "the attack is gone");
  assert.equal(db.length, hz.length, "levels stay aligned with pitches");
  assert.ok(hz.every((f) => f === 415));
  assert.ok(db.every((l) => l === -20));

  // What it was costing: the scoop dominated the wobble figure.
  const spread = (xs) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
  };
  const cents = (f) => 1200 * Math.log2(f / 415);
  assert.ok(spread([...scoop, ...steady].map(cents)) > 8, "with the attack, a steady note looks unstable");
  assert.ok(spread(hz.map(cents)) < 0.001, "without it, steady is steady");
});

test("a note barely longer than the attack still yields frames", () => {
  const { postAttack } = attackModule;
  const [hz] = postAttack([415, 416, 417], FS);
  assert.ok(hz.length >= 1);
});

/* ---- a slur is not a note --------------------------------------------- */

const E5 = 622.25, F5 = 659.26, FS5 = 698.46;      // a whole tone and its midpoint
const cents = (a, b) => 1200 * Math.log2(b / a);

test("a slur from E to F# yields no phantom F in between", () => {
  // The Hotteterre case: a G major prelude with no F naturals reported a
  // steady stream of them, because F is exactly the midpoint of E-F# and the
  // whole slur was being absorbed into one region.
  const tr = new RegionTracker({ frameSeconds: FS });
  const frames = [];
  for (let i = 0; i < 25; i++) frames.push(voiced(E5));
  for (let i = 1; i <= 20; i++) frames.push(voiced(E5 * Math.pow(FS5 / E5, i / 20)));  // the slur
  for (let i = 0; i < 25; i++) frames.push(voiced(FS5));
  frames.push(...new Array(6).fill(silent()));

  const closed = feed(tr, frames).concat(tr.flush() ?? []);
  const kept = closed.filter((r) => !r.short && Math.abs(driftCents(r.framesHz)) < GLIDE_CENTS);
  const named = kept.map((r) => r.medianHz);

  assert.ok(named.some((hz) => Math.abs(cents(E5, hz)) < 25), "the E is heard");
  assert.ok(named.some((hz) => Math.abs(cents(FS5, hz)) < 25), "the F# is heard");
  for (const hz of named) {
    assert.ok(Math.abs(cents(F5, hz)) > 30,
      `no phantom F: got ${hz.toFixed(1)} Hz, ${cents(F5, hz).toFixed(1)}c from F`);
  }
});

test("driftCents tells a glide from a steady note, vibrato included", () => {
  const steady = new Array(30).fill(415);
  assert.ok(Math.abs(driftCents(steady)) < 1);

  // Vibrato oscillates rather than travels, so it must not read as drift.
  const vibrato = Array.from({ length: 40 }, (_, i) => 415 * Math.pow(2, 25 * Math.sin(i / 2) / 1200));
  assert.ok(Math.abs(driftCents(vibrato)) < GLIDE_CENTS, `vibrato drift ${driftCents(vibrato).toFixed(1)}c`);

  const glide = Array.from({ length: 30 }, (_, i) => E5 * Math.pow(FS5 / E5, i / 29));
  assert.ok(Math.abs(driftCents(glide)) >= GLIDE_CENTS, "a whole-tone slur is caught");
  assert.ok(driftCents(glide) > 0, "and its direction is reported");

  assert.equal(driftCents([415, 415]), 0, "too few frames to judge");
  assert.equal(driftCents(null), 0);
});

test("a trailing reference could not have split the slur; the anchor can", () => {
  // Why the fix works: over a slur the previous five frames are always close
  // to the current one, so a trailing median never reaches the threshold.
  const glide = Array.from({ length: 30 }, (_, i) => E5 * Math.pow(FS5 / E5, i / 29));
  const trailingGaps = glide.slice(5).map((hz, i) => Math.abs(cents(glide[i], hz)));
  assert.ok(Math.max(...trailingGaps) < 70, "a trailing reference never diverges enough");
  const anchorGaps = glide.map((hz) => Math.abs(cents(glide[0], hz)));
  assert.ok(Math.max(...anchorGaps) > 70, "an anchor does");
});

/* ---- a trill is not a note either -------------------------------------- */

function trill(upFrames, cycles = 8, lower = E5, upper = FS5) {
  const tr = new RegionTracker({ frameSeconds: FS });
  const closed = [];
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < 5; i++) { const r = tr.push(voiced(lower)); if (r) closed.push(r); }
    for (let i = 0; i < upFrames; i++) { const r = tr.push(voiced(upper)); if (r) closed.push(r); }
  }
  for (let i = 0; i < 6; i++) { const r = tr.push(silent()); if (r) closed.push(r); }
  const last = tr.flush();
  if (last) closed.push(last);
  return closed;
}

test("a fast trill is recognised, not reported as a flawless sustained note", () => {
  // Its upper note is shorter than the confirmation a new note needs, so the
  // upper frames are dropped one at a time and the region looks immaculate:
  // zero drift, tiny spread, dead on the lower pitch. Only the blip count
  // gives it away.
  const kept = trill(2).filter((r) => !r.short);
  assert.equal(kept.length, 1, "it survives as one long region");
  const region = kept[0];
  assert.ok(Math.abs(cents(E5, region.medianHz)) < 5, "sitting exactly on the lower note");
  assert.ok(Math.abs(driftCents(region.framesHz)) < GLIDE_CENTS, "drift cannot catch it");
  assert.ok(region.blips >= 3, `blips counted (${region.blips})`);
  assert.equal(isOscillating(region), true);
});

test("a slow trill breaks into fragments too short to measure", () => {
  const regions = trill(5);
  assert.ok(regions.length > 4, "it splits");
  assert.equal(regions.filter((r) => !r.short).length, 0, "nothing long enough to report");
});

test("a sustained note with the odd octave error is not called a trill", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  for (let i = 0; i < 120; i++) tr.push(voiced(i === 40 || i === 90 ? E5 * 2 : E5));
  const region = tr.flush();
  assert.ok(region.blips <= 2, `few blips (${region.blips})`);
  assert.equal(isOscillating(region), false);
  assert.ok(Math.abs(cents(E5, region.medianHz)) < 1);
});

test("vibrato is not a trill: it stays inside the split window", () => {
  const tr = new RegionTracker({ frameSeconds: FS });
  for (let i = 0; i < 80; i++) tr.push(voiced(E5 * Math.pow(2, 30 * Math.sin(i / 2) / 1200)));
  const region = tr.flush();
  assert.equal(isOscillating(region), false, `blips ${region.blips}`);
  assert.ok(Math.abs(driftCents(region.framesHz)) < GLIDE_CENTS);
});

/* ---- trills are runs of regions, not one odd region -------------------- */

const region = (atSeconds, seconds, medianHz) => ({ atSeconds, seconds, medianHz });

test("an accelerating alternation is found, as recorded trills actually look", () => {
  // The shape measured from a real trill: alternations shortening from half a
  // second to a twentieth, each its own region, no blips anywhere.
  const durations = [0.49, 0.26, 0.20, 0.16, 0.14, 0.10, 0.12, 0.08, 0.12, 0.08];
  const regions = [];
  let at = 1.0;
  durations.forEach((d, i) => { regions.push(region(at, d, i % 2 ? 424 : 474)); at += d; });
  const runs = alternationRuns(regions);
  assert.equal(runs.length, 1);
  assert.deepEqual([runs[0].start, runs[0].end], [0, regions.length]);
});

test("a scale is not an alternation, however fast", () => {
  // Consecutive and quick, but it never comes back to where it was.
  const scale = [415, 466, 523, 587, 622, 698, 784].map((hz, i) => region(i * 0.15, 0.15, hz));
  assert.deepEqual(alternationRuns(scale), []);
});

test("a slow two-note figure is music, not an ornament", () => {
  const figure = [415, 466, 415, 466, 415, 466].map((hz, i) => region(i * 0.8, 0.8, hz));
  assert.deepEqual(alternationRuns(figure), [], "too slow to be a trill");
});

test("silence between the notes ends the run", () => {
  const spaced = [415, 466, 415, 466, 415, 466]
    .map((hz, i) => region(i * 0.5, 0.2, hz));            // 0.3 s of gap each time
  assert.deepEqual(alternationRuns(spaced), []);
});

test("a trill's closing note is left out of the run, to be measured", () => {
  const regions = [];
  let at = 0;
  for (let i = 0; i < 8; i++) { regions.push(region(at, 0.1, i % 2 ? 424 : 474)); at += 0.1; }
  regions.push(region(at, 0.55, 474));                    // the resolution, held
  const runs = alternationRuns(regions);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].end, 8, "the held note stays outside the ornament");
});

test("too few alternations are left alone", () => {
  const regions = [415, 466, 415].map((hz, i) => region(i * 0.12, 0.12, hz));
  assert.deepEqual(alternationRuns(regions), []);
});

/* ---- a trill that changes fingering part-way --------------------------- */

/* On a one-keyed flute the written auxiliary is often unplayable at speed, so
 * the player substitutes its neighbour: a trill on B starts C-B-C-B and
 * continues C#-B-C#-B, and one on E becomes E-F#. The upper pole steps by a
 * semitone, which strict alternation cannot follow. */
const B4 = 465.9, C5 = 493.5, CS5 = 522.9;   // F5 and FS5 are declared above

const evenly = (pitches, seconds = 0.12) => {
  let at = 0;
  return pitches.map((hz) => { const r = region(at, seconds, hz); at += seconds; return r; });
};
const covered = (regions) => {
  const seen = new Set();
  for (const { start, end } of alternationRuns(regions)) for (let i = start; i < end; i++) seen.add(i);
  return seen;
};

test("a trill that swaps C for C# stays one ornament, losing no alternations", () => {
  // The damaging case is a single written-auxiliary alternation before the
  // swap: too short to be a run of its own, it was measured as a phantom C.
  const regions = evenly([C5, B4, CS5, B4, CS5, B4, CS5, B4]);
  assert.equal(alternationRuns(regions).length, 1);
  assert.equal(covered(regions).size, regions.length, "nothing left over to be measured");
});

test("the same for E, whose F becomes F#", () => {
  const regions = evenly([F5, E5, F5, E5, FS5, E5, FS5, E5, FS5, E5]);
  assert.equal(alternationRuns(regions).length, 1);
  assert.equal(covered(regions).size, regions.length);
});

test("sharing a pitch is not enough to join two ornaments", () => {
  // Tried loosely, this swallowed a fifth of a recorded prelude by joining
  // trills to whatever touched them. Both sides must alternate, one pole must
  // be held, and the odd poles must be a substitution apart.
  const trillThenLeap = evenly([415, 466, 415, 466, 415, 466, 932, 880, 932, 880]);
  assert.equal(alternationRuns(trillThenLeap).length, 2, "two ornaments, not one");

  // A trill whose neighbour shares its lower note but leaps above: no join.
  const trillThenFar = evenly([372, 420, 372, 420, 372, 420, 468, 420, 468, 420]);
  const runs = alternationRuns(trillThenFar);
  assert.ok(runs.length >= 1);
  assert.ok(runs.every((r) => r.end - r.start < trillThenFar.length),
    "a fourth away is a different figure, not a change of fingering");
});
