/* The scoring rule against notes whose answer is known.

 * Everything else that measures a note measures it against another
 * measurement. These probes are synthesised to a stated intonation shape, so
 * "the reading is right" is a checkable claim rather than a comparison
 * between two rules that could both be wrong.
 *
 * They exist because a rule that reads the end of a note and a rule that
 * averages the whole of it agree on almost every note ever played and differ
 * completely on the one case the feature is for -- a note corrected late.
 * Real recordings show the disagreement; only these say who was right.
 *
 * Gitignored like the recordings, and skipped when absent. Make them with
 * `python -m flutetrainer.tools.make_probe_tones`. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verify, TRUTH } from "./abscore.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const probe = (name) => path.join(root, "recordings", "probes", `${name}.wav`);
const have = (name) => fs.existsSync(probe(name));
const readings = (name) => verify([probe(name)]);

/* The tolerance is the app's own in-tune band. A rule allowed to be six
 * cents out on a tone built to be exact has no business calling a player's
 * note in tune. */
const TOLERANCE = 5.0;

test("a note held steadily reads what it was held at", { skip: !have("steady") }, () => {
  for (const name of ["steady", "sharp20"]) {
    if (!have(name)) continue;
    for (const row of readings(name)) {
      assert.ok(Math.abs(row.readings.settled.error) < TOLERANCE,
        `${name}: ${row.readings.settled.error.toFixed(1)}c from ${row.expected}`);
    }
  }
});

/* The one the whole rule exists for. Reading the whole note averages the
 * approach into the answer, and on late-sharp it misses by the entire
 * correction -- which is why this asserts the old rule fails, not only that
 * the new one passes. A test that only checks the new rule would still pass
 * if someone quietly restored the old one. */
test("a note corrected late reads the correction, not the approach",
     { skip: !have("late-sharp") }, () => {
  const [row] = readings("late-sharp");
  assert.ok(Math.abs(row.readings.settled.error) < TOLERANCE,
    `settled: ${row.readings.settled.error.toFixed(1)}c out`);
  assert.ok(Math.abs(row.readings.whole.error) > 15,
    "the whole-note rule is supposed to miss this by most of the correction");
});

test("a note that falls away as it dies is not scored on the fall",
     { skip: !have("droop") }, () => {
  const [row] = readings("droop");
  assert.ok(Math.abs(row.readings.settled.error) < TOLERANCE,
    `settled: ${row.readings.settled.error.toFixed(1)}c out`);
});

/* Vibrato is the shape that would catch a rule scoring a fragment of a note:
 * a window short enough to land inside one swing reports that swing. */
test("wide vibrato reads its centre, not a swing", { skip: !have("vibrato") }, () => {
  const [row] = readings("vibrato");
  assert.ok(Math.abs(row.readings.settled.error) < TOLERANCE,
    `settled: ${row.readings.settled.error.toFixed(1)}c off centre`);
});

/* Naming, not scoring: a wrong row on Compare temperaments is this failing,
 * and has nothing to do with which window was measured. */
test("every pitch class in tune is named correctly and reads zero",
     { skip: !have("ladder") }, () => {
  const rows = readings("ladder");
  assert.equal(rows.length, 12, "twelve notes, twelve regions");
  const wanted = ["D5", "Eb5", "E5", "F5", "F#5", "G5", "G#5", "A5", "Bb5", "B5", "C6", "C#6"];
  assert.deepEqual(rows.map((r) => r.readings.settled.pitch), wanted);
  for (const row of rows) {
    assert.ok(Math.abs(row.readings.settled.error) < 2.0,
      `${row.readings.settled.pitch}: ${row.readings.settled.error.toFixed(1)}c`);
  }
});

test("the probe answers are stated, not read back from the code", () => {
  // Guards the one way this file could become worthless: expectations copied
  // from whatever the code printed on the day. They are written down here and
  // in the generator, and nowhere else.
  assert.equal(TRUTH["late-sharp"], 25);
  assert.equal(TRUTH.sharp20, 20);
  assert.equal(TRUTH.steady, 0);
});
