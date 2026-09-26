/* Two buttons: go on, and go again.
 *
 * Asked for by a player who practises with a Bluetooth page-turner pedal at
 * her feet, because the thing she wanted most often mid-exercise -- another
 * go at the note she had just played -- could only be had by restarting the
 * whole exercise. A flute takes both hands and the mouth, so a control worked
 * with a foot is not a convenience here; it is the only free limb.
 *
 * These pedals present themselves as keyboards, and there is no standard for
 * what they send: page-turner mode is usually PageDown/PageUp, "media" mode
 * sends arrows, some send space or enter, and a few send letters. Every
 * plausible key is accepted so that most players never have to find out which
 * they own; the rest can say so on the hardware-check page, which reports the
 * key and offers to remember it. A key that a browser or another use needs
 * back -- Tab, Escape -- is deliberately not in the table.
 *
 * FORWARD is "I am done with this, move on"; BACK is "that again". Views
 * decide what those mean for them and are expected to agree on the sense:
 * forward never destroys anything, back never skips anything.
 */

import * as settings from "../settings.js";

export const FORWARD = "forward";
export const BACK = "back";

/* Key -> intention. Lower-cased `event.key`, so a shifted press still lands. */
const KEYS = new Map([
  ["pagedown", FORWARD], ["arrowright", FORWARD], ["arrowdown", FORWARD],
  [" ", FORWARD], ["enter", FORWARD],
  ["pageup", BACK], ["arrowleft", BACK], ["arrowup", BACK],
  ["backspace", BACK],
]);

/* The built-in table alone. Exported for the hardware check, which has to be
 * able to say "this key is recognised already" separately from "you have
 * assigned it". */
export function tableIntent(key) {
  return typeof key === "string" ? KEYS.get(key.toLowerCase()) ?? null : null;
}

/* What the player has assigned on the hardware-check page, if anything. */
export function assignments(s = settings.get()) {
  return { forward: s.pedalForward ?? null, back: s.pedalBack ?? null };
}

/* What a key means, assignments first so a pedal that sends something already
 * in the table can still be pointed the other way. Pure: the caller supplies
 * the assignments, which is what makes the whole decision testable without a
 * browser or a stored setting. */
export function intentFor(key, overrides = null) {
  if (typeof key !== "string") return null;
  const lower = key.toLowerCase();
  if (overrides) {
    if (overrides.forward && overrides.forward.toLowerCase() === lower) return FORWARD;
    if (overrides.back && overrides.back.toLowerCase() === lower) return BACK;
  }
  return tableIntent(lower);
}

/* Should this press be taken as a pedal press at all?
 *
 * Two ways it must not be. A pedal press and a space bar in a text field are
 * the same event, and stealing it would make the session label unfillable.
 * And space or enter on a focused button is the browser working that button
 * -- swallow it and a keyboard user cannot press Stop, which would have been
 * shipped in 8.4.5 had the hardware-check page not put a pedal listener on a
 * page full of buttons.
 *
 * Pure, and takes the target's shape rather than the node, so every branch is
 * reachable from a test. */
export function pressIntent(key, { tagName = "", contentEditable = false, overrides = null } = {}) {
  const tag = String(tagName).toUpperCase();
  if (contentEditable === true) return null;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return null;
  const lower = typeof key === "string" ? key.toLowerCase() : "";
  if ((lower === " " || lower === "enter") && (tag === "BUTTON" || tag === "A")) return null;
  return intentFor(key, overrides);
}

/* Subscribe. `handler(intent, event)` is called for a pedal press; return the
 * disposer to an owner() like any other subscription. Return false from the
 * handler to let the press through to the page.
 *
 * Assignments are read at press time, so changing one on the hardware-check
 * page takes effect in an exercise already running. */
export function pedal(handler) {
  const onKey = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target ?? {};
    const intent = pressIntent(event.key, {
      tagName: target.tagName ?? "",
      contentEditable: target.isContentEditable === true,
      overrides: assignments(),
    });
    if (!intent) return;
    if (handler(intent, event) === false) return;
    event.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
