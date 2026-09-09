/* Stopper check (vérif bouchon): a tool for placing the stopper, on its own
 * page. The run itself is the shared ExerciseRun with the stopper spec. */

import { t } from "../i18n.js";
import { back } from "../router.js";
import { el, append, labelField, explainer } from "../ui/widgets.js";
import { helpSection } from "../ui/help.js";
import { startRow } from "../ui/controls.js";
import { owner } from "../ui/owner.js";
import { STOPPER, ExerciseRun } from "./run.js";

export default {
  title: () => t("home.card.stopper.title"),

  mount(root) {
    this.root = root;
    this.showStart();
  },

  unmount() { this.teardown(); },

  teardown() {
    if (this.own) this.own.dispose();
    this.own = owner();
    // Not on the owner: a run is a mounted view, not a subscription, and
    // unmounting it is a different act from releasing a listener.
    if (this.active) { this.active.unmount(); this.active = null; }
  },

  showStart() {
    this.teardown();
    const root = this.root;
    root.replaceChildren();
    const label = labelField();
    this.label = label;
    const help = this.own.add(helpSection("stopper"));
    const row = this.own.add(startRow({
      label: t("stopper.start"), onStart: () => this.startRun(), needMicNote: false,
    }));
    append(root,
      explainer(t("stopper.intro"), t("practice.stopper.protocol")),
      row.element,
      el("div", { class: "row" }, [label.element]),
      help.element,
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
