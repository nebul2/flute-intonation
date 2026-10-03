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

/* A fake Web Audio graph that records how it was built. Enough of one to walk
 * the whole of start(): what the context was asked for, and what got wired to
 * what -- which is the only way to pin a connection whose entire purpose is
 * to exist. */
function stubGraph({ trackRate = 48000 } = {}) {
  const log = { contexts: [], wires: [] };
  const node = (name) => ({ name, connect(to) { log.wires.push(`${name} -> ${to.name}`); } });
  class FakeContext {
    constructor(options) {
      log.contexts.push(options ?? null);
      if (options && options.sampleRate === 0) throw new Error("unsupported rate");
      this.state = "suspended";
      this.sampleRate = options?.sampleRate ?? 44100;
      this.currentTime = 0;
      this.destination = node("destination");
      this.audioWorklet = { addModule: async () => {} };
    }
    resume() { this.state = "running"; return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
    createMediaStreamSource() { return node("source"); }
    createBiquadFilter() { return Object.assign(node("notch"), { type: "", frequency: { value: 0 }, Q: { value: 0 } }); }
    createGain() { return Object.assign(node("gain"), { gain: { value: 1 } }); }
  }
  globalThis.navigator ??= {};
  navigator.mediaDevices = {
    getUserMedia: async () => ({
      getAudioTracks: () => [{ getSettings: () => (trackRate ? { sampleRate: trackRate } : {}), muted: false, enabled: true }],
      getTracks: () => [{ stop() {} }],
    }),
  };
  globalThis.window = { AudioContext: FakeContext };
  globalThis.AudioWorkletNode = function () { return Object.assign(node("capture"), { port: {} }); };
  return log;
}

test("the input track reports itself for diagnosis", async () => {
  reset();
  stubGraph({ trackRate: 48000 });
  await engine.start();
  assert.match(engine.trackInfo, /48000 Hz, unmuted, enabled/);
  engine.stop();
  assert.equal(engine.trackInfo, "none", "and says so once there is no stream");
});

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

/* ---- the analysis rate --------------------------------------------------- */

/* A fake graph whose context can refuse a rate in either of the two ways
 * real browsers do: in its constructor (older Safari) or when a stream at
 * another rate is connected (Firefox). */
function rateGraph({ trackRate = 16000, refuse = null } = {}) {
  const log = { contexts: [], closed: 0 };
  const node = (name) => ({ name, connect() {} });
  class FakeContext {
    constructor(options) {
      log.contexts.push(options ?? null);
      if (refuse === "constructor" && options?.sampleRate) throw new Error("rate not supported");
      this.sampleRate = options?.sampleRate ?? trackRate;
      this.state = "suspended"; this.currentTime = 0;
      this.destination = node("destination");
      this.audioWorklet = { addModule: async () => {} };
    }
    resume() { this.state = "running"; return Promise.resolve(); }
    close() { log.closed += 1; this.state = "closed"; return Promise.resolve(); }
    createMediaStreamSource() {
      if (refuse === "connect" && this.sampleRate !== trackRate) {
        const err = new Error("different sample-rate"); err.name = "NotSupportedError"; throw err;
      }
      return node("source");
    }
    createBiquadFilter() { return Object.assign(node("notch"), { type: "", frequency: { value: 0 }, Q: { value: 0 } }); }
    createGain() { return Object.assign(node("gain"), { gain: { value: 1 } }); }
  }
  globalThis.navigator ??= {};
  navigator.mediaDevices = {
    getUserMedia: async () => ({
      getAudioTracks: () => [{ getSettings: () => ({ sampleRate: trackRate }), muted: false, enabled: true }],
      getTracks: () => [{ stop() {} }],
    }),
  };
  globalThis.window = { AudioContext: FakeContext };
  globalThis.AudioWorkletNode = function () { return Object.assign(node("capture"), { port: {} }); };
  return log;
}

test("the analysis runs at 48 kHz whatever the microphone runs at", async () => {
  // An iPad with AirPods connected: a 16 kHz voice-call microphone.
  reset();
  const log = rateGraph({ trackRate: 16000 });
  await engine.start();
  assert.equal(engine.state, "listening");
  assert.equal(log.contexts[0]?.sampleRate, 48000);
  assert.equal(engine.sampleRate, 48000);
  assert.equal(engine.contextFallback, false);
  assert.equal(engine.inputRate, 16000);
  assert.equal(engine.narrowInput, true, "and the narrow microphone is still named");
  engine.stop();
});

test("a browser that will not take the rate falls back to its own", async () => {
  for (const refuse of ["constructor", "connect"]) {
    reset();
    const log = rateGraph({ trackRate: 44100, refuse });
    await engine.start();
    assert.equal(engine.state, "listening", `${refuse}: still starts`);
    assert.equal(engine.contextFallback, true, refuse);
    assert.equal(engine.sampleRate, 44100, `${refuse}: the device's own rate`);
    assert.equal(log.contexts.at(-1), null, `${refuse}: retried with no options`);
    if (refuse === "connect") assert.equal(log.closed, 1, "the refused context is closed");
    assert.equal(engine.narrowInput, false);
    engine.stop();
  }
});
