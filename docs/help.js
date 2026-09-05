/* Background documents shipped with the app.
 *
 * Each topic has one Markdown file per language under help/. They are fetched
 * on demand -- nobody pays for them until they ask -- cached once fetched, and
 * precached by the service worker, so they read offline like everything else.
 * A test fails if a shipped file is missing from either the registry or the
 * service worker's list.
 *
 * To add a topic: drop `help/<topic>.<lang>.md` in, add a line to TOPICS, and
 * add `help.<topic>.label` to both languages in i18n.js. */

export const TOPICS = Object.freeze({
  stopper: Object.freeze({ en: "help/stopper.en.md", fr: "help/stopper.fr.md" }),
  temperaments: Object.freeze({ en: "help/temperaments.en.md", fr: "help/temperaments.fr.md" }),
  intervals: Object.freeze({ en: "help/intervals.en.md", fr: "help/intervals.fr.md" }),
});

const cache = new Map();

/* The path for a topic in a language, falling back to English and then to
 * whatever the topic does have, so a partly translated set still reads. */
export function pathFor(topic, language = "en") {
  const entry = TOPICS[topic];
  if (!entry) return null;
  return entry[language] ?? entry.en ?? Object.values(entry)[0] ?? null;
}

export async function load(topic, language = "en") {
  const path = pathFor(topic, language);
  if (!path) throw new Error(`no help topic ${topic}`);
  if (cache.has(path)) return { text: cache.get(path), path, filename: path.split("/").pop() };

  const response = await fetch(new URL(`./${path}`, import.meta.url));
  if (!response.ok) throw new Error(`${response.status} fetching ${path}`);
  const text = await response.text();
  cache.set(path, text);
  return { text, path, filename: path.split("/").pop() };
}
