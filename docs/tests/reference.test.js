/* Setting the reference pitch from playing -- and, above all, refusing to set
 * it from one note. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { instrumentOffset, referenceFromOffset, referenceVerdict,
         MIN_NOTES, MIN_OCCURRENCES, MAX_SPREAD_CENTS,
         MIN_REFERENCE_HZ, MAX_REFERENCE_HZ } from "../core/reference.js";
import { aggregate, scorableRows, sessionScore } from "../core/stats.js";
import { SpelledPitch } from "../core/pitch.js";

/* A sounding, shaped as free play reports one. */
let counter = 0;
const sounding = (name, cents, { stdev = 2.0, seconds = 2.0 } = {}) => ({
  pitch: SpelledPitch.parse(name), primaryCents: cents,
  stdev, seconds, meanDb: -22, index: counter++,
});

const rowsFor = (soundings) => scorableRows(aggregate(soundings));

test("the offset is the median of the notes, so one bad note cannot set it", () => {
  // The rule the whole module exists for. An F that sits sharp and will not
  // come down is a real property of this instrument, not a reading of where
  // it is pitched, and it must not drag the reference with it.
  const rows = rowsFor([sounding("D5", 2), sounding("G5", 3),
                        sounding("A5", 4), sounding("F5", 40)]);
  assert.equal(sessionScore(rows).offset > 11, true, "the mean is dragged to +12");
  assert.ok(Math.abs(instrumentOffset(rows) - 4) < 1e-9, "the median is not");
});

test("a note played ten times gets one vote, not ten", () => {
  // Otherwise a piece that dwells on its tonic lets the tonic decide where
  // the instrument is pitched.
  const many = Array.from({ length: 10 }, () => sounding("D5", 20));
  const rows = rowsFor([...many, sounding("G5", 0), sounding("A5", 1)]);
  assert.equal(rows.length, 3, "three distinct pitches");
  assert.ok(Math.abs(instrumentOffset(rows) - 1) < 1e-9);
});

test("the reference moves to where the playing sits", () => {
  // Playing 12.5 cents sharp of targets built on A=415 puts the flute's A a
  // twelfth of a semitone above 415.
  assert.ok(Math.abs(referenceFromOffset(415, 12.5) - 418.0) < 0.05);
  assert.equal(referenceFromOffset(415, 0), 415);
  // Flat moves it down, and the two directions are symmetrical in cents.
  const up = 1200 * Math.log2(referenceFromOffset(415, 20) / 415);
  const down = 1200 * Math.log2(referenceFromOffset(415, -20) / 415);
  assert.ok(Math.abs(up + down) < 0.5);
});

test("a wild measurement declines rather than writing nonsense", () => {
  assert.equal(referenceFromOffset(415, 1200), null, "an octave out is not a reference");
  assert.equal(referenceFromOffset(415, -1200), null);
  assert.equal(referenceFromOffset(0, 5), null);
  assert.equal(referenceFromOffset(415, NaN), null);
  // The boundaries themselves are accepted.
  const low = 1200 * Math.log2(MIN_REFERENCE_HZ / 415);
  const high = 1200 * Math.log2(MAX_REFERENCE_HZ / 415);
  assert.ok(referenceFromOffset(415, low + 1) !== null);
  assert.ok(referenceFromOffset(415, high - 1) !== null);
});

test("one note, however long and however often, is never enough", () => {
  // The agreement this module encodes: the tonic you happened to play is not
  // the pitch of your flute.
  const rows = rowsFor(Array.from({ length: 12 }, () => sounding("D5", 18)));
  const verdict = referenceVerdict(sessionScore(rows));
  assert.equal(verdict.ready, false);
  assert.equal(verdict.reason, "more");
  assert.equal(verdict.need, MIN_NOTES - 1);
});

test("enough different notes, played enough times, is", () => {
  const soundings = [sounding("D5", 5), sounding("D5", 6), sounding("G5", 4),
                     sounding("A5", 5), sounding("B5", 6)];
  const score = sessionScore(rowsFor(soundings));
  assert.equal(score.notes, MIN_NOTES + 1);
  assert.ok(score.occurrences >= MIN_OCCURRENCES);
  assert.deepEqual(referenceVerdict(score), { ready: true, reason: "ok" });
});

test("notes that disagree with each other are playing, not a pitch", () => {
  const rows = rowsFor([sounding("D5", -30), sounding("G5", 0),
                        sounding("A5", 30), sounding("B5", -25), sounding("C6", 28)]);
  const score = sessionScore(rows);
  assert.ok(score.relative > MAX_SPREAD_CENTS);
  assert.equal(referenceVerdict(score).reason, "scattered");
});

test("nothing played at all is not an answer either", () => {
  assert.equal(instrumentOffset([]), null);
  assert.equal(sessionScore([]), null);
  assert.equal(referenceVerdict(null).ready, false);
});
