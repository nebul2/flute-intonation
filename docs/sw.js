/* Service worker: offline use without giving up "push is the release".
 *
 * Network-first, cache as fallback. While online every request goes to the
 * network and the answer refreshes the cache, so a visitor always runs the
 * files that were just pushed; only when the network fails is the cached
 * copy served. The whole app is precached on install so the first offline
 * open after a visit works in full. Cross-origin requests (the audience
 * counter) are never intercepted or cached: offline, they simply fail.
 *
 * PRECACHE must list every file the app serves. A test compares it against
 * the files on disk, so a new module cannot be forgotten. */

const VERSION = "phase 5.3 · 2026-08-31";
const CACHE = `bongout-${VERSION}`;

const PRECACHE = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "app.js",
  "analytics.js",
  "history.js",
  "i18n.js",
  "router.js",
  "settings.js",
  "core/identify.js",
  "views/temperament.js",
  "views/temperaments.js",
  "views/bend.js",
  "core/bend.js",
  "profiles.js",
  "audio/engine.js",
  "audio/regions.js",
  "audio/segmenter.js",
  "audio/worklet.js",
  "audio/yin.js",
  "download.js",
  "help.js",
  "core/compare.js",
  "core/generator.js",
  "core/pitch.js",
  "core/resolver.js",
  "core/scoring.js",
  "core/stats.js",
  "core/temperaments.js",
  "core/tuning.js",
  "help/stopper.en.md",
  "help/temperaments.en.md",
  "help/temperaments.fr.md",
  "help/stopper.fr.md",
  "ui/help.js",
  "ui/markdown.js",
  "ui/naming.js",
  "ui/widgets.js",
  "views/check.js",
  "views/home.js",
  "views/listen.js",
  "views/practice.js",
  "views/run.js",
  "views/sessions.js",
  "views/settings.js",
  "views/stopper.js",
  "views/tuner.js",
  "views/tuning.js",
  "icon/nebul2-icon-180.png",
  "icon/nebul2-icon-192.png",
  "icon/nebul2-icon-32.png",
  "icon/nebul2-icon-512.png",
  "icon/nebul2-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = (await cache.match("./")) || (await cache.match("index.html"));
      if (shell) return shell;
    }
    throw error;
  }
}
