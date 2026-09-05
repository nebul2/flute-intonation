/* Asking for feedback: what gets prefilled, and how often it is asked.
 *
 * The restraint is the feature. A prompt that reappears is a nag, and the
 * people being asked here are doing a favour. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { diagnostics, body, mailto, shouldInvite, ADDRESS, ISSUES, INVITE_AFTER_SESSIONS }
  from "../feedback.js";

const CONTEXT = {
  settings: { temperament: "vallotti", root: "C", referenceHz: 415, mode: "pure" },
  engine: { sampleRate: 48000, granted: { autoGainControl: false, noiseSuppression: false, echoCancellation: false } },
  page: "listen",
  language: "fr",
  navigator: { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0)" },
};

test("the report carries what a teacher should not have to describe", () => {
  // Bug reports from non-technical users are usually unactionable for want of
  // exactly these lines.
  const text = diagnostics(CONTEXT);
  assert.match(text, /^app: phase /m, "which build");
  assert.match(text, /tuning: vallotti on C, A = 415 Hz, pure/, "which tuning");
  assert.match(text, /audio: 48000 Hz/, "what the microphone was given");
  assert.match(text, /AGC off/, "including whether the browser was processing it");
  assert.match(text, /page: listen/);
  assert.match(text, /language: fr/);
});

test("the report is plain readable lines, not an encoded blob", () => {
  // Someone about to email a stranger must be able to see exactly what they
  // are attaching, and delete any line of it. A blob would be more complete
  // and less honest.
  const text = diagnostics(CONTEXT);
  for (const line of text.split("\n")) {
    assert.match(line, /^[a-z]+: /, `"${line}" reads as a label and a value`);
  }
  assert.ok(!/[A-Za-z0-9+/]{60,}={0,2}/.test(text), "nothing base64-shaped");
});

test("a report survives knowing almost nothing", () => {
  // The microphone may never have been started, and the page may not say.
  const text = diagnostics({ navigator: { userAgent: "x" } });
  assert.match(text, /^app: /m, "the version is always there");
  assert.ok(!text.includes("undefined"), text);
  assert.ok(!text.includes("null"), text);
});

test("the player's own words come first, the machine's after a separator", () => {
  const text = body(CONTEXT, "What happened:");
  const [mine, theirs] = text.split("\n--\n");
  assert.match(mine, /^What happened:/, "their prompt opens the mail");
  assert.match(theirs, /^app: /, "and the diagnostics are visibly separate");
  assert.ok(mine.indexOf("app:") === -1, "with nothing technical above the fold");
});

test("the mail link addresses the mailbox, or is absent rather than broken", () => {
  // The address is a dedicated one in a public repository, replaceable if it
  // attracts spam. Empty is a supported state: the buttons fall back to
  // copying and to the issue tracker, so nothing is ever a dead link.
  const href = mailto("subject", CONTEXT, "prompt");
  if (ADDRESS === "") {
    assert.equal(href, null, "no address means no mail button at all");
    return;
  }
  assert.match(ADDRESS, /^[^@\s]+@[^@\s]+\.[^@\s]+$/, `${ADDRESS} is not an address`);
  assert.ok(!ADDRESS.includes(" "), "an address with a space would break the link");
  const url = new URL(href);
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, ADDRESS, "the link must reach the mailbox itself");

  const params = new URLSearchParams(url.search);
  assert.equal(params.get("subject"), "subject");
  assert.match(params.get("body"), /^prompt/, "their words open the mail");
  assert.match(params.get("body"), /\napp: phase /, "and the setup follows below");
});

test("a configured address produces a link that survives the encoding", () => {
  // Exercised through body/encodeURIComponent rather than the module constant,
  // so the test holds whichever way ADDRESS is set.
  const encoded = encodeURIComponent(body(CONTEXT, "Ça n'a pas marché — l'écart était trop grand"));
  assert.ok(!encoded.includes(" "), "spaces are encoded");
  assert.ok(!encoded.includes("\n"), "newlines are encoded");
  assert.equal(decodeURIComponent(encoded).includes("Ça n'a pas marché"), true, "accents survive");
});

test("the issue tracker is a real absolute link", () => {
  assert.match(ISSUES, /^https:\/\/github\.com\//);
});

test("nobody is asked before they have an opinion, or twice", () => {
  for (let n = 0; n < INVITE_AFTER_SESSIONS; n++) {
    assert.equal(shouldInvite({ sessions: n, asked: false }), false, `${n} sessions is too early`);
  }
  assert.equal(shouldInvite({ sessions: INVITE_AFTER_SESSIONS, asked: false }), true);
  assert.equal(shouldInvite({ sessions: 50, asked: true }), false, "asked once is asked for good");
  assert.equal(shouldInvite({ sessions: 0, asked: true }), false);
});
