/* Real flute audio, committed.
 *
 * The full takes are minutes long and stay out of the repository; these few
 * seconds carry the behaviour that mattered. Every rule they check was first
 * reasoned out from simulation and was wrong in some way that only a flute
 * revealed, so these run for everyone, always -- unlike recordings.test.js,
 * which skips when the full takes are absent.
 *
 * Recut with `python -m flutetrainer.tools.make_excerpts`. */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fs from "node:fs";
import { analyse } from "./wavpipe.js";
import { scaleRuns } from "../core/scales.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => analyse(path.join(here, "fixtures", `${name}.wav`));

test("held notes are measured and never taken for ornaments", () => {
  const report = fixture("sustained");
  assert.ok(report.counts.note >= 2, `notes: ${JSON.stringify(report.counts)}`);
  assert.equal(report.trillRuns, 0);
  assert.equal(report.counts.slur ?? 0, 0);
  assert.ok(report.regions.every((r) => r.blipShare < 0.2), "a held note barely blips");
});

test("the same note tongued again is repetition, not alternation", () => {
  const report = fixture("tongued");
  assert.ok(report.counts.note >= 2, `notes: ${JSON.stringify(report.counts)}`);
  assert.equal(report.trillRuns, 0, "the pitch never changes, so nothing alternates");
});

test("an accelerating trill is one ornament, not a stream of notes", () => {
  // Its alternations shorten from about half a second to a twentieth. Every
  // one is long enough to become a region of its own, which is why a rule
  // looking for a pitch leaving and returning *within* a region never fired.
  const report = fixture("trill");
  assert.equal(report.trillRuns, 1, `runs: ${report.trillRuns}`);
  assert.ok(report.counts.trill > 10, `alternations absorbed: ${report.counts.trill}`);
  assert.ok((report.counts.note ?? 0) <= 3, `little left over: ${report.counts.note}`);
  assert.ok(report.regions.every((r) => r.blips === 0),
    "and not one blip in the whole trill, which is what the first rule counted");
});

test("a trill survives its fingering giving way", () => {
  // The upper pole drifts up as the trill accelerates and settles about 155
  // cents above the main note: between the written auxiliary and its
  // neighbour, on neither.
  const report = fixture("trill_fingering");
  assert.equal(report.trillRuns, 1, "one ornament, not two");
  assert.ok(report.counts.trill > 10);
  assert.ok((report.counts.note ?? 0) <= 3,
    "no opening alternation left behind as a phantom note");
});

test("a slurred passage still yields the notes at either end", () => {
  const report = fixture("slurred");
  assert.ok(report.counts.note >= 2, `notes: ${JSON.stringify(report.counts)}`);
  assert.ok((report.counts.slur ?? 0) >= 1, "the transition itself is not a note");
});

test("every fixture is small enough to belong in a repository", () => {
  // The point of excerpting: whole takes are tens of megabytes. A scale is a
  // longer gesture than a trill and cannot be cut as short, so the per-file
  // cap allows for that -- but the total is what actually matters to anyone
  // cloning, and it stays two orders of magnitude below the takes.
  let total = 0;
  for (const name of ["sustained", "tongued", "trill", "trill_fingering", "slurred",
                      "scales_run_together", "scale_two_octave"]) {
    const bytes = fs.statSync(path.join(here, "fixtures", `${name}.wav`)).size;
    total += bytes;
    assert.ok(bytes < 1200 * 1024, `${name}.wav is ${(bytes / 1024).toFixed(0)} KB`);
  }
  assert.ok(total < 4 * 1024 * 1024, `fixtures total ${(total / 1024 / 1024).toFixed(1)} MB`);
});

test("two scales run together are split by contour, with no silence to help", () => {
  // Real playing, and the case that decided the design: within a scale the
  // notes are contiguous -- median gap 0.00 s across the whole take -- and
  // these two scales are 0.05 s apart. No silence threshold could separate
  // them, so the contour has to.
  const notes = fixture("scales_run_together").notes;
  const runs = scaleRuns(notes);
  assert.equal(runs.length, 2, `expected two scales, got ${runs.length}`);
  assert.deepEqual(runs.map((r) => r.tonicName), ["D", "G"]);
  assert.ok(runs.every((r) => r.shape === "up"), "both were played ascending only");
});

test("a two-octave scale survives the detector jumping an octave", () => {
  // Six of these in 226 real notes, always at a register crossing. This one
  // is E5 heard as E4 in the middle of the ascent; unrepaired it breaks the
  // run in half and the scale is lost entirely.
  const runs = scaleRuns(fixture("scale_two_octave").notes);
  assert.equal(runs.length, 1, `expected one scale, got ${runs.length}`);
  assert.equal(runs[0].tonicName, "D");
  assert.equal(runs[0].octaves, 2);
  assert.equal(runs[0].octaveErrors, 1, "the jump is repaired, and reported rather than hidden");
});
