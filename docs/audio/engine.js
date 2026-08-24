/* The one audio engine every section shares.
 *
 * One AudioContext, one microphone stream, one capture worklet, one drone.
 * Sections subscribe to frames while mounted and unsubscribe when they leave;
 * the engine keeps running across navigation so the player is not asked for
 * the microphone again on every page. Starting must happen inside a user
 * gesture (iOS requires it), which is why every section that needs audio
 * shows its own Start button that calls engine.start().
 *
 * Browser lessons from the project notes, applied here: echoCancellation,
 * noiseSuppression and autoGainControl are requested OFF and what the browser
 * actually granted is kept in `engine.granted`, because some browsers ignore
 * the request and AGC would fight every level measurement.
 */

import { Detector } from "./yin.js";

const STATES = ["idle", "starting", "listening", "refused", "error"];

// Notch width is f/Q: at Q = 25 a notch on D4 (277 Hz) is ~11 Hz (~70 cents)
// wide, narrower than the 80-cent acceptance window that decides whether a
// notch may be engaged at all.
const NOTCH_Q = 25;

/* Which of the drone's three partials to remove from the microphone while
 * `targetHz` is expected: every partial more than `acceptanceCents` away from
 * the target. A partial at the target is the player's own note (the unison,
 * or the octave for 2*f0) and must stay -- ducking handles those. */
export function dronePartialsToNotch(droneHz, targetHz, acceptanceCents = 80.0) {
  if (!(droneHz > 0) || !(targetHz > 0)) return [];
  return [1, 2, 3].map((k) => droneHz * k)
    .filter((hz) => Math.abs(1200 * Math.log2(hz / targetHz)) > acceptanceCents);
}

class Drone {
  constructor(engine) {
    this.engine = engine;
    this.nodes = null;
    this.hz = 0;
    this.level = 0.15;
  }

  get playing() { return this.nodes !== null; }

  /* Fundamental plus two partials at -12 dB/octave (amplitude 1/n^2), gentle
   * attack -- the Python drone's recipe. */
  start(hz, level = this.level) {
    const ctx = this.engine.context;
    if (!ctx) return;
    if (this.nodes) this.stop();
    this.hz = hz;
    this.level = level;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.3);
    master.connect(ctx.destination);

    const weights = [1.0, 0.25, 1 / 9];
    const total = weights.reduce((a, b) => a + b, 0);
    const oscillators = weights.map((w, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = hz * (i + 1);
      const gain = ctx.createGain();
      gain.gain.value = w / total;
      osc.connect(gain).connect(master);
      osc.start();
      return osc;
    });
    this.nodes = { master, oscillators };
    this.engine.emit();
  }

  /* Smoothly change the level of a playing drone (used to duck it during a
   * unison note, where its bleed would otherwise mask the player). */
  setLevel(level) {
    this.level = level;
    const ctx = this.engine.context;
    if (!this.nodes || !ctx) return;
    this.nodes.master.gain.setTargetAtTime(level, ctx.currentTime, 0.08);
  }

  stop() {
    if (!this.nodes) return;
    const { master, oscillators } = this.nodes;
    const ctx = this.engine.context;
    if (ctx) {
      master.gain.setTargetAtTime(0.0, ctx.currentTime, 0.05);
      oscillators.forEach((osc) => osc.stop(ctx.currentTime + 0.3));
    }
    this.nodes = null;
    this.engine.emit();
  }
}

class Engine {
  constructor() {
    this.state = "idle";
    this.context = null;
    this.stream = null;
    this.detector = null;
    this.granted = null;
    this.error = null;
    this.lastFrame = null;
    this.frames = 0;
    this.frameListeners = new Set();
    this.stateListeners = new Set();
    this.drone = new Drone(this);
    this.deviceId = null;
  }

  get sampleRate() { return this.context ? this.context.sampleRate : 0; }
  get listening() { return this.state === "listening"; }

  onFrame(cb) { this.frameListeners.add(cb); return () => this.frameListeners.delete(cb); }
  onState(cb) { this.stateListeners.add(cb); return () => this.stateListeners.delete(cb); }

  emit() { this.stateListeners.forEach((cb) => cb(this)); }

  setState(state, error = null) {
    if (!STATES.includes(state)) throw new Error(`bad engine state ${state}`);
    this.state = state;
    this.error = error;
    this.emit();
  }

  /* Call from a user gesture. Resolves when listening; sets `refused` or
   * `error` state otherwise (never throws to the caller). */
  async start({ deviceId = null } = {}) {
    if (this.state === "listening" || this.state === "starting") return;
    this.setState("starting");
    this.deviceId = deviceId;

    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      this.setState("refused", err);
      return;
    }

    try {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      await this.context.resume();
      await this.context.audioWorklet.addModule(new URL("./worklet.js", import.meta.url));
      this.detector = new Detector(this.context.sampleRate);

      const source = this.context.createMediaStreamSource(this.stream);
      const capture = new AudioWorkletNode(this.context, "capture", { numberOfOutputs: 0 });

      // Three notch filters between the microphone and the detector, parked
      // as all-pass (flat magnitude) until setNotches() engages them on the
      // drone's partials. The detector is monophonic and reports whichever
      // periodicity dominates the mic; with a drone through speakers the
      // player otherwise has to out-play its bleed. We synthesise the drone,
      // so we know exactly which frequencies to remove.
      this.notches = [0, 1, 2].map(() => {
        const filter = this.context.createBiquadFilter();
        filter.type = "allpass";
        filter.frequency.value = 1000;
        filter.Q.value = NOTCH_Q;
        return filter;
      });
      source.connect(this.notches[0]);
      this.notches[0].connect(this.notches[1]);
      this.notches[1].connect(this.notches[2]);
      this.notches[2].connect(capture);
      capture.port.onmessage = (event) => {
        const frame = this.detector.process(event.data);
        frame.t = performance.now();
        this.lastFrame = frame;
        this.frames += 1;
        this.frameListeners.forEach((cb) => cb(frame));
      };
      this.granted = this.stream.getAudioTracks()[0].getSettings();
      this.setState("listening");
    } catch (err) {
      this.stop();
      this.setState("error", err);
    }
  }

  /* Engage notches at these frequencies (up to three; 0 or missing = off). */
  setNotches(freqs = []) {
    if (!this.notches || !this.context) return;
    this.notches.forEach((filter, i) => {
      const hz = freqs[i] || 0;
      if (hz > 0) {
        filter.frequency.setValueAtTime(hz, this.context.currentTime);
        filter.type = "notch";
      } else {
        filter.type = "allpass";
      }
    });
  }

  stop() {
    this.drone.stop();
    this.notches = null;
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    if (this.context) this.context.close().catch(() => {});
    this.stream = null;
    this.context = null;
    this.detector = null;
    this.granted = null;
    this.lastFrame = null;
    this.setState("idle");
  }

  /* Input devices, with labels once permission has been granted. */
  async inputDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audioinput");
  }
}

export const engine = new Engine();
