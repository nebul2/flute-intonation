/* Practice history: on this device only, in IndexedDB, never sent anywhere.
 * Records use the Python version's session schema (v: 1) plus `app`, `at`
 * and `exercise`, so an exported file reads the same as a desktop session.
 * Falls back to memory when IndexedDB is unavailable (private mode, node). */

import { download } from "./download.js";

const DB = "flute-intonation";
const STORE = "sessions";

let memory = [];

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true }).createIndex("at", "at");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const result = fn(store);
    transaction.oncomplete = () => resolve(result.result ?? result);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function add(record) {
  const entry = { ...record, at: record.at ?? new Date().toISOString(), app: "web" };
  const db = await open().catch(() => null);
  if (!db) { memory.push(entry); return entry; }
  await tx(db, "readwrite", (store) => store.add(entry));
  db.close();
  return entry;
}

/* All records, newest first. */
export async function all() {
  const db = await open().catch(() => null);
  if (!db) return [...memory].reverse();
  const rows = await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/* The most recent record satisfying `predicate`. */
export async function latest(predicate) {
  return (await all()).find(predicate) ?? null;
}

/* Delete one session by its auto-increment id. */
export async function remove(id) {
  memory = memory.filter((entry) => entry.id !== id);
  const db = await open().catch(() => null);
  if (!db) return;
  await tx(db, "readwrite", (store) => store.delete(id));
  db.close();
}

export async function clear() {
  memory = [];
  const db = await open().catch(() => null);
  if (!db) return;
  await tx(db, "readwrite", (store) => store.clear());
  db.close();
}

export async function count() { return (await all()).length; }

/* A JSON file of everything, for moving history between devices. The
 * browser decides where it lands; a page can only name it. */
export async function exportFile() {
  const records = await all();
  const text = JSON.stringify({ v: 1, app: "web", exported_at: new Date().toISOString(), sessions: records }, null, 2);
  const filename = download(`flute-intonation-${new Date().toISOString().slice(0, 10)}.json`,
                            text, "application/json");
  return { count: records.length, filename };
}
