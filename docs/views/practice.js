/* Practice: the five exercises from the desktop version, run in the browser.
 *
 * Feedback policy per exercise, following the pedagogy plan:
 *   after   -- no needle while you play, only progress; the reading appears
 *              when the note ends, so the ear commits first
 *   predict -- like after, but you call sharp / flat / in tune before the
 *              number is revealed, and the agreement is scored
 *   end     -- nothing per note at all ("captured"); the stopper check, where
 *              seeing one note's deviation would invite correcting the next
 *
 * The drone-unison guard is the desktop rule: with the drone sounding and
 * nobody playing, 1.5 s of background is measured and a note *at the drone's
 * own pitch* must exceed background + 10 dB to open; every other note is
 * separated from the drone by pitch alone. */

import { t, lang } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import * as history from "../history.js";
import { SpelledPitch, centsBetween } from "../core/pitch.js";
import { Mode, TargetResolver } from "../core/resolver.js";
import { intervalDrill, intervalInContext, enharmonicPair, stopperCheck } from "../core/generator.js";
import { SessionSummary, analyseNote, judgeDirection, octavePairs, IN_TUNE_CENTS, CLOSE_CENTS } from "../core/scoring.js";
import { NoteSegmenter, onsetThresholdFor } from "../audio/segmenter.js";
import { el, audioControl, needle, levelBar, bandClass, currentTuning, name } from "../ui/widgets.js";

const EXERCISES = {
  calibration: { build: (tonic) => intervalDrill(tonic, { intervals: [0, 4, 7] }), feedback: "after" },
  intervals: { build: (tonic) => intervalInContext(tonic), feedback: "after" },
  enharmonic: { build: () => enharmonicPair(), feedback: "after" },
  predict: { build: (tonic) => intervalDrill(tonic, { intervals: [0, 4, 7] }), feedback: "predict" },
  stopper: { build: () => stopperCheck(), feedback: "end", acceptance: 120 },
};
const TONICS = ["D", "G", "A", "C", "F"];
const ONSET_MARGIN_DB = 10.0;
const CALIBRATE_MS = 1500;
// During calibration and unison notes the drone is ducked to this fraction of
// its level (about -12 dB). At the drone's own pitch the measured background
// *is* the drone's bleed, so without ducking the player has to out-shout the
// drone to open the note -- observed live. Every other note keeps the full
// drone; the unison is where it carries the least tuning information anyway.
const UNISON_DUCK = 0.25;
const PLAYING_LEVEL_DB = -20.0;   // typical playing level at the mic; sanity check only

function bandLabel(cents) {
  const m = Math.abs(cents);
  if (m <= IN_TUNE_CENTS) return t("band.inTune");
  if (m <= CLOSE_CENTS) return t("band.close");
  return cents > 0 ? t("band.sharp") : t("band.flat");
}

export default {
  title: () => t("practice.title"),

  mount(root) {
    this.root = root;
    this.tonic = "D";
    this.showList();
  },

  unmount() { this.teardownRun(); },

  /* ---- the list ------------------------------------------------------ */

  showList() {
    this.teardownRun();
    const root = this.root;
    root.replaceChildren();
    const control = audioControl({ showGranted: false });
    this.control = control;

    const tonicSelect = el("select", { class: "select", onchange: (e) => { this.tonic = e.target.value; } },
      TONICS.map((k) => el("option", { value: k, selected: k === this.tonic || null,
                                       text: name(SpelledPitch.parse(`${k}4`)).replace(/4$/, "") })));

    const buttons = Object.keys(EXERCISES).map((key) => el("button", {
      class: "card exercise", disabled: !engine.listening,
      onclick: () => this.startRun(key),
    }, [
      el("div", { class: "card-title", text: t(`practice.ex.${key}.title`) }),
      el("div", { class: "card-desc", text: t(`practice.ex.${key}.desc`) }),
    ]));
    this.offState = engine.onState(() => buttons.forEach((b) => { b.disabled = !engine.listening; }));

    root.append(
      el("p", { class: "intro", text: t("practice.intro") }),
      el("div", { class: "row" }, [control.element, el("span", { text: t("practice.tonic") }), tonicSelect]),
      engine.listening ? null : el("p", { class: "note-box", text: t("practice.needMic") }),
      el("div", { class: "cards" }, buttons),
    );
  },

  /* ---- a run --------------------------------------------------------- */

  startRun(key) {
    if (this.offState) { this.offState(); this.offState = null; }
    if (this.control) { this.control.dispose(); this.control = null; }
    const spec = EXERCISES[key];
    const built = spec.build(this.tonic);
    const s = settings.get();
    const tuning = currentTuning(s);

    this.run = {
      key, spec, settings: s, tuning,
      exercises: Array.isArray(built) ? built : [built],
      resolver: new TargetResolver(Mode.PURE, tuning),
      exIdx: 0, noteIdx: -1, phase: "start",
      droneHz: null, onsetDb: null, levels: [], calibrateUntil: 0,
      seg: null, target: 0, note: null, exercise: null,
      summary: new SessionSummary(), judgements: [], rows: [], stopped: false,
      pendingResult: null, nextTimer: null,
    };
    this.buildRunUi();
    this.offFrame = engine.onFrame((frame) => this.onFrame(frame));
    this.mounted = true;
    requestAnimationFrame(() => this.render());
    this.nextSegment();
  },

  teardownRun() {
    this.mounted = false;
    if (this.offFrame) { this.offFrame(); this.offFrame = null; }
    if (this.offState) { this.offState(); this.offState = null; }
    if (this.control) { this.control.dispose(); this.control = null; }
    if (this.keyHandler) { window.removeEventListener("keydown", this.keyHandler); this.keyHandler = null; }
    if (this.run?.nextTimer) clearTimeout(this.run.nextTimer);
    if (this.run) engine.drone.stop();
    this.run = null;
  },

  buildRunUi() {
    const run = this.run;
    const root = this.root;
    root.replaceChildren();

    this.ui = {
      heading: el("h2", { text: t(`practice.ex.${run.key}.title`) }),
      status: el("p", { class: "intro" }),
      noteLabel: el("div", { class: "big-note", text: "—" }),
      target: el("div", { class: "target" }),
      progress: el("div", { class: "progress" }, [el("div", { class: "progress-fill" })]),
      progressText: el("div", { class: "target" }),
      level: levelBar(),
      judge: el("div", { class: "judge", hidden: true }, ["sharp", "flat", "in tune"].map((call) =>
        el("button", { class: "secondary big", text: t(`practice.call.${call}`),
                       onclick: () => this.judge(call) }))),
      rows: el("div", { class: "rows" }),
      summary: el("div", { class: "summary" }),
      stop: el("button", { class: "secondary", text: t("practice.stop"), onclick: () => this.finish(true) }),
    };
    const u = this.ui;
    u.panel = el("div", { class: "card panel" }, [u.noteLabel, u.target, u.progress, u.progressText, u.level.element, u.judge]);
    root.append(
      u.heading,
      run.key === "stopper" ? el("p", { class: "note-box", text: t("practice.stopper.protocol") }) : null,
      (run.exercises.some((e) => e.drone) && !run.settings.headphones)
        ? el("p", { class: "note-box", text: t("practice.bleed") }) : null,
      u.status,
      u.panel,
      u.summary, u.rows,
      el("div", { class: "controls" }, [u.stop]),
    );

    // s / f / t on a keyboard, for the predict prompt.
    this.keyHandler = (e) => {
      if (!this.run || this.run.phase !== "judging") return;
      const call = { s: "sharp", f: "flat", t: "in tune", i: "in tune" }[e.key.toLowerCase()];
      if (call) this.judge(call);
    };
    window.addEventListener("keydown", this.keyHandler);
  },

  contextTag(note, exercise) {
    const mixed = exercise.notes.some((n) => n.context) && exercise.notes.some((n) => !n.context);
    if (!mixed) return "";
    return note.context ? ` · ${t("practice.tag.pure")}` : ` · ${t("practice.tag.temp")}`;
  },

  nextSegment() {
    const run = this.run;
    if (!run) return;
    const exercise = run.exercises[run.exIdx];
    if (!exercise) { this.finish(false); return; }
    run.exercise = exercise;
    run.noteIdx = -1;
    run.droneHz = null;
    run.onsetDb = null;

    if (exercise.drone && run.settings.droneLevel > 0) {
      run.droneHz = run.tuning.targetHz(exercise.drone);
      // The background measurement exists only for the drone-unison guard,
      // and is taken with the drone already ducked, as it will be during
      // the unison notes it protects.
      const needsGuard = exercise.notes.some((n) =>
        Math.abs(centsBetween(run.droneHz, run.resolver.resolve(n))) <= 80.0);
      engine.drone.start(run.droneHz, run.settings.droneLevel * (needsGuard ? UNISON_DUCK : 1));
      if (needsGuard) {
        run.phase = "calibrating";
        run.levels = [];
        run.calibrateUntil = performance.now() + CALIBRATE_MS;
        this.ui.status.textContent = t("practice.calibrating");
        return;
      }
    }
    this.nextNote();
  },

  finishCalibration() {
    const run = this.run;
    const sorted = [...run.levels].sort((a, b) => a - b);
    const background = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.9 * sorted.length))] : -60;
    run.onsetDb = background + ONSET_MARGIN_DB;
    let text = t("practice.calibrated", background.toFixed(1), run.onsetDb.toFixed(1));
    if (run.onsetDb > PLAYING_LEVEL_DB) text += " — " + t("practice.calibratedWarn");
    this.ui.status.textContent = text;
    this.nextNote();
  },

  nextNote() {
    const run = this.run;
    if (!run) return;
    run.noteIdx += 1;
    const exercise = run.exercise;
    if (run.noteIdx >= exercise.notes.length) {
      engine.drone.stop();
      run.exIdx += 1;
      this.nextSegment();
      return;
    }
    const note = exercise.notes[run.noteIdx];
    run.note = note;
    run.target = run.resolver.resolve(note);
    if (engine.detector) engine.detector.reset();
    run.seg = new NoteSegmenter({
      targetHz: run.target,
      frameSeconds: engine.detector ? engine.detector.frameSeconds : 512 / 44100,
      requiredSeconds: 0.6 * exercise.durationSeconds(note),
      onsetDb: onsetThresholdFor(run.target, run.droneHz, run.onsetDb),
      acceptanceCents: run.spec.acceptance ?? 80.0,
    });
    run.phase = "playing";
    this.ui.noteLabel.textContent = name(note.pitch, run.settings) + this.contextTag(note, exercise);
    this.ui.target.textContent = `${run.target.toFixed(2)} Hz`;
    if (run.droneHz) {
      const unison = run.seg.onsetDb !== null;
      engine.drone.setLevel(run.settings.droneLevel * (unison ? UNISON_DUCK : 1));
      if (run.key !== "stopper") this.ui.status.textContent = unison ? t("practice.playNowUnison") : t("practice.playNow");
    } else if (run.key !== "stopper") {
      this.ui.status.textContent = t("practice.playNow");
    }
  },

  onFrame(frame) {
    const run = this.run;
    if (!run) return;
    if (run.phase === "calibrating") {
      run.levels.push(frame.levelDb);
      if (frame.t >= run.calibrateUntil) this.finishCalibration();
      return;
    }
    if (run.phase !== "playing" || !run.seg) return;
    run.seg.push(frame.hz, frame.levelDb);
    if (run.seg.complete) this.noteDone();
  },

  noteDone() {
    const run = this.run;
    const frameSeconds = run.seg.frameSeconds;
    const result = analyseNote(run.note.pitch, run.target, run.seg.framesHz, frameSeconds);
    run.summary.add(result);
    run.pendingResult = result;
    if (run.spec.feedback === "predict" && result) {
      run.phase = "judging";
      this.ui.judge.hidden = false;
      this.ui.status.textContent = t("practice.yourCall");
      return;
    }
    this.reveal(result, null);
  },

  judge(called) {
    const run = this.run;
    if (!run || run.phase !== "judging") return;
    this.ui.judge.hidden = true;
    this.reveal(run.pendingResult, called);
  },

  reveal(result, called) {
    const run = this.run;
    const label = this.ui.noteLabel.textContent;
    let row;
    if (!result) {
      row = el("div", { class: "result-row" }, [el("span", { class: "result-name", text: label }),
                                                el("span", { class: "muted", text: t("practice.notPlayed") })]);
    } else if (run.spec.feedback === "end") {
      row = el("div", { class: "result-row" }, [el("span", { class: "result-name", text: label }),
                                                el("span", { class: "muted", text: t("practice.captured", result.frameCount) })]);
    } else {
      const gauge = needle();
      gauge.set(result.meanCents);
      const cents = el("span", { class: `mono ${bandClass(result.meanCents)}`,
                                 text: `${result.meanCents >= 0 ? "+" : ""}${result.meanCents.toFixed(1)}¢ ${bandLabel(result.meanCents)}` });
      const children = [el("div", { class: "result-head" }, [el("span", { class: "result-name", text: label }), cents]), gauge.element];
      if (called) {
        const actual = judgeDirection(result.meanCents);
        const agreed = called === actual;
        run.judgements.push(agreed);
        children.push(el("div", { class: `muted ${agreed ? "good" : ""}`,
          text: `${t("practice.youSaid", t(`practice.call.${called}`))} — ` +
                (agreed ? t("practice.agreed") : t("practice.measured", t(`practice.call.${actual}`))) }));
      }
      row = el("div", { class: "result-row" }, children);
    }
    this.ui.rows.prepend(row);
    run.rows.push(row);
    run.phase = "between";
    run.nextTimer = setTimeout(() => { run.nextTimer = null; this.nextNote(); }, 900);
  },

  render() {
    if (!this.mounted || !this.run) return;
    const run = this.run;
    if (run.phase === "finished") return;      // nothing moves once it is over
    const u = this.ui;
    const frame = engine.lastFrame;
    if (frame) u.level.set(frame.levelDb);
    if (run.phase === "playing" && run.seg) {
      const fraction = Math.min(1, run.seg.elapsedSeconds / run.seg.requiredSeconds);
      u.progress.firstChild.style.width = `${fraction * 100}%`;
      u.progressText.textContent = `${run.seg.elapsedSeconds.toFixed(1)} / ${run.seg.requiredSeconds.toFixed(1)} s`;
    } else if (run.phase === "calibrating") {
      const left = Math.max(0, (run.calibrateUntil - performance.now()) / 1000);
      u.progress.firstChild.style.width = `${(1 - left / (CALIBRATE_MS / 1000)) * 100}%`;
      u.progressText.textContent = t("practice.stayQuiet", left.toFixed(1));
    }
    requestAnimationFrame(() => this.render());
  },

  /* ---- the end ------------------------------------------------------- */

  async finish(stopped) {
    const run = this.run;
    if (!run || run.phase === "finished") return;
    run.phase = "finished";
    run.stopped = stopped;
    if (run.nextTimer) clearTimeout(run.nextTimer);
    engine.drone.stop();
    // The playing panel becomes a clear "over" state: no progress, no
    // meter, a tick instead of a note -- the exercise has visibly ended.
    this.ui.judge.hidden = true;
    this.ui.noteLabel.textContent = stopped ? "■" : "✓";
    this.ui.target.textContent = "";
    this.ui.progress.hidden = true;
    this.ui.progressText.textContent = "";
    this.ui.level.element.hidden = true;
    this.ui.panel.classList.add("finished");
    this.ui.status.textContent = stopped ? t("practice.stopped") : t("practice.done");
    this.ui.stop.textContent = t("practice.backToList");
    this.ui.stop.onclick = () => this.showList();

    const s = run.settings;
    const summary = run.summary;
    const parts = [];
    if (summary.results.length) {
      parts.push(el("p", { class: "mono", text: t("practice.meanAbs", summary.meanAbsoluteCents.toFixed(1)) }));
      const byClass = summary.byPitchClass();
      parts.push(el("p", { class: "mono", text: `${t("practice.byNote")} ` + Object.entries(byClass).map(([k, v]) => {
        const pitch = SpelledPitch.parse(`${k}4`);
        return `${name(pitch, s).replace(/4$/, "")} ${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
      }).join("  ") }));
    }
    if (run.judgements.length) {
      parts.push(el("p", { text: t("practice.judgement", run.judgements.filter(Boolean).length, run.judgements.length) }));
    }
    // The reveal for mixed exercises: what the two targets were.
    for (const exercise of run.exercises) {
      for (let i = 0; i + 1 < exercise.notes.length; i++) {
        const a = exercise.notes[i], b = exercise.notes[i + 1];
        if (a.pitch.equals(b.pitch) && !a.context && b.context) {
          const tempered = run.tuning.targetHz(a.pitch);
          const pure = run.resolver.resolve(b);
          const gap = centsBetween(tempered, pure);
          parts.push(el("p", { class: "mono", text: t("practice.pair", name(a.pitch, s), tempered.toFixed(2), pure.toFixed(2),
                                                         `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}`) }));
        }
      }
    }

    let stopper = null;
    if (run.key === "stopper") {
      stopper = await this.stopperReport(summary, s);
      parts.push(stopper.element);
    }
    this.ui.summary.replaceChildren(el("h2", { text: t("practice.summary") }), ...parts);

    if (summary.results.length) {
      const record = {
        ...summary.toDict(),
        exercise: `practice: ${run.key}`, mode: "pure",
        temperament: s.temperament, root: s.root, reference_hz: s.referenceHz,
        naming: s.naming, lang: lang(), stopped,
      };
      if (run.judgements.length) {
        record.judgement = { agreed: run.judgements.filter(Boolean).length, total: run.judgements.length };
      }
      try { await history.add(record); this.ui.summary.append(el("p", { class: "muted", text: t("practice.saved") })); }
      catch (_e) { /* storage unavailable: the session still displayed */ }
    }
  },

  async stopperReport(summary, s) {
    const pairs = octavePairs(summary.results);
    const box = el("div", { class: "stopper" });
    if (!pairs.length) { box.append(el("p", { text: t("practice.stopper.noPairs") })); return { element: box }; }
    box.append(el("p", { text: t("practice.stopper.title") }));
    for (const { lower, upper, width } of pairs) {
      box.append(el("p", { class: "mono", text: `${name(lower.pitch, s)} → ${name(upper.pitch, s)}  ` +
        `${width >= 0 ? "+" : ""}${width.toFixed(1)}¢ ${width > 0 ? t("practice.stopper.wide") : t("practice.stopper.narrow")}` }));
    }
    const error = pairs.reduce((a, p) => a + Math.abs(p.width), 0) / pairs.length;
    box.append(el("p", { class: "mono", text: t("practice.stopper.error", error.toFixed(1)) }));
    const offset = summary.results.reduce((a, r) => a + r.meanCents, 0) / summary.results.length;
    box.append(el("p", { class: "muted", text: t("practice.stopper.offset", `${offset >= 0 ? "+" : ""}${offset.toFixed(1)}`) }));

    const previous = await history.latest((r) => r.exercise === "practice: stopper").catch(() => null);
    if (previous) {
      const prevPairs = octavePairs(SessionSummary.fromDict(previous).results);
      if (prevPairs.length) {
        const last = prevPairs.reduce((a, p) => a + Math.abs(p.width), 0) / prevPairs.length;
        const verdict = error < last ? t("practice.stopper.closer") : t("practice.stopper.wider");
        box.append(el("p", { text: t("practice.stopper.previous", (previous.at ?? "").slice(0, 16).replace("T", " "), last.toFixed(1), verdict) }));
      }
    }
    return { element: box };
  },
};
