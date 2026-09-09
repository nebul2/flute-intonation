/* Form controls that own their setting.
 *
 * Every view used to build its own selects and checkboxes, so the same idea
 * appeared in several shapes and a player never learned the UI once: seven
 * key selects in four shapes, two checkbox conventions, three ways of
 * labelling a control. Worse than untidy -- only four of sixteen views
 * subscribed to settings changes, so switching Do-Re-Mi to C-D-E left every
 * other open page showing the old names until it was navigated away from.
 *
 * A field here reads its value from settings, writes it back on user input,
 * and re-renders when anything it watches changes. That last part is the
 * whole fix for stale names: one subscription inside the control, rather than
 * twelve views each remembering to subscribe.
 *
 * Layer rule: this file may not import audio/, core/ or views/. It is the
 * generic half -- what a control *is*. The musical half -- what a key or a
 * temperament is -- lives in controls.js above it.
 */

import { el } from "./dom.js";
import * as settings from "../settings.js";
import { t, onLanguageChange } from "../i18n.js";

/* ---- the label convention ------------------------------------------- */

/* One shape for every labelled control, so they line up and a player's eye
 * learns one place to look. `.field` is styled in styles.css; it was used at
 * nine sites with no rule at all before this. */
export function field(label, control, hint = null) {
  return el("div", { class: "row" }, [
    label ? el("label", { class: "field" }, [label, control]) : control,
    hint,
  ]);
}

/* ---- option lists ---------------------------------------------------- */

/* Replace a select's options and select `value`.
 *
 * el() sets attributes rather than properties, so `el("option", {selected})`
 * sets defaultSelected -- ignored once the user has touched the control -- and
 * `el("select", {value})` does nothing at all. Every option-replacing path
 * goes through here so that trap is sprung once, in one place. The fallback is
 * views/listen.js's rule, generalised: a value that is no longer in the list
 * becomes the first entry, and the caller is told.
 */
export function setOptions(select, options, value) {
  select.replaceChildren(...options.map((option) =>
    el("option", { value: String(option.value), text: option.label })));
  select.value = String(value);
  if (select.value === String(value) || !options.length) return value;
  select.value = String(options[0].value);
  return options[0].value;
}

/* ---- the binding ----------------------------------------------------- */

/* Keep `render` in step with the settings it depends on and with the
 * language, and hand back one unsubscribe.
 *
 * `watch` names the settings keys that matter; anything else changing is
 * ignored, which matters because settings.set() fires on every drag of the
 * drone slider and there are now dozens of subscribers rather than five.
 *
 * `source` is the escape hatch: a control given one speaks that settings
 * object and takes no subscription at all. Runs freeze their settings at the
 * start so a mid-run naming change cannot retro-relabel notes already scored,
 * and a live control inside a run would show half a session in Do and half
 * in D.
 */
function live(render, { watch = [], source = null } = {}) {
  if (source) {
    render();
    return onLanguageChange(render);
  }
  const snapshot = () => watch.map((key) => settings.get()[key]);
  let previous = snapshot();
  const offSettings = settings.subscribe(() => {
    const next = snapshot();
    if (next.every((v, i) => v === previous[i])) return;
    previous = next;
    render();
  });
  const offLanguage = onLanguageChange(render);
  render();
  return () => { offSettings(); offLanguage(); };
}

/* The common half of every field: where its value lives, and what happens
 * when the player changes it. */
function bound({ bind = null, source = null, value = null, onChange = null, onSync = null }) {
  const read = () => {
    if (bind) return (source ? source() : settings.get())[bind];
    return value;
  };
  let current = read();
  let writing = false;
  return {
    get value() { return current; },
    /* Programmatic: no onChange, because nothing the player did caused it. */
    set(next) { current = next; if (bind && !source) { writing = true; settings.set({ [bind]: next }); writing = false; } },
    /* User input. The write happens first and synchronously, so any other
     * control bound to the same setting is already correct; onChange runs in a
     * microtask because handlers here restart runs and rebuild pages, and
     * doing that while the change event is still dispatching tears the DOM
     * out from under the event. A microtask still runs before paint. */
    changed(next) {
      current = next;
      if (bind && !source) { writing = true; settings.set({ [bind]: next }); writing = false; }
      queueMicrotask(() => { if (onSync) onSync(next); if (onChange) onChange(next); });
    },
    sync() { current = read(); if (onSync) onSync(current); return current; },
    get writing() { return writing; },
  };
}

/* ---- the fields ------------------------------------------------------ */

/* A select over a fixed or computed list of {value, label} options. */
export function selectField({ label = null, hint = null, options, watch = [], parse = String, ...rest }) {
  const state = bound(rest);
  const select = el("select", { class: "select" });
  const hintNode = hint ? el("p", { class: "muted small" }) : null;
  const list = () => (typeof options === "function" ? options() : options);

  const render = () => {
    const chosen = setOptions(select, list(), state.value);
    if (chosen !== state.value) state.set(chosen);
    if (hintNode) hintNode.textContent = typeof hint === "function" ? hint(state.value) : hint;
  };
  select.addEventListener("change", () => {
    state.changed(parse(select.value));
    if (hintNode) hintNode.textContent = typeof hint === "function" ? hint(state.value) : hint;
  });
  const off = live(render, { watch, source: rest.source });

  return {
    element: field(label, select, hintNode), select,
    get value() { return state.value; },
    set(v) { state.set(v); render(); },
    refresh: render, dispose: off,
  };
}

/* A checkbox. `look` picks which of the app's two conventions it wears:
 * "toggle" is the inline one used inside a run, "option" the card used on the
 * Settings page, "bare" a naked box in a table row. They were three separate
 * pieces of markup for one act. */
export function checkboxField({ label, help = null, look = "toggle", ariaLabel = null, ...rest }) {
  const state = bound(rest);
  const input = el("input", { type: "checkbox", ...(ariaLabel ? { "aria-label": ariaLabel } : {}) });
  input.checked = state.value === true;
  input.addEventListener("change", () => state.changed(input.checked));

  const text = el("span", { class: look === "option" ? "option-label" : "" });
  const helpNode = help ? el("span", { class: "option-help" }) : null;
  const render = () => {
    input.checked = state.value === true;
    text.textContent = typeof label === "function" ? label() : label;
    if (helpNode) helpNode.textContent = typeof help === "function" ? help() : help;
  };
  const off = live(render, { watch: rest.bind ? [rest.bind] : [], source: rest.source });

  const element = look === "bare"
    ? input
    : el("label", { class: look === "option" ? "option" : "toggle" },
        look === "option" ? [input, el("div", { class: "option-body" }, [text, helpNode])] : [input, text]);
  return {
    element, input,
    get value() { return state.value; },
    set(v) { state.set(v); render(); },
    refresh: render, dispose: off,
  };
}

/* A group of radio cards. The local factory in views/tuning.js and the same
 * markup open-coded twice in views/settings.js, in one place. */
export function radioGroup({ name, options, ...rest }) {
  const state = bound(rest);
  const inputs = [];
  const labels = [];
  const wrap = el("div", { class: "options" }, options.map((option) => {
    const input = el("input", { type: "radio", name, value: String(option.value) });
    input.checked = option.value === state.value;
    input.addEventListener("change", () => { if (input.checked) state.changed(option.value); });
    inputs.push([input, option]);
    const text = el("span", { class: "option-label" });
    const help = option.help ? el("span", { class: "option-help" }) : null;
    labels.push([text, help, option]);
    return el("label", { class: "option" }, [input, el("div", { class: "option-body" }, [text, help])]);
  }));

  const render = () => {
    for (const [input, option] of inputs) input.checked = option.value === state.value;
    for (const [text, help, option] of labels) {
      text.textContent = typeof option.label === "function" ? option.label() : option.label;
      if (help) help.textContent = typeof option.help === "function" ? option.help() : option.help;
    }
  };
  const off = live(render, { watch: rest.bind ? [rest.bind] : [], source: rest.source });
  return {
    element: wrap,
    get value() { return state.value; },
    set(v) { state.set(v); render(); },
    refresh: render, dispose: off,
  };
}

/* A slider. Fires on input rather than change, so the drone level can be
 * heard while it is dragged -- which is why watched-key diffing above is not
 * an optimisation. */
export function rangeField({ label = null, min, max, step, ...rest }) {
  const state = bound(rest);
  const input = el("input", { type: "range", min: String(min), max: String(max), step: String(step) });
  input.value = String(state.value);
  input.addEventListener("input", () => state.changed(Number(input.value)));
  const render = () => { input.value = String(state.value); };
  const off = live(render, { watch: rest.bind ? [rest.bind] : [], source: rest.source });
  return {
    element: field(label, input), input,
    get value() { return state.value; },
    set(v) { state.set(v); render(); },
    refresh: render, dispose: off,
  };
}

/* A pill group of buttons -- one visibly chosen. */
export function segmentedField({ options, ...rest }) {
  const state = bound(rest);
  const buttons = options.map((option) => {
    const button = el("button", { text: typeof option.label === "function" ? option.label() : option.label });
    button.addEventListener("click", () => { state.changed(option.value); render(); });
    return [button, option];
  });
  const wrap = el("div", { class: "segmented" }, buttons.map(([button]) => button));
  const render = () => {
    for (const [button, option] of buttons) {
      button.className = option.value === state.value ? "active" : "";
      button.textContent = typeof option.label === "function" ? option.label() : option.label;
    }
  };
  const off = live(render, { watch: rest.bind ? [rest.bind] : [], source: rest.source });
  return {
    element: wrap,
    get value() { return state.value; },
    set(v) { state.set(v); render(); },
    refresh: render, dispose: off,
  };
}

