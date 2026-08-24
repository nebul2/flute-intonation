/* Anonymous audience measurement via GoatCounter -- counts, not people.
 *
 * What is sent: the name of the section opened ("tuner", "practice", ...),
 * once per navigation. What is not: the URL, any setting, any note, any
 * result. GoatCounter itself sets no cookie and stores no IP address (it
 * keeps a salted hash that rotates daily), which is what keeps this inside
 * the audience-measurement exemption rather than consent-banner territory.
 *
 * The script is loaded only when measurement is enabled, so switching it off
 * in Settings means nothing is fetched at all; browsers signalling Do Not
 * Track are treated as switched off; localhost is never counted. */

import * as settings from "./settings.js";

const ENDPOINT = "https://benflute.goatcounter.com/count";
const SCRIPT = "https://gc.zgo.at/count.js";

let loading = null;

export function enabled() {
  if (typeof window === "undefined") return false;
  if (settings.get().analytics === false) return false;
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return false;
  const host = location.hostname;
  return host !== "localhost" && host !== "127.0.0.1" && host !== "";
}

function load() {
  if (loading) return loading;
  window.goatcounter = { no_onload: true, allow_frame: false };
  loading = new Promise((resolve) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = SCRIPT;
    script.dataset.goatcounter = ENDPOINT;
    script.onload = resolve;
    script.onerror = resolve;           // blocked or offline: silently no stats
    document.head.append(script);
  });
  return loading;
}

/* Record that a section was opened. `route` is a bare name, never a URL. */
export function pageview(route) {
  if (!enabled()) return;
  load().then(() => {
    const gc = window.goatcounter;
    if (gc && typeof gc.count === "function") gc.count({ path: route, title: route, event: false });
  });
}
