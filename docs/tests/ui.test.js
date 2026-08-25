/* Headless checks on the shell: language key parity, routes, naming.
 * Run: node --test docs/tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";

import { STRINGS, t, setLanguage } from "../i18n.js";
import { ROUTES } from "../router.js";
import { SpelledPitch, highestFirst } from "../core/pitch.js";
import { noteName, pitchClassName, SOLFEGE, LETTERS, REGISTER } from "../ui/naming.js";
import * as settings from "../settings.js";

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
