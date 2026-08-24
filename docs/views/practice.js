/* Practice: a description page until the exercises are ported. */
import { t } from "../i18n.js";
import { el } from "../ui/widgets.js";

export default {
  title: () => t("practice.title"),
  mount(root) {
    root.append(
      el("span", { class: "chip", text: t("home.soon") }),
      el("p", { class: "intro", text: t("practice.soon") }),
    );
  },
  unmount() {},
};
