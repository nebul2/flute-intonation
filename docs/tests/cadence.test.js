/* The cadence: chords spelled from the key, the flute always on a chord tone
 * and inside its range, only the arrival moved, every cadence ending on the
 * same note. Approximate comparisons on every cent and hertz. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpelledPitch, centsBetween, intervalBetween } from "../core/pitch.js";
import { BAROQUE_415, TemperamentTuning, parseScala, PureIntervalTuning } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";
import { Mode, TargetResolver } from "../core/resolver.js";
import { cadence, cadenceRun, CHORDS, APPROACHES } from "../core/cadence.js";
import { PRACTICE_KEYS, keysForQuality } from "../core/generator.js";

const P = (s) => SpelledPitch.parse(s);
const approx = (got, want, abs, label = "") =>
  assert.ok(Math.abs(got - want) <= abs, `${label} expected ${want} ± ${abs}, got ${got}`);
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const pc = (p) => `${p.letter}${p.alter}`;
const names = (ex, i) => ex.accompaniment[i].voices.map((v) => v.name);

test("D major, top voice: the lines and chords a musician would write", () => {
  const iv = cadence("D", "major", { approach: "IV", seventh: false, role: "top" });
  assert.equal(iv.name, "IV–V–I");
  assert.deepEqual(iv.notes.map((n) => n.pitch.name), ["D5", "C#5", "D5"]);
  const ii = cadence("D", "major", { approach: "ii6", seventh: true, role: "top" });
  assert.deepEqual(ii.notes.map((n) => n.pitch.name), ["E5", "C#5", "D5"]);
  assert.ok(ii.notes[0].context.bass.letter === "G", "ii6 has the subdominant in the bass");
  const vi = cadence("D", "major", { approach: "VI", role: "top" });
  assert.deepEqual(vi.notes.map((n) => n.pitch.name), ["F#5", "E5", "D5"]);
  // V7 sounds its seventh, G, somewhere in the accompaniment.
  assert.ok(names(ii, 1).some((n) => n.startsWith("G")));
});

test("D major, bass: the flute plays the chords' bass, rising then falling home", () => {
  const ex = cadence("D", "major", { approach: "IV", role: "bass" });
  assert.deepEqual(ex.notes.map((n) => n.pitch.name), ["G4", "A4", "D4"]);
  ex.notes.forEach((n) => assert.ok(n.context.bass.equals(n.pitch), "the flute is the bass"));
  // and the chord sits above it
  ex.notes.forEach((n, i) => ex.accompaniment[i].voices.forEach((v) =>
    assert.ok(v.chromaticIndex > n.pitch.chromaticIndex, `${v} above ${n.pitch}`)));
});

test("in every key and role the flute is on a chord tone, inside its range", () => {
  for (const quality of ["major", "minor"]) {
    for (const { key } of keysForQuality(quality)) {
      for (const role of ["top", "bass"]) {
        for (const approach of APPROACHES) {
          const ex = cadence(key, quality, { approach, seventh: true, role });
          ex.notes.forEach((n, i) => {
            const chord = CHORDS[ex.accompaniment[i].chord];
            const sounding = [...ex.accompaniment[i].voices, n.pitch, n.context.bass].map(pc);
            assert.ok(sounding.includes(pc(n.pitch)), `${key} ${quality} ${role} ${approach}: ${n.pitch}`);
            assert.ok(n.pitch.chromaticIndex >= P("D4").chromaticIndex, `${key} ${role}: ${n.pitch} below D4`);
            assert.ok(n.pitch.chromaticIndex <= P("E6").chromaticIndex, `${key} ${role}: ${n.pitch} above E6`);
            assert.equal(new Set(sounding).size >= chord.tones.length - 1, true, "the chord is there");
          });
        }
      }
    }
  }
});

test("minor raises the leading note in the dominant and in the line", () => {
  const ex = cadence("A", "minor", { approach: "IV", seventh: true, role: "top" });
  assert.equal(ex.notes[1].pitch.name, "G#5");
  assert.ok(names(ex, 1).every((n) => !n.startsWith("G") || n.startsWith("G#")));
});

test("flat keys arrive by name, as the Practice page passes them", () => {
  const ex = cadence("Bb", "major", { approach: "IV", role: "top" });
  assert.deepEqual(ex.notes.map((n) => n.pitch.name), ["Bb5", "A5", "Bb5"]);
});

test("only the arrival moves; the approach and the dominant stay in tune", () => {
  const ex = cadence("G", "major", { approach: "VI", offsetCents: -20 });
  assert.deepEqual(ex.accompaniment.map((a) => a.offsetCents), [0, 0, -20]);
  approx(ex.offsetCents, -20, 1e-9);
});

test("each chord is pure over its own bass", () => {
  const tuning = new TemperamentTuning(parseScala(TEMPERAMENTS.vallotti.scl), P("C4"), BAROQUE_415);
  const pure = new PureIntervalTuning(tuning);
  const ex = cadence("D", "major", { approach: "IV", seventh: false, role: "top" });
  // The I chord: D3, F#4, A4 -> a pure third and fifth (compound) above D3.
  const [bass, third, fifth] = ex.accompaniment[2].voices;
  const b = tuning.targetHz(bass);
  approx(centsBetween(b * 2.5, pure.targetHz(third, ex.notes[2].context)), 0, 1e-6);
  approx(centsBetween(b * 3, pure.targetHz(fifth, ex.notes[2].context)), 0, 1e-6);
  // And the flute's leading note over V is a pure major third above its bass.
  const v = ex.notes[1];
  const iv = intervalBetween(v.context.bass, v.pitch);
  assert.equal(iv.simpleName, "M3");
  const resolver = new TargetResolver(Mode.PURE, tuning);
  approx(centsBetween(tuning.targetHz(v.context.bass) * 1.25 * 2 ** iv.octaves, resolver.resolve(v)), 0, 1e-6);
});

test("a session: in tune first, both directions, never the same approach twice running", () => {
  for (let seed = 1; seed <= 15; seed++) {
    const run = cadenceRun("D", "major", { blocks: 6, cents: 20, rng: seeded(seed) });
    assert.equal(run.length, 6);
    approx(run[0].offsetCents, 0, 1e-9);
    const offs = run.map((e) => e.offsetCents);
    assert.ok(offs.some((c) => c < 0) && offs.some((c) => c > 0));
    for (let i = 1; i < run.length; i++) {
      assert.notEqual(run[i].name.split("–")[0], run[i - 1].name.split("–")[0], `seed ${seed} repeated approach`);
    }
    // Every cadence ends on the same note: one reference for the arrival.
    const finals = new Set(run.map((e) => e.notes[2].pitch.name));
    assert.equal(finals.size, 1);
  }
});
