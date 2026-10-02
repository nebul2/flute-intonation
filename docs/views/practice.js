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
    this.showList(null);
  },

  unmount() { this.teardown(); },

  teardown() {
    if (this.own) this.own.dispose();
    this.own = owner();
    if (this.active) { this.active.unmount(); this.active = null; }
  },

  /* The list, or one group of it. Exercises that are variations on one idea
   * share a `group` and a single card on the list, so that adding a level
   * does not add a card to a page that is already long -- Follow me alone
   * has three, and more are planned. */
  showList(group = null) {
    const moved = group !== this.group;
    this.group = group;
    this.teardown();
    // Into or out of a group is a new page as far as the player can tell.
    if (moved && typeof window !== "undefined") window.scrollTo(0, 0);
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
    const exerciseCard = (key) => el("button", {
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
    ]);
    // A group's card opens the group; it is not an exercise, so it does not
    // wait for the microphone.
    const groupCard = (name) => el("button", { class: "card exercise", onclick: () => this.showList(name) }, [
      el("div", { class: "card-title", text: `${t(`practice.group.${name}.title`)} →` }),
      el("div", { class: "card-desc", text: t(`practice.group.${name}.desc`) }),
    ]);
    const keys = Object.keys(EXERCISES);
    const buttons = group
      ? keys.filter((key) => EXERCISES[key].group === group).map(exerciseCard)
      : keys.filter((key) => !EXERCISES[key].group).map(exerciseCard);
    const groups = group ? [] : [...new Set(keys.map((key) => EXERCISES[key].group).filter(Boolean))];
    // The exercise cards are the start buttons, so the row is the microphone
    // control and the note saying why the cards are dead.
    this.own.add(micGate(buttons));
    const row = this.own.add(startRow());

    append(root,
      group ? el("button", { class: "secondary", text: t("practice.group.back"), onclick: () => this.showList(null) }) : null,
      group ? el("h2", { text: t(`practice.group.${group}.title`) }) : null,
      explainer(group ? t(`practice.group.${group}.intro`) : t("practice.intro")),
      chooser.element,
      el("div", { class: "row" }, [label.element]),
      row.element,
      el("div", { class: "cards" }, [...buttons, ...groups.map(groupCard)]),
    );
  },

  startRun(key) {
    // Read before teardown: teardown() disposes the chooser, and reading a
    // control after disposing it happens to work today for a reason nobody
    // should have to know.
    const { key: tonic, quality } = this.chooser.value;
    const label = this.label ? this.label.value : "";
    this.teardown();
    const group = this.group;
    this.active = new ExerciseRun({ key, spec: EXERCISES[key], tonic, quality, label,
                                    onBack: () => this.showList(group) });
    this.active.mount(this.root);
  },
};
