/* One place for every document the app ships.
 *
 * Each page already carries the document that concerns it, folded away. This
 * page exists so the set can be found without knowing which page to look on,
 * and so "how do I read the numbers?" has an answer that is one tap from the
 * footer rather than buried under a result. */

import { t } from "../i18n.js";
import { el, append, explainer } from "../ui/widgets.js";
import { helpSection } from "../ui/help.js";

const DOCS = ["numbers", "intervals", "temperaments", "stopper"];

export default {
  title: () => t("help.title"),

  mount(root) {
    this.sections = DOCS.map((topic) => helpSection(topic));
    append(root,
      explainer(t("help.intro")),
      ...DOCS.flatMap((topic, i) => [
        el("p", { class: "muted small", text: t(`help.doc.${topic}`) }),
        this.sections[i].element,
      ]),
    );
  },

  unmount() { for (const s of this.sections ?? []) s.dispose(); },
};
