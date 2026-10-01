/* How to help: the page for someone who wants to give something back.
 *
 * The third surface in the app that asks for anything, after the footer link
 * and the one-time invitation, and it is deliberately the passive kind. A
 * card on the home page sits there for whoever goes looking; it never
 * interrupts, carries no badge and is never promoted. The rule in
 * ui/feedback.js still holds -- a favour asked twice is a demand -- and this
 * page may not become a third ask that follows anyone around.
 *
 * What it asks for is narrower and more useful than "tell us what you think":
 * two named movements, recorded on the device that runs the app. The app's
 * own takes of those two are the baseline every detector change is measured
 * against (flutetrainer/data/pieces/telemann-fantasias), so a volunteer's
 * recording lines up against a known answer note for note, which no amount of
 * free playing can do.
 */

import { t } from "../i18n.js";
import { el, append, explainer } from "../ui/widgets.js";
import { feedbackLinks } from "../ui/feedback.js";

/* The score, public domain, in the edition the project's own note data was
 * derived from. Linked rather than bundled: it is thirteen pages of scan and
 * the app is not a score library. */
const IMSLP = "https://imslp.org/wiki/12_Fantasias_for_Flute_without_Bass,_TWV_40:2-13_(Telemann,_Georg_Philipp)";

function piece(key, { easy = false } = {}) {
  return el("li", {}, [
    el("div", {}, [
      el("strong", { text: t(`contribute.piece.${key}.name`) }),
      easy ? el("span", { class: "chip", text: t("contribute.start") }) : null,
    ]),
    el("div", { class: "muted", text: t(`contribute.piece.${key}.note`) }),
  ]);
}

export default {
  title: () => t("contribute.title"),

  mount(root) {
    append(root,
      explainer(t("feedback.trainedOn"), t("contribute.why")),

      el("h2", { text: t("contribute.recordings") }),
      el("p", { class: "intro", text: t("contribute.recordingsIntro") }),
      el("ul", { class: "plain" }, [piece("grave", { easy: true }), piece("largo")]),
      el("p", { class: "muted small" }, [
        t("contribute.score"), " ",
        el("a", { href: IMSLP, target: "_blank", rel: "noopener noreferrer", text: t("contribute.scoreLink") }),
      ]),

      el("h2", { text: t("contribute.how") }),
      el("p", { class: "note-box", text: t("contribute.sameDevice") }),
      el("ul", { class: "plain" }, [
        el("li", { text: t("contribute.how.recorder") }),
        el("li", { text: t("contribute.how.asYouPlay") }),
        el("li", { text: t("contribute.how.mistakes") }),
      ]),

      el("h2", { text: t("contribute.sending") }),
      el("p", { class: "intro", text: t("contribute.sendingHow") }),

      el("h2", { text: t("contribute.saying") }),
      el("p", { class: "intro", text: t("contribute.sayingIntro") }),
      el("ul", { class: "plain" }, [
        el("li", { text: t("contribute.say.useful") }),
        el("li", { text: t("contribute.say.confusing") }),
        el("li", { text: t("contribute.say.wanted") }),
      ]),

      feedbackLinks("contribute", {
        prompt: t("contribute.prompt"),
        subject: t("contribute.subject"),
      }),

      el("h2", { text: t("contribute.inReturn") }),
      el("ul", { class: "plain" }, [
        el("li", { text: t("contribute.return.deleted") }),
        el("li", { text: t("contribute.return.private") }),
        el("li", { text: t("contribute.return.told") }),
        el("li", { text: t("contribute.return.anonymous") }),
      ]),
    );
  },
};
