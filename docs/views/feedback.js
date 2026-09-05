/* The page behind the footer link: says what feedback is wanted and offers
 * the ways to send it. Reached only by asking for it, so it can be as
 * forthcoming as it likes -- the restraint belongs in the invitation, not
 * here. */

import { t } from "../i18n.js";
import { el, append, explainer } from "../ui/widgets.js";
import { feedbackLinks } from "../ui/feedback.js";

export default {
  title: () => t("feedback.title"),

  mount(root) {
    append(root,
      explainer(t("feedback.about")),
      el("p", { class: "intro", text: t("feedback.wanted") }),
      el("ul", { class: "plain" }, [
        el("li", { text: t("feedback.want.wrong") }),
        el("li", { text: t("feedback.want.confusing") }),
        el("li", { text: t("feedback.want.instrument") }),
        el("li", { text: t("feedback.want.missing") }),
      ]),
      el("p", { class: "note-box", text: t("feedback.trainedOn") }),
      el("p", { class: "note-box", text: t("feedback.sendRecording") }),
      feedbackLinks("feedback"),
    );
  },
};
