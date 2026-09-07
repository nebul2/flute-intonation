/* What the detector heard, against what the score says.
 *
 *   node docs/tests/score.js recordings/telemann2.wav path/to/score.midi [--ref 415]
 *
 * Both sides become chromatic indices and are aligned by ORDER, never by
 * time -- a player's rubato is theirs, and the question here is only whether
 * the right notes were heard. The alignment is the scale recogniser's own
 * (core/scales.js alignToTemplate), which already knows that a semitone off
 * is a wrong note and a fifth off is a different one. */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyse } from "./wavpipe.js";
import { readScore } from "./midi.js";
import { alignToTemplate } from "../core/scales.js";

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
const name = (chroma) => `${NAMES[chroma % 12]}${Math.floor(chroma / 12)}`;

export function compareToScore(wav, midi, { referenceHz = 415 } = {}) {
  const heard = analyse(wav, { referenceHz });
  const observed = heard.notes.map((n) => n.pitch.chromaticIndex);
  const expected = readScore(midi).map((n) => n.chroma);
  const fit = alignToTemplate(observed, expected);
  return { heard, observed, expected, fit };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [wav, midi, ...rest] = process.argv.slice(2);
  const refIdx = rest.indexOf("--ref");
  const referenceHz = refIdx >= 0 ? Number(rest[refIdx + 1]) : 415;
  const { heard, observed, expected, fit } = compareToScore(wav, midi, { referenceHz });

  console.log(`${path.basename(wav)} against ${path.basename(midi)}  (A = ${referenceHz})`);
  console.log(`  regions ${heard.regions.length}: ${Object.entries(heard.counts).map(([k, v]) => `${k} ${v}`).join("  ")}`);
  console.log(`  score ${expected.length} notes, heard ${observed.length} notes`);
  console.log(`  matched ${fit.matched}  wrong ${fit.wrong}  missing ${fit.missing}  extra ${fit.extra}  repeats ${fit.repeats}`);
  console.log(`  recall ${(100 * fit.matched / expected.length).toFixed(0)}% of the score's notes were heard where written`);
  console.log();

  // Every divergence, in score order, with a little context.
  for (const op of fit.ops) {
    if (op.op === "match") continue;
    const at = op.template !== undefined ? `score #${String(op.template + 1).padStart(3)}` : "score  ---";
    const want = op.template !== undefined ? name(expected[op.template]) : "";
    const got = op.observed !== undefined ? name(observed[op.observed]) : "";
    const when = op.observed !== undefined ? `${heard.notes[op.observed].atSeconds.toFixed(1)}s` : "";
    const line = { wrong: `WRONG    wanted ${want.padEnd(4)} heard ${got}`,
                   missing: `MISSING  wanted ${want}`,
                   extra: `EXTRA    heard ${got}`,
                   repeat: `repeat   ${got}` }[op.op];
    console.log(`  ${at}  ${when.padStart(6)}  ${line}`);
  }
}
