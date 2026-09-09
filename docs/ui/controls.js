/* The app's musical controls: one key select, one quality select, one
 * temperament chooser, used everywhere those things are chosen.
 *
 * There were seven key selects in four shapes, offering four different key
 * vocabularies, two of them carrying an index and two a key name -- and two of
 * the seven were in one file, the start screen and the mid-session change in
 * views/listen.js, each with its own copy of the same helper. A player cannot
 * learn a UI that is a different UI on every page.
 *
 * These also make a rule structural that was previously only a convention.
 * CLAUDE.md: note naming is display-only and must never reach tuning. A
 * keyControl takes and returns spelled keys and names them only on the way to
 * the screen, so there is one place that could get it wrong instead of seven.
 *
 * Layer rule: this file composes fields.js and may speak core/ and audio/;
 * fields.js below it may speak neither. Nothing here imports a view.
 */

import { el } from "./dom.js";
import { field, selectField, checkboxField, radioGroup, segmentedField, rangeField, setOptions } from "./fields.js";
import { name, nameClass, temperamentLabel, audioControl } from "./widgets.js";
import { NAMING_KEYS, CHROMATIC_SPELLINGS, pitchClassLabel, pitchClassIndexOf } from "./naming.js";
import { t, lang } from "../i18n.js";
import * as settings from "../settings.js";
import { engine } from "../audio/engine.js";
import { SpelledPitch } from "../core/pitch.js";
import { PRACTICE_KEYS, keysForQuality } from "../core/generator.js";
import { TEMPERAMENTS } from "../core/temperaments.js";

/* The sounding pitch of a key, for naming and for drones.
 *
 * NEVER derive this from `entry.tonic`: a key's tonic is its *letter*, so B
 * flat major has tonic "B". views/scales.js records the bug that came of
 * confusing the two -- guided mode expected B where the player had been asked
 * for B flat, so the flat keys never advanced. */
export function tonicPitchOf(entry) {
  return SpelledPitch.parse(`${entry.key}4`);
}

/* ---- key ------------------------------------------------------------- */

/* Which key to play in.
 *
 * `keys` narrows the vocabulary; the default is every key the app can spell,
 * and a caller passing fewer should say why at the call site. `store` says
 * what the bound setting holds: "key" the key's name, "index" its position in
 * the list -- both exist in the app already, and an index is clamped on read
 * so a list that shrinks cannot select something that is not there.
 */
export function keyControl({ keys = PRACTICE_KEYS, store = "key", label = t("music.key"),
                             labelKey = null, ...rest } = {}) {
  let list = keys;
  const entryOf = (value) => (store === "index"
    ? list[Math.min(Math.max(Number(value) || 0, 0), list.length - 1)]
    : list.find((e) => e.key === value) ?? list[0]);
  const valueOf = (entry) => (store === "index" ? list.indexOf(entry) : entry.key);
  const optionsOf = () => list.map((entry) => ({
    value: valueOf(entry),
    label: labelKey ? t(labelKey, nameClass(tonicPitchOf(entry), settingsOf()))
                    : nameClass(tonicPitchOf(entry), settingsOf()),
  }));
  const settingsOf = () => (rest.source ? rest.source() : settings.get());

  const inner = selectField({
    label, options: optionsOf, watch: NAMING_KEYS,
    parse: (v) => (store === "index" ? Number(v) : v),
    ...rest,
  });
  return {
    element: inner.element, select: inner.select,
    get value() { return inner.value; },
    get entry() { return entryOf(inner.value); },
    get key() { return entryOf(inner.value).key; },
    get tonic() { return entryOf(inner.value).tonic; },
    tonicPitch() { return tonicPitchOf(entryOf(inner.value)); },
    /* For a key list that depends on something else -- the quality, below. */
    setKeys(next) {
      list = next;
      const chosen = setOptions(inner.select, optionsOf(), inner.value);
      if (chosen !== inner.value) inner.set(chosen);
      return entryOf(chosen);
    },
    set: inner.set, refresh: inner.refresh, dispose: inner.dispose,
  };
}

/* Major or minor. */
export function qualityControl({ label = t("music.quality"), ...rest } = {}) {
  return selectField({
    label,
    options: () => ["major", "minor"].map((q) => ({ value: q, label: t(`music.quality.${q}`) })),
    ...rest,
  });
}

/* The pair, which is how they always appear: changing the quality re-fills the
 * key list, because a minor scale can only be spelled from some tonics.
 *
 * The fallback when the current key is not in the new list -- select the first
 * entry -- is today's behaviour, silently. B flat minor is unrepresentable and
 * quietly becomes something else; that is preserved here, including its
 * silence, and surfaced through onChange so a view could choose to say so.
 */
export function keyQuality({ keyBind = null, qualityBind = null, keys = null,
                             onChange = null, source = null, key = null, quality = "major" } = {}) {
  const listFor = (q) => keys ?? keysForQuality(q);
  const announce = () => { if (onChange) onChange({ key: keyControl_.key, quality: qualityControl_.value }); };

  const qualityControl_ = qualityControl({
    bind: qualityBind, source, value: quality,
    onChange: () => { keyControl_.setKeys(listFor(qualityControl_.value)); announce(); },
  });
  const keyControl_ = keyControl({
    keys: listFor(qualityBind ? (source ? source() : settings.get())[qualityBind] : quality),
    bind: keyBind, source, value: key, onChange: announce,
  });

  return {
    element: el("div", { class: "row" }, [keyControl_.element, qualityControl_.element]),
    key: keyControl_, quality: qualityControl_,
    get value() { return { key: keyControl_.key, quality: qualityControl_.value }; },
    tonicPitch: () => keyControl_.tonicPitch(),
    refresh() { keyControl_.refresh(); qualityControl_.refresh(); },
    dispose() { keyControl_.dispose(); qualityControl_.dispose(); },
  };
}

/* ---- root, pitch class, temperament ---------------------------------- */

/* The note a temperament is built on, as a letter. */
export function rootControl({ roots = ["C", "D", "F", "G", "A", "Bb"], label = t("music.root"), ...rest } = {}) {
  return selectField({
    label, watch: NAMING_KEYS,
    options: () => roots.map((root) => ({
      value: root, label: nameClass(SpelledPitch.parse(`${root}4`), rest.source ? rest.source() : settings.get()),
    })),
    ...rest,
  });
}

/* One of the twelve pitch classes, by index from C. Named through
 * ui/naming.js like everything else, so it follows the naming setting -- the
 * private tables this replaces did not. */
export function pitchClassControl({ label = t("music.root"), ...rest } = {}) {
  return selectField({
    label, watch: NAMING_KEYS, parse: Number,
    options: () => CHROMATIC_SPELLINGS.map((_, index) => ({
      value: index, label: pitchClassLabel(index, (rest.source ? rest.source() : settings.get()).naming),
    })),
    ...rest,
  });
}

/* Which temperament, as cards with their explanations or as a plain select. */
export function temperamentControl({ order, look = "radio", label = t("music.temperament"), ...rest } = {}) {
  const list = order ?? Object.keys(TEMPERAMENTS);
  const options = () => list.map((key) => ({
    value: key, label: temperamentLabel(key),
    help: TEMPERAMENTS[key].help?.[lang()] ?? TEMPERAMENTS[key].help?.en ?? null,
  }));
  return look === "radio"
    ? radioGroup({ name: "temperament", options: options(), ...rest })
    : selectField({ label, options, ...rest });
}

/* ---- the microphone ---------------------------------------------------- */

/* Enable something only while the engine is listening. Four views wrote this
 * out, and one of them stored the unsubscribe in a field it later overwrote. */
export function micGate(target) {
  const apply = () => {
    const listening = engine.listening;
    if (typeof target === "function") target(listening);
    else for (const node of [].concat(target)) node.disabled = !listening;
  };
  const off = engine.onState(apply);
  apply();
  return off;
}

/* The start-the-microphone row: the audio control, a primary button that
 * comes alive when the engine does, and the note explaining why it is dead.
 * stopper.js, listen.js, scales.js and practice.js each had their own. */
export function startRow({ label, onStart, showGranted = false, extras = [], needMicNote = true } = {}) {
  const control = audioControl({ showGranted });
  const button = el("button", { class: "primary", text: label, onclick: () => onStart() });
  const off = micGate(button);
  const note = needMicNote ? el("p", { class: "note-box", text: t("practice.needMic") }) : null;
  const offNote = note ? engine.onState(() => { note.hidden = engine.listening; }) : null;
  if (note) note.hidden = engine.listening;
  return {
    element: el("div", {}, [el("div", { class: "row" }, [control.element, button, ...extras]), note]),
    button, control,
    dispose() { off(); if (offNote) offNote(); control.dispose(); },
  };
}
