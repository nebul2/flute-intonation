/* Stopper check (vérif bouchon): a tool for placing the stopper, on its own
 * page. The run itself is the shared ExerciseRun with the stopper spec. */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import { back } from "../router.js";
import { el, audioControl, labelField } from "../ui/widgets.js";
import { STOPPER, ExerciseRun } from "./run.js";

export default {
  title: () => t("home.card.stopper.title"),

  mount(root) {
    this.root = root;
    this.showStart();
  },

  unmount() { this.teardown(); },

  teardown() {
    if (this.offState) { this.offState(); this.offState = null; }
    if (this.control) { this.control.dispose(); this.control = null; }
    if (this.active) { this.active.unmount(); this.active = null; }
  },

  showStart() {
    this.teardown();
    const root = this.root;
    root.replaceChildren();
    const control = audioControl({ showGranted: false });
    this.control = control;
    const label = labelField();
    this.label = label;
    const start = el("button", { class: "primary", text: t("stopper.start"), disabled: !engine.listening,
                                 onclick: () => this.startRun() });
    this.offState = engine.onState(() => { start.disabled = !engine.listening; });
    root.append(
      el("p", { class: "intro", text: t("stopper.intro") }),
      el("p", { class: "note-box", text: t("practice.stopper.protocol") }),
      el("div", { class: "row" }, [control.element, start]),
      el("div", { class: "row" }, [label.element]),
    );
  },

  startRun() {
    this.teardown();
    this.active = new ExerciseRun({
      key: "stopper", spec: STOPPER, label: this.label ? this.label.value : "",
      onBack: () => back(), backLabel: t("nav.back"),
    });
    this.active.mount(this.root);
  },
};
