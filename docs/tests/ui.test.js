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

/* ---- the shared control layer ----------------------------------------- */

/* Views on this list still build their own controls. It may only ever shrink:
 * the second assertion below fails if a listed file has been migrated and its
 * name left behind, so the list cannot rot into a permanent exemption. Delete
 * a name when you migrate the view; delete the list when it empties. */
const HAND_BUILT_CONTROLS = new Set([
  "bend.js", "sessions.js", "settings.js",
]);
const HAND_BUILT = /el\("select"|type:\s*"(?:checkbox|radio|range)"/;

test("views take their controls from ui/controls.js", () => {
  // Seven key selects in four shapes, offering four different key
  // vocabularies, two of them in one file -- which is a UI a player cannot
  // learn, and which cost a shipped bug when one path forgot to carry the key
  // (b8452e1, "Redo restarts in the key you chose, not in D major").
  const views = fs.readdirSync(path.join(here, "..", "views"));
  for (const file of views) {
    const src = fs.readFileSync(path.join(here, "..", "views", file), "utf8");
    const handBuilt = HAND_BUILT.test(src);
    if (HAND_BUILT_CONTROLS.has(file)) {
      assert.ok(handBuilt,
        `${file}: migrated? then delete it from HAND_BUILT_CONTROLS -- the list may only shrink`);
    } else {
      assert.ok(!handBuilt,
        `${file}: build controls with ui/controls.js, not by hand`);
    }
  }
});

test("note names live in ui/naming.js, not in a table in a view", () => {
  // Three views carried their own. One hard-codes solfège, so a player who
  // chose letters was shown "Do♯4" on that page whatever they had set; two
  // more disagreed with each other on whether to spell with sharps or flats.
  const KNOWN = new Set(["temperament.js"]);
  const views = fs.readdirSync(path.join(here, "..", "views"));
  for (const file of views) {
    const src = fs.readFileSync(path.join(here, "..", "views", file), "utf8");
    const table = /\[\s*"(?:Do|Ré|Mi|Fa|Sol|La|Si)[♯♭"]/.test(src);
    if (KNOWN.has(file)) {
      assert.ok(table, `${file}: table gone? then delete it from KNOWN here too`);
    } else {
      assert.ok(!table, `${file}: name notes through ui/naming.js`);
    }
  }
});

test("every bind: names a setting that actually exists", () => {
  // The silent one: a typo writes a key nothing reads, the control looks like
  // it works, and the choice is forgotten on reload with no error anywhere.
  const known = new Set(Object.keys(settings.DEFAULTS));
  for (const dir of ["views", "ui"]) {
    for (const file of fs.readdirSync(path.join(here, "..", dir))) {
      if (!file.endsWith(".js")) continue;
      const src = fs.readFileSync(path.join(here, "..", dir, file), "utf8");
      for (const [, key] of src.matchAll(/\bbind:\s*"([A-Za-z0-9_]+)"/g)) {
        assert.ok(known.has(key), `${dir}/${file}: bind "${key}" is not in settings DEFAULTS`);
      }
    }
  }
});

test("the control layer keeps its dependencies pointing one way", () => {
  // fields.js is the generic half and must stay engine-free, or it cannot be
  // tested without a browser and audio policy starts leaking into it. And
  // widgets.js may not reach up into controls.js, which imports it.
  // Import statements only: a first pass matched the comment in fields.js that
  // states the rule, which is the false-positive these greps are prone to.
  const imports = (file) =>
    [...fs.readFileSync(path.join(here, "..", "ui", file), "utf8")
      .matchAll(/^\s*(?:import|export)[^;]*?from\s+"([^"]+)"/gm)].map(([, from]) => from);
  assert.ok(!imports("fields.js").some((from) => /audio\/|core\//.test(from)),
    `ui/fields.js may not import audio/ or core/: ${imports("fields.js").join(", ")}`);
  assert.ok(!imports("widgets.js").some((from) => from.includes("controls.js")),
    "ui/widgets.js may not import ui/controls.js -- controls imports widgets");
  assert.ok(!imports("controls.js").some((from) => from.includes("/views/")),
    "ui/controls.js may not import a view");
});

test("a class the app puts on the page is a class the stylesheet knows", () => {
  // `.field` was emitted at nine sites and had no rule at all: those rows laid
  // out by inheritance, so the day someone added one, nine places would move.
  //
  // Checked over ui/ rather than every view: this is the shared layer, small
  // and new, and a class invented here lands on every page at once. It caught
  // a `.field-lead` invented mid-migration with no rule behind it -- the same
  // mistake, one file over from where the test was looking.
  const css = fs.readFileSync(path.join(here, "..", "styles.css"), "utf8");
  const known = (name) => new RegExp(`\\.${name}[\\s,.:>{]`).test(css);
  for (const file of fs.readdirSync(path.join(here, "..", "ui"))) {
    if (!file.endsWith(".js")) continue;
    const src = fs.readFileSync(path.join(here, "..", "ui", file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const [, value] of src.matchAll(/class:\s*"([a-z][a-z0-9 -]*)"/g)) {
      for (const name of value.split(/\s+/).filter(Boolean)) {
        assert.ok(known(name), `${file} puts .${name} on the page; styles.css must define it`);
      }
    }
  }
});

test("widgets that return a wrapper are appended by their element", () => {
  // audioControl, labelField, levelBar and needle all return objects, not
  // nodes. Appending one bare renders nothing and silently loses the control,
  // which is how the temperament page shipped with no way to start the
  // microphone. Node's test runner has no DOM, so this is checked in source.
  const views = fs.readdirSync(path.join(here, "..", "views"));
  for (const file of views) {
    const src = fs.readFileSync(path.join(here, "..", "views", file), "utf8");

    // The specific slip, and the one worth banning outright: four pages used
    // `.node`, which none of these widgets has. `append` skips undefined, so
    // the level meter simply never rendered and nothing ever complained.
    assert.ok(!/\.node\b/.test(src),
      `${file}: these widgets expose .element, never .node`);

    for (const factory of ["audioControl", "labelField"]) {
      if (!src.includes(`${factory}(`)) continue;
      // Assigned to a const in every current caller; an object property would
      // need widening here rather than dropping the check.
      const assigned = src.match(new RegExp(`const (\\w+) = ${factory}\\(`));
      assert.ok(assigned, `${file}: ${factory}() result is not held in a const`);
      const holder = assigned[1];
      assert.ok(src.includes(`${holder}.element`),
        `${file}: ${holder} comes from ${factory}() but is never used as ${holder}.element`);
    }
  }
});

test("views mount through the append helper, never Node.append on the root", () => {
  // Node.append renders a null child as the text "null". Twice now a view has
  // shipped a conditional child that way -- the stopper page once, and the
  // Listen key row in 6.4. The helper in ui/widgets.js skips null, false and
  // undefined and is otherwise identical, so there is no reason to use the
  // DOM method on the mount root at all.
  const views = fs.readdirSync(path.join(here, "..", "views"));
  for (const file of views) {
    const src = fs.readFileSync(path.join(here, "..", "views", file), "utf8");
    assert.ok(!/\broot\.append\(/.test(src),
      `${file}: use append(root, ...) from ui/widgets.js, which skips null`);
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

/* ---- the scoring rule ------------------------------------------------- */

/* CLAUDE.md: "A note's figure comes from scoredWindow() in core/scoring.js.
 * No view reduces frames to a pitch itself." That rule was convention only,
 * and convention is what let five views each pick mean or median for
 * themselves in the first place -- which is how a note corrected at the end
 * came to be scored on its own approach.
 *
 * Unlike HAND_BUILT_CONTROLS this list is not expected to empty. Both entries
 * are decisions, not debt, and each says so at the line that matches. What the
 * test enforces is that the list stays exactly this: a sixth view cannot
 * quietly start reducing frames again. */
const OWN_REDUCTION = new Map([
  ["bend.js", "measures how far a note can be pushed, not where it settled"],
  ["tuner.js", "a live rolling display, with no finished note to trim"],
]);
const REDUCES_FRAMES = /(?:median|mean)\(\s*(?:framesHz|voiced|frames\b)|\.hz\)\.sort\(/;

test("only core/scoring.js turns a note's frames into a pitch", () => {
  const views = fs.readdirSync(path.join(here, "..", "views"));
  for (const file of views) {
    const src = fs.readFileSync(path.join(here, "..", "views", file), "utf8");
    // Comments explain the rule; only code may break it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const reduces = REDUCES_FRAMES.test(code);
    if (OWN_REDUCTION.has(file)) {
      assert.ok(reduces,
        `${file}: no longer reduces frames? then delete it from OWN_REDUCTION`);
    } else {
      assert.ok(!reduces,
        `${file}: use scoredWindow()/notePitch()/analyseNote(), not your own average`);
    }
  }
});

test("a view that measures a note imports a reducer rather than writing one", () => {
  // The other half of the same rule: a view holding framesHz has to hand them
  // somewhere. Naming the sanctioned entry points here means a new view is
  // pointed at them by a failing test rather than by a code review.
  const SANCTIONED = /\b(?:scoredWindow|notePitch|analyseNote|postAttack)\b/;
  const views = fs.readdirSync(path.join(here, "..", "views"));
  for (const file of views) {
    const src = fs.readFileSync(path.join(here, "..", "views", file), "utf8");
    if (!/framesHz/.test(src)) continue;
    assert.ok(SANCTIONED.test(src),
      `${file}: holds a note's frames but reduces them with neither `
      + `scoredWindow(), notePitch(), analyseNote() nor postAttack()`);
  }
});
