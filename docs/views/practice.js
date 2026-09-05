/* Practice: the list of guided exercises. Running one is the shared
 * ExerciseRun in views/run.js; this page only chooses. */

import { t } from "../i18n.js";
import { navigate } from "../router.js";
import { engine } from "../audio/engine.js";
import { SpelledPitch } from "../core/pitch.js";
import { el, append, audioControl, labelField, nameClass, explainer } from "../ui/widgets.js";
import { EXERCISES, ExerciseRun } from "./run.js";

const TONICS = ["D", "G", "A", "C", "F"];

export default {
  title: () => t("practice.title"),

  mount(root) {
    this.root = root;
    this.tonic = "D";
    this.quality = "major";
    this.showList();
  },

  unmount() { this.teardown(); },

  teardown() {
    if (this.offState) { this.offState(); this.offState = null; }
    if (this.control) { this.control.dispose(); this.control = null; }
    if (this.active) { this.active.unmount(); this.active = null; }
  },

  showList() {
    this.teardown();
    const root = this.root;
    root.replaceChildren();
    const control = audioControl({ showGranted: false });
    this.control = control;
    const label = labelField();
    this.label = label;

    const tonicSelect = el("select", { class: "select", onchange: (e) => { this.tonic = e.target.value; } },
      TONICS.map((k) => el("option", { value: k, selected: k === this.tonic || null,
                                       text: nameClass(SpelledPitch.parse(`${k}4`)) })));
    const qualitySelect = el("select", { class: "select", onchange: (e) => { this.quality = e.target.value; } },
      ["major", "minor"].map((q) => el("option", { value: q, selected: q === this.quality || null,
                                                    text: t(`practice.quality.${q}`) })));

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
    this.offState = engine.onState(() => buttons.forEach((b) => { b.disabled = !engine.listening; }));

    append(root,
      explainer(t("practice.intro")),
      el("div", { class: "row" }, [control.element, el("span", { text: t("practice.tonic") }), tonicSelect,
                                    el("span", { text: t("practice.quality") }), qualitySelect]),
      el("div", { class: "row" }, [label.element]),
      engine.listening ? null : el("p", { class: "note-box", text: t("practice.needMic") }),
      el("div", { class: "cards" }, buttons),
    );
  },

  startRun(key) {
    this.teardown();
    this.active = new ExerciseRun({ key, spec: EXERCISES[key], tonic: this.tonic, quality: this.quality,
                                    label: this.label ? this.label.value : "",
                                    onBack: () => this.showList() });
    this.active.mount(this.root);
  },
};
