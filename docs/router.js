/* A hash router: '#/tuner' -> the tuner view. Hash routes need no server
 * configuration, which matters on a static host, and the browser's own back
 * button works. Each view is {title(), mount(root), unmount()}; only one is
 * mounted at a time. */

export const ROUTES = Object.freeze({
  "": "home",
  tuner: "tuner",
  practice: "practice",
  tuning: "tuning",
  settings: "settings",
  check: "check",
  listen: "listen",
  stopper: "stopper",
  sessions: "sessions",
  temperament: "temperament",
  temperaments: "temperaments",
  bend: "bend",
  feedback: "feedback",
});

export function currentRoute() {
  const hash = (typeof location !== "undefined" ? location.hash : "") || "";
  const name = hash.replace(/^#\/?/, "").split("?")[0];
  return ROUTES[name] ?? "home";
}

export function navigate(name) {
  location.hash = name === "home" ? "#/" : `#/${name}`;
}

export function back() {
  if (history.length > 1) history.back();
  else navigate("home");
}

export class Router {
  constructor(views, render) {
    this.views = views;      // name -> view module
    this.render = render;    // (name, view) -> root element for the view
    this.mounted = null;
  }

  start() {
    window.addEventListener("hashchange", () => this.show());
    this.show();
  }

  show() {
    const name = currentRoute();
    const view = this.views[name];
    if (this.mounted?.view.unmount) this.mounted.view.unmount();
    const root = this.render(name, view);
    view.mount(root);
    this.mounted = { name, view };
    window.scrollTo(0, 0);
  }

  /* Re-mount the current view (after a language change). */
  refresh() { this.show(); }
}
