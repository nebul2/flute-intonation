/* The two-button vocabulary, and taking a note back. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { intentFor, FORWARD, BACK } from "../ui/pedal.js";
import { SessionSummary, NoteResult } from "../core/scoring.js";
import { SpelledPitch } from "../core/pitch.js";

test("every shape a page-turner pedal sends lands on one of two intentions", () => {
  // These pedals present as keyboards and there is no standard for what they
  // send: page-turner mode is usually PageDown/PageUp, media mode sends
  // arrows, some send space or enter. Accepting all of them is what spares
  // the player having to find out which they own.
  for (const key of ["PageDown", "ArrowRight", "ArrowDown", " ", "Enter"]) {
    assert.equal(intentFor(key), FORWARD, key);
  }
  for (const key of ["PageUp", "ArrowLeft", "ArrowUp", "Backspace"]) {
    assert.equal(intentFor(key), BACK, key);
  }
  assert.equal(intentFor("pagedown"), FORWARD, "case does not matter");
});

test("keys that belong to the browser are left alone", () => {
  // Tab and Escape are how a keyboard user leaves; swallowing them to serve a
  // pedal would trap them.
  for (const key of ["Tab", "Escape", "a", "F5", "Home"]) {
    assert.equal(intentFor(key), null, key);
  }
  assert.equal(intentFor(null), null);
  assert.equal(intentFor(undefined), null);
});

test("a retake replaces the attempt before it, keeping one result per note", () => {
  // The reason it replaces rather than appends: adjust reads the first two
  // results as its two basses. Play the first note twice with appending and
  // it would compare two goes at the same bass and report that the note had
  // not moved -- a confident, wrong verdict.
  const summary = new SessionSummary();
  const at = (cents) => new NoteResult(SpelledPitch.parse("F#4"), 367.0, cents, 2.0, 0.1, 40);
  summary.add(at(12));
  summary.add(at(-30));            // a fluff
  assert.equal(summary.results.length, 2);

  const taken = summary.dropLast();
  assert.equal(taken.meanCents, -30, "the reading comes back so the caller can count it");
  summary.add(at(-14));            // the attempt that was kept
  assert.deepEqual(summary.results.map((r) => r.meanCents), [12, -14]);
});

test("taking back from an empty summary is harmless", () => {
  // "Again" can be pressed on the first note before anything has been played.
  const summary = new SessionSummary();
  assert.equal(summary.dropLast(), null);
  assert.deepEqual(summary.results, []);
});
