/* The landing page: six cards, working ones first, "coming" ones last. */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import { navigate } from "../router.js";
import { el } from "../ui/widgets.js";

const CARDS = [
  { route: "tuner", icon: iconTuner },
  { route: "practice", icon: iconPractice },
  { route: "tuning", icon: iconTuning },
  { route: "settings", icon: iconSettings },
  { route: "check", icon: iconCheck },
  { route: "listen", icon: iconListen, soon: true },
];

function svg(paths, extra = "") {
  return `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}${extra}</svg>`;
}
function iconTuner() { return svg('<path d="M12 4v11"/><circle cx="12" cy="18" r="3"/><path d="M5 9l7-5 7 5"/>'); }
function iconPractice() { return svg('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'); }
function iconTuning() { return svg('<path d="M12 4v16M4 8h16"/><path d="M6 8l-2 6h4l-2-6zM18 8l-2 6h4l-2-6z"/>'); }
function iconSettings() { return svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'); }
function iconCheck() { return svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6"/>'); }
function iconListen() { return svg('<path d="M7 9a5 5 0 0110 0c0 3-3 4-3 7a2 2 0 01-4 0"/><path d="M4 12h2M18 12h2"/>'); }

export default {
  title: () => t("app.name"),

  mount(root) {
    const chip = el("span", { class: "chip audio" });
    const update = () => {
      chip.textContent = engine.state === "error"
        ? t("audio.error", engine.error?.message ?? "?") : t(`audio.${engine.state}`);
      chip.dataset.state = engine.state;
    };
    this.off = engine.onState(update);
    update();

    const grid = el("div", { class: "cards" }, CARDS.map(({ route, icon, soon }) =>
      el("button", {
        class: `card${soon ? " soon" : ""}`,
        onclick: () => navigate(route),
        "aria-label": t(`home.card.${route}.title`),
      }, [
        el("div", { class: "card-icon", html: icon() }),
        el("div", { class: "card-title" }, [
          t(`home.card.${route}.title`),
          soon ? el("span", { class: "chip", text: t("home.soon") }) : null,
        ]),
        el("div", { class: "card-desc", text: t(`home.card.${route}.desc`) }),
      ])));

    root.append(
      el("p", { class: "tagline", text: t("app.tagline") }),
      el("div", { class: "audio-line" }, [chip]),
      grid,
    );
  },

  unmount() { if (this.off) this.off(); },
};
