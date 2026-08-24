/* Phase 0: the hardware check. Microphone in through the ported detector,
 * drone out through the speakers. No temperaments yet -- note names are equal
 * temperament at the chosen reference, and the page says so. The point of
 * this build is to prove the audio path on hardware we have never met.
 *
 * Browser lessons already in the project's notes, applied here:
 *  - echoCancellation / noiseSuppression / autoGainControl must be OFF, or
 *    the browser's processing fights the level measurements; the diagnostics
 *    line reports what the browser actually granted, because some ignore us;
 *  - everything audio starts inside the click handler (iOS requires it);
 *  - the drone through speakers re-enters the microphone: expected, visible,
 *    and the reason for the headphones note.
 */
"use strict";

const VERSION = "phase 0 · 2026-08-24";

const NAMES = ["Do", "Do♯", "Ré", "Mi♭", "Mi", "Fa", "Fa♯",
               "Sol", "Sol♯", "La", "Si♭", "Si"];

const state = {
  context: null,
  stream: null,
  detector: null,
  droneNodes: null,
  referenceHz: 415,
  frames: 0,
  lastVoiced: null,       // {hz, confidence, at}
  lastLevelDb: -120,
};

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* Note naming: equal temperament at the chosen reference, fixed-do.  */

function describe(hz) {
  const semis = 12 * Math.log2(hz / state.referenceHz);
  const nearest = Math.round(semis);
  const cents = 100 * (semis - nearest);
  const index = ((nearest % 12) + 12 + 9) % 12;
  const octave = 4 + Math.floor((nearest + 9) / 12);
  return { name: `${NAMES[index]}${octave}`, cents };
}

function droneHz() {
  return state.referenceHz * Math.pow(2, -7 / 12);   // D below the reference A
}

/* ------------------------------------------------------------------ */
/* Audio graph                                                        */

async function start() {
  $("status").textContent = "asking for the microphone…";
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  } catch (err) {
    $("status").textContent =
      `microphone refused (${err.name}). Allow it in the browser and reload.`;
    return;
  }

  state.context = new (window.AudioContext || window.webkitAudioContext)();
  await state.context.resume();
  try {
    await state.context.audioWorklet.addModule("worklet.js");
  } catch (err) {
    $("status").textContent = `audio worklet failed to load: ${err.message}`;
    return;
  }

  state.detector = new YIN.Detector(state.context.sampleRate);
  const source = state.context.createMediaStreamSource(state.stream);
  const capture = new AudioWorkletNode(state.context, "capture",
                                       { numberOfOutputs: 0 });
  capture.port.onmessage = (event) => {
    const frame = state.detector.process(event.data);
    state.frames += 1;
    state.lastLevelDb = frame.levelDb;
    if (frame.hz > 0) {
      state.lastVoiced = { hz: frame.hz, confidence: frame.confidence,
                          at: performance.now() };
    }
  };
  source.connect(capture);

  const granted = state.stream.getAudioTracks()[0].getSettings();
  $("diag").textContent =
    `${state.context.sampleRate} Hz · ` +
    `AGC ${granted.autoGainControl === false ? "off" : "ON (browser kept it)"} · ` +
    `noise-suppression ${granted.noiseSuppression === false ? "off" : "ON"} · ` +
    `echo-cancel ${granted.echoCancellation === false ? "off" : "ON"}`;

  $("status").textContent = "listening";
  $("start").textContent = "Stop";
  $("drone").disabled = false;
  requestAnimationFrame(render);
}

function stop() {
  stopDrone();
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  if (state.context) state.context.close();
  state.context = null;
  state.stream = null;
  $("status").textContent = "stopped";
  $("start").textContent = "Start";
  $("drone").disabled = true;
  $("drone").textContent = "Drone";
}

function startDrone() {
  const ctx = state.context;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.3);
  master.connect(ctx.destination);

  // Fundamental plus two partials at -12 dB/octave (amplitude 1/n^2),
  // matching the Python drone's recipe.
  const weights = [1.0, 0.25, 1 / 9];
  const total = weights.reduce((a, b) => a + b, 0);
  const oscillators = weights.map((w, i) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = droneHz() * (i + 1);
    const gain = ctx.createGain();
    gain.gain.value = w / total;
    osc.connect(gain).connect(master);
    osc.start();
    return osc;
  });
  state.droneNodes = { master, oscillators };
  $("drone").textContent = `Drone off (${droneHz().toFixed(2)} Hz)`;
}

function stopDrone() {
  if (!state.droneNodes) return;
  const { master, oscillators } = state.droneNodes;
  const ctx = state.context;
  if (ctx) {
    master.gain.setTargetAtTime(0.0, ctx.currentTime, 0.05);
    oscillators.forEach((o) => o.stop(ctx.currentTime + 0.3));
  }
  state.droneNodes = null;
  $("drone").textContent = "Drone";
}

/* ------------------------------------------------------------------ */
/* Display                                                            */

function render() {
  if (!state.context) return;

  const now = performance.now();
  const voiced = state.lastVoiced && now - state.lastVoiced.at < 400;

  if (voiced) {
    const { name, cents } = describe(state.lastVoiced.hz);
    $("note").textContent = name;
    $("hz").textContent = `${state.lastVoiced.hz.toFixed(2)} Hz`;
    $("cents").textContent = `${cents >= 0 ? "+" : ""}${cents.toFixed(1)}¢`;
    $("needle").style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
    $("needle").style.opacity = "1";
    const inTune = Math.abs(cents) <= 5;
    $("cents").className = inTune ? "good" : Math.abs(cents) <= 15 ? "close" : "off";
  } else {
    $("note").textContent = "—";
    $("hz").textContent = "listening";
    $("cents").textContent = "";
    $("needle").style.opacity = "0.25";
  }

  const level = Math.max(-72, Math.min(0, state.lastLevelDb));
  $("levelbar").style.width = `${((level + 72) / 72) * 100}%`;
  $("leveltext").textContent = `${state.lastLevelDb.toFixed(1)} dBFS`;

  requestAnimationFrame(render);
}

/* ------------------------------------------------------------------ */

window.addEventListener("DOMContentLoaded", () => {
  $("version").textContent = VERSION;
  $("start").addEventListener("click", () => (state.context ? stop() : start()));
  $("drone").addEventListener("click", () =>
    (state.droneNodes ? stopDrone() : startDrone()));
  document.querySelectorAll("input[name=ref]").forEach((radio) =>
    radio.addEventListener("change", (e) => {
      state.referenceHz = Number(e.target.value);
      if (state.droneNodes) { stopDrone(); startDrone(); }
    }));
});
