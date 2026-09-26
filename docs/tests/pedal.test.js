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

/* ---- where "again" lands -------------------------------------------- */

import { takeBackTarget } from "../views/run.js";

const entry = (exIdx, noteIdx) => ({ counted: true, judged: false, row: null, exIdx, noteIdx });

test("after the run has moved on, back still reaches the note that was played", () => {
  // Miki's report, and the bug behind it. 8.4.5 could only reach the note on
  // screen, so a press arriving later than the 900 ms gap between notes hit
  // the *next* note instead: nothing visibly happened and the previous note's
  // reading was deleted. Playing note 1, letting note 2 start, then pressing
  // back must land on note 1.
  const target = takeBackTarget({
    phase: "playing", log: [entry(0, 0)], exIdx: 0, noteIdx: 1, hasNote: true,
  });
  assert.deepEqual(target, { give: "logged", exIdx: 0, noteIdx: 0 });
});

test("back walks the history one note at a time", () => {
  const log = [entry(0, 0), entry(0, 1), entry(0, 2)];
  assert.equal(takeBackTarget({ phase: "playing", log, exIdx: 0, noteIdx: 3, hasNote: true }).noteIdx, 2);
  log.pop();
  assert.equal(takeBackTarget({ phase: "playing", log, exIdx: 0, noteIdx: 2, hasNote: true }).noteIdx, 1);
  log.pop();
  assert.equal(takeBackTarget({ phase: "playing", log, exIdx: 0, noteIdx: 1, hasNote: true }).noteIdx, 0);
});

test("back reaches across an exercise boundary", () => {
  // Adjust to the drone is two one-note exercises over different basses, so
  // its first note is always a segment behind by the time anyone decides to
  // play it again. The target names the exercise as well as the note.
  const target = takeBackTarget({
    phase: "playing", log: [entry(0, 0)], exIdx: 1, noteIdx: 0, hasNote: true,
  });
  assert.deepEqual(target, { give: "logged", exIdx: 0, noteIdx: 0 });
});

test("with nothing finished, back starts the note in progress over", () => {
  assert.deepEqual(
    takeBackTarget({ phase: "playing", log: [], exIdx: 0, noteIdx: 0, hasNote: true }),
    { give: "nothing", exIdx: 0, noteIdx: 0 });
  // ...and with no note at all there is nothing to do rather than something odd.
  assert.equal(takeBackTarget({ phase: "playing", log: [], hasNote: false }), null);
});

test("a call not yet made is taken back with its own note", () => {
  // In judging the reading is already in the summary but has no row, so it
  // comes back from there rather than from the log.
  assert.deepEqual(
    takeBackTarget({ phase: "judging", log: [entry(0, 0)], exIdx: 0, noteIdx: 1, hasNote: true }),
    { give: "pending", exIdx: 0, noteIdx: 1 });
});

test("back does nothing while calibrating or once the run is over", () => {
  for (const phase of ["calibrating", "finished"]) {
    assert.equal(takeBackTarget({ phase, log: [entry(0, 0)], exIdx: 0, noteIdx: 1, hasNote: true }), null, phase);
  }
});
