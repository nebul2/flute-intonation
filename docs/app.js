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
 *
 * Two languages. The default follows the browser (the testers this page is
 * for are French flute teachers), the EN/FR toggle overrides it, and the
 * choice is remembered. Dynamic lines keep their state as keys so a language
 * switch re-renders them rather than freezing the old words.
 */
"use strict";

const VERSION = "phase 0.1 · 2026-08-24";

const NAMES = ["Do", "Do♯", "Ré", "Mi♭", "Mi", "Fa", "Fa♯",
               "Sol", "Sol♯", "La", "Si♭", "Si"];

const STRINGS = {
  en: {
    title: "Traverso — hardware check",
    tagline: "Does your microphone and speaker path work? Phase 0 of the intonation trainer.",
    pressStart: "press Start",
    start: "Start",
    stop: "Stop",
    drone: "Drone",
    droneStop: (hz) => `Stop drone (${hz} Hz)`,
    statusIdle: "press Start and allow the microphone",
    statusAsking: "asking for the microphone…",
    statusRefused: (name) => `microphone refused (${name}). Allow it in the browser and reload.`,
    statusWorklet: (msg) => `audio worklet failed to load: ${msg}`,
    statusListening: "listening",
    statusStopped: "stopped",
    listening: "listening",
    agcOff: "AGC off", agcOn: "AGC ON (browser kept it)",
    nsOff: "noise-suppression off", nsOn: "noise-suppression ON",
    ecOff: "echo-cancel off", ecOn: "echo-cancel ON",
    noteBox: "Note names are equal temperament for this check only — the real " +
      "engine (Vallotti, mesotonic, pure intervals over the drone) is the next " +
      "phase. The gold mark on the level bar is the −50 dBFS gate. With the " +
      "drone through speakers it will re-enter the microphone: that is expected " +
      "here, and headphones are recommended once real exercises arrive.",
    source: "source",
  },
  fr: {
    title: "Traverso — test matériel",
    tagline: "Micro et haut-parleurs fonctionnent-ils ? Phase 0 de l'entraîneur de justesse.",
    pressStart: "appuyez sur Démarrer",
    start: "Démarrer",
    stop: "Arrêter",
    drone: "Bourdon",
    droneStop: (hz) => `Couper le bourdon (${hz} Hz)`,
    statusIdle: "appuyez sur Démarrer et autorisez le micro",
    statusAsking: "demande d'accès au micro…",
    statusRefused: (name) => `micro refusé (${name}). Autorisez-le dans le navigateur et rechargez.`,
    statusWorklet: (msg) => `échec du chargement du module audio : ${msg}`,
    statusListening: "à l'écoute",
    statusStopped: "arrêté",
    listening: "à l'écoute",
    agcOff: "AGC coupé", agcOn: "AGC ACTIF (imposé par le navigateur)",
    nsOff: "réduction de bruit coupée", nsOn: "réduction de bruit ACTIVE",
    ecOff: "anti-écho coupé", ecOn: "anti-écho ACTIF",
    noteBox: "Les noms de notes sont en tempérament égal pour ce test " +
      "uniquement — le vrai moteur (Vallotti, mésotonique, intervalles purs " +
      "sur bourdon) arrive à la phase suivante. Le repère doré sur la barre de " +
      "niveau est le seuil de −50 dBFS. Avec le bourdon sur haut-parleurs, le " +
      "son revient dans le micro : c'est attendu ici, et le casque sera " +
      "recommandé quand les vrais exercices arriveront.",
    source: "code source",
  },
};

const state = {
  context: null,
  stream: null,
  detector: null,
  droneNodes: null,
  referenceHz: 415,
  frames: 0,
  lastVoiced: null,       // {hz, confidence, at}
  lastLevelDb: -120,
  lang: "en",
  statusKey: "statusIdle",
  statusArg: null,
  granted: null,          // the track settings the browser actually applied
};

const $ = (id) => document.getElementById(id);
const t = () => STRINGS[state.lang];

/* ------------------------------------------------------------------ */
/* Language                                                           */

function setLanguage(lang) {
  state.lang = lang in STRINGS ? lang : "en";
  try { localStorage.setItem("lang", state.lang); } catch (_e) { /* private mode */ }

  document.documentElement.lang = state.lang;
  document.title = t().title;
  $("title").textContent = t().title;
  $("tagline").textContent = t().tagline;
  $("notebox").textContent = t().noteBox;
  $("srclink").textContent = t().source;
  $("start").textContent = state.context ? t().stop : t().start;
  $("drone").textContent = state.droneNodes
    ? t().droneStop(droneHz().toFixed(2)) : t().drone;
  if (!state.context) $("hz").textContent = t().pressStart;
  renderStatus();
  renderDiag();

  document.querySelectorAll("[data-lang]").forEach((el) =>
    el.classList.toggle("active", el.dataset.lang === state.lang));
}

function renderStatus() {
  const entry = t()[state.statusKey];
  $("status").textContent =
    typeof entry === "function" ? entry(state.statusArg) : entry;
}

function renderDiag() {
  if (!state.granted || !state.context) { $("diag").textContent = ""; return; }
  const g = state.granted;
  $("diag").textContent =
    `${state.context.sampleRate} Hz · ` +
    `${g.autoGainControl === false ? t().agcOff : t().agcOn} · ` +
    `${g.noiseSuppression === false ? t().nsOff : t().nsOn} · ` +
    `${g.echoCancellation === false ? t().ecOff : t().ecOn}`;
}

function setStatus(key, arg = null) {
  state.statusKey = key;
  state.statusArg = arg;
  renderStatus();
}

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
  setStatus("statusAsking");
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
    setStatus("statusRefused", err.name);
    return;
  }

  state.context = new (window.AudioContext || window.webkitAudioContext)();
  await state.context.resume();
  try {
    await state.context.audioWorklet.addModule("worklet.js");
  } catch (err) {
    setStatus("statusWorklet", err.message);
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

  state.granted = state.stream.getAudioTracks()[0].getSettings();
  renderDiag();
  setStatus("statusListening");
  $("start").textContent = t().stop;
  $("drone").disabled = false;
  requestAnimationFrame(render);
}

function stop() {
  stopDrone();
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  if (state.context) state.context.close();
  state.context = null;
  state.stream = null;
  state.granted = null;
  setStatus("statusStopped");
  renderDiag();
  $("start").textContent = t().start;
  $("hz").textContent = t().pressStart;
  $("drone").disabled = true;
  $("drone").textContent = t().drone;
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
  $("drone").textContent = t().droneStop(droneHz().toFixed(2));
}

function stopDrone() {
  if (!state.droneNodes) return;
  const { master, oscillators } = state.droneNodes;
  const ctx = state.context;
  if (ctx) {
    master.gain.setTargetAtTime(0.0, ctx.currentTime, 0.05);
    oscillators.forEach((osc) => osc.stop(ctx.currentTime + 0.3));
  }
  state.droneNodes = null;
  $("drone").textContent = t().drone;
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
    const magnitude = Math.abs(cents);
    $("cents").className = magnitude <= 5 ? "good" : magnitude <= 15 ? "close" : "off";
  } else {
    $("note").textContent = "—";
    $("hz").textContent = t().listening;
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

  let saved = null;
  try { saved = localStorage.getItem("lang"); } catch (_e) { /* private mode */ }
  const preferred = saved
    || ((navigator.language || "").toLowerCase().startsWith("fr") ? "fr" : "en");
  setLanguage(preferred);

  $("start").addEventListener("click", () => (state.context ? stop() : start()));
  $("drone").addEventListener("click", () =>
    (state.droneNodes ? stopDrone() : startDrone()));
  document.querySelectorAll("[data-lang]").forEach((el) =>
    el.addEventListener("click", () => setLanguage(el.dataset.lang)));
  document.querySelectorAll("input[name=ref]").forEach((radio) =>
    radio.addEventListener("change", (event) => {
      state.referenceHz = Number(event.target.value);
      if (state.droneNodes) { stopDrone(); startDrone(); }
    }));
});
