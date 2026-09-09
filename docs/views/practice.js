/* Practice: the list of guided exercises. Running one is the shared
 * ExerciseRun in views/run.js; this page only chooses. */

import { t } from "../i18n.js";
import { navigate } from "../router.js";
import { engine } from "../audio/engine.js";
import { el, append, labelField, explainer } from "../ui/widgets.js";
import { keyQuality, micGate, startRow } from "../ui/controls.js";
import { owner } from "../ui/owner.js";
import { EXERCISES, ExerciseRun } from "./run.js";

export default {
  title: () => t("practice.title"),

  mount(root) {
    this.root = root;
    this.showList();
  },

  unmount() { this.teardown(); },

  teardown() {
    if (this.own) this.own.dispose();
    this.own = owner();
    if (this.active) { this.active.unmount(); this.active = null; }
  },

  showList() {
    this.teardown();
    const root = this.root;
    root.replaceChildren();
    const label = labelField();
    this.label = label;

    /* The tonic and the scale, bound so they are remembered.
     *
     * They were plain fields on this object, reset to D major every time the
     * page was opened -- so a player working in G had to say so again on
     * every visit, while the key-choosing exercises next door had remembered
     * their key across sessions since phase 6. Two halves of one page
     * disagreeing about whether a choice is worth keeping.
     *
     * TONICS -- five letters -- is gone with them: the shared vocabulary
     * spells every key the app can, so Practice gains the flat keys it had no
     * reason to be missing. */
    const chooser = this.own.add(keyQuality({ keyBind: "practiceTonic", qualityBind: "practiceQuality" }));
    this.chooser = chooser;

    // A spec with a `route` runs itself on its own page: Play Scales is a
    // listening exercise, not a walk through fixed target notes, so it
    // cannot be an ExerciseRun. One list of exercises either way.
    const buttons = Object.keys(EXERCISES).map((key) => el("button", {
      class: `card exercise${EXERCISES[key].experimental ? " experimental" : ""}`,
      disabled: !engine.listening,
      onclick: () => (EXERCISES[key].route ? navigate(EXERCISES[key].route) : this.startRun(key)),
    }, [
      el("div", { class: "card-title" }, [
        t(`practice.ex.${key}.title`),
        EXERCISES[key].experimental
          ? el("span", { class: "chip warn-chip", text: t("home.experimental") }) : null,
      ]),
      el("div", { class: "card-desc", text: t(`practice.ex.${key}.desc`) }),
    ]));
    // The exercise cards are the start buttons, so the row is the microphone
    // control and the note saying why the cards are dead.
    this.own.add(micGate(buttons));
    const row = this.own.add(startRow());

    append(root,
      explainer(t("practice.intro")),
      chooser.element,
      el("div", { class: "row" }, [label.element]),
      row.element,
      el("div", { class: "cards" }, buttons),
    );
  },

  startRun(key) {
    // Read before teardown: teardown() disposes the chooser, and reading a
    // control after disposing it happens to work today for a reason nobody
    // should have to know.
    const { key: tonic, quality } = this.chooser.value;
    const label = this.label ? this.label.value : "";
    this.teardown();
    this.active = new ExerciseRun({ key, spec: EXERCISES[key], tonic, quality, label,
                                    onBack: () => this.showList() });
    this.active.mount(this.root);
  },
};
