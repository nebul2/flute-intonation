/* What each note can do, and what follows from it.
 *
 * The numbers here are shaped after what the player reports of this traverso:
 * the lowest note will not come up, F sits sharp and will not come down, and
 * most other low notes move freely. Synthetic, and deliberately so -- the
 * arithmetic must be right before any of it is pointed at a recording. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  reach, isRigid, checkCorrection, offsetWindow, bestOffset, attribute,
  validEntry, RIGID_CENTS,
} from "../core/bend.js";

const approx = (got, want, abs, label = "") =>
  assert.ok(Math.abs(got - want) <= abs, `${label} expected ${want} ± ${abs}, got ${got}`);

/* Low C: sits flat and will not come up. */
const lowC = { natural: -8, floor: -35, ceiling: -6 };
/* F: sits sharp and will not come down. */
const f = { natural: 14, floor: 10, ceiling: 30 };
/* A: free in both directions. */
const a = { natural: 1, floor: -24, ceiling: 26 };

test("bend is measured from where the note naturally sits, and is asymmetric", () => {
  // The point of taking the natural reading first: 'bends 29 cents' hides
  // everything, because all 29 of low C's cents are downward.
  approx(reach(lowC).down, 27, 1e-9, "low C down");
  approx(reach(lowC).up, 2, 1e-9, "low C up");
  approx(reach(lowC).total, 29, 1e-9);
  approx(reach(f).down, 4, 1e-9, "F down");
  approx(reach(f).up, 16, 1e-9, "F up");
});

test("a note that will not move in the direction asked for is rigid there, and free in the other", () => {
  assert.equal(isRigid(lowC, "up"), true, "low C will not come up");
  assert.equal(isRigid(lowC, "down"), false, "but it comes down freely");
  assert.equal(isRigid(f, "down"), true, "F will not come down");
  assert.equal(isRigid(f, "up"), false);
  assert.equal(isRigid(a, "up"), false);
  assert.equal(isRigid(a, "down"), false);
});

test("a correction the instrument cannot make is reported as impossible, with the shortfall", () => {
  // The case that motivates all of this: telling the player to lower an F
  // that will not go down.
  const asked = checkCorrection(f, -12);
  assert.equal(asked.possible, false);
  approx(asked.available, 4, 1e-9, "only four cents of downward bend exist");
  approx(asked.shortfall, 8, 1e-9, "so eight cents of the advice is undeliverable");

  // The same size of correction the other way is easy.
  const other = checkCorrection(f, 12);
  assert.equal(other.possible, true);
  approx(other.shortfall, 0, 1e-9);
});

test("a correction within reach is possible even when it is most of the range", () => {
  const asked = checkCorrection(lowC, -26);
  assert.equal(asked.possible, true, "26 of the 27 available cents");
  approx(asked.shortfall, 0, 1e-9);
});

test("the offset window is where the whole flute must sit for a note to be reachable", () => {
  const w = offsetWindow(f);
  approx(w.low, -30, 1e-9);
  approx(w.high, -10, 1e-9);
  // Read it back: at that offset the note's window must contain its target.
  for (const o of [w.low, -20, w.high]) {
    assert.ok(f.floor + o <= 1e-9 && f.ceiling + o >= -1e-9, `offset ${o} should reach`);
  }
  assert.ok(f.floor + (w.high + 1) > 1e-9, "and just outside it, it should not");
});

test("the headjoint is placed for the notes that cannot move, not for the mean", () => {
  // The whole argument. F wants the flute 10 to 30 cents flatter; low C wants
  // it 6 to 35 cents sharper. They do not overlap, so no placement plays both,
  // and the mean of the naturals -- about +2 -- plays neither.
  const result = bestOffset([lowC, f, a]);
  assert.equal(result.total, 3);
  assert.equal(result.reachable, 2, "two of the three, which is the most available");
  assert.equal(result.unreachable.length, 1);
  assert.equal(result.unreachable[0].natural, f.natural, "F is the one given up");

  const mean = (lowC.natural + f.natural + a.natural) / 3;
  assert.ok(Math.abs(result.offset - -mean) > 2,
    `the answer (${result.offset}) is not simply minus the mean (${(-mean).toFixed(1)})`);
});

test("among placements that reach the same notes, the one asking for least bending wins", () => {
  // Two notes, both reachable across a wide band of offsets: the tie is broken
  // by effort, because a note reachable only at its limit is not really playable.
  const easy = { natural: 0, floor: -40, ceiling: 40 };
  const alsoEasy = { natural: 10, floor: -30, ceiling: 50 };
  const result = bestOffset([easy, alsoEasy]);
  assert.equal(result.reachable, 2);
  // Naturals at 0 and 10: the least-effort placement sits between them.
  assert.ok(result.offset <= 0 && result.offset >= -10,
    `offset ${result.offset} should sit between the two naturals`);
  assert.ok(result.meanBend <= 5 + 1e-9, `mean bend ${result.meanBend}`);
});

test("a flute whose notes all agree is placed where they all are", () => {
  const entries = [
    { natural: 7, floor: -18, ceiling: 30 },
    { natural: 7, floor: -20, ceiling: 28 },
    { natural: 7, floor: -15, ceiling: 25 },
  ];
  const result = bestOffset(entries);
  assert.equal(result.reachable, 3);
  approx(result.offset, -7, 1e-9, "shift the whole flute down by seven");
  approx(result.meanBend, 0, 1e-9, "and then nothing needs bending at all");
});

test("out of tune beyond what the flute can do is the flute; inside it, the player", () => {
  assert.equal(attribute(f, 20), "within-reach", "F at +20 was a choice");
  assert.equal(attribute(f, 5), "beyond-flat", "F at +5 is impossible, so it is not one");
  assert.equal(attribute(f, 35), "beyond-sharp");
  assert.equal(attribute(lowC, -8), "within-reach");
  assert.equal(attribute(lowC, 4), "beyond-sharp", "low C cannot be played sharp");
});

test("readings out of order are refused rather than believed", () => {
  assert.equal(validEntry(lowC), true);
  assert.equal(validEntry({ natural: 0, floor: 10, ceiling: 20 }), false, "floor above natural");
  assert.equal(validEntry({ natural: 0, floor: -10, ceiling: -5 }), false, "ceiling below natural");
  assert.equal(validEntry({ natural: 0, floor: -10 }), false, "a missing reading");
  assert.equal(validEntry({ natural: 0, floor: 0, ceiling: 0 }), true, "a rigid note is valid");
});

test("no notes yields no recommendation rather than a confident zero", () => {
  assert.equal(bestOffset([]), null);
});

test("the rigidity threshold is a named constant, not a magic number", () => {
  const barely = { natural: 0, floor: -(RIGID_CENTS - 0.1), ceiling: RIGID_CENTS + 0.1 };
  assert.equal(isRigid(barely, "down"), true);
  assert.equal(isRigid(barely, "up"), false);
});

/* ---- checking the app's own advice against the instrument -------------- */

import { reviewSession, impossible } from "../core/bend.js";

const PROFILE = {
  F4: { natural: 14, floor: 10, ceiling: 30 },   // sits sharp, will not come down
  C4: { natural: -8, floor: -35, ceiling: -6 },  // sits flat, will not come up
  A4: { natural: 1, floor: -24, ceiling: 26 },   // free
};

test("advice the flute cannot carry out is caught before it is given", () => {
  // F played 14 cents sharp. The app would say "come down 14"; the flute has
  // four cents of downward bend. Ten of those fourteen are not the player's.
  const reviews = reviewSession(PROFILE, [{ pitch: "F4", meanCents: 14 }]);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].possible, false);
  approx(reviews[0].wanted, -14, 1e-9, "the correction asked for");
  approx(reviews[0].available, 4, 1e-9);
  approx(reviews[0].shortfall, 10, 1e-9, "undeliverable cents");
});

test("the same error on a flexible note is the player's to fix", () => {
  const reviews = reviewSession(PROFILE, [{ pitch: "A4", meanCents: 14 }]);
  assert.equal(reviews[0].possible, true);
  approx(reviews[0].shortfall, 0, 1e-9);
  assert.equal(reviews[0].attribution, "within-reach");
});

test("a note played outside what the flute can do is attributed to the flute", () => {
  // F cannot be played at +5 at all; if it was measured there, the reading is
  // the instrument's doing (or the measurement's), not a lapse of control.
  const reviews = reviewSession(PROFILE, [{ pitch: "F4", meanCents: 5 }]);
  assert.equal(reviews[0].attribution, "beyond-flat");
});

test("notes the profile has never measured are passed over in silence", () => {
  // Not guessed at, not defaulted to "fine": absent. A profile accumulates a
  // few notes at a time, so most of it is unmeasured most of the time.
  const reviews = reviewSession(PROFILE, [
    { pitch: "F4", meanCents: 14 },
    { pitch: "G5", meanCents: 30 },
  ]);
  assert.deepEqual(reviews.map((r) => r.pitch), ["F4"]);
});

test("a half-measured note is treated as unmeasured, not as a partial answer", () => {
  const broken = { F4: { natural: 14, floor: 20, ceiling: 30 } };  // floor above natural
  assert.deepEqual(reviewSession(broken, [{ pitch: "F4", meanCents: 14 }]), []);
});

test("impossible() picks out exactly the notes worth explaining away", () => {
  // Both of the player's reported problem notes fall out here, which is the
  // check working rather than a coincidence: F sits 14 sharp with 4 cents of
  // downward bend, and low C sits 8 flat with 2 cents of upward bend. Each is
  // played at its natural pitch -- no lapse of control at all -- and neither
  // can be brought to its target by any amount of trying. A alone is the
  // player's to fix, and it is the only one the app should ask about.
  const reviews = reviewSession(PROFILE, [
    { pitch: "F4", meanCents: 14 },
    { pitch: "A4", meanCents: 14 },
    { pitch: "C4", meanCents: -8 },
  ]);
  assert.equal(reviews.length, 3);
  const cannot = impossible(reviews);
  assert.deepEqual(cannot.map((r) => r.pitch), ["F4", "C4"]);
  approx(cannot[0].shortfall, 10, 1e-9, "F is 10 cents beyond reach");
  approx(cannot[1].shortfall, 6, 1e-9, "low C is 6 cents beyond reach");
});

test("a note already in tune asks for no correction and is never impossible", () => {
  const reviews = reviewSession(PROFILE, [{ pitch: "F4", meanCents: 0 }]);
  assert.equal(reviews[0].possible, true, "asking for nothing is always possible");
  approx(reviews[0].wanted, 0, 1e-9);
});

/* ---- the instrument as a whole ---------------------------------------- */

import { profileStats } from "../core/bend.js";

test("where the flute sits and how consistent it is are two different numbers", () => {
  // A flute sitting uniformly 12 cents sharp is not out of tune with itself at
  // all: one push of the headjoint fixes every note. Averaging raw distances
  // would score it as badly as a scattered one, which is the mistake.
  const uniform = [12, 12, 12, 12].map((c) => ({ natural: c, floor: c - 20, ceiling: c + 20 }));
  const stats = profileStats(uniform);
  approx(stats.centre, 12, 1e-9, "it sits 12 sharp");
  approx(stats.scatter, 0, 1e-9, "and is perfectly consistent with itself");
  approx(stats.rawError, 12, 1e-9, "which the raw average cannot tell you");
});

test("a scattered flute is scattered even when it sits on the target", () => {
  const scattered = [-15, 15, -15, 15].map((c) => ({ natural: c, floor: c - 20, ceiling: c + 20 }));
  const stats = profileStats(scattered);
  approx(stats.centre, 0, 1e-9, "centred overall");
  approx(stats.scatter, 15, 1e-9, "and 15 cents out with itself, which no headjoint fixes");
});

test("bend capability is averaged in each direction separately, and the worst named", () => {
  const stats = profileStats([lowC, f, a]);
  assert.equal(stats.n, 3);
  approx(stats.meanDown, (27 + 4 + 25) / 3, 1e-9, "mean downward bend");
  approx(stats.meanUp, (2 + 16 + 25) / 3, 1e-9, "mean upward bend");
  approx(stats.leastUp, 2, 1e-9, "low C is the stiffest upward");
  approx(stats.leastDown, 4, 1e-9, "F is the stiffest downward");
  assert.equal(stats.rigidUp, 1, "one note that will not go up");
  assert.equal(stats.rigidDown, 1, "one that will not come down");
});

test("half-measured notes are left out of the statistics entirely", () => {
  const stats = profileStats([a, { natural: 0, floor: 10, ceiling: 20 }]);
  assert.equal(stats.n, 1, "only the valid one counts");
});

test("an empty profile has no statistics rather than zeroed ones", () => {
  assert.equal(profileStats([]), null);
  assert.equal(profileStats([{ natural: 0, floor: 5, ceiling: 1 }]), null);
});

/* ---- what a bend cost in sound ---------------------------------------- */

import { bendCost, wasForced, FORCED_DROP_DB } from "../core/bend.js";

test("a bend that wrecked the sound is distinguished from one that did not", () => {
  // The flaw this catches: asking for the flattest a note will go measures the
  // extreme, and most notes can be forced a long way if the tone may collapse.
  // A note dragged 36 cents down at 9 dB quieter is not 36 cents of usable bend.
  const forced = {
    natural: 14, floor: -22, ceiling: 30,
    levels: { natural: -30, floor: -39, ceiling: -31 },
  };
  const cost = bendCost(forced);
  approx(cost.down, 9, 1e-9, "nine decibels to get down there");
  approx(cost.up, 1, 1e-9, "but the upward bend cost nothing");
  assert.equal(wasForced(forced, "down"), true);
  assert.equal(wasForced(forced, "up"), false);
});

test("a profile taken before levels were kept says 'not measured', not 'nothing'", () => {
  assert.equal(bendCost(lowC), null, "no levels recorded at all");
  assert.equal(wasForced(lowC, "down"), false, "and nothing is claimed about it");
  const partial = { natural: 0, floor: -20, ceiling: 20, levels: { natural: NaN, floor: -40 } };
  assert.equal(bendCost(partial), null, "a missing natural level makes the drops meaningless");
});

test("the forcing threshold is a constant, and sits where a drop is real", () => {
  const at = (drop) => ({
    natural: 0, floor: -30, ceiling: 30,
    levels: { natural: -30, floor: -30 - drop, ceiling: -30 },
  });
  assert.equal(wasForced(at(FORCED_DROP_DB + 0.1), "down"), true);
  assert.equal(wasForced(at(FORCED_DROP_DB - 0.1), "down"), false);
});

test("levels never change the pitch arithmetic", () => {
  // The reach is what it is; the cost is reported beside it, never subtracted.
  const withLevels = { ...lowC, levels: { natural: -30, floor: -45, ceiling: -30 } };
  approx(reach(withLevels).down, reach(lowC).down, 1e-9);
  approx(profileStats([withLevels]).meanDown, profileStats([lowC]).meanDown, 1e-9);
});
