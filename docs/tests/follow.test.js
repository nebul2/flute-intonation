/* Follow me: the partner's offsets, the notes it asks for, and the follow
 * ratio. Approximate comparisons on every cent and hertz. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpelledPitch, centsBetween, intervalBetween } from "../core/pitch.js";
import { BAROQUE_415, TemperamentTuning, parseScala } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";
import { Mode, TargetResolver } from "../core/resolver.js";
import {
  FOLLOW_LEVELS, offsetSequence, followPool, followBlock, followRun, followSet, blockFollow,
  referenceFrom, followPattern, shiftedHz, unmeasuredCanBend, directionOf, MIN_FOLLOW_OFFSET,
} from "../core/follow.js";

const P = (s) => SpelledPitch.parse(s);
const approx = (got, want, abs, label = "") =>
  assert.ok(Math.abs(got - want) <= abs, `${label} expected ${want} ± ${abs}, got ${got}`);
/* A repeatable stand-in for Math.random. */
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const vallotti = () => new TemperamentTuning(parseScala(TEMPERAMENTS.vallotti.scl), P("C4"), BAROQUE_415);

/* ---- the partner's offsets ------------------------------------------ */

test("the partner starts in tune, then moves both ways with catches", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const seq = offsetSequence({ blocks: 6, cents: 20, catchRate: 0.25, rng: seeded(seed) });
    assert.equal(seq.length, 6);
    approx(seq[0], 0, 1e-9, "first block in tune");
    const rest = seq.slice(1);
    // 5 blocks after the first: round(1.25) = 1 catch, 4 moving, 2 each way.
    assert.equal(rest.filter((c) => Math.abs(c) < 1e-9).length, 1, `seed ${seed} catches`);
    assert.equal(rest.filter((c) => c < -1e-9).length, 2, `seed ${seed} flat`);
    assert.equal(rest.filter((c) => c > 1e-9).length, 2, `seed ${seed} sharp`);
    for (const c of rest) assert.ok(Math.abs(c) < 1e-9 || Math.abs(Math.abs(c) - 20) < 1e-9);
  }
});

test("an odd number of moving blocks still uses both directions", () => {
  const seq = offsetSequence({ blocks: 4, cents: 12, catchRate: 0, rng: seeded(3) });
  const rest = seq.slice(1);
  assert.ok(rest.some((c) => c < 0) && rest.some((c) => c > 0));
});

test("shiftedHz moves by exactly the cents asked", () => {
  approx(centsBetween(440, shiftedHz(440, -20)), -20, 1e-9);
  approx(centsBetween(415, shiftedHz(415, 12)), 12, 1e-9);
});

/* ---- the notes ------------------------------------------------------- */

test("every level's pool makes exactly its named interval, in range", () => {
  for (const tonic of ["D", "G", "C", "F", "A"]) {
    for (const [level, spec] of Object.entries(FOLLOW_LEVELS)) {
      const pool = followPool(tonic, "major", level);
      assert.ok(pool.length >= 3, `${tonic} ${level}: ${pool.length} notes`);
      for (const { pitch, partner } of pool) {
        const iv = intervalBetween(partner, pitch);
        assert.equal(iv.simpleName, spec.interval, `${tonic} ${level} ${partner}->${pitch}`);
        assert.equal(iv.octaves, spec.octaves);
        assert.ok(pitch.chromaticIndex >= P(spec.low).chromaticIndex);
        assert.ok(pitch.chromaticIndex <= P(spec.high).chromaticIndex);
      }
    }
  }
});

test("D major unison is spelled from the key: F# and C#, no F or C", () => {
  const names = followPool("D", "major", "unison").map((p) => p.pitch.name);
  assert.ok(names.includes("F#4") && names.includes("C#5"));
  assert.ok(!names.includes("F4") && !names.includes("C5"));
  assert.ok(followPool("D", "major", "unison").every((p) => p.partner.equals(p.pitch)));
});

test("D minor uses B flat", () => {
  const names = followPool("D", "minor", "unison").map((p) => p.pitch.name);
  assert.ok(names.includes("Bb4") && !names.includes("B4"));
});

test("the fifth level never asks for a diminished fifth", () => {
  // In C major, B over the E below is a fifth, but F over B is not -- that F
  // must not appear as a "fifth".
  const pool = followPool("C", "major", "fifth");
  assert.ok(!pool.some((p) => p.pitch.letter === "F" && p.partner.letter === "B"));
});

test("a block carries its offset and four notes over their partners", () => {
  const pool = followPool("D", "major", "unison");
  const block = followBlock(pool, { offsetCents: -20, notesPerBlock: 4, beats: 6, rng: seeded(2) });
  approx(block.offsetCents, -20, 1e-9);
  assert.equal(block.notes.length, 4);
  assert.equal(block.drone, null);
  for (const n of block.notes) assert.ok(n.context.bass.equals(n.pitch));
  // Drawn without repeats while the pool lasts.
  assert.equal(new Set(block.notes.map((n) => n.pitch.name)).size, 4);
});

test("a block never asks a note to bend the way it cannot", () => {
  // C major unison includes F4, which the built-in list says will not come
  // down. (Its C4 entry is below this level's range, so only the C-foot
  // levels could meet it; the check stays for the day one does.)
  const pool = followPool("C", "major", "unison");
  for (let seed = 1; seed <= 30; seed++) {
    const up = followBlock(pool, { offsetCents: 20, rng: seeded(seed) });
    assert.ok(!up.notes.some((n) => n.pitch.name === "C4"), "C4 asked to follow sharp");
    const down = followBlock(pool, { offsetCents: -20, rng: seeded(seed) });
    assert.ok(!down.notes.some((n) => n.pitch.name === "F4"), "F4 asked to follow flat");
  }
  assert.equal(unmeasuredCanBend(P("C4"), "down"), true);
});

test("a measured profile overrides the built-in list", () => {
  const pool = followPool("D", "major", "unison");
  const nothingBendsUp = (pitch, dir) => dir !== "up" || pitch.name === "A4";
  const block = followBlock(pool, { offsetCents: 20, canBend: nothingBendsUp, rng: seeded(4) });
  assert.ok(block.notes.every((n) => n.pitch.name === "A4"));
});

test("the pure target is the interval above the shifted partner", () => {
  const t = vallotti();
  const resolver = new TargetResolver(Mode.PURE, t);
  const [block] = followRun("D", "major", "majorThird", { blocks: 1, rng: seeded(5) });
  for (const n of block.notes) {
    approx(resolver.resolve(n), t.targetHz(n.context.bass) * 5 / 4, 1e-9, n.pitch.name);
  }
  const run = followRun("D", "major", "unison", { blocks: 6, cents: 20, rng: seeded(6) });
  assert.equal(run.length, 6);
  approx(run[0].offsetCents, 0, 1e-9);
  assert.equal(directionOf(-20), "down");
  assert.equal(directionOf(0), null);
});

/* ---- the follow ratio ------------------------------------------------ */

const R = (name, vsPartner) => ({ name, vsPartner });

test("a session plays the same notes in every block, in a fresh order", () => {
  const blocks = followRun("D", "major", "unison", { blocks: 6, rng: seeded(7) });
  const names = (b) => b.notes.map((n) => n.pitch.name).sort().join(" ");
  for (const b of blocks) assert.equal(names(b), names(blocks[0]));
  assert.equal(new Set(blocks[0].notes.map((n) => n.pitch.name)).size, 4);
});

test("the set prefers notes that bend both ways", () => {
  const pool = followPool("C", "major", "unison");
  for (let seed = 1; seed <= 20; seed++) {
    const set = followSet(pool, { notesPerBlock: 4, rng: seeded(seed) });
    assert.ok(!set.some((p) => p.pitch.name === "F4"), "F4 will not come down; others are available");
  }
});

test("following is measured from your own in-tune reading, not the tuning", () => {
  // You play A4 30 cents sharp of the tuning while the partner is in tune.
  const reference = referenceFrom([{ offsetCents: 0, readings: [R("A4", 30)] }]);
  approx(reference.get("A4"), 30, 1e-9);
  // Partner 20 flat, you stay put: still 30 sharp of the tuning, 50 above them.
  approx(blockFollow([R("A4", 50)], -20, reference).ratio, 0, 1e-9);
  // All the way: 30 above them again, i.e. 20 lower than before.
  approx(blockFollow([R("A4", 30)], -20, reference).ratio, 1, 1e-9);
  approx(blockFollow([R("A4", 30)], -20, reference).shift, -20, 1e-9);
  // Half.
  approx(blockFollow([R("A4", 40)], -20, reference).ratio, 0.5, 1e-9);
  // Sharp partner, overshooting.
  assert.ok(blockFollow([R("A4", 35)], 20, reference).ratio > 1);
});

test("the first block has nothing to compare with, and says so", () => {
  const b = blockFollow([R("A4", 30), R("E5", 10)], 0, new Map());
  assert.equal(b.shift, null);
  assert.equal(b.ratio, null);
  approx(b.vsPartner, 20, 1e-9);
});

test("no ratio when the partner barely moved; a catch reports the shift", () => {
  const reference = new Map([["A4", 30]]);
  const b = blockFollow([R("A4", 36)], 0, reference);
  assert.equal(b.ratio, null);
  approx(b.shift, 6, 1e-9);
  assert.equal(blockFollow([R("A4", 36)], MIN_FOLLOW_OFFSET - 1, reference).ratio, null);
});

test("only in-tune blocks set the reference, and the latest one wins", () => {
  const reference = referenceFrom([
    { offsetCents: 0, readings: [R("A4", 30)] },
    { offsetCents: -20, readings: [R("A4", 40)] },     // moving: not a reference
    { offsetCents: 0, readings: [R("A4", 24), R("E5", NaN)] },
  ]);
  approx(reference.get("A4"), 24, 1e-9);
  assert.ok(!reference.has("E5"), "a skipped note sets nothing");
});

test("skipped notes are left out of a block's reading", () => {
  const reference = new Map([["A4", 0], ["E5", 0]]);
  const b = blockFollow([R("A4", -10), R("E5", NaN)], 20, reference);
  assert.equal(b.notes, 1);
  approx(b.ratio, 0.5, 1e-9);
  assert.equal(blockFollow([R("A4", NaN)], 20, reference), null);
});

/* The take that found the flaw: recordings/follow-unison-follow.wav, the
 * partner's pitch read from each lead-in and the flute against it from the
 * note that followed (8.7 drew different notes each block, so only some
 * have a reference). Measured from the tuning, block 2 read as 198% and
 * block 3 as -137%: a flute sitting 20-55 cents sharp, counted as following.
 * Measured from the player's own block 1, it is modest following up and
 * almost none down -- which is what the numbers show by eye. */
test("real take: a flute sitting sharp is not counted as following", () => {
  const block1 = [R("E5", 34.2), R("F#4", 3.4), R("F#5", 27.2), R("A4", 55.1)];
  const block2 = [R("E5", 26.4), R("G4", 19.0), R("F#4", 1.1), R("A4", 31.9)];
  const block3 = [R("C#5", 39.4), R("B5", 49.8), R("F#5", 41.3), R("E5", 58.9)];
  const reference = referenceFrom([{ offsetCents: 0, readings: block1 }]);
  const up = blockFollow(block2, 20, reference);
  const down = blockFollow(block3, -20, reference);
  assert.equal(up.compared, 3);
  approx(up.ratio, 0.44, 0.02, "followed sharp");
  assert.equal(down.compared, 2);
  approx(down.ratio, 0.03, 0.02, "followed flat");
  // What the tuning-based figure would have said.
  const fromTuning = (rs, off) => rs.reduce((a, r) => a + r.vsPartner + off, 0) / rs.length / off;
  assert.ok(fromTuning(block2, 20) > 1.9 && fromTuning(block3, -20) < -1.3);
});

test("a pattern is named only when the session supports one", () => {
  const ref = new Map([["A4", 0]]);
  const block = (vsPartner, offset) => blockFollow([R("A4", vsPartner)], offset, ref);
  // Follows flat fully, sharp hardly at all, two blocks each way.
  const lopsided = [block(0, 0), block(0, -20), block(2, -20), block(-16, 20), block(-18, 20)];
  const p = followPattern(lopsided);
  assert.equal(p.readier, "flat");
  approx(p.flat, 0.95, 1e-9);
  approx(p.sharp, 0.15, 1e-9);
  assert.equal(p.catchBlocks, 1);
  // A first block, with no reference, is not a catch.
  assert.equal(followPattern([blockFollow([R("A4", 3)], 0, new Map())]).catchBlocks, 0);
  // One block each way is not enough to say anything.
  assert.equal(followPattern([block(0, -20), block(-18, 20)]).readier, null);
  // Close enough is not a pattern.
  assert.equal(followPattern([block(4, -20), block(4, -20), block(-6, 20), block(-6, 20)]).readier, null);
});

/* ---- the exercise entries and the flute's own profile ------------------ */

test("the Follow me cards build a session at the chosen offset", async () => {
  const { EXERCISES } = await import("../views/run.js");
  for (const key of ["followUnison", "followOctave"]) {
    const spec = EXERCISES[key];
    assert.equal(spec.feedback, "block");
    const blocks = spec.build("D", "major", null, { seconds: 6, cents: 12, canBend: () => true });
    assert.equal(blocks.length, 6);
    for (const b of blocks) {
      assert.ok(Math.abs(b.offsetCents) < 1e-9 || Math.abs(Math.abs(b.offsetCents) - 12) < 1e-9);
      assert.equal(b.notes.length, 4);
      approx(b.durationSeconds(b.notes[0]), 6, 1e-9);
    }
  }
});

test("a measured flute decides what may bend; unmeasured notes use the list", async () => {
  const profiles = await import("../profiles.js");
  const { canBendOn } = await import("../views/run.js");
  // A's measured: barely moves up, plenty down. F4 unmeasured.
  profiles.setNote("test flute", "A4", { natural: 0, floor: -25, ceiling: 2 }, null, "2026-10-02");
  const can = canBendOn("test flute");
  assert.equal(can(P("A4"), "up"), false);
  assert.equal(can(P("A4"), "down"), true);
  assert.equal(can(P("F4"), "down"), false, "built-in list for an unmeasured note");
  assert.equal(can(P("G4"), "up"), true);
  profiles.remove("test flute");
});

/* ---- the warm-up --------------------------------------------------------- */

test("the warm-up passes only when every note is within the line", async () => {
  const { warmupVerdict } = await import("../core/follow.js");
  const pass = warmupVerdict([R("A4", 4), R("E5", -9), R("F#4", 0), R("D5", 10)], 10, 4);
  assert.equal(pass.passed, true);
  assert.equal(pass.allSame, null);
  const one = warmupVerdict([R("A4", 4), R("E5", -9), R("F#4", 0), R("D5", 14)], 10, 4);
  assert.equal(one.passed, false);
  assert.deepEqual(one.notes.filter((n) => !n.ok).map((n) => [n.name, n.way]), [["D5", "sharp"]]);
  assert.equal(one.allSame, null, "one miss among passes is not the whole flute");
});

test("a skipped note fails the warm-up; too few notes fails it", async () => {
  const { warmupVerdict } = await import("../core/follow.js");
  assert.equal(warmupVerdict([R("A4", 1), R("E5", NaN)], 10, 2).passed, false);
  assert.equal(warmupVerdict([R("A4", 1)], 10, 4).passed, false);
});

test("every note out the same way is named, as the 8.7 take would have been", async () => {
  const { warmupVerdict } = await import("../core/follow.js");
  const take = [R("E5", 34.2), R("F#4", 13.4), R("F#5", 27.2), R("A4", 55.1)];
  assert.equal(warmupVerdict(take, 10, 4).allSame, "sharp");
  assert.equal(warmupVerdict([R("A4", -20), R("E5", -15)], 10, 2).allSame, "flat");
  assert.equal(warmupVerdict([R("A4", -20), R("E5", 15)], 10, 2).allSame, null);
});

test("the warm-up's Try again button retries, as the pedal does", async () => {
  // 8.7.2 shipped with the button doing nothing: it called onward(), which
  // only acted after a passed block, while the pedal went through skip().
  const { ExerciseRun } = await import("../views/run.js");
  for (const via of ["onward", "skip"]) {
    let retried = 0;
    const fake = { run: { phase: "warmup", nextTimer: null }, ui: {}, retryWarmup() { retried += 1; } };
    ExerciseRun.prototype[via].call(fake);
    assert.equal(retried, 1, `${via} on a missed warm-up`);
  }
});

test("the gate is set wherever the partner sounds at the note's pitch -- the octave too", async () => {
  // 8.7.4 on speakers: at the octave the partner's second partial is the
  // note itself, and with no gate the partner alone started the note.
  const { ExerciseRun } = await import("../views/run.js");
  const tuning = vallotti();
  const runner = Object.create(ExerciseRun.prototype);
  runner.run = { tuning, resolver: new TargetResolver(Mode.PURE, tuning), spec: {} };
  const shares = (level, offsetCents) => {
    const ex = followBlock(followPool("D", "major", level), { offsetCents, rng: seeded(4) });
    return ex.notes.map((n, i) => runner.partnerShares(n, ex, i));
  };
  assert.ok(shares("unison", -20).every(Boolean), "unison");
  assert.ok(shares("octave", 20).every(Boolean), "octave: the partner's second partial");
  assert.ok(!shares("majorThird", 0).some(Boolean), "a third shares nothing");
});

test("every sound plays as chosen, and its strong partials are what the gate guards", async () => {
  // 8.8.1 on speakers: four sounds chosen, one heard -- everything but plain
  // fell back to plain without headphones.
  const { soundingTimbre, partialsOf, TIMBRES } = await import("../audio/timbres.js");
  for (const name of Object.keys(TIMBRES)) assert.equal(soundingTimbre(name), name);
  assert.equal(soundingTimbre("nonsense"), "plain");
  assert.equal(partialsOf(200, "plain").length, 3);
  // A string bass's fourth partial is strong enough to be guarded.
  assert.ok(partialsOf(100, "strings").some((hz) => Math.abs(hz - 400) < 1e-9));
  // The flute partner differs from plain where it can be heard: the octave.
  assert.ok(TIMBRES.flute.partials[1] / TIMBRES.plain.partials[1] > 2);
});
