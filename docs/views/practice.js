/* Practice: the list of guided exercises. Running one is the shared
 * ExerciseRun in views/run.js; this page only chooses. */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import { SpelledPitch } from "../core/pitch.js";
import { el, append, audioControl, name } from "../ui/widgets.js";
import { EXERCISES, ExerciseRun } from "./run.js";

const TONICS = ["D", "G", "A", "C", "F"];

export default {
  title: () => t("practice.title"),

  mount(root) {
    this.root = root;
    this.tonic = "D";
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

    const tonicSelect = el("select", { class: "select", onchange: (e) => { this.tonic = e.target.value; } },
      TONICS.map((k) => el("option", { value: k, selected: k === this.tonic || null,
                                       text: name(SpelledPitch.parse(`${k}4`)).replace(/4$/, "") })));

    const buttons = Object.keys(EXERCISES).map((key) => el("button", {
      class: "card exercise", disabled: !engine.listening, onclick: () => this.startRun(key),
    }, [
      el("div", { class: "card-title", text: t(`practice.ex.${key}.title`) }),
      el("div", { class: "card-desc", text: t(`practice.ex.${key}.desc`) }),
    ]));
    this.offState = engine.onState(() => buttons.forEach((b) => { b.disabled = !engine.listening; }));

    append(root,
      el("p", { class: "intro", text: t("practice.intro") }),
      el("div", { class: "row" }, [control.element, el("span", { text: t("practice.tonic") }), tonicSelect]),
      engine.listening ? null : el("p", { class: "note-box", text: t("practice.needMic") }),
      el("div", { class: "cards" }, buttons),
    );
  },

  startRun(key) {
    this.teardown();
    this.active = new ExerciseRun({ key, spec: EXERCISES[key], tonic: this.tonic, onBack: () => this.showList() });
    this.active.mount(this.root);
  },
};
