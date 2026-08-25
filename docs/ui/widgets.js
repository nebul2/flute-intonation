/* Small DOM helpers and the widgets several views share: the microphone
 * start/stop control with its state chip, the cents needle, the level bar,
 * and "the current tuning" built from settings. Views compose these; none of
 * them knows about routes. */

import { engine } from "../audio/engine.js";
import { t } from "../i18n.js";
import * as settings from "../settings.js";
import { SpelledPitch } from "../core/pitch.js";
import { ReferencePitch, TemperamentTuning, parseScala } from "../core/tuning.js";
import { TEMPERAMENTS } from "../core/temperaments.js";
import { noteName } from "./naming.js";

/* el("div", {class: "x", onclick: fn}, [children...]) */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/* Append children, skipping null/undefined. Node.append() would otherwise
 * render a null child as the text "null" -- seen live under the stopper
 * protocol note. Every view uses this for conditional children. */
export function append(parent, ...children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child);
  }
  return parent;
}

/* ---- the current tuning, from settings ----------------------------- */

export function currentTuning(s = settings.get()) {
  const scale = parseScala(TEMPERAMENTS[s.temperament]?.scl ?? TEMPERAMENTS.vallotti.scl);
  const reference = new ReferencePitch(SpelledPitch.parse("A4"), Number(s.referenceHz) || 415);
  return new TemperamentTuning(scale, SpelledPitch.parse(`${s.root}4`), reference);
}

export function temperamentLabel(name) { return t(`temperament.${name}`); }

export function name(pitch, s = settings.get()) { return noteName(pitch, s.naming); }

/* "A = 415 · Vallotti sur Do · intervalles purs · casque" */
export function statusText(s = settings.get()) {
  const parts = [
    `A = ${s.referenceHz}`,
    `${temperamentLabel(s.temperament)} · ${noteName(SpelledPitch.parse(`${s.root}4`), s.naming, false)}`,
    t(`mode.${s.mode}`),
    s.headphones ? t("status.headphones") : t("status.speakers"),
  ];
  return parts.join("  ·  ");
}

/* ---- microphone control -------------------------------------------- */

export function audioControl({ showGranted = true } = {}) {
  const button = el("button", { class: "primary" });
  const chip = el("span", { class: "chip audio" });
  const granted = el("div", { class: "diag" });
  const wrap = el("div", { class: "audio-control" }, [button, chip, showGranted ? granted : null]);

  function update() {
    chip.textContent = engine.state === "error"
      ? t("audio.error", engine.error?.message ?? "?") : t(`audio.${engine.state}`);
    chip.dataset.state = engine.state;
    button.textContent = engine.listening ? t("audio.stop") : t("audio.start");
    button.disabled = engine.state === "starting";
    if (engine.listening && engine.granted) {
      const g = engine.granted;
      granted.textContent = t("audio.granted", engine.sampleRate,
        g.autoGainControl !== false, g.noiseSuppression !== false, g.echoCancellation !== false);
    } else {
      granted.textContent = "";
    }
  }

  button.addEventListener("click", () => {
    if (engine.listening) engine.stop();
    else engine.start({ deviceId: settings.get().deviceId });
  });
  const off = engine.onState(update);
  update();
  return { element: wrap, update, dispose: off };
}

/* ---- session label -------------------------------------------------- */

let labelFieldCount = 0;

/* Names the session about to be recorded -- "flute 1", "flute 2". The value
 * is remembered, and names already used are offered as suggestions, so
 * labelling a second instrument is one tap after the first time. */
export function labelField() {
  const listId = `labels-${++labelFieldCount}`;
  const list = el("datalist", { id: listId });
  const input = el("input", {
    type: "text", class: "text", list: listId, maxlength: "40",
    placeholder: t("session.labelPlaceholder"),
    value: settings.get().lastLabel || "",
    oninput: (e) => settings.set({ lastLabel: e.target.value }),
  });
  historyLabels().then((labels) => {
    for (const label of labels) list.append(el("option", { value: label }));
  }).catch(() => {});
  return {
    element: el("span", { class: "labelfield" },
      [el("span", { text: t("session.label") }), input, list]),
    get value() { return input.value.trim(); },
  };
}

async function historyLabels() {
  const history = await import("../history.js");
  const seen = new Set();
  for (const record of await history.all()) {
    if (record.label) seen.add(record.label);
  }
  return [...seen];
}

/* ---- run navigation ------------------------------------------------- */

/* The one navigation bar for every page that runs something: a Stop control
 * while running, then Redo and Back to the list once finished. Rendered
 * twice -- `top` and `bottom` -- from one state, so both ends of a long page
 * always agree. `extras` (e.g. a toggle) appear in the top bar only. */
export function runNav({ onStop, onRedo, onBack, stopLabel = t("nav.stop"), backLabel = null, extras = [] }) {
  const make = (withExtras) => {
    const stop = el("button", { class: "secondary", text: stopLabel, onclick: () => onStop() });
    const redo = el("button", { class: "primary", text: t("nav.redo"), onclick: () => onRedo(), hidden: true });
    const back = el("button", { class: "secondary", text: backLabel ?? t("nav.backToList"), onclick: () => onBack(), hidden: true });
    const bar = el("div", { class: `controls runnav${withExtras ? " top" : ""}` },
      [el("div", { class: "runnav-buttons" }, [stop, redo, back]), ...(withExtras ? extras : [])]);
    return { bar, stop, redo, back };
  };
  const top = make(true), bottom = make(false);
  return {
    top: top.bar,
    bottom: bottom.bar,
    finish() {
      for (const side of [top, bottom]) {
        side.stop.hidden = true;
        side.redo.hidden = false;
        side.back.hidden = false;
      }
    },
  };
}

/* ---- cents needle --------------------------------------------------- */

export function needle() {
  const marker = el("div", { class: "needle" });
  const track = el("div", { class: "track" }, [el("div", { class: "mark" }), marker]);
  const labels = el("div", { class: "scale-labels" },
    [el("span", { text: "−50¢" }), el("span", { text: "0" }), el("span", { text: "+50¢" })]);
  const element = el("div", {}, [track, labels]);
  return {
    element,
    set(cents) {
      if (cents === null) {
        marker.style.opacity = "0.25";
        track.classList.remove("in-tune");
        return;
      }
      marker.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
      marker.style.opacity = "1";
      // Within the in-tune band the centre bar and the needle go green:
      // the same band as the number's colour, so the two never disagree.
      track.classList.toggle("in-tune", bandClass(cents) === "good");
    },
  };
}

/* ---- level bar ------------------------------------------------------ */

export function levelBar() {
  const bar = el("div", { class: "levelbar" });
  const text = el("span", { class: "leveltext", text: "−∞ dBFS" });
  const element = el("div", { class: "level" }, [
    el("div", { class: "track" }, [bar, el("div", { class: "gate" })]), text,
  ]);
  return {
    element,
    set(db) {
      const level = Math.max(-72, Math.min(0, db));
      bar.style.width = `${((level + 72) / 72) * 100}%`;
      text.textContent = `${db.toFixed(1)} dBFS`;
    },
  };
}

/* Every named pitch in a range with its frequency in `tuning`, and the one
 * nearest a heard frequency. Spellings as in the desktop tuner: flats where
 * the flute's keys prefer them; cosmetic in a 12-note temperament. */
const SPELLINGS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];

export function tunerCandidates(tuning, low = 3, high = 7) {
  const out = [];
  for (let octave = low; octave <= high; octave++) {
    for (const spelling of SPELLINGS) {
      const pitch = SpelledPitch.parse(`${spelling}${octave}`);
      out.push({ pitch, hz: tuning.targetHz(pitch) });
    }
  }
  return out;
}

export function nearestCandidate(candidates, hz) {
  let best = null;
  for (const c of candidates) {
    const cents = 1200 * Math.log2(hz / c.hz);
    if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { ...c, cents };
  }
  return best;
}

export function bandClass(cents) {
  const m = Math.abs(cents);
  return m <= 5 ? "good" : m <= 15 ? "close" : "off";
}
