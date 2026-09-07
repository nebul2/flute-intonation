/* Reading a score, and comparing a recording against it.
 *
 * The first run of this comparison reported every note heard an octave low
 * and 16% recall. The detector had heard the opening note for note; the
 * comparison tool had asserted that MIDI numbers and the app's chromatic
 * index agree, and they do not -- MIDI puts C4 at 60, the app at 48. The raw
 * frequencies were what exposed it. Pinned here so it cannot come back. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readMidi, readScore, MIDI_TO_APP } from "./midi.js";
import { SpelledPitch } from "../core/pitch.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const GRAVE = path.join(root, "flutetrainer", "data", "pieces", "telemann-fantasias",
                        "telemann_TWV40-03_fantasia02_Amin_1-Grave.midi");

test("the score reader agrees with the app about where middle C is", () => {
  // Both conventions exist; only one of them is the app's.
  assert.equal(SpelledPitch.parse("C4").chromaticIndex, 48, "the app counts from C0 = 0");
  assert.equal(60 + MIDI_TO_APP, 48, "so MIDI's middle C must land on the app's");
  assert.equal(SpelledPitch.parse("D4").chromaticIndex, 62 + MIDI_TO_APP);
});

test("the Telemann Grave reads as the 83 notes it is, starting on A4", () => {
  const notes = readScore(GRAVE);
  assert.equal(notes.length, 83, "the note count checked two ways when the score was obtained");
  const a4 = SpelledPitch.parse("A4").chromaticIndex;
  assert.equal(notes[0].chroma, a4, "the Grave opens on A4 in the app's index");
  // The opening bar, from the LilyPond: a' c'' e'' | f' r e'' d'' cis'' d'' f'' a'' d'''
  const opening = ["A4", "C5", "E5", "F4", "E5", "D5", "C#5", "D5", "F5", "A5", "D6"]
    .map((n) => SpelledPitch.parse(n).chromaticIndex);
  assert.deepEqual(notes.slice(0, 11).map((n) => n.chroma), opening);
  // The range the flute needs: nothing below D4, nothing above D6.
  const lo = Math.min(...notes.map((n) => n.chroma)), hi = Math.max(...notes.map((n) => n.chroma));
  assert.equal(lo, SpelledPitch.parse("D4").chromaticIndex);
  assert.equal(hi, SpelledPitch.parse("D6").chromaticIndex);
});

test("raw MIDI numbers are offered too, unconverted, for anyone who wants them", () => {
  const raw = readMidi(GRAVE);
  assert.equal(raw[0].chroma, 69, "A4 is 69 in MIDI");
  assert.ok(raw.every((n, i) => i === 0 || n.tick >= raw[i - 1].tick), "in time order");
});
