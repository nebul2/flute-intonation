/* Settings. Everything writes through settings.set(), so the status strip
 * and any mounted view re-render immediately. */

import { t, setLanguage } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import * as history from "../history.js";
import { el, audioControl } from "../ui/widgets.js";

const REFERENCES = [392, 415, 430, 440, 442];

export default {
  title: () => t("settings.title"),

  mount(root) {
    const s = settings.get();

    /* reference pitch */
    const custom = el("input", {
      type: "number", class: "number", min: "380", max: "470", step: "0.1",
      value: REFERENCES.includes(Number(s.referenceHz)) ? "" : s.referenceHz,
      placeholder: t("settings.custom"),
      onchange: (e) => {
        const hz = Number(e.target.value);
        if (hz >= 380 && hz <= 470) settings.set({ referenceHz: hz });
      },
    });
    const refs = el("div", { class: "segmented" }, REFERENCES.map((hz) =>
      el("button", {
        class: Number(s.referenceHz) === hz ? "active" : "",
        text: String(hz),
        onclick: (e) => {
          settings.set({ referenceHz: hz });
          refs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target));
          custom.value = "";
        },
      })));

    /* naming */
    const naming = el("div", { class: "options" }, ["solfege", "letters"].map((style) =>
      el("label", { class: "option" }, [
        el("input", { type: "radio", name: "naming", value: style, checked: s.naming === style || null,
                      onchange: () => settings.set({ naming: style }) }),
        el("span", { class: "option-label", text: t(`settings.naming.${style}`) }),
      ])));

    /* language */
    const language = el("div", { class: "segmented" }, ["fr", "en"].map((code) =>
      el("button", {
        class: (s.lang ?? document.documentElement.lang) === code ? "active" : "",
        text: code.toUpperCase(),
        onclick: () => { settings.set({ lang: code }); setLanguage(code); },
      })));

    /* microphone */
    const mic = el("select", { class: "select", onchange: (e) => {
      settings.set({ deviceId: e.target.value || null });
      if (engine.listening) { engine.stop(); engine.start({ deviceId: e.target.value || null }); }
    } }, [el("option", { value: "", text: t("settings.micDefault") })]);
    const micNote = el("div", { class: "diag", text: engine.listening ? "" : t("settings.micNeedsStart") });
    engine.inputDevices().then((devices) => {
      for (const d of devices) {
        mic.append(el("option", {
          value: d.deviceId, selected: s.deviceId === d.deviceId || null,
          text: d.label || `${t("settings.mic")} ${mic.children.length}`,
        }));
      }
    });

    /* drone level */
    const droneLevel = el("input", {
      type: "range", min: "0.02", max: "0.5", step: "0.01", value: String(s.droneLevel),
      oninput: (e) => {
        const level = Number(e.target.value);
        settings.set({ droneLevel: level });
        if (engine.drone.playing) engine.drone.start(engine.drone.hz, level);
      },
    });

    /* headphones */
    const headphones = el("label", { class: "option" }, [
      el("input", { type: "checkbox", checked: s.headphones || null,
                    onchange: (e) => settings.set({ headphones: e.target.checked }) }),
      el("span", { class: "option-label", text: t("settings.headphones") }),
    ]);

    const control = audioControl();
    this.control = control;

    /* history */
    const historyNote = el("div", { class: "diag" });
    history.count().then((n) => { historyNote.textContent = t("settings.historyCount", n); }).catch(() => {});
    const exportButton = el("button", { class: "secondary", text: t("settings.export"), onclick: async () => {
      const n = await history.exportFile();
      historyNote.textContent = t("settings.exported", n);
    } });
    const clearButton = el("button", { class: "secondary", text: t("settings.clear"), onclick: async () => {
      if (!window.confirm(t("settings.clearConfirm"))) return;
      await history.clear();
      historyNote.textContent = t("settings.cleared");
    } });

    root.append(
      el("h2", { text: t("settings.reference") }),
      el("div", { class: "row" }, [refs, custom]),
      el("h2", { text: t("settings.naming") }), naming,
      el("h2", { text: t("settings.language") }), language,
      el("h2", { text: t("settings.mic") }), control.element, mic, micNote,
      el("h2", { text: t("settings.droneLevel") }), droneLevel,
      headphones,
      el("h2", { text: t("settings.history") }),
      el("div", { class: "controls left" }, [exportButton, clearButton]),
      historyNote,
    );
  },

  unmount() { if (this.control) this.control.dispose(); },
};
