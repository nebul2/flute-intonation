/* Two buttons: go on, and go again.
 *
 * Asked for by a player who practises with a Bluetooth page-turner pedal at
 * her feet, because the thing she wanted most often mid-exercise -- another
 * go at the note she had just played -- could only be had by restarting the
 * whole exercise. A flute takes both hands and the mouth, so a control you
 * work with a foot is not a convenience here; it is the only free limb.
 *
 * These pedals present themselves as keyboards, and there is no standard for
 * what they send: page-turner mode is usually PageDown/PageUp, "media" mode
 * sends arrows, and some send space or enter. Rather than ask the player to
 * find out which, every plausible pair is accepted and mapped onto the same
 * two intentions. A key that some pedal sends and some other use needs back
 * (Tab, Escape) is deliberately not in the table.
 *
 * FORWARD is "I am done with this, move on"; BACK is "that again". Views
 * decide what those mean for them and are expected to agree on the sense:
 * forward never destroys anything, back never skips anything.
 */

export const FORWARD = "forward";
export const BACK = "back";

/* Key -> intention. Lower-cased `event.key`, so a shifted press still lands. */
const KEYS = new Map([
  ["pagedown", FORWARD], ["arrowright", FORWARD], ["arrowdown", FORWARD],
  [" ", FORWARD], ["enter", FORWARD],
  ["pageup", BACK], ["arrowleft", BACK], ["arrowup", BACK],
  ["backspace", BACK],
]);

/* What a key press means, or null. Exported so a view can consult the table
 * without subscribing, and so the mapping can be tested without a DOM. */
export function intentFor(key) {
  return typeof key === "string" ? KEYS.get(key.toLowerCase()) ?? null : null;
}

/* Is the player typing rather than pedalling? A pedal press and a space bar
 * in a text field are the same event, and stealing it would make the session
 * label unfillable. */
function editing(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

/* Subscribe. `handler(intent, event)` is called for a mapped key; return the
 * disposer to an owner() like any other subscription.
 *
 * Only a handled press is swallowed: space still scrolls the page, and enter
 * still works a focused button, unless the view actually did something with
 * it. Return false from the handler to let a press through. */
export function pedal(handler) {
  const onKey = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (editing(event.target)) return;
    const intent = intentFor(event.key);
    if (!intent) return;
    if (handler(intent, event) === false) return;
    event.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
