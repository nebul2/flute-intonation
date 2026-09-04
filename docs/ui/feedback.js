/* The two places the app asks what you think, and no others.
 *
 * A permanent link in the footer, which never asks for anything, and one
 * invitation after a few sessions, which asks once and then never again. No
 * modals, no toasts, no badge: the people testing this are doing a favour,
 * and a favour asked twice is a demand.
 */

import { t, lang } from "../i18n.js";
import * as settings from "../settings.js";
import { engine } from "../audio/engine.js";
import * as feedback from "../feedback.js";
import { el, append } from "./widgets.js";

function context(page) {
  return { settings: settings.get(), engine, page, language: lang() };
}

/* Copying is the fallback when no address is configured, and a second route
 * when there is one: a phone with no mail app set up gets nowhere from a
 * mailto, and the report is worth having in the clipboard regardless. */
async function copyReport(page, prompt, note) {
  const text = feedback.body(context(page), prompt);
  try {
    await navigator.clipboard.writeText(text);
    note.textContent = t("feedback.copied");
  } catch (_error) {
    // Denied, or an insecure context. Showing the text is still useful: it can
    // be selected by hand, which is worse but never fails.
    note.replaceChildren(el("textarea", { class: "feedback-fallback", rows: 8, readonly: true, text }));
  }
}

/**
 * The links themselves, shared by the footer and the invitation.
 *
 * @param page which part of the app this is being sent from
 */
export function feedbackLinks(page, { prompt = t("feedback.prompt") } = {}) {
  const note = el("div", { class: "muted small" });
  const href = feedback.mailto(t("feedback.subject"), context(page), prompt);
  const buttons = [];

  if (href) {
    buttons.push(el("a", { class: "button primary", href, text: t("feedback.write") }));
  }
  buttons.push(el("button", {
    class: href ? "secondary" : "primary", text: t("feedback.copy"),
    onclick: () => copyReport(page, prompt, note),
  }));
  buttons.push(el("a", {
    class: "button secondary", href: feedback.ISSUES,
    target: "_blank", rel: "noopener noreferrer", text: t("feedback.issue"),
  }));

  return el("div", { class: "feedback" }, [
    el("div", { class: "controls left" }, buttons),
    el("p", { class: "muted small", text: t("feedback.whatIsSent") }),
    note,
  ]);
}

/**
 * The one-time invitation, for the end of a session's results.
 *
 * Returns null unless it is genuinely time to ask -- enough sessions to have
 * an opinion, and never asked before -- so callers can append the result
 * unconditionally. Dismissing it is as final as answering it: the point is
 * that it is asked once.
 */
export function invitation(page, sessionCount) {
  const s = settings.get();
  if (!feedback.shouldInvite({ sessions: sessionCount, asked: s.feedbackAsked === true })) {
    return null;
  }
  const box = el("div", { class: "invite" });
  const settle = () => {
    settings.set({ feedbackAsked: true });
    box.remove();
  };
  append(box,
    el("p", { text: t("feedback.invite") }),
    feedbackLinks(page, { prompt: t("feedback.invitePrompt") }),
    el("div", { class: "controls left" }, [
      el("button", { class: "secondary", text: t("feedback.notNow"), onclick: settle }),
    ]),
  );
  // Acting on it counts as answering it: nobody should be asked again because
  // they wrote the mail instead of pressing the dismiss button.
  box.addEventListener("click", (e) => {
    if (e.target.closest("a.button, .controls button")) settings.set({ feedbackAsked: true });
  });
  return box;
}
