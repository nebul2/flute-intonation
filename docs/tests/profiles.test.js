/* Keeping one flute's readings under that flute, and only that flute.
 *
 * These readings are slow to take -- three notes each, a few notes a sitting --
 * so losing them or mixing two instruments' together is the worst thing this
 * module can do. Everything here guards one of those two failures. */

import { test } from "node:test";
import assert from "node:assert/strict";

/* localStorage does not exist under node --test; the module must survive that
 * on a real device too (private browsing), so a stub is the honest fixture. */
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; },
};

const profiles = await import("../profiles.js");
const TUNING = { temperament: "vallotti", root: "C", referenceHz: 415, mode: "pure" };
const reset = () => { for (const k of Object.keys(store)) delete store[k]; };

test("a flute exists as soon as it is named, before it is measured", () => {
  // The bug this fixes: a newly named flute that exists only once it has a
  // note cannot be shown in the picker, so naming one looked like losing one.
  reset();
  profiles.ensure("Palanca");
  assert.deepEqual(profiles.names(), ["Palanca"]);
  assert.deepEqual(profiles.entries("Palanca"), [], "and it is empty, not absent");
});

test("renaming carries the readings with it", () => {
  reset();
  profiles.setNote("", "F4", { natural: 14, floor: 10, ceiling: 30 }, TUNING, "now");
  profiles.setNote("", "C4", { natural: -8, floor: -35, ceiling: -6 }, TUNING, "now");
  assert.equal(profiles.entries("").length, 2);

  assert.deepEqual(profiles.rename("", "Palanca"), { ok: true });
  assert.deepEqual(profiles.names(), ["Palanca"], "the old name is gone");
  assert.equal(profiles.entries("Palanca").length, 2, "and both notes came along");
  assert.equal(profiles.get("Palanca").name, "Palanca", "including its own record of it");
});

test("renaming onto an existing flute is refused, not merged", () => {
  // Merging two instruments' readings describes a flute that does not exist,
  // and there is no way back from it.
  reset();
  profiles.setNote("Palanca", "F4", { natural: 14, floor: 10, ceiling: 30 }, TUNING, "now");
  profiles.setNote("Rottenburgh", "F4", { natural: 2, floor: -20, ceiling: 24 }, TUNING, "now");

  assert.deepEqual(profiles.rename("Palanca", "Rottenburgh"), { ok: false, reason: "taken" });
  assert.equal(profiles.entries("Palanca").length, 1, "both survive untouched");
  assert.equal(profiles.entries("Rottenburgh")[0].natural, 2, "and neither was overwritten");
});

test("renaming a flute that is not there says so", () => {
  reset();
  assert.deepEqual(profiles.rename("ghost", "Palanca"), { ok: false, reason: "missing" });
});

test("renaming to the same name is a no-op, not a loss", () => {
  reset();
  profiles.setNote("Palanca", "F4", { natural: 14, floor: 10, ceiling: 30 }, TUNING, "now");
  assert.deepEqual(profiles.rename("Palanca", "Palanca"), { ok: true });
  assert.equal(profiles.entries("Palanca").length, 1);
});

test("two flutes keep separate readings for the same note", () => {
  reset();
  profiles.setNote("Palanca", "F4", { natural: 14, floor: 10, ceiling: 30 }, TUNING, "now");
  profiles.setNote("Rottenburgh", "F4", { natural: 2, floor: -20, ceiling: 24 }, TUNING, "now");
  assert.equal(profiles.entries("Palanca")[0].natural, 14);
  assert.equal(profiles.entries("Rottenburgh")[0].natural, 2);
});

test("re-measuring a note replaces that note and leaves the others alone", () => {
  reset();
  profiles.setNote("Palanca", "F4", { natural: 14, floor: 10, ceiling: 30 }, TUNING, "a");
  profiles.setNote("Palanca", "C4", { natural: -8, floor: -35, ceiling: -6 }, TUNING, "a");
  profiles.setNote("Palanca", "F4", { natural: 11, floor: 6, ceiling: 28 }, TUNING, "b");
  const byPitch = Object.fromEntries(profiles.entries("Palanca").map((e) => [e.pitch, e]));
  assert.equal(byPitch.F4.natural, 11, "the retake wins");
  assert.equal(byPitch.C4.natural, -8, "and nothing else moved");
  assert.equal(profiles.entries("Palanca").length, 2);
});

test("a profile taken under another tuning is flagged rather than compared", () => {
  reset();
  profiles.setNote("Palanca", "F4", { natural: 14, floor: 10, ceiling: 30 }, TUNING, "now");
  assert.equal(profiles.staleFor("Palanca", TUNING), false);
  assert.equal(profiles.staleFor("Palanca", { ...TUNING, referenceHz: 440 }), true);
  assert.equal(profiles.staleFor("Palanca", { ...TUNING, temperament: "meantone_quarter" }), true);
  assert.equal(profiles.staleFor("Palanca", { ...TUNING, root: "F" }), true);
});

test("storage is read through, so a second tab's changes are not missed", () => {
  // The module used to cache its state and never invalidate it: with the app
  // open twice, one tab's readings would be invisible to the other and the
  // next write from the stale tab would erase them.
  reset();
  profiles.setNote("Palanca", "F4", { natural: 14, floor: 10, ceiling: 30 }, TUNING, "now");
  // Something else writes to the same key -- another tab, in practice.
  store["flute-intonation.profiles"] = JSON.stringify({
    Palanca: { name: "Palanca", notes: { G4: { natural: 3, floor: -20, ceiling: 25 } } },
  });
  assert.deepEqual(profiles.entries("Palanca").map((e) => e.pitch), ["G4"],
    "the newer state is seen, not a cached one");
});

test("a corrupt or absent store starts clean instead of throwing", () => {
  reset();
  store["flute-intonation.profiles"] = "{not json";
  assert.deepEqual(profiles.names(), []);
  assert.equal(profiles.get("anything"), null);
});
