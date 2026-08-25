/* The "read more" disclosure any page can drop in.
 *
 *   root.append(helpSection("stopper").element);
 *
 * A native <details>, so it is keyboard-accessible and needs no toggle logic
 * of its own. The document is fetched the first time it is opened, rendered
 * from Markdown, and offered for download as the original file. Reopening
 * costs nothing; a failure says so instead of silently showing an empty box. */

import { t, lang, onLanguageChange } from "../i18n.js";
import * as help from "../help.js";
import { download } from "../download.js";
import { render } from "./markdown.js";
import { el } from "./widgets.js";

export function helpSection(topic) {
  const body = el("div", { class: "help-body" });
  const summary = el("summary", { text: t(`help.${topic}.label`) });
  const details = el("details", { class: "help" }, [summary, body]);

  let loadedLanguage = null;

  async function show() {
    if (loadedLanguage === lang()) return;
    const wanted = lang();
    body.replaceChildren(el("p", { class: "muted", text: t("help.loading") }));
    try {
      const { text, filename } = await help.load(topic, wanted);
      const article = el("article", { class: "help-doc" });
      article.append(render(text));
      body.replaceChildren(article, el("div", { class: "controls left" }, [
        el("button", {
          class: "secondary", text: t("help.download"),
          onclick: () => download(filename, text, "text/markdown;charset=utf-8"),
        }),
      ]));
      loadedLanguage = wanted;
    } catch (error) {
      body.replaceChildren(el("p", { class: "note-box", text: t("help.failed", error.message) }));
      loadedLanguage = null;
    }
  }

  details.addEventListener("toggle", () => { if (details.open) show(); });
  // Switching language while it is open swaps the document; while it is shut,
  // the stale copy is dropped so the next open fetches the right one.
  const off = onLanguageChange(() => {
    summary.textContent = t(`help.${topic}.label`);
    if (details.open) show(); else loadedLanguage = null;
  });

  return { element: details, dispose: off };
}
