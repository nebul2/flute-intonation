/* "Almost": the line between a little off and very off, and what counts as
 * nearly having been right. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { judgeMagnitude, nearMiss, judgementTally, band, MAGNITUDES,
         IN_TUNE_CENTS, NEARLY_CENTS } from "../core/scoring.js";
import { compareAdjustment, NEARLY_ENOUGH, NEARLY_TOO_FAR, ENOUGH, TOO_FAR } from "../core/adjust.js";

test("a deviation is named by its size and its direction", () => {
  assert.equal(judgeMagnitude(0), "in tune");
  assert.equal(judgeMagnitude(IN_TUNE_CENTS), "in tune", "the boundary is in tune");
  assert.equal(judgeMagnitude(IN_TUNE_CENTS + 0.1), "little sharp");
  assert.equal(judgeMagnitude(NEARLY_CENTS), "little sharp", "the boundary is still a little");
  assert.equal(judgeMagnitude(NEARLY_CENTS + 0.1), "very sharp");
  assert.equal(judgeMagnitude(-7), "little flat");
  assert.equal(judgeMagnitude(-40), "very flat");
  // Every name it can produce is one the reports know how to lay out.
  for (const cents of [-40, -7, 0, 7, 40]) assert.ok(MAGNITUDES.includes(judgeMagnitude(cents)));
});

test("the two lines are one decision, so words and colours cannot disagree", () => {
  // A figure shown amber and described as "very sharp" in the same summary
  // would be the app contradicting itself. Both read the same pair.
  const bands = { inTuneCents: 5, nearlyCents: 10 };
  for (const cents of [3, 6, 9, 11, 30]) {
    const amber = band(cents, bands) === "close";
    const little = judgeMagnitude(cents, bands).startsWith("little");
    assert.equal(amber, little, `${cents} cents`);
  }
});

test("both lines move together when the player moves them", () => {
  const strict = { inTuneCents: 2, nearlyCents: 8 };
  assert.equal(judgeMagnitude(3), "in tune", "default");
  assert.equal(judgeMagnitude(3, strict), "little sharp", "strict");
  assert.equal(judgeMagnitude(9), "little sharp", "default");
  assert.equal(judgeMagnitude(9, strict), "very sharp");
  assert.equal(band(3, strict), "close");
});

test("a near miss is a wrong call the note was sitting close to", () => {
  // Called in tune, the note seven cents sharp: the ear was at the line.
  assert.equal(nearMiss("in tune", "sharp", 7), true);
  // Twenty-two cents sharp is not near anything.
  assert.equal(nearMiss("in tune", "sharp", 22), false);
  // Called sharp, measured in tune: the note was inside the band, so the
  // call was always within a few cents of right.
  assert.equal(nearMiss("sharp", "in tune", 3), true);
});

test("calling sharp for flat is never a near miss, however small", () => {
  // The direction is the thing being learned; getting it backwards is the
  // whole failure, and softening it would teach nothing.
  assert.equal(nearMiss("sharp", "flat", -6), false);
  assert.equal(nearMiss("flat", "sharp", 6), false);
  // And agreeing is not a near miss either -- it is a hit.
  assert.equal(nearMiss("sharp", "sharp", 40), false);
});

test("the tally splits a session by how far out the notes really were", () => {
  // The finding the aggregate row cannot show: this ear catches everything
  // badly out and misses everything slightly out.
  const j = (called, actual, cents) => ({ called, actual, agreed: called === actual, cents });
  const tally = judgementTally([
    j("sharp", "sharp", 30), j("sharp", "sharp", 25), j("flat", "flat", -40),
    j("in tune", "sharp", 7), j("in tune", "sharp", 8), j("in tune", "flat", -6),
  ]);
  assert.equal(tally.total, 6);
  assert.equal(tally.agreed, 3);
  assert.deepEqual(tally.byMagnitude["very sharp"], { played: 2, agreed: 2 });
  assert.deepEqual(tally.byMagnitude["little sharp"], { played: 2, agreed: 0 });
  assert.deepEqual(tally.byMagnitude["very flat"], { played: 1, agreed: 1 });
  assert.deepEqual(tally.byMagnitude["little flat"], { played: 1, agreed: 0 });
  // All three misses were near ones, and saying so is the point.
  assert.equal(tally.nearly, 3);
  // The direction rows are unchanged, since the saved record carries them.
  assert.deepEqual(tally.byActual.sharp, { played: 4, agreed: 2 });
});

test("judgements saved before cents existed still tally", () => {
  const tally = judgementTally([{ called: "sharp", actual: "sharp", agreed: true }]);
  assert.equal(tally.agreed, 1);
  assert.equal(tally.nearly, 0);
  assert.equal(tally.byMagnitude["in tune"].played, 1, "no cents lands in the middle, not nowhere");
});

/* ---- adjust: moved the right way, out on the amount ------------------ */

/* `meanCents` is each sounding's error against its *own* target, so the move
 * the player made is the required distance plus the second note's error --
 * which is the whole reason this comparison survives a reference set wrong. */
const adjust = (requiredCents, didCents) => compareAdjustment(
  { targetHz: 300, meanCents: 0, pitch: "F#4" },
  { targetHz: 300 * Math.pow(2, requiredCents / 1200),
    meanCents: didCents - requiredCents, pitch: "F#4" });

/* A wide interval on purpose: at the narrow end of what the exercise asks, a
 * third of the move is under the three cents that count as not having moved
 * at all, and the bands stop being separable. */
const WIDE = 40;

test("a move most of the way there is short, and nearly enough", () => {
  const nearly = adjust(WIDE, WIDE * (NEARLY_ENOUGH + 0.02));
  assert.equal(nearly.verdict, "short");
  assert.equal(nearly.nearly, true);
  // Barely moved is short and not nearly anything.
  const barely = adjust(WIDE, WIDE * (NEARLY_ENOUGH - 0.1));
  assert.equal(barely.verdict, "short");
  assert.equal(barely.nearly, false);
});

test("a move barely past the band is far, and nearly right", () => {
  const nearly = adjust(WIDE, WIDE * (TOO_FAR + 0.1));
  assert.equal(nearly.verdict, "far");
  assert.equal(nearly.nearly, true);
  const wild = adjust(WIDE, WIDE * (NEARLY_TOO_FAR + 0.5));
  assert.equal(wild.verdict, "far");
  assert.equal(wild.nearly, false);
});

test("moving the wrong way is never nearly right", () => {
  const wrong = adjust(WIDE, -WIDE * 0.25);
  assert.equal(wrong.verdict, "opposite");
  assert.equal(wrong.nearly, false);
  // And a good move is not flagged as nearly -- it simply is.
  const good = adjust(WIDE, WIDE * ((ENOUGH + TOO_FAR) / 2));
  assert.equal(good.verdict, "moved");
  assert.equal(good.nearly, false);
});
