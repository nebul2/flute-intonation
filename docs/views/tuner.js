/* The tuner: live needle (the one place it stays live), the nearest note in
 * the selected temperament at the selected reference -- the thing no
 * commercial tuner does -- plus a "held note" readout that reduces a long
 * tone to one number. */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import { navigate } from "../router.js";
import { SpelledPitch, centsBetween } from "../core/pitch.js";
import {
  el, audioControl, needle, levelBar, bandClass, currentTuning, temperamentLabel, name,
} from "../ui/widgets.js";

/* Spellings the tuner offers. In a 12-note temperament the enharmonics share a
 * frequency, so this choice is cosmetic; flats where the flute's keys prefer
 * them. Same table as the desktop version. */
const SPELLINGS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
const DRONE_CHOICES = ["D4", "G4", "A4", "C4", "F4", "E4"];

function candidates(tuning, low = 3, high = 7) {
  const out = [];
  for (let octave = low; octave <= high; octave++) {
    for (const spelling of SPELLINGS) {
      const pitch = SpelledPitch.parse(`${spelling}${octave}`);
      out.push({ pitch, hz: tuning.targetHz(pitch) });
    }
  }
  return out;
}

function nearest(cands, hz) {
  let best = null;
  for (const c of cands) {
    const cents = centsBetween(c.hz, hz);
    if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { ...c, cents };
  }
  return best;
}

export default {
  title: () => t("tuner.title"),

  mount(root) {
    let s = settings.get();
    let tuning = currentTuning(s);
    let cands = candidates(tuning);

    const intro = el("p", { class: "intro" });
    const link = el("a", { href: "#/tuning", class: "link", text: t("tuner.changeTuning") });
    const note = el("div", { class: "big-note", text: "—" });
    const hz = el("span", { text: t("tuner.listening") });
    const cents = el("span");
    const target = el("div", { class: "target" });
    const held = el("div", { class: "held" });
    const gauge = needle();
    const level = levelBar();
    const control = audioControl({ showGranted: false });

    const droneSelect = el("select", { class: "select" },
      DRONE_CHOICES.map((p) => el("option", { value: p, text: name(SpelledPitch.parse(p), s) })));
    const droneButton = el("button", { class: "secondary", text: t("tuner.drone"), disabled: true });

    const refreshIntro = () => {
      intro.textContent = t("tuner.intro", temperamentLabel(s.temperament), s.referenceHz);
    };
    const updateDrone = () => {
      droneButton.disabled = !engine.listening;
      droneButton.textContent = engine.drone.playing ? t("tuner.droneStop") : t("tuner.drone");
    };
    const startDrone = () => {
      const pitch = SpelledPitch.parse(droneSelect.value);
      engine.drone.start(tuning.targetHz(pitch), s.droneLevel);
    };
    droneButton.addEventListener("click", () => {
      if (engine.drone.playing) engine.drone.stop(); else startDrone();
    });
    droneSelect.addEventListener("change", () => { if (engine.drone.playing) startDrone(); });

    this.offSettings = settings.subscribe((next) => {
      s = next;
      tuning = currentTuning(s);
      cands = candidates(tuning);
      refreshIntro();
      droneSelect.querySelectorAll("option").forEach((o) => {
        o.textContent = name(SpelledPitch.parse(o.value), s);
      });
      if (engine.drone.playing) startDrone();
    });
    this.offState = engine.onState(updateDrone);
    refreshIntro();
    updateDrone();

    // Held-note readout: median of the voiced frames in the last second.
    const recent = [];
    let lastVoiced = null;
    this.offFrame = engine.onFrame((frame) => {
      level.set(frame.levelDb);
      if (frame.hz > 0) {
        lastVoiced = frame;
        recent.push(frame);
      }
      while (recent.length && frame.t - recent[0].t > 1000) recent.shift();
    });

    const render = () => {
      if (!this.mounted) return;
      const now = performance.now();
      if (engine.listening && lastVoiced && now - lastVoiced.t < 400) {
        const n = nearest(cands, lastVoiced.hz);
        note.textContent = name(n.pitch, s);
        hz.textContent = `${lastVoiced.hz.toFixed(2)} Hz`;
        cents.textContent = `${n.cents >= 0 ? "+" : ""}${n.cents.toFixed(1)}¢`;
        cents.className = bandClass(n.cents);
        target.textContent = `${t("tuner.target")} ${n.hz.toFixed(2)} Hz`;
        gauge.set(n.cents);
        if (recent.length >= 10) {
          const sorted = recent.map((f) => f.hz).sort((a, b) => a - b);
          const median = sorted[sorted.length >> 1];
          const h = nearest(cands, median);
          held.textContent = `${t("tuner.hold")}: ${name(h.pitch, s)} ${median.toFixed(1)} Hz ` +
            `(${h.cents >= 0 ? "+" : ""}${h.cents.toFixed(1)}¢)`;
        }
      } else {
        note.textContent = "—";
        hz.textContent = engine.listening ? t("tuner.listening") : t("check.pressStart");
        cents.textContent = "";
        target.textContent = "";
        gauge.set(null);
      }
      requestAnimationFrame(render);
    };
    this.mounted = true;
    requestAnimationFrame(render);

    root.append(
      intro, link,
      el("div", { class: "card panel" }, [
        note,
        el("div", { class: "readout" }, [hz, cents]),
        target,
        gauge.element,
        level.element,
        held,
        el("div", { class: "controls" }, [control.element, droneSelect, droneButton]),
      ]),
    );
    this.control = control;
  },

  unmount() {
    this.mounted = false;
    for (const off of [this.offFrame, this.offState, this.offSettings]) if (off) off();
    if (this.control) this.control.dispose();
  },
};
