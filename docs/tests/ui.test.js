/* Headless checks on the shell: language key parity, routes, naming.
 * Run: node --test docs/tests/ */
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

import { STRINGS, t, setLanguage } from "../i18n.js";
import { ROUTES } from "../router.js";
import { EXERCISES } from "../views/run.js";
import { SpelledPitch, highestFirst } from "../core/pitch.js";
import { noteName, pitchClassName, SOLFEGE, LETTERS, REGISTER } from "../ui/naming.js";
import * as settings from "../settings.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("every string exists in both languages", () => {
  const en = Object.keys(STRINGS.en).sort();
  const fr = Object.keys(STRINGS.fr).sort();
  assert.deepEqual(fr, en);
  for (const key of en) {
    assert.equal(typeof STRINGS.en[key], typeof STRINGS.fr[key], `${key}: same kind in both`);
  }
});

test("every route has card strings and a title", () => {
  for (const name of Object.values(ROUTES)) {
    if (name === "home") continue;
    assert.ok(STRINGS.en[`home.card.${name}.title`], `home.card.${name}.title`);
    assert.ok(STRINGS.en[`home.card.${name}.desc`], `home.card.${name}.desc`);
    assert.ok(STRINGS.fr[`home.card.${name}.title`], `fr home.card.${name}.title`);
  }
});

test("the exercise list and its strings agree, in both directions", () => {
  // The stopper check was moved out of Practice into Tools and its strings
  // stayed behind, so the front page went on advertising it as an exercise.
  // This catches both halves of that: an exercise with no strings, and
  // strings for an exercise that no longer exists.
  const keys = Object.keys(EXERCISES);
  for (const key of keys) {
    for (const lang of ["en", "fr"]) {
      assert.ok(STRINGS[lang][`practice.ex.${key}.title`], `${lang} practice.ex.${key}.title`);
      assert.ok(STRINGS[lang][`practice.ex.${key}.desc`], `${lang} practice.ex.${key}.desc`);
    }
  }
  const orphans = Object.keys(STRINGS.en)
    .filter((k) => k.startsWith("practice.ex."))
    .filter((k) => !keys.includes(k.split(".")[2]));
  assert.deepEqual(orphans, [], "strings for exercises that are not in EXERCISES");
});

test("widgets that return a wrapper are appended by their element", () => {
  // audioControl, labelField and runNav return objects, not nodes. Appending
  // one bare renders nothing and silently loses the control -- which is how
  // the temperament page shipped with no way to start the microphone. Node's
  // test runner has no DOM, so this is checked in the source.
  const views = fs.readdirSync(path.join(here, "..", "views"));
  for (const file of views) {
    const src = fs.readFileSync(path.join(here, "..", "views", file), "utf8");
    for (const factory of ["audioControl", "labelField"]) {
      if (!src.includes(`${factory}(`)) continue;
      // Whatever it was assigned to must be used through .element somewhere.
      const assigned = src.match(new RegExp(`const (\\w+) = ${factory}\\(`));
      assert.ok(assigned, `${file}: ${factory}() result is not held in a const`);
      const holder = assigned[1];
      assert.ok(src.includes(`${holder}.element`),
        `${file}: ${holder} comes from ${factory}() but is never used as ${holder}.element`);
    }
  }
});

test("t() switches language and falls back to the key", () => {
  setLanguage("fr");
  assert.equal(t("nav.back"), "Retour");
  assert.equal(t("check.droneStop", "277.18"), "Couper le bourdon (277.18 Hz)");
  setLanguage("en");
  assert.equal(t("nav.back"), "Back");
  assert.equal(t("no.such.key"), "no.such.key");
});

test("fixed-do solfège naming, as in the desktop version", () => {
  const cases = { C4: "Do4", D4: "Ré4", E4: "Mi4", F4: "Fa4", G4: "Sol4", A4: "La4", B4: "Si4",
                  "F#4": "Fa♯4", Bb3: "Si♭3", Eb5: "Mi♭5" };
  for (const [text, expected] of Object.entries(cases)) {
    assert.equal(noteName(SpelledPitch.parse(text), SOLFEGE), expected);
    assert.equal(noteName(SpelledPitch.parse(text), LETTERS), text);
  }
  assert.equal(noteName(SpelledPitch.parse("F#5"), SOLFEGE, false), "Fa♯");
  assert.equal(pitchClassName("B", -1, SOLFEGE), "Si♭");
  assert.throws(() => noteName(SpelledPitch.parse("C4"), "movable-do"), /unknown naming style/);
});

test("settings default to the desktop defaults without storage", () => {
  settings._reset();
  const s = settings.get();
  assert.equal(s.referenceHz, 415);
  assert.equal(s.temperament, "vallotti");
  assert.equal(s.mode, "pure");
  assert.equal(s.naming, "solfege");
  const next = settings.set({ referenceHz: 440 });
  assert.equal(next.referenceHz, 440);
  assert.equal(settings.get().temperament, "vallotti");
});

test("high notes come first everywhere a list of notes is shown", () => {
  const P = (s) => SpelledPitch.parse(s);
  const sorted = [P("D4"), P("A6"), P("F#5")].sort(highestFirst).map((p) => p.name);
  assert.deepEqual(sorted, ["A6", "F#5", "D4"]);
});

test("register naming follows the flute's registers, which break at D", () => {
  const P = (s) => SpelledPitch.parse(s);
  const reg = (text) => noteName(P(text), SOLFEGE, { octaveStyle: REGISTER });
  setLanguage("en");
  // The three D's of the stopper check read as the three registers.
  assert.equal(reg("D4"), "Ré low");
  assert.equal(reg("D5"), "Ré middle");
  assert.equal(reg("D6"), "Ré high");
  // C#5 is the top of the *first* register, though scientific numbering
  // puts it in octave 5 -- this is the whole point of breaking at D.
  assert.equal(reg("C#5"), "Do♯ low");
  assert.equal(reg("C#6"), "Do♯ middle");
  assert.equal(reg("A6"), "La high");
  // The bands run D-to-C#, so C7 is still within the third one.
  assert.equal(reg("C7"), "Do high");
  // Below the flute's lowest note, and above the third band, there is no
  // register to name and the number is kept.
  assert.equal(reg("A3"), "La3");
  assert.equal(reg("D7"), "Ré7");
  // Letters style takes the register word too.
  assert.equal(noteName(P("D5"), LETTERS, { octaveStyle: REGISTER }), "D middle");
  setLanguage("fr");
  assert.equal(reg("D4"), "Ré grave");
  assert.equal(reg("D5"), "Ré médium");
  assert.equal(reg("D6"), "Ré aigu");
  setLanguage("en");
});

test("numbers remain the default of noteName itself, so records read the same", () => {
  assert.equal(noteName(SpelledPitch.parse("D5"), SOLFEGE), "Ré5");
});

test("the register break is configurable for a flute with a C foot", () => {
  const P = (s) => SpelledPitch.parse(s);
  setLanguage("en");
  const at = (text, brk) => noteName(P(text), SOLFEGE, { octaveStyle: REGISTER, registerBreak: brk });

  // C#5 is the top of the low register when the break is at D...
  assert.equal(at("C#5", "D"), "Do♯ low");
  // ...and the start of the middle one when it is at C.
  assert.equal(at("C#5", "C"), "Do♯ middle");
  assert.equal(at("C4", "C"), "Do low");
  assert.equal(at("D4", "C"), "Ré low");
  assert.equal(at("D5", "C"), "Ré middle");
  assert.equal(at("B4", "C"), "Si low");

  // With the break at C the register names line up with the octave numbers.
  for (const [text, word] of [["D4", "low"], ["A4", "low"], ["D5", "middle"],
                              ["B5", "middle"], ["D6", "high"], ["A6", "high"]]) {
    assert.equal(at(text, "C"), `${noteName(P(text), SOLFEGE, { octave: false })} ${word}`);
    assert.equal(String(P(text).octave), { low: "4", middle: "5", high: "6" }[word]);
  }
  // C4 has no register when the break is at D: it is below the instrument.
  assert.equal(at("C4", "D"), "Do4");
  // An unknown value falls back to the default rather than throwing.
  assert.equal(at("D4", "nonsense"), at("D4", "D"));
});
