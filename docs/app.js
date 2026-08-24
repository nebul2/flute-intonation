/* Boot: language, settings, the shell (header, status strip, footer), and the
 * router. Views own everything inside <main>. */

import { t, setLanguage, detectLanguage, onLanguageChange } from "./i18n.js";
import * as settings from "./settings.js";
import { Router, currentRoute, back } from "./router.js";
import { el, statusText } from "./ui/widgets.js";

import home from "./views/home.js";
import tuner from "./views/tuner.js";
import practice from "./views/practice.js";
import tuning from "./views/tuning.js";
import settingsView from "./views/settings.js";
import check from "./views/check.js";
import listen from "./views/listen.js";
import stopper from "./views/stopper.js";

export const VERSION = "phase 2.8 · 2026-08-24";

const VIEWS = { home, tuner, practice, tuning, settings: settingsView, check, listen, stopper };

function $(id) { return document.getElementById(id); }

function renderShell(name, view) {
  const isHome = name === "home";
  $("back").hidden = isHome;
  $("logo").hidden = !isHome;        // the icon marks the landing page; the back
                                     // arrow takes its grid slot inside sections
  $("title").textContent = isHome ? t("app.name") : view.title();
  document.title = isHome ? t("app.name") : `${view.title()} — ${t("app.name")}`;
  $("strip").textContent = statusText();
  const main = $("view");
  main.replaceChildren();
  main.dataset.view = name;
  return main;
}

function renderChrome() {
  $("back").setAttribute("aria-label", t("nav.back"));
  $("srclink").textContent = t("footer.source");
  $("version").textContent = VERSION;
  document.querySelectorAll("[data-lang]").forEach((b) =>
    b.classList.toggle("active", b.dataset.lang === document.documentElement.lang));
}

window.addEventListener("DOMContentLoaded", () => {
  const s = settings.get();
  setLanguage(s.lang ?? detectLanguage());

  const router = new Router(VIEWS, renderShell);
  renderChrome();

  $("back").addEventListener("click", back);
  $("strip").addEventListener("click", () => { location.hash = "#/tuning"; });
  document.querySelectorAll("[data-lang]").forEach((b) =>
    b.addEventListener("click", () => {
      settings.set({ lang: b.dataset.lang });
      setLanguage(b.dataset.lang);
    }));

  onLanguageChange(() => { renderChrome(); router.refresh(); });
  settings.subscribe(() => { $("strip").textContent = statusText(); });

  router.start();
  void currentRoute;
  void el;
});
