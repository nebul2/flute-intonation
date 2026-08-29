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
  // The point of excerpting: whole takes are tens of megabytes.
  for (const name of ["sustained", "tongued", "trill", "trill_fingering", "slurred"]) {
    const bytes = fs.statSync(path.join(here, "fixtures", `${name}.wav`)).size;
    assert.ok(bytes < 600 * 1024, `${name}.wav is ${(bytes / 1024).toFixed(0)} KB`);
  }
});
