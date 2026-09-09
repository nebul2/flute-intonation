/* The microphone start path, with getUserMedia stubbed.
 *
 * Nothing else here can be tested headlessly -- AudioContext and the worklet
 * are the browser's -- but the constraint handling is plain logic, and it is
 * the part that has silently cost a player their microphone. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { engine } from "../audio/engine.js";

/* getUserMedia that fails with `failWith` while a deviceId is asked for, and
 * otherwise hands back a stream. Records every constraint it was given. */
function stubMedia(failWith) {
  const asked = [];
  globalThis.navigator ??= {};
  navigator.mediaDevices = {
    getUserMedia: async ({ audio }) => {
      asked.push(audio);
      if (audio.deviceId && failWith) {
        const err = new Error("device gone");
        err.name = failWith;
        throw err;
      }
      return { getAudioTracks: () => [{ getSettings: () => ({}) }], getTracks: () => [{ stop() {} }] };
    },
  };
  // The engine builds its graph after the stream arrives; without a real
  // AudioContext that throws, which lands it in "error" -- after the part
  // under test has already happened.
  globalThis.window = { AudioContext: function () { throw new Error("no audio in node"); } };
  return asked;
}

const reset = () => { engine.state = "idle"; engine.stream = null; engine.context = null; };

test("an expired microphone id falls back to the default device", async () => {
  // Safari rotates deviceId between sessions. Asked for with `exact`, a stale
  // id is a hard failure, and the player reads it as a dead microphone.
  for (const name of ["OverconstrainedError", "ConstraintNotSatisfiedError", "NotFoundError"]) {
    reset();
    const asked = stubMedia(name);
    await engine.start({ deviceId: "an id from a previous session" });
    assert.equal(asked.length, 2, `${name}: asked again`);
    assert.ok(asked[0].deviceId, "the first attempt asked for the saved microphone");
    assert.equal(asked[1].deviceId, undefined, "the second asked for whatever is there");
    assert.equal(engine.deviceDropped, true, "and says so, for the caller to forget the id");
    assert.notEqual(engine.state, "refused", `${name}: not reported as a refusal`);
  }
});

test("a real refusal is still a refusal", async () => {
  reset();
  const asked = stubMedia("NotAllowedError");
  await engine.start({ deviceId: "whatever" });
  assert.equal(asked.length, 1, "permission denied is not retried");
  assert.equal(engine.state, "refused");
  assert.equal(engine.deviceDropped, false);
});

test("with no saved microphone nothing is retried", async () => {
  reset();
  const asked = stubMedia("OverconstrainedError");
  await engine.start();
  assert.equal(asked.length, 1);
  assert.equal(engine.deviceDropped, false);
});
