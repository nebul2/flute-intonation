/* The web pipeline against real flute recordings.
 *
 * Everything else in this suite is synthetic, and this project's standing
 * lesson is that synthetic tones repeatedly failed to reveal what real audio
 * found in minutes -- the detector crash on breath noise, the phantom F
 * between E and F#, and the trill rule below, which was reasoned out from
 * simulation and turned out never to fire on a real trill.
 *
 * Recordings are gitignored and nobody else has them, so every check skips
 * when its file is absent rather than failing. Capture them with
 * `python -m flutetrainer.tools.record --take trills`. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyse } from "./wavpipe.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const recording = (name) => path.join(root, "recordings", name);
const have = (name) => fs.existsSync(recording(name));

/* Plain playing: the false-positive side. No ornament rule may fire here, or
 * ordinary notes would be thrown away. */
test("long tones are measured, and are neither trills nor slurs", { skip: !have("longtones.wav") }, () => {
  const report = analyse(recording("longtones.wav"));
  assert.ok(report.counts.note >= 12, `notes measured: ${report.counts.note}`);
  assert.equal(report.trillRuns, 0, "a held note does not alternate");
  assert.equal(report.counts.slur ?? 0, 0);
  assert.ok(report.regions.every((r) => r.blipShare < 0.2), "clean notes barely blip");
});

test("tongued repetitions are measured, not mistaken for ornaments",
     { skip: !have("attacks.wav") }, () => {
  const report = analyse(recording("attacks.wav"));
  assert.ok(report.counts.note >= 8, `notes measured: ${report.counts.note}`);
  assert.equal(report.trillRuns, 0,
    "the same note tongued again is not an alternation: the pitch never changes");
});

/* Trills: the true-positive side, and the reason the rule had to change. A
 * baroque trill accelerates from slow to as fast as it will go, so one
 * gesture sweeps every alternation speed. Measured across five of them, the
 * alternations ran from 0.49 s down to 0.05 s -- every one long enough to
 * become a region of its own, which is why the blip rule never fired. */
test("recorded trills are recognised as ornaments", { skip: !have("trills.wav") }, () => {
  const report = analyse(recording("trills.wav"));
  assert.ok(report.trillRuns >= 4, `runs found: ${report.trillRuns}`);
  assert.ok(report.counts.trill > report.counts.note,
    `a recording of trills is mostly trill: ${JSON.stringify(report.counts)}`);
  // Almost nothing should be left over as unexplained fragments: before the
  // runs were recognised this file produced 112 too-short regions.
  assert.ok((report.counts.short ?? 0) <= 10,
    `few unexplained fragments: ${report.counts.short ?? 0}`);
});

/* A trill whose fingering changes part-way: the written auxiliary gives way
 * to its neighbour, so the upper pole steps by a semitone mid-ornament. */
test("a trill that changes fingering stays one ornament",
     { skip: !have("trillfingering.wav") }, () => {
  const report = analyse(recording("trillfingering.wav"));
  assert.ok(report.trillRuns >= 2, `ornaments found: ${report.trillRuns}`);
  assert.ok(report.counts.trill > report.counts.note,
    `mostly ornament: ${JSON.stringify(report.counts)}`);
  // The point of the join: no stray alternation left behind as a note. The
  // written auxiliary sounded once or twice before the swap and must not be
  // reported as something the player meant.
  assert.ok((report.counts.note ?? 0) <= report.trillRuns * 3,
    `few leftovers: ${report.counts.note} notes for ${report.trillRuns} ornaments`);
});

test("a piece keeps its notes while its ornaments are set aside",
     { skip: !have("piece.wav") }, () => {
  const report = analyse(recording("piece.wav"));
  assert.ok(report.trillRuns >= 5, `ornaments found: ${report.trillRuns}`);
  assert.ok(report.counts.note >= 50,
    `the music itself survives: ${JSON.stringify(report.counts)}`);
  // The scales and plain notes must outnumber what is set aside, or the rule
  // is eating the piece rather than its ornaments.
  assert.ok(report.counts.note > (report.counts.short ?? 0) + (report.counts.slur ?? 0),
    "measured notes outnumber the leftovers");
});
