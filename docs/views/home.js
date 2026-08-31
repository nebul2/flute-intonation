/* The landing page: cards in three labelled groups -- tools you use on the
 * instrument, ways to play, and how the app is set up. */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import { navigate } from "../router.js";
import { el } from "../ui/widgets.js";

const SECTIONS = [
  { key: "tools", cards: [
    { route: "tuner", icon: iconTuner },
    { route: "stopper", icon: iconStopper },
    { route: "temperament", icon: iconTemperament, experimental: true },
    { route: "temperaments", icon: iconCompare },
    { route: "check", icon: iconCheck },
    { route: "bend", icon: iconBend },
  ] },
  { key: "play", cards: [
    { route: "practice", icon: iconPractice },
    { route: "listen", icon: iconListen },
    { route: "sessions", icon: iconSessions },
  ] },
  { key: "setup", cards: [
    { route: "tuning", icon: iconTuning },
    { route: "settings", icon: iconSettings },
  ] },
];

function svg(paths) {
  return `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
function iconTuner() { return svg('<path d="M12 4v11"/><circle cx="12" cy="18" r="3"/><path d="M5 9l7-5 7 5"/>'); }
function iconStopper() { return svg('<rect x="3" y="8" width="18" height="8" rx="2"/><rect x="6" y="9.5" width="4" height="5" rx="1" fill="currentColor"/><path d="M14 12h4M16 10v4"/>'); }
function iconPractice() { return svg('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'); }
function iconTuning() { return svg('<path d="M12 4v16M4 8h16"/><path d="M6 8l-2 6h4l-2-6zM18 8l-2 6h4l-2-6z"/>'); }
function iconSettings() { return svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'); }
function iconCheck() { return svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6"/>'); }
function iconTemperament() { return svg('<path d="M4 17V7M8 17V5M12 17v-8M16 17V6M20 17v-9"/><path d="M2 20h20"/>'); }
function iconCompare() { return svg('<path d="M4 7h6M4 12h6M4 17h6M14 7h6M14 12h6M14 17h6"/><path d="M12 4v16"/>'); }
function iconBend() { return svg('<path d="M4 18c4 0 4-12 8-12s4 12 8 12"/><path d="M2 12h20" stroke-dasharray="2 3"/>'); }
function iconSessions() { return svg('<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18.5" cy="18" r="2.5"/>'); }
function iconListen() { return svg('<path d="M7 9a5 5 0 0110 0c0 3-3 4-3 7a2 2 0 01-4 0"/><path d="M4 12h2M18 12h2"/>'); }

function card({ route, icon, soon, experimental }) {
  return el("button", {
    class: `card${soon ? " soon" : ""}${experimental ? " experimental" : ""}`,
    onclick: () => navigate(route),
    "aria-label": t(`home.card.${route}.title`),
  }, [
    el("div", { class: "card-icon", html: icon() }),
    el("div", { class: "card-title" }, [
      t(`home.card.${route}.title`),
      soon ? el("span", { class: "chip", text: t("home.soon") }) : null,
      experimental ? el("span", { class: "chip warn-chip", text: t("home.experimental") }) : null,
    ]),
    el("div", { class: "card-desc", text: t(`home.card.${route}.desc`) }),
  ]);
}

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

    root.append(
      el("p", { class: "tagline", text: t("app.tagline") }),
      el("div", { class: "audio-line" }, [chip]),
      ...SECTIONS.map(({ key, cards }) => el("section", { class: "home-section" }, [
        el("h2", { class: "section-label", text: t(`home.section.${key}`) }),
        el("div", { class: "cards" }, cards.map(card)),
      ])),
    );
  },

  unmount() { if (this.off) this.off(); },
};
