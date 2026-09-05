/* Ported from test_core.py (generator, resolver, scoring) and test_audio.py
 * (segmenter, onset guard). Same tolerances; no `===` on Hz or cents. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpelledPitch, centsBetween } from "../core/pitch.js";
import { BAROQUE_415, HarmonicContext, TemperamentTuning, parseScala } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";
import { Mode, TargetNote, TargetResolver } from "../core/resolver.js";
import * as generator from "../core/generator.js";
const { scale, arpeggio, intervalDrill, intervalInContext, enharmonicPair, stopperCheck } = generator;
const await_import_generator = () => generator;
import { NoteResult, SessionSummary, analyseNote, judgeDirection, octavePairs } from "../core/scoring.js";
import { NoteSegmenter, State, onsetThresholdFor } from "../audio/segmenter.js";
import * as runModule from "../views/run.js";

const P = (s) => SpelledPitch.parse(s);
/* views/run.js pulls in the audio engine, so it is imported lazily and
 * only by the tests that need the exercise registry. */
const run_exercises = () => runModule;
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

/* ---- endless random scale notes -------------------------------------- */

test("scale pools are spelled by the key: D minor has Bb, C minor has Eb Ab Bb", () => {
  const { scalePool, scaleKeyFor } = await_import_generator();
  assert.equal(scaleKeyFor("D", "major"), "D");
  assert.equal(scaleKeyFor("D", "minor"), "F");
  assert.deepEqual(scalePool("D", "major").map((p) => p.name), ["D4", "E4", "F#4", "G4", "A4", "B4", "C#5", "D5"]);
  assert.deepEqual(scalePool("D", "minor").map((p) => p.name), ["D4", "E4", "F4", "G4", "A4", "Bb4", "C5", "D5"]);
  // C4 sits below the flute's range, so the scale starts an octave up, as in Python.
  assert.deepEqual(scalePool("C", "minor").map((p) => p.name), ["C5", "D5", "Eb5", "F5", "G5", "Ab5", "Bb5", "C6"]);
});

test("pickDifferent stays in the pool and never repeats the previous note", () => {
  const { scalePool, pickDifferent } = await_import_generator();
  const pool = scalePool("D", "major");
  let seed = 1;
  const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
  let previous = null;
  for (let i = 0; i < 200; i++) {
    const next = pickDifferent(pool, previous, rng);
    assert.ok(pool.some((p) => p.equals(next)), "in the pool");
    if (previous) assert.ok(!next.equals(previous), "no immediate repeat");
    previous = next;
  }
});

/* ---- the stopper check, drawn ---------------------------------------- */

import { octaveBarGeometry, BAR_SPAN_CENTS, BAR_TRUE_CENTS } from "../core/scoring.js";

test("a true octave sits at the centre of its track", () => {
  const g = octaveBarGeometry(0);
  approx(g.percent, 50, 1e-9, "dead centre");
  assert.equal(g.beyond, false);
});

test("wide goes right, narrow goes left, symmetrically", () => {
  // The direction has to be unambiguous: it is what tells the player which way
  // to move the stopper, and the two mistakes are mirror images of each other.
  const wide = octaveBarGeometry(20);
  const narrow = octaveBarGeometry(-20);
  assert.ok(wide.percent > 50, `wide at ${wide.percent}%`);
  assert.ok(narrow.percent < 50, `narrow at ${narrow.percent}%`);
  approx(wide.percent - 50, 50 - narrow.percent, 1e-9, "mirrored about true");
  approx(wide.percent, 75, 1e-9, "half the half-span is a quarter of the track");
});

test("the ends of the scale are the ends of the track", () => {
  approx(octaveBarGeometry(BAR_SPAN_CENTS).percent, 100, 1e-9);
  approx(octaveBarGeometry(-BAR_SPAN_CENTS).percent, 0, 1e-9);
  assert.equal(octaveBarGeometry(BAR_SPAN_CENTS).beyond, false, "exactly at the end is not beyond it");
});

test("beyond the scale is pinned and flagged, never drawn as a near miss", () => {
  // The figure is always shown next to the mark, but the mark must not be able
  // to imply a smaller error than there is.
  for (const width of [BAR_SPAN_CENTS + 0.1, 90, 400]) {
    const g = octaveBarGeometry(width);
    assert.equal(g.beyond, true, `${width} cents is off the scale`);
    approx(g.percent, 100, 1e-9, "pinned to the end");
    approx(g.clamped, BAR_SPAN_CENTS, 1e-9);
  }
  const narrow = octaveBarGeometry(-120);
  assert.equal(narrow.beyond, true);
  approx(narrow.percent, 0, 1e-9);
});

test("the scale is fixed, so two runs can be compared by eye", () => {
  // Not a tautology: fitting the scale to the data is the obvious thing to do
  // and would silently break the one comparison this tool exists to support --
  // did the last move of the stopper help?
  const before = [30, -12, 18, -25].map((c) => octaveBarGeometry(c).percent);
  const after = [6, -3, 4, -5].map((c) => octaveBarGeometry(c).percent);
  const spread = (xs) => Math.max(...xs) - Math.min(...xs);
  assert.ok(spread(after) < spread(before) / 2,
    `an improved run must visibly draw tighter: ${spread(before).toFixed(1)} -> ${spread(after).toFixed(1)}`);
});

test("the shaded centre zone is inside the scale and worth having", () => {
  assert.ok(BAR_TRUE_CENTS > 0 && BAR_TRUE_CENTS < BAR_SPAN_CENTS);
  const g = octaveBarGeometry(BAR_TRUE_CENTS);
  assert.ok(g.percent > 50 && g.percent < 60, `five cents is a small nudge: ${g.percent}%`);
});

/* ---- the sharp keys the guided scales sequence needs ------------------- */

test("E and B major are spelled, so the guided sequence can reach them", () => {
  // The palette stopped at A (three sharps), so a sequence running D G A E
  // died at its third step. E needs D#, B needs A# as well -- and both must
  // be spelled by walking letters through the signature, never by adding
  // semitones, or E major comes out with an Eb in it.
  const { scalePool } = await_import_generator();
  assert.deepEqual(scalePool("E", "major").map((p) => p.name),
    ["E4", "F#4", "G#4", "A4", "B4", "C#5", "D#5", "E5"]);
  assert.deepEqual(scalePool("B", "major").map((p) => p.name),
    ["B4", "C#5", "D#5", "E5", "F#5", "G#5", "A#5", "B5"]);
});

test("every key signature spells a major scale with each letter once", () => {
  // A signature that alters the same letter twice, or reaches for one the
  // scale does not use, spells something that is not a major scale.
  //
  // Note the pairing: KEY_SIGNATURES is keyed by *signature name*, and a flat
  // key's name is not a letter -- Bb major is tonic "B" under key "Bb". They
  // are separate arguments, and scale() throws if the name is passed as the
  // tonic. The guided scales sequence therefore has to carry both.
  const { KEY_SIGNATURES, scale } = await_import_generator();
  for (const key of Object.keys(KEY_SIGNATURES)) {
    const tonic = key[0];
    const notes = scale(tonic, { key, octaves: 1, descending: false }).notes;
    const letters = notes.slice(0, 7).map((n) => n.pitch.letter);
    assert.equal(new Set(letters).size, 7, `${key} major reuses a letter: ${letters.join("")}`);
    assert.equal(notes[0].pitch.letter, tonic, `${key} major should start on ${tonic}`);
    assert.equal(notes.length, 8, `${key} major should have eight notes`);
  }
});

test("two octaves does not fit every key, and the short ones are known", () => {
  // B, C and Bb run off the top: their second octave lies above A6. scale()
  // truncates silently through inRange rather than refusing, so the caller
  // gets a short scale and no complaint. This pins exactly which keys are
  // affected, so the guided sequence can ask for one octave in those three.
  const { scale } = await_import_generator();
  const ascending = (tonic, key) =>
    scale(tonic, { key, octaves: 2, descending: false }).notes.length;

  for (const [tonic, key] of [["D", "D"], ["G", "G"], ["A", "A"], ["E", "E"],
                              ["F", "F"], ["E", "Eb"], ["A", "Ab"]]) {
    assert.equal(ascending(tonic, key), 15, `${key} major should fit two octaves`);
  }
  for (const [tonic, key, got] of [["B", "B", 13], ["C", "C", 13], ["B", "Bb", 14]]) {
    assert.equal(ascending(tonic, key), got,
      `${key} major cannot reach two octaves within D4-A6, and is truncated to ${got}`);
  }
});

test("every drone exercise takes its note length from one setting", () => {
  // Ear training rather than reflex training: a longer note is more time to
  // hear what two pitches do together. They are all the same activity, so a
  // player who wants longer wants longer everywhere -- one setting, not five.
  const { EXERCISES } = run_exercises();
  for (const [key, spec] of Object.entries(EXERCISES)) {
    if (!spec.build) continue;                       // runs on its own page
    for (const seconds of [4, 6, 12]) {
      const built = spec.build("D", "major", spec.keys ? spec.keys[0] : null, { seconds });
      for (const exercise of (Array.isArray(built) ? built : [built])) {
        for (const note of exercise.notes) {
          assert.ok(Math.abs(exercise.durationSeconds(note) - seconds) < 1e-9,
            `${key}: asked for ${seconds}s, got ${exercise.durationSeconds(note)}s`);
        }
      }
    }
  }
});

test("an exercise built with no options still works", () => {
  // Defensive on purpose: a caller that forgets the options bag should fall
  // back to the generator's own default rather than throw on undefined.
  const { EXERCISES } = run_exercises();
  for (const [key, spec] of Object.entries(EXERCISES)) {
    if (!spec.build) continue;
    assert.doesNotThrow(() => spec.build("D", "major", spec.keys ? spec.keys[0] : null),
      `${key} threw without options`);
  }
});

test("an endless exercise keeps the length it started with", () => {
  // Otherwise it changes pace mid-run, which for an ear-training drill is
  // worse than being slow.
  const { EXERCISES } = run_exercises();
  const spec = EXERCISES.predictRandom;
  const first = spec.build("D", "major", null, { seconds: 10 });
  const run = { notes: [first.notes[0]], tonic: "D", quality: "major" };
  const next = spec.nextNote(run);
  assert.equal(next.beats, first.notes[0].beats, "the second note lasts as long as the first");
});
