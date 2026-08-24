/* Ported from test_core.py (generator, resolver, scoring) and test_audio.py
 * (segmenter, onset guard). Same tolerances; no `===` on Hz or cents. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpelledPitch, centsBetween } from "../core/pitch.js";
import { BAROQUE_415, HarmonicContext, TemperamentTuning, parseScala } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";
import { Mode, TargetNote, TargetResolver } from "../core/resolver.js";
import { scale, arpeggio, intervalDrill, intervalInContext, enharmonicPair, stopperCheck } from "../core/generator.js";
import { NoteResult, SessionSummary, analyseNote, judgeDirection, octavePairs } from "../core/scoring.js";
import { NoteSegmenter, State, onsetThresholdFor } from "../audio/segmenter.js";

const P = (s) => SpelledPitch.parse(s);
const approx = (got, want, abs, label = "") =>
  assert.ok(Math.abs(got - want) <= abs, `${label} expected ${want} ± ${abs}, got ${got}`);
const vallotti = (root = "C") =>
  new TemperamentTuning(parseScala(TEMPERAMENTS.vallotti.scl), P(`${root}4`), BAROQUE_415);

/* ---- generator ------------------------------------------------------- */

test("D major scale is spelled with F# and C#, every note over the D drone", () => {
  const ex = scale("D");
  const names = ex.notes.map((n) => n.pitch.name);
  assert.deepEqual(names.slice(0, 8), ["D4", "E4", "F#4", "G4", "A4", "B4", "C#5", "D5"]);
  assert.equal(names.length, 15);                       // up and down
  assert.ok(ex.notes.every((n) => n.context && n.context.bass.equals(P("D4"))));
  assert.ok(ex.drone.equals(P("D4")));
});

test("F major scale uses Bb, not A#", () => {
  const names = scale("F").notes.map((n) => n.pitch.name);
  assert.ok(names.includes("Bb4"));
  assert.ok(!names.includes("A#4"));
});

test("arpeggio is the triad up and back", () => {
  const names = arpeggio("D").notes.map((n) => n.pitch.name);
  assert.deepEqual(names, ["D4", "F#4", "A4", "D5", "A4", "F#4", "D4"]);
});

test("interval drill: diatonic steps above the bass", () => {
  const names = intervalDrill("D", { intervals: [0, 4, 7] }).notes.map((n) => n.pitch.name);
  assert.deepEqual(names, ["D4", "A4", "D5"]);
});

test("interval in context pairs tempered with pure", () => {
  const ex = intervalInContext("D");
  assert.equal(ex.notes.length, 4);
  for (let i = 0; i < ex.notes.length; i += 2) {
    assert.ok(ex.notes[i].pitch.equals(ex.notes[i + 1].pitch));
    assert.equal(ex.notes[i].context, null);
    assert.ok(ex.notes[i + 1].context.bass.equals(ex.drone));
  }
  const resolver = new TargetResolver(Mode.PURE, vallotti());
  const tempered = resolver.resolve(ex.notes[0]);
  const pure = resolver.resolve(ex.notes[1]);
  approx(pure, vallotti().targetHz(ex.drone) * 1.25, 1e-9);
  const gap = centsBetween(tempered, pure);
  assert.ok(Math.abs(gap) > 5 && Math.abs(gap) < 30, `gap ${gap}`);
});

test("enharmonic pair: two notes, two targets, 5-60 cents apart", () => {
  const [dSharp, eFlat] = enharmonicPair();
  const t = vallotti();
  const resolver = new TargetResolver(Mode.PURE, t);
  assert.equal(dSharp.notes[0].pitch.name, "D#5");
  assert.equal(eFlat.notes[0].pitch.name, "Eb5");
  approx(resolver.resolve(dSharp.notes[0]), t.targetHz(dSharp.drone) * 5 / 2, 1e-9);
  approx(resolver.resolve(eFlat.notes[0]), t.targetHz(eFlat.drone) * 12 / 5, 1e-9);
  const diff = Math.abs(centsBetween(resolver.resolve(dSharp.notes[0]), resolver.resolve(eFlat.notes[0])));
  assert.ok(diff > 5 && diff < 60, `diff ${diff}`);
});

test("stopper check is the classical note set", () => {
  const ex = stopperCheck();
  assert.equal(ex.drone, null);
  assert.deepEqual(ex.notes.map((n) => n.pitch.name), ["D4", "D5", "D6", "G4", "G5", "G6"]);
});

test("stopper notes pair into four octaves, G5-G6 included", () => {
  const ex = stopperCheck();
  const results = ex.notes.map((n, i) => new NoteResult(n.pitch, 440 * Math.pow(2, i / 3), 0, 0, null, 1));
  const labels = octavePairs(results).map((p) => `${p.lower.pitch}->${p.upper.pitch}`);
  assert.deepEqual(labels, ["D4->D5", "D5->D6", "G4->G5", "G5->G6"]);
});

/* ---- resolver -------------------------------------------------------- */

test("resolver: pure mode falls back to the temperament without context", () => {
  const t = vallotti();
  const resolver = new TargetResolver(Mode.PURE, t);
  const note = new TargetNote(P("F#4"), 1, null);
  approx(resolver.resolve(note), t.targetHz(P("F#4")), 1e-9);
  const inContext = new TargetNote(P("F#4"), 1, new HarmonicContext(P("D4")));
  approx(resolver.resolve(inContext), t.targetHz(P("D4")) * 1.25, 1e-9);
  resolver.setMode(Mode.TEMPERAMENT);
  approx(resolver.resolve(inContext), t.targetHz(P("F#4")), 1e-9);
});

test("Exercise durations follow the tempo", () => {
  const ex = intervalDrill("D", { beats: 4, tempoBpm: 60 });
  approx(ex.durationSeconds(ex.notes[0]), 4.0, 1e-9);
  const fast = intervalDrill("D", { beats: 4, tempoBpm: 120 });
  approx(fast.durationSeconds(fast.notes[0]), 2.0, 1e-9);
});

/* ---- scoring --------------------------------------------------------- */

test("analyseNote skips the attack and reports mean and stdev", () => {
  const target = 415.0;
  const frameSeconds = 512 / 44100;
  const attack = new Array(5).fill(target * Math.pow(2, -40 / 1200));   // a scoop
  const body = new Array(40).fill(target * Math.pow(2, 6 / 1200));
  const r = analyseNote(P("A4"), target, [...attack, ...body], frameSeconds);
  approx(r.meanCents, 6.0, 0.05);
  approx(r.stdevCents, 0.0, 1e-6);
  assert.equal(r.frameCount, 40);
  assert.equal(analyseNote(P("A4"), target, [], frameSeconds), null);
});

test("judgeDirection matches the display bands", () => {
  assert.equal(judgeDirection(8), "sharp");
  assert.equal(judgeDirection(-8), "flat");
  assert.equal(judgeDirection(3), "in tune");
  assert.equal(judgeDirection(-4.9), "in tune");
  assert.equal(judgeDirection(5.1), "sharp");
});

test("octave pairs measure sounded width, not targets", () => {
  const results = (offset) => [
    new NoteResult(P("D4"), 277.29, 5.0 + offset, 0, null, 1),
    new NoteResult(P("D5"), 554.58, -3.0 + offset, 0, null, 1),
    new NoteResult(P("D6"), 1109.16, 1.0 + offset, 0, null, 1),
    new NoteResult(P("G4"), 370.00, 0.0 + offset, 0, null, 1),
    new NoteResult(P("G5"), 740.00, 6.5 + offset, 0, null, 1),
  ];
  for (const offset of [0, -30, 30]) {
    const pairs = octavePairs(results(offset));
    assert.deepEqual(pairs.map((p) => `${p.lower.pitch}->${p.upper.pitch}`), ["D4->D5", "D5->D6", "G4->G5"]);
    approx(pairs[0].width, -8.0, 0.01);
    approx(pairs[1].width, 4.0, 0.01);
    approx(pairs[2].width, 6.5, 0.01);
  }
  assert.deepEqual(octavePairs([new NoteResult(P("D4"), 277.29, 0, 0, null, 1),
                                new NoteResult(P("D#5"), 587.33, 0, 0, null, 1)]), []);
});

test("session summary round-trips through the saved schema", () => {
  const s = new SessionSummary();
  s.add(new NoteResult(P("F#4"), 348.58, 12.34, 3.2, 0.5, 40));
  s.add(new NoteResult(P("A4"), 415.0, -2.0, 1.0, null, 30));
  const d = s.toDict();
  assert.equal(d.v, 1);
  assert.equal(d.notes[0].pitch, "F#4");
  approx(d.mean_absolute_cents, 7.17, 0.01);
  approx(d.by_pitch_class["F#"], 12.34, 0.01);
  const back = SessionSummary.fromDict(d);
  assert.equal(back.results.length, 2);
  approx(back.results[0].meanCents, 12.34, 0.01);
});

/* ---- segmenter ------------------------------------------------------- */

const seg = (opts) => new NoteSegmenter({ targetHz: 415.0, frameSeconds: 0.0116, requiredSeconds: 0.5, ...opts });

test("segmenter completes after the required duration", () => {
  const s = seg({ requiredSeconds: 0.2 });
  for (let i = 0; i < 30; i++) s.push(415.0);
  assert.equal(s.state, State.DONE);
});

test("segmenter ignores frames far from the target", () => {
  const s = seg();
  for (let i = 0; i < 100; i++) s.push(311.13);
  assert.equal(s.state, State.WAITING);
  assert.equal(s.framesHz.length, 0);
});

test("a release alone does not complete a note", () => {
  const s = seg({ requiredSeconds: 5.0 });
  for (let i = 0; i < 20; i++) s.push(415.0);
  for (let i = 0; i < 6; i++) s.push(0.0);
  assert.equal(s.state, State.WAITING);
});

test("a breath mid-note keeps the progress before it", () => {
  const s = seg({ requiredSeconds: 1.0 });
  for (let i = 0; i < 40; i++) s.push(415.0);
  const collected = s.framesHz.length;
  for (let i = 0; i < 10; i++) s.push(0.0);
  assert.equal(s.state, State.WAITING);
  assert.equal(s.framesHz.length, collected);
  for (let i = 0; i < 60; i++) s.push(415.0);
  assert.equal(s.state, State.DONE);
});

test("wandering onto another note discards the fragment", () => {
  const s = seg({ requiredSeconds: 1.0 });
  for (let i = 0; i < 40; i++) s.push(415.0);
  for (let i = 0; i < 10; i++) s.push(311.13);
  assert.equal(s.state, State.WAITING);
  assert.equal(s.framesHz.length, 0);
});

test("onset level check rejects bleed at the unison but lets a decay through", () => {
  const s = seg({ targetHz: 277.29, onsetDb: -30.0 });
  for (let i = 0; i < 200; i++) s.push(277.29, -45.0);     // dead on pitch, bleed-loud
  assert.equal(s.state, State.WAITING);
  for (let i = 0; i < 200; i++) s.push(277.29, -18.0);     // the player joins
  assert.equal(s.state, State.DONE);

  const d = seg({ targetHz: 554.37, requiredSeconds: 1.0, onsetDb: -30.0 });
  for (let i = 0; i < 10; i++) d.push(554.37, -15.0);
  assert.equal(d.state, State.SOUNDING);
  for (let i = 0; i < 200; i++) d.push(554.37, -55.0);     // diminuendo
  assert.equal(d.state, State.DONE);
});

test("onset check applies only where pitch cannot separate the drone", () => {
  const drone = 277.29;
  assert.equal(onsetThresholdFor(drone, drone, -30.0), -30.0);
  for (const target of [346.62, 415.94]) assert.equal(onsetThresholdFor(target, drone, -30.0), null);
  assert.equal(onsetThresholdFor(drone * Math.pow(2, 70 / 1200), drone, -30.0), -30.0);
  assert.equal(onsetThresholdFor(drone * Math.pow(2, 90 / 1200), drone, -30.0), null);
  assert.equal(onsetThresholdFor(drone, null, -30.0), null);
  assert.equal(onsetThresholdFor(drone, drone, null), null);
});
