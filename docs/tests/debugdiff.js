/* Compare debug records of the same playing, heard by different devices.
 *
 *   node docs/tests/debugdiff.js a.json b.json [c.json ...]
 *
 * Each record is what Listen to me's "Send debug record" writes (docs/debug.js):
 * every frame, every region and its classification, the audio path. The
 * devices were started by hand, so their clocks disagree by seconds; the
 * records are lined up by their pitch tracks first -- the lag at which the
 * two agree best -- and then each region on one is paired with the region it
 * overlaps on the other.
 *
 * What it prints is the disagreements, each with the likeliest reason: a
 * note one device never closed, a region classified differently (short,
 * slur, trill) and how near it was to that rule's line, a different name for
 * a pitch near the boundary between two, and frames a device never received.
 * Agreement on pitch is summarised in a line; the point is the differences.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TRILL_MAX_NOTE_SECONDS } from "../audio/regions.js";

const BIN_S = 0.05;

export function loadRecord(file) {
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  if (record.kind !== "listen-debug") throw new Error(`${file}: not a Listen to me debug record`);
  return { ...record, file: path.basename(file) };
}

/* Voiced pitch per 50 ms bin, in cents from A = 415, on the record's own
 * clock (seconds from its first frame). */
export function track(record) {
  const bins = new Map();
  const { t_ms: t, hz } = record.frames;
  for (let i = 0; i < t.length; i++) {
    if (!(hz[i] > 0)) continue;
    const bin = Math.round(t[i] / 1000 / BIN_S);
    const cents = 1200 * Math.log2(hz[i] / 415);
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin).push(cents);
  }
  const out = new Map();
  for (const [bin, xs] of bins) { xs.sort((p, q) => p - q); out.set(bin, xs[xs.length >> 1]); }
  return out;
}

/* The lag, in seconds, to add to b's clock to land on a's: the one at which
 * the most bins voiced on both agree within a semitone. Ties go to the
 * smallest mean difference. */
export function align(a, b, { maxLagS = 60 } = {}) {
  const ta = track(a), tb = track(b);
  let best = null;
  const maxLag = Math.round(maxLagS / BIN_S);
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let agree = 0, both = 0, sum = 0;
    for (const [bin, cb] of tb) {
      const ca = ta.get(bin + lag);
      if (ca === undefined) continue;
      both += 1;
      const d = Math.abs(ca - cb);
      if (d <= 100) { agree += 1; sum += d; }
    }
    if (!both) continue;
    const score = { lag, agree, both, mean: agree ? sum / agree : Infinity };
    if (!best || agree > best.agree || (agree === best.agree && score.mean < best.mean)) best = score;
  }
  if (!best || best.agree < 10) return null;
  return { lagS: best.lag * BIN_S, agreedBins: best.agree, sharedBins: best.both, meanCents: best.mean };
}

/* Each region's start and end on its record's own clock. */
function placed(record) {
  const start = (record.tracker_start_ms ?? 0) / 1000;
  return record.regions.map((g, i) => ({ ...g, i, from: start + g.at_s, to: start + g.at_s + g.seconds }));
}

/* Pairs regions by overlap once b is shifted by `lagS`. A region is paired
 * with the one it overlaps most, if that covers at least `minShare` of the
 * shorter of the two. */
export function pairRegions(a, b, lagS, { minShare = 0.3 } = {}) {
  const ra = placed(a), rb = placed(b).map((g) => ({ ...g, from: g.from + lagS, to: g.to + lagS }));
  const used = new Set();
  const pairs = [];
  for (const ga of ra) {
    let best = null;
    for (const gb of rb) {
      if (used.has(gb.i)) continue;
      const overlap = Math.min(ga.to, gb.to) - Math.max(ga.from, gb.from);
      const share = overlap / Math.min(ga.seconds, gb.seconds);
      if (share >= minShare && (!best || share > best.share)) best = { gb, share };
    }
    if (best) used.add(best.gb.i);
    pairs.push({ a: ga, b: best ? best.gb : null });
  }
  for (const gb of rb) if (!used.has(gb.i)) pairs.push({ a: null, b: gb });
  return pairs.sort((p, q) => (p.a ?? p.b).from - (q.a ?? q.b).from);
}

/* Why a pair might disagree, in words. */
export function reason(p) {
  const { a, b } = p;
  if (!a || !b) {
    const g = a ?? b;
    return `only one device closed a region here (${g.seconds.toFixed(2)} s, ${g.kind}) -- `
         + "the other merged it into a neighbour, or never heard it start";
  }
  const why = [];
  if (a.kind !== b.kind) {
    const kinds = new Set([a.kind, b.kind]);
    if (kinds.has("trill-run")) {
      const longest = Math.max(a.seconds, b.seconds);
      why.push(`one device counted it in a trill run: notes of ${a.seconds.toFixed(2)} / ${b.seconds.toFixed(2)} s `
             + `against the ${TRILL_MAX_NOTE_SECONDS} s limit${Math.abs(longest - TRILL_MAX_NOTE_SECONDS) < 0.1 ? " -- right on the line" : ""}`);
    } else if (kinds.has("short")) {
      why.push(`too short on one device: ${a.seconds.toFixed(2)} / ${b.seconds.toFixed(2)} s`);
    } else if (kinds.has("slur")) {
      why.push("a slur (pitch still moving) on one device, a note on the other");
    } else {
      why.push(`${a.kind} / ${b.kind}`);
    }
  }
  if (a.note && b.note && a.note.pitch !== b.note.pitch) {
    const edge = Math.max(Math.abs(a.note.tempered_cents ?? 0), Math.abs(b.note.tempered_cents ?? 0));
    why.push(`named ${a.note.pitch} / ${b.note.pitch}${edge > 40 ? ` -- ${edge.toFixed(0)} cents out, near the boundary between the two names` : ""}`);
  }
  if (Math.abs(a.seconds - b.seconds) > 0.25) why.push(`lengths ${a.seconds.toFixed(2)} / ${b.seconds.toFixed(2)} s: one device split or joined it`);
  return why.join("; ");
}

const label = (g) => (!g ? "—" : g.note ? `${g.note.pitch} ${g.note.cents >= 0 ? "+" : ""}${g.note.cents}¢` : g.kind);

export function compare(a, b) {
  const lines = [];
  const lag = align(a, b);
  lines.push(`${a.file} (${a.device?.name}, input ${a.device?.input_rate ?? "?"} Hz, analysed ${a.device?.context_rate} Hz)`);
  lines.push(`${b.file} (${b.device?.name}, input ${b.device?.input_rate ?? "?"} Hz, analysed ${b.device?.context_rate} Hz)`);
  for (const r of [a, b]) {
    if (r.drops?.count) lines.push(`  ${r.device?.name}: ${r.drops.count} gaps in the frame clock, longest ${r.drops.longestMs} ms -- frames never received`);
  }
  if (!lag) { lines.push("  could not line the two up: are they the same playing?"); return lines; }
  lines.push(`  lined up with ${b.device?.name} ${lag.lagS >= 0 ? "+" : ""}${lag.lagS.toFixed(2)} s; `
           + `${lag.agreedBins} of ${lag.sharedBins} shared moments agree, mean pitch difference ${lag.meanCents.toFixed(2)}¢`);
  const pairs = pairRegions(a, b, lag.lagS);
  let same = 0;
  const pitchDiffs = [];
  for (const p of pairs) {
    if (p.a && p.b && p.a.kind === p.b.kind && (!p.a.note || p.a.note.pitch === p.b.note?.pitch)) {
      same += 1;
      if (p.a.note && p.b.note) pitchDiffs.push(Math.abs(p.a.note.cents - p.b.note.cents));
      continue;
    }
    const at = (p.a ?? p.b).from;
    lines.push(`  ${at.toFixed(1).padStart(6)} s  ${label(p.a).padEnd(16)} ${label(p.b).padEnd(16)} ${reason(p)}`);
  }
  pitchDiffs.sort((p, q) => p - q);
  const median = pitchDiffs.length ? pitchDiffs[pitchDiffs.length >> 1] : null;
  lines.push(`  ${same} of ${pairs.length} regions agree on kind and name`
           + (median !== null ? `; on those notes the readings differ by a median ${median.toFixed(2)}¢, `
             + `worst ${pitchDiffs.at(-1).toFixed(2)}¢` : ""));
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (files.length < 2) {
    console.error("usage: node docs/tests/debugdiff.js a.json b.json [c.json ...]");
    process.exit(1);
  }
  const records = files.map(loadRecord);
  for (const other of records.slice(1)) {
    console.log(compare(records[0], other).join("\n"));
    console.log("");
  }
}
