/* Follow me: the partner's offsets, the notes it asks for, and the follow
 * ratio. Approximate comparisons on every cent and hertz. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpelledPitch, centsBetween, intervalBetween } from "../core/pitch.js";
import { BAROQUE_415, TemperamentTuning, parseScala } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";
import { Mode, TargetResolver } from "../core/resolver.js";
import {
  FOLLOW_LEVELS, offsetSequence, followPool, followBlock, followRun, followOf, blockFollow,
  followPattern, shiftedHz, unmeasuredCanBend, directionOf, MIN_FOLLOW_OFFSET,
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

test("following all the way, not at all, and half", () => {
  // Partner 20 flat. Sitting on the partner reads 0 against it: followed.
  approx(followOf(0, -20).ratio, 1, 1e-9);
  approx(followOf(0, -20).moved, -20, 1e-9);
  // Staying where a tuner would put you reads +20 against the partner.
  approx(followOf(20, -20).ratio, 0, 1e-9);
  approx(followOf(10, -20).ratio, 0.5, 1e-9);
  // Overshooting the partner gives more than 100%.
  assert.ok(followOf(-5, -20).ratio > 1);
  // Sharp partner, the same arithmetic.
  approx(followOf(-6, 20).ratio, 0.7, 1e-9);
});

test("no ratio when the partner barely moved", () => {
  assert.equal(followOf(3, 0).ratio, null);
  assert.equal(followOf(3, MIN_FOLLOW_OFFSET - 1).ratio, null);
  approx(followOf(3, 0).moved, 3, 1e-9);
});

test("a block's reading is the mean over notes played, ignoring skipped ones", () => {
  const b = blockFollow([4, 8, NaN, 6], -20);
  assert.equal(b.notes, 3);
  approx(b.vsPartner, 6, 1e-9);
  approx(b.ratio, 0.7, 1e-9);
  assert.equal(blockFollow([NaN], -20), null);
});

test("a pattern is named only when the session supports one", () => {
  const block = (vsPartner, offset) => blockFollow([vsPartner], offset);
  // Follows flat fully, sharp hardly at all, two blocks each way.
  const lopsided = [block(0, 0), block(0, -20), block(2, -20), block(-16, 20), block(-18, 20)];
  const p = followPattern(lopsided);
  assert.equal(p.readier, "flat");
  approx(p.flat, 0.95, 1e-9);
  approx(p.sharp, 0.15, 1e-9);
  assert.equal(p.catchBlocks, 1);
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
