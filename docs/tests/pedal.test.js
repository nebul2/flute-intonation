/* The two-button vocabulary, and taking a note back. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { intentFor, pressIntent, tableIntent, FORWARD, BACK } from "../ui/pedal.js";
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

/* ---- what an assignment changes ------------------------------------- */

test("a pedal nobody predicted can be assigned, and the assignment wins", () => {
  // Some page-turners send letters. The table cannot grow fast enough to
  // cover every one, so the hardware-check page lets the player name it.
  assert.equal(tableIntent("b"), null, "not in the table");
  assert.equal(intentFor("b", { forward: "b", back: "n" }), FORWARD);
  assert.equal(intentFor("n", { forward: "b", back: "n" }), BACK);

  // And an assignment beats the table, so a pedal sending ArrowLeft can be
  // pointed forwards if that is which way round it sits under the foot.
  assert.equal(tableIntent("arrowleft"), BACK);
  assert.equal(intentFor("arrowleft", { forward: "arrowleft", back: null }), FORWARD);

  // Assignments are compared case-insensitively, like the table.
  assert.equal(intentFor("B", { forward: "b", back: null }), FORWARD);
  // An empty assignment is not a key that matches everything.
  assert.equal(intentFor("q", { forward: null, back: null }), null);
});

test("typing is not pedalling", () => {
  // A pedal press and a space bar in a text field are the same event, and
  // stealing it would make the session label unfillable.
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(pressIntent(" ", { tagName }), null, tagName);
    assert.equal(pressIntent("PageDown", { tagName }), null, tagName);
  }
  assert.equal(pressIntent(" ", { tagName: "DIV", contentEditable: true }), null);
  assert.equal(pressIntent(" ", { tagName: "DIV" }), FORWARD, "an ordinary page is fair game");
});

test("space and enter on a focused button stay the browser's", () => {
  // Swallow these and a keyboard user cannot press Stop. The hardware-check
  // page is a panel full of buttons, which is how this came to light.
  for (const tagName of ["BUTTON", "A"]) {
    assert.equal(pressIntent(" ", { tagName }), null, `space on ${tagName}`);
    assert.equal(pressIntent("Enter", { tagName }), null, `enter on ${tagName}`);
    // The pedal-shaped keys still work there: no button is activated by them.
    assert.equal(pressIntent("PageDown", { tagName }), FORWARD, `pagedown on ${tagName}`);
    assert.equal(pressIntent("ArrowLeft", { tagName }), BACK, `arrowleft on ${tagName}`);
  }
});
