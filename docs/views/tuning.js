/* Mode & temperament: two questions with simple help, and a live example so
 * the choice is felt rather than abstract -- the same F# over D, tempered and
 * pure, at the current settings.
 *
 * Every control here is bound to its setting rather than writing it by hand,
 * so the page is three declarations and one example refresh. It was also the
 * page where the naming bug was most visible: the root select named its own
 * options and nothing told it when Do-Re-Mi became C-D-E. */

import { t } from "../i18n.js";
import * as settings from "../settings.js";
import { SpelledPitch, centsBetween } from "../core/pitch.js";
import { HarmonicContext, PureIntervalTuning } from "../core/tuning.js";
import { TEMPERAMENT_ORDER } from "../core/temperaments.js";
import { el, append, currentTuning, explainer } from "../ui/widgets.js";
import { radioGroup } from "../ui/fields.js";
import { rootControl, temperamentControl } from "../ui/controls.js";
import { owner } from "../ui/owner.js";

/* The temperament roots the app offers. Not all twelve: these are the ones a
 * baroque player would build a temperament on, and offering B natural or E
 * flat here would be offering a choice nobody makes. */
const ROOTS = ["C", "D", "F", "G", "A", "Bb"];

export default {
  title: () => t("tuning.title"),

  mount(root) {
    const own = owner();
    this.own = own;
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

    // Labels are functions so a language change re-renders them in place;
    // the control's own subscription does the rest.
    const modes = own.add(radioGroup({
      name: "mode", bind: "mode", onChange: refreshExample,
      options: ["temperament", "pure"].map((mode) => ({
        value: mode,
        label: () => t(`mode.${mode}`),
        help: () => t(`tuning.mode.${mode}.help`),
      })),
    }));
    const temperaments = own.add(temperamentControl({
      order: TEMPERAMENT_ORDER, bind: "temperament", onChange: refreshExample,
    }));
    // Mid-sentence, so it keeps its own label rather than music.root's, which
    // is a field label and capitalised for one.
    const rootField = own.add(rootControl({
      roots: ROOTS, bind: "root", label: t("tuning.root"), onChange: refreshExample,
    }));

    refreshExample();
    append(root,
      el("h2", { text: t("tuning.modeQuestion") }),
      modes.element,
      el("h2", { text: t("tuning.whichTemperament") }),
      temperaments.element,
      rootField.element,
      el("h2", { text: t("tuning.example") }),
      example,
      explainer(t("tuning.enharmonic")),
    );
  },

  unmount() { if (this.own) { this.own.dispose(); this.own = null; } },
};
