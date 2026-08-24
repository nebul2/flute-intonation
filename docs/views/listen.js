/* Listen to me: a description page until it exists. */
import { t } from "../i18n.js";
import { el } from "../ui/widgets.js";

export default {
  title: () => t("listen.title"),
  mount(root) {
    root.append(
      el("span", { class: "chip", text: t("home.soon") }),
      el("p", { class: "intro", text: t("listen.soon") }),
    );
  },
  unmount() {},
};
