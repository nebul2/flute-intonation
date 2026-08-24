/* Headless checks on the shell: language key parity, routes, naming.
 * Run: node --test docs/tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";

import { STRINGS, t, setLanguage } from "../i18n.js";
import { ROUTES } from "../router.js";
import { SpelledPitch } from "../core/pitch.js";
import { noteName, pitchClassName, SOLFEGE, LETTERS } from "../ui/naming.js";
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
