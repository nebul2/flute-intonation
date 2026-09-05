/* Run the web pipeline over a recorded WAV, headlessly.
 *
 * The detector and the region tracker are the ones the app ships; this only
 * feeds them a file instead of a microphone and classifies each region the
 * way views/listen.js does. That way a real recording can be used to check
 * the segmenter -- the project's standing lesson is that synthetic tones
 * repeatedly failed to reveal what real audio found in minutes, and the
 * trill and slur rules were both reasoned out from simulation.
 *
 * Run it directly for a report:
 *   node docs/tests/wavpipe.js recordings/trills.wav
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Detector } from "../audio/yin.js";
import { RegionTracker, driftCents, isOscillating, alternationRuns, GLIDE_CENTS } from "../audio/regions.js";
import { postAttack } from "../core/scoring.js";
import { tunerCandidates, nearestCandidate } from "../core/naming.js";
import { SpelledPitch } from "../core/pitch.js";
import { parseScala, TemperamentTuning, ReferencePitch } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";

/* Minimal RIFF reader: 16-, 24- and 32-bit integer PCM and 32-bit float,
 * any channel count (mixed down). Enough for what tools/record.py writes. */
export function readWav(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${file}: not a WAV file`);
  }
  let offset = 12, fmt = null, data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        format: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = buffer.subarray(body, body + size);
    }
    offset = body + size + (size % 2);          // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error(`${file}: missing fmt or data chunk`);

  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytes * fmt.channels));
  const samples = new Float32Array(frames);
  const isFloat = fmt.format === 3;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const at = (i * fmt.channels + c) * bytes;
      if (isFloat) sum += data.readFloatLE(at);
      else if (bytes === 2) sum += data.readInt16LE(at) / 32768;
      else if (bytes === 3) sum += ((data[at] | (data[at + 1] << 8) | (data[at + 2] << 24 >> 8)) << 8 >> 8) / 8388608;
      else sum += data.readInt32LE(at) / 2147483648;
    }
    samples[i] = sum / fmt.channels;
  }
  return { samples, sampleRate: fmt.sampleRate };
}

/* Feed a file through detector and tracker, classifying every region exactly
 * as views/listen.js does: too short, a trill, a slur, or a measured note. */
export function analyse(file, { hop = 512, referenceHz = 415, temperament = "vallotti", root = "C" } = {}) {
  const { samples, sampleRate } = readWav(file);
  // Naming needs a tuning, and the pipeline has to state which one rather
  // than inherit a browser's settings. The reference matters: at 415 a
  // recording of this flute names its notes as the player would.
  const tuning = new TemperamentTuning(
    parseScala(TEMPERAMENTS[temperament].scl),
    SpelledPitch.parse(`${root}4`),
    new ReferencePitch(SpelledPitch.parse("A4"), referenceHz),
  );
  const candidates = tunerCandidates(tuning);
  const detector = new Detector(sampleRate);
  const frameSeconds = hop / sampleRate;
  const tracker = new RegionTracker({ frameSeconds });

  const regions = [];
  const take = (region) => { if (region) regions.push(region); };
  for (let at = 0; at + hop <= samples.length; at += hop) {
    const frame = detector.process(samples.subarray(at, at + hop));
    take(tracker.push({ hz: frame.hz, levelDb: frame.levelDb }));
  }
  take(tracker.flush());

  // Ornaments are runs, not single regions, so they are marked over the
  // whole file exactly as views/listen.js marks them over a session.
  const ornament = new Set();
  const runs = alternationRuns(regions);
  for (const { start, end } of runs) for (let i = start; i < end; i++) ornament.add(i);

  const classified = regions.map((region, index) => {
    const [framesHz] = postAttack(region.framesHz, frameSeconds);
    const drift = driftCents(framesHz);
    let kind = "note";
    if (ornament.has(index)) kind = "trill";
    else if (region.short) kind = "short";
    else if (isOscillating(region)) kind = "trill";
    else if (Math.abs(drift) >= GLIDE_CENTS) kind = "slur";
    // The note as views/listen.js would have scored it, so anything that
    // works on named notes can be run over a real recording.
    const ordered = [...framesHz].sort((a, b) => a - b);
    const medianHz = ordered.length ? ordered[ordered.length >> 1] : region.medianHz;
    const near = nearestCandidate(candidates, medianHz);
    return {
      kind,
      pitch: near.pitch,
      cents: near.cents,
      // Carried through so anything that measures a note -- not merely names
      // it -- can be run over a real recording too.
      framesHz,
      levelsDb: region.levelsDb,
      atSeconds: region.startIndex * frameSeconds,
      seconds: region.seconds,
      medianHz: region.medianHz,
      blips: region.blips,
      blipShare: region.blips / (region.blips + region.framesHz.length),
      drift,
      frames: region.framesHz.length,
    };
  });

  const counts = classified.reduce((tally, r) => ({ ...tally, [r.kind]: (tally[r.kind] ?? 0) + 1 }), {});
  // What views/listen.js would have kept: the notes, in order, nothing else.
  // Feed this to anything that reasons about melody -- never `regions`, which
  // still holds the trills, and a trill alternating by a semitone or two is
  // exactly the shape a stepwise matcher reads as a scale.
  const notes = classified
    .filter((r) => r.kind === "note")
    .map((r, index) => ({ ...r, index }));
  return { file: path.basename(file), sampleRate, seconds: samples.length / sampleRate,
           regions: classified, notes, counts, trillRuns: runs.length };
}

/* CLI */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("usage: node docs/tests/wavpipe.js <file.wav> [...]");
    process.exit(2);
  }
  for (const file of files) {
    const report = analyse(file);
    console.log(`\n${report.file}  ${report.seconds.toFixed(1)}s  ${report.sampleRate} Hz`);
    console.log("  " + Object.entries(report.counts).map(([k, n]) => `${k} ${n}`).join("   "));
    for (const r of report.regions) {
      if (r.kind === "short") continue;
      console.log(`    ${r.atSeconds.toFixed(2).padStart(6)}s  ${r.seconds.toFixed(2)}s  `
        + `${r.medianHz.toFixed(1).padStart(7)} Hz  ${r.kind.padEnd(5)}  `
        + `blips ${String(r.blips).padStart(3)} (${(r.blipShare * 100).toFixed(0).padStart(2)}%)  `
        + `drift ${r.drift.toFixed(0).padStart(5)}c`);
    }
  }
}
