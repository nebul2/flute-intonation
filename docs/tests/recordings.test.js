/* The web pipeline against real flute recordings.
 *
 * Everything else in this suite is synthetic, and this project's standing
 * lesson is that synthetic tones repeatedly failed to reveal what real audio
 * found in minutes -- the detector crash on breath noise, the phantom F
 * between E and F#. The trill and slur rules were reasoned out from
 * simulation, so they especially want real material.
 *
 * Recordings are gitignored and nobody else has them, so every check here
 * skips when its file is absent rather than failing. Capture them with
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

/* Sustained notes: the false-positive side. Neither ornament rule may fire on
 * plain playing, or every clean note would be thrown away as a trill. */
test("long tones are measured, and are neither trills nor slurs", { skip: !have("longtones.wav") }, () => {
  const report = analyse(recording("longtones.wav"));
  assert.ok(report.counts.note >= 12, `notes measured: ${report.counts.note}`);
  assert.equal(report.counts.trill ?? 0, 0, "a held note is not a trill");
  assert.equal(report.counts.slur ?? 0, 0, "a held note is not a slur");
  const measured = report.regions.filter((r) => r.kind === "note");
  assert.ok(measured.every((r) => r.blipShare < 0.2), "clean notes barely blip");
});

test("tongued repetitions are measured, not mistaken for ornaments",
     { skip: !have("attacks.wav") }, () => {
  const report = analyse(recording("attacks.wav"));
  assert.ok(report.counts.note >= 8, `notes measured: ${report.counts.note}`);
  assert.equal(report.counts.trill ?? 0, 0);
});

/* Trills: the true-positive side. A baroque trill accelerates from slow to as
 * fast as it will go, so one gesture sweeps every alternation speed -- the
 * regime that splits into fragments and the regime that would otherwise be
 * reported as an immaculate sustained note. */
test("recorded trills are recognised as ornaments, not measured as notes",
     { skip: !have("trills.wav") }, () => {
  const report = analyse(recording("trills.wav"));
  const ornaments = (report.counts.trill ?? 0) + (report.counts.short ?? 0);
  assert.ok(report.counts.trill >= 1,
    `at least one trill recognised (trills ${report.counts.trill ?? 0}, short ${report.counts.short ?? 0})`);
  assert.ok(ornaments >= report.counts.note ?? 0,
    "a recording of trills should not be mostly plain notes");
  for (const region of report.regions.filter((r) => r.kind === "trill")) {
    assert.ok(region.blipShare >= 0.2, "flagged on blip share, as designed");
  }
});

test("a piece with ornaments still yields notes to measure",
     { skip: !have("piece.wav") }, () => {
  const report = analyse(recording("piece.wav"));
  assert.ok(report.counts.note >= 5,
    `real music must still be measurable: ${JSON.stringify(report.counts)}`);
  // Slurs and trills are expected here; what would be wrong is everything
  // being swallowed by one of them.
  const total = report.regions.length;
  assert.ok((report.counts.trill ?? 0) < total * 0.8, "not everything is a trill");
  assert.ok((report.counts.slur ?? 0) < total * 0.8, "not everything is a slur");
});
