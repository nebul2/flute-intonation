/* The control layer, over a DOM small enough to fit in this file.
 *
 * Node's test runner has no DOM, which is why every other convention here is
 * checked by reading source. But the interesting part of a bound control is
 * behaviour -- does a write reach settings, does an external write reach the
 * control, does the pair loop -- and that needs elements that remember what
 * was done to them. Roughly forty lines of stub buys all of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

class StubNode {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.listeners = {};
    this.attributes = {}; this.style = {}; this.className = "";
    this.classList = { add: () => {}, remove: () => {}, toggle: () => {} };
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type) { for (const fn of this.listeners[type] ?? []) fn({ target: this }); }
  setAttribute(key, value) { this.attributes[key] = value; if (key === "value") this.value = value; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  get textContent() { return this._text ?? ""; }
  set textContent(v) { this._text = v; }
  /* A select's value only takes if an option carries it -- the real DOM rule,
   * and the one setOptions() relies on to detect a value that has gone. */
  get value() { return this._value ?? ""; }
  set value(v) {
    if (this.tagName !== "select" || !this.children.length) { this._value = v; return; }
    this._value = this.children.some((c) => c.attributes.value === v) ? v : this._value ?? "";
  }
}
globalThis.document = {
  createElement: (tag) => new StubNode(tag),
  createTextNode: (text) => { const n = new StubNode("#text"); n.textContent = text; return n; },
  // i18n stamps the chosen language on <html>; without this, changing
  // language throws here and nowhere else, which tells you nothing.
  documentElement: new StubNode("html"),
};

const settings = await import("../settings.js");
const { selectField, checkboxField } = await import("../ui/fields.js");
const { keyControl, temperamentControl } = await import("../ui/controls.js");
const { t, setLanguage } = await import("../i18n.js");
const { owner } = await import("../ui/owner.js");

const reset = () => { settings._reset(); settings.set({ listenKey: "D", listenQuality: "major", practiceRandom: false }); };
const pick = (control, value) => { control.select._value = String(value); control.select.dispatch("change"); };

test("a bound control writes what the player chose", () => {
  reset();
  const key = keyControl({ bind: "listenKey" });
  pick(key, "G");
  assert.equal(settings.get().listenKey, "G", "the setting follows the control");
  assert.equal(key.key, "G");
  key.dispose();
});

test("a bound control follows a write it did not make", () => {
  // Two controls on one setting used to be able to disagree, because each
  // held its own copy. This is the whole reason a control owns its setting.
  reset();
  const a = keyControl({ bind: "listenKey" });
  const b = keyControl({ bind: "listenKey" });
  pick(a, "E");
  assert.equal(b.select.value, "E", "the other control moved too");
  a.dispose(); b.dispose();
});

test("a control's own write does not send it round again", () => {
  reset();
  let renders = 0;
  const field = selectField({
    bind: "listenKey", options: [{ value: "D", label: "D" }, { value: "G", label: "G" }],
    onChange: () => { renders += 1; },
  });
  field.select._value = "G";
  field.select.dispatch("change");
  field.select.dispatch("change");
  assert.ok(renders <= 2, `no feedback loop, saw ${renders} changes`);
  field.dispose();
});

test("an unbound control changes nothing outside itself", () => {
  reset();
  const key = keyControl({ value: "D", onChange: () => {} });
  pick(key, "A");
  assert.equal(settings.get().listenKey, "D", "the preference is untouched");
  assert.equal(key.key, "A", "but the control moved");
  key.dispose();
});

test("a key control relabels itself when the naming setting changes", () => {
  // The defect this layer exists to kill: twelve of sixteen views showed stale
  // note names until they were navigated away from and back.
  reset();
  settings.set({ naming: "letters" });
  const key = keyControl({ bind: "listenKey" });
  const labelNow = () => key.select.children.find((o) => o.attributes.value === "D").textContent;
  assert.equal(labelNow(), "D");
  settings.set({ naming: "solfege" });
  assert.equal(labelNow(), "Ré", "relabelled without the view being told");
  key.dispose();
});

test("a disposed control stops listening", () => {
  reset();
  const key = keyControl({ bind: "listenKey" });
  key.dispose();
  settings.set({ naming: "letters" });          // must not throw or re-render
  assert.equal(settings.get().naming, "letters");
});

test("a key control spells a flat key by its name, never by its tonic letter", () => {
  // B flat major has tonic "B". views/scales.js records the shipped bug from
  // reading the tonic where the key was meant: the flat keys never advanced.
  reset();
  settings.set({ naming: "letters" });
  const key = keyControl({ bind: "listenKey" });
  const option = key.select.children.find((o) => o.attributes.value === "Bb");
  assert.ok(option, "Bb is offered");
  assert.equal(option.textContent, "Bb", "named as the key, not as its tonic letter B");
  key.dispose();
});

test("a checkbox binds like everything else", () => {
  reset();
  const box = checkboxField({ label: "random", bind: "practiceRandom" });
  box.input.checked = true;
  box.input.dispatch("change");
  assert.equal(settings.get().practiceRandom, true);
  box.dispose();
});

test("an owner disposes everything once, in reverse", () => {
  const order = [];
  const own = owner();
  own.add(() => order.push("first"));
  own.add({ dispose: () => order.push("second") });
  own.add(() => { throw new Error("one bad handle"); });
  own.dispose();
  assert.deepEqual(order, ["second", "first"], "LIFO, and a thrower strands nothing");
  own.dispose();
  assert.deepEqual(order, ["second", "first"], "disposing twice is harmless");
});

/* The two shapes of temperamentControl carry their labels differently --
 * radioGroup renders text into markup it already built, selectField rebuilds
 * its options -- and the radio shape was handing over strings, which go stale
 * the moment the language changes. */
const textsIn = (node, found = []) => {
  if (node._text) found.push(node._text);
  for (const kid of node.children ?? []) textsIn(kid, found);
  return found;
};

test("the temperament cards relabel when the language does", () => {
  const control = temperamentControl({ order: ["vallotti", "equal"], value: "vallotti" });
  const before = textsIn(control.element);
  assert.ok(before.includes(t("temperament.vallotti")), "starts in the current language");
  setLanguage(t("temperament.vallotti") === "Vallotti" && before.join(" ").includes("Well") ? "fr" : "en");
  const after = textsIn(control.element);
  assert.notDeepEqual(after, before, "labels must follow the language, not be frozen at build");
  assert.ok(after.every((text) => text.length > 0), "and must not blank out");
  setLanguage("en");
  control.dispose();
});
