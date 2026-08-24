/* Mode & temperament: two questions with simple help, and a live example so
 * the choice is felt rather than abstract -- the same F# over D, tempered and
 * pure, at the current settings. */

import { t } from "../i18n.js";
import * as settings from "../settings.js";
import { SpelledPitch, centsBetween } from "../core/pitch.js";
import { HarmonicContext, PureIntervalTuning } from "../core/tuning.js";
import { TEMPERAMENTS, TEMPERAMENT_ORDER } from "../core/temperaments.js";
import { lang } from "../i18n.js";
import { el, currentTuning, temperamentLabel, name } from "../ui/widgets.js";

const ROOTS = ["C", "D", "F", "G", "A", "Bb"];

export default {
  title: () => t("tuning.title"),

  mount(root) {
    const example = el("p", { class: "example mono" });

    const refreshExample = () => {
      const s = settings.get();
      const tuning = currentTuning(s);
      const fs = SpelledPitch.parse("F#4");
      const tempered = tuning.targetHz(fs);
      const pure = new PureIntervalTuning(tuning).targetHz(fs, new HarmonicContext(SpelledPitch.parse("D4")));
      const gap = centsBetween(tempered, pure);
      example.textContent = t("tuning.exampleLine", tempered.toFixed(2), pure.toFixed(2),
                              `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}`);
    };

    const radio = (groupName, value, checked, label, help) =>
      el("label", { class: "option" }, [
        el("input", {
          type: "radio", name: groupName, value, checked: checked || null,
          onchange: () => { settings.set({ [groupName]: value }); refreshExample(); },
        }),
        el("span", { class: "option-body" }, [
          el("span", { class: "option-label", text: label }),
          help ? el("span", { class: "option-help", text: help }) : null,
        ]),
      ]);

    const s = settings.get();
    const modes = el("div", { class: "options" }, [
      radio("mode", "temperament", s.mode === "temperament",
            t("mode.temperament"), t("tuning.mode.temperament.help")),
      radio("mode", "pure", s.mode === "pure", t("mode.pure"), t("tuning.mode.pure.help")),
    ]);

    const temperaments = el("div", { class: "options" }, TEMPERAMENT_ORDER.map((key) =>
      radio("temperament", key, s.temperament === key,
            temperamentLabel(key), TEMPERAMENTS[key].help[lang()] ?? TEMPERAMENTS[key].help.en)));

    const rootSelect = el("select", { class: "select", onchange: (e) => {
      settings.set({ root: e.target.value }); refreshExample();
    } }, ROOTS.map((r) => el("option", {
      value: r, selected: s.root === r || null, text: name(SpelledPitch.parse(`${r}4`), { ...s, naming: s.naming }).replace(/4$/, ""),
    })));

    refreshExample();
    root.append(
      el("h2", { text: t("tuning.modeQuestion") }),
      modes,
      el("h2", { text: t("tuning.whichTemperament") }),
      temperaments,
      el("div", { class: "row" }, [el("span", { text: t("tuning.root") }), rootSelect]),
      el("h2", { text: t("tuning.example") }),
      example,
      el("p", { class: "note-box", text: t("tuning.enharmonic") }),
    );
  },

  unmount() {},
};
