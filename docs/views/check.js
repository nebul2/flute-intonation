/* Hardware check: the phase-0 page on the shared engine. Equal-temperament
 * names here on purpose -- this page tests the microphone and speakers, not
 * the tuning -- and it says so. */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import { el, audioControl, needle, levelBar, bandClass, explainer } from "../ui/widgets.js";

const NAMES = ["Do", "Do♯", "Ré", "Mi♭", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "Si♭", "Si"];

function describe(hz, referenceHz) {
  const semis = 12 * Math.log2(hz / referenceHz);
  const nearest = Math.round(semis);
  const cents = 100 * (semis - nearest);
  const index = ((nearest % 12) + 12 + 9) % 12;
  const octave = 4 + Math.floor((nearest + 9) / 12);
  return { name: `${NAMES[index]}${octave}`, cents };
}

export default {
  title: () => t("check.title"),

  mount(root) {
    const ref = Number(settings.get().referenceHz) || 415;
    const droneHz = ref * Math.pow(2, -7 / 12);      // D below the reference A

    const note = el("div", { class: "big-note", text: "—" });
    const hz = el("span", { text: t("check.pressStart") });
    const cents = el("span");
    const gauge = needle();
    const level = levelBar();
    const control = audioControl();
    const drone = el("button", { class: "secondary", text: t("check.drone"), disabled: true });

    const updateDrone = () => {
      drone.disabled = !engine.listening;
      drone.textContent = engine.drone.playing
        ? t("check.droneStop", droneHz.toFixed(2)) : t("check.drone");
    };
    drone.addEventListener("click", () => {
      if (engine.drone.playing) engine.drone.stop();
      else engine.drone.start(droneHz, settings.get().droneLevel);
    });
    this.offState = engine.onState(updateDrone);
    updateDrone();

    let lastVoiced = null;
    this.offFrame = engine.onFrame((frame) => {
      if (frame.hz > 0) lastVoiced = frame;
      level.set(frame.levelDb);
    });

    const render = () => {
      if (!this.mounted) return;
      const now = performance.now();
      if (engine.listening && lastVoiced && now - lastVoiced.t < 400) {
        const d = describe(lastVoiced.hz, ref);
        note.textContent = d.name;
        hz.textContent = `${lastVoiced.hz.toFixed(2)} Hz`;
        cents.textContent = `${d.cents >= 0 ? "+" : ""}${d.cents.toFixed(1)}¢`;
        cents.className = bandClass(d.cents);
        gauge.set(d.cents);
      } else {
        note.textContent = "—";
        hz.textContent = engine.listening ? t("check.listening") : t("check.pressStart");
        cents.textContent = "";
        gauge.set(null);
      }
      requestAnimationFrame(render);
    };
    this.mounted = true;
    requestAnimationFrame(render);

    root.append(
      explainer(t("check.intro"), t("check.note")),
      el("div", { class: "card panel" }, [
        note,
        el("div", { class: "readout" }, [hz, cents]),
        gauge.element,
        level.element,
        el("div", { class: "controls" }, [control.element, drone]),
      ]),
    );
    this.control = control;
  },

  unmount() {
    this.mounted = false;
    if (this.offFrame) this.offFrame();
    if (this.offState) this.offState();
    if (this.control) this.control.dispose();
  },
};
