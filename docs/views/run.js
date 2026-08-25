/* The exercise runner: one implementation shared by every page that runs a
 * guided exercise (Practice, Stopper check). Mounted into a root element with
 * an exercise spec; owns the drone, the notches, the segmenter, the feedback
 * policy, the end state, the summary and the history record.
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
 * separated from the drone by pitch alone. The drone is ducked during that
 * measurement and during unison notes, and its partials are notched out of
 * the microphone wherever they are not the note being played. */

import { t, lang } from "../i18n.js";
import { engine, dronePartialsToNotch } from "../audio/engine.js";
import * as settings from "../settings.js";
import * as history from "../history.js";
import { SpelledPitch, centsBetween } from "../core/pitch.js";
import { Mode, TargetResolver } from "../core/resolver.js";
import { intervalDrill, intervalInContext, enharmonicPair, stopperCheck, scalePool, scaleKeyFor, pickDifferent } from "../core/generator.js";
import { HarmonicContext } from "../core/tuning.js";
import { Exercise, TargetNote } from "../core/resolver.js";
import { SessionSummary, analyseNote, judgeDirection, octavePairs, IN_TUNE_CENTS, CLOSE_CENTS } from "../core/scoring.js";
import { NoteSegmenter, onsetThresholdFor } from "../audio/segmenter.js";
import { el, append, needle, levelBar, bandClass, currentTuning, name, runNav } from "../ui/widgets.js";

/* The practice set. */
export const EXERCISES = {
  calibration: { build: (tonic) => intervalDrill(tonic, { intervals: [0, 4, 7] }), feedback: "after" },
  intervals: { build: (tonic) => intervalInContext(tonic), feedback: "after" },
  enharmonic: { build: () => enharmonicPair(), feedback: "after" },
  predict: { build: (tonic) => intervalDrill(tonic, { intervals: [0, 4, 7] }), feedback: "predict" },
  /* Endless: random notes of the chosen scale over the tonic drone until the
   * player stops. The exercise starts with one note; the runner asks
   * `nextNote` for each further one, so it never runs out. */
  predictRandom: {
    build: (tonic, quality = "major") => {
      const root = SpelledPitch.parse(`${tonic}4`);
      const pool = scalePool(tonic, quality, { octaves: 1 });
      const context = new HarmonicContext(root);
      return new Exercise({
        name: `random ${quality} scale notes over ${root}`,
        notes: [new TargetNote(pickDifferent(pool), 4.0, context)],
        drone: root, tempoBpm: 60.0, key: scaleKeyFor(tonic, quality),
      });
    },
    nextNote: (run) => {
      const previous = run.notes[run.notes.length - 1];
      const pool = scalePool(run.tonic, run.quality, { octaves: 1 });
      return new TargetNote(pickDifferent(pool, previous.pitch), 4.0, previous.context);
    },
    feedback: "predict",
    endless: true,
  },
};

/* The stopper check: a tool, not an exercise, so it lives on its own page. */
export const STOPPER = { build: () => stopperCheck(), feedback: "end", acceptance: 120, report: "stopper" };

const ONSET_MARGIN_DB = 10.0;
const CALIBRATE_MS = 1500;
const PLAYING_LEVEL_DB = -20.0;   // typical playing level at the mic; sanity check only
// During calibration and unison notes the drone is ducked to this fraction of
// its level (about -12 dB): at the drone's own pitch the measured background
// *is* the drone's bleed, and without ducking the player had to out-shout it.
const UNISON_DUCK = 0.25;

function bandLabel(cents) {
  const m = Math.abs(cents);
  if (m <= IN_TUNE_CENTS) return t("band.inTune");
  if (m <= CLOSE_CENTS) return t("band.close");
  return cents > 0 ? t("band.sharp") : t("band.flat");
}

export class ExerciseRun {
  /* `key` names the exercise (its strings live under practice.ex.<key>);
   * `spec` is one of the entries above; `onBack` leaves the run; `backLabel`
   * overrides the navigation's "back to the list" wording. */
  constructor({ key, spec, tonic = "D", quality = "major", label = "", onBack, backLabel = null }) {
    this.key = key;
    this.spec = spec;
    this.tonic = tonic;
    this.quality = quality;
    this.label = label;
    this.onBack = onBack;
    this.backLabel = backLabel;
  }

  mount(root) {
    this.root = root;
    const built = this.spec.build(this.tonic, this.quality);
    const s = settings.get();
    const tuning = currentTuning(s);
    this.run = {
      key: this.key, spec: this.spec, settings: s, tuning,
      tonic: this.tonic, quality: this.quality,
      notes: [],                       // the current segment's notes (grows when endless)
      exercises: Array.isArray(built) ? built : [built],
      resolver: new TargetResolver(Mode.PURE, tuning),
      exIdx: 0, noteIdx: -1, phase: "start",
      droneHz: null, onsetDb: null, levels: [], calibrateUntil: 0,
      seg: null, target: 0, note: null, exercise: null,
      summary: new SessionSummary(), judgements: [], rows: [], stopped: false,
      pendingResult: null, nextTimer: null,
    };
    this.buildUi();
    this.offFrame = engine.onFrame((frame) => this.onFrame(frame));
    this.mounted = true;
    requestAnimationFrame(() => this.render());
    this.nextSegment();
  }

  unmount() {
    this.mounted = false;
    if (this.offFrame) { this.offFrame(); this.offFrame = null; }
    if (this.keyHandler) { window.removeEventListener("keydown", this.keyHandler); this.keyHandler = null; }
    if (this.run?.nextTimer) clearTimeout(this.run.nextTimer);
    engine.drone.stop();
    engine.setNotches([]);
    this.run = null;
  }

  restart() {
    const root = this.root;
    this.unmount();
    root.replaceChildren();
    this.mount(root);
  }

  buildUi() {
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
        el("button", { class: "secondary big", text: t(`practice.call.${call}`), onclick: () => this.judge(call) }))),
      rows: el("div", { class: "rows" }),
      summary: el("div", { class: "summary" }),
      nav: runNav({
        stopLabel: t("practice.stop"),
        backLabel: this.backLabel,
        onStop: () => this.finish(true),
        onRedo: () => this.restart(),
        onBack: () => this.onBack(),
      }),
    };
    const u = this.ui;
    u.panel = el("div", { class: "card panel" }, [u.noteLabel, u.target, u.progress, u.progressText, u.level.element, u.judge]);
    append(root,
      u.heading,
      run.spec.report === "stopper" ? el("p", { class: "note-box", text: t("practice.stopper.protocol") }) : null,
      (run.exercises.some((e) => e.drone) && !run.settings.headphones)
        ? el("p", { class: "note-box", text: t("practice.bleed") }) : null,
      u.status, u.nav.top, u.panel, u.summary, u.rows, u.nav.bottom,
    );
    // s / f / t on a keyboard, for the predict prompt.
    this.keyHandler = (e) => {
      if (!this.run || this.run.phase !== "judging") return;
      const call = { s: "sharp", f: "flat", t: "in tune", i: "in tune" }[e.key.toLowerCase()];
      if (call) this.judge(call);
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  contextTag(note, exercise) {
    const mixed = exercise.notes.some((n) => n.context) && exercise.notes.some((n) => !n.context);
    if (!mixed) return "";
    return note.context ? ` · ${t("practice.tag.pure")}` : ` · ${t("practice.tag.temp")}`;
  }

  nextSegment() {
    const run = this.run;
    if (!run) return;
    const exercise = run.exercises[run.exIdx];
    if (!exercise) { this.finish(false); return; }
    run.exercise = exercise;
    run.notes = [...exercise.notes];
    run.noteIdx = -1;
    run.droneHz = null;
    run.onsetDb = null;

    if (exercise.drone && run.settings.droneLevel > 0) {
      run.droneHz = run.tuning.targetHz(exercise.drone);
      // The background measurement exists only for the drone-unison guard,
      // taken with the drone ducked and the notches as they will be for the
      // unison note it protects.
      const needsGuard = exercise.notes.some((n) =>
        Math.abs(centsBetween(run.droneHz, run.resolver.resolve(n))) <= 80.0);
      engine.drone.start(run.droneHz, run.settings.droneLevel * (needsGuard ? UNISON_DUCK : 1));
      if (needsGuard) {
        engine.setNotches(dronePartialsToNotch(run.droneHz, run.droneHz));
        run.phase = "calibrating";
        run.levels = [];
        run.calibrateUntil = performance.now() + CALIBRATE_MS;
        this.ui.status.textContent = t("practice.calibrating");
        return;
      }
    }
    this.nextNote();
  }

  finishCalibration() {
    const run = this.run;
    const sorted = [...run.levels].sort((a, b) => a - b);
    const background = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.9 * sorted.length))] : -60;
    run.onsetDb = background + ONSET_MARGIN_DB;
    let text = t("practice.calibrated", background.toFixed(1), run.onsetDb.toFixed(1));
    if (run.onsetDb > PLAYING_LEVEL_DB) text += " — " + t("practice.calibratedWarn");
    this.ui.status.textContent = text;
    this.nextNote();
  }

  nextNote() {
    const run = this.run;
    if (!run) return;
    run.noteIdx += 1;
    const exercise = run.exercise;
    if (run.noteIdx >= run.notes.length) {
      if (run.spec.endless) {
        run.notes.push(run.spec.nextNote(run));    // never runs out; Stop ends it
      } else {
        engine.drone.stop();
        engine.setNotches([]);
        run.exIdx += 1;
        this.nextSegment();
        return;
      }
    }
    const note = run.notes[run.noteIdx];
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
    const isStopper = run.spec.report === "stopper";
    if (run.droneHz) {
      const unison = run.seg.onsetDb !== null;
      engine.drone.setLevel(run.settings.droneLevel * (unison ? UNISON_DUCK : 1));
      engine.setNotches(dronePartialsToNotch(run.droneHz, run.target, run.spec.acceptance ?? 80.0));
      if (!isStopper) this.ui.status.textContent = unison ? t("practice.playNowUnison") : t("practice.playNow");
    } else if (!isStopper) {
      this.ui.status.textContent = t("practice.playNow");
    }
  }

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
  }

  noteDone() {
    const run = this.run;
    const result = analyseNote(run.note.pitch, run.target, run.seg.framesHz, run.seg.frameSeconds);
    run.summary.add(result);
    run.pendingResult = result;
    if (run.spec.feedback === "predict" && result) {
      run.phase = "judging";
      this.ui.judge.hidden = false;
      this.ui.status.textContent = t("practice.yourCall");
      return;
    }
    this.reveal(result, null);
  }

  judge(called) {
    const run = this.run;
    if (!run || run.phase !== "judging") return;
    this.ui.judge.hidden = true;
    this.reveal(run.pendingResult, called);
  }

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
  }

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
  }

  /* ---- the end ------------------------------------------------------- */

  async finish(stopped) {
    const run = this.run;
    if (!run || run.phase === "finished") return;
    run.phase = "finished";
    if (run.spec.endless) stopped = false;     // stopping is how an endless run ends
    run.stopped = stopped;
    if (run.nextTimer) clearTimeout(run.nextTimer);
    engine.drone.stop();
    engine.setNotches([]);
    // A clear "over" state: a tick (or a square when stopped early), no
    // progress bar, no meter, the summary above the per-note rows.
    const u = this.ui;
    u.judge.hidden = true;
    u.noteLabel.textContent = stopped ? "■" : "✓";
    u.target.textContent = "";
    u.progress.hidden = true;
    u.progressText.textContent = "";
    u.level.element.hidden = true;
    u.panel.classList.add("finished");
    u.status.textContent = stopped ? t("practice.stopped") : t("practice.done");
    u.nav.finish();

    const s = run.settings;
    const summary = run.summary;
    const parts = [];
    if (summary.results.length) {
      parts.push(el("p", { class: "mono", text: t("practice.meanAbs", summary.meanAbsoluteCents.toFixed(1)) }));
      const byClass = summary.byPitchClass();
      parts.push(el("p", { class: "mono", text: `${t("practice.byNote")} ` + Object.entries(byClass).map(([k, v]) =>
        `${name(SpelledPitch.parse(`${k}4`), s).replace(/4$/, "")} ${v >= 0 ? "+" : ""}${v.toFixed(1)}`).join("  ") }));
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
    if (run.spec.report === "stopper") parts.push((await this.stopperReport(summary, s)).element);
    u.summary.replaceChildren(el("h2", { text: t("practice.summary") }), ...parts);

    if (summary.results.length) {
      const record = {
        ...summary.toDict(),
        exercise: `practice: ${run.key}`, mode: "pure",
        temperament: s.temperament, root: s.root, reference_hz: s.referenceHz,
        naming: s.naming, lang: lang(), stopped,
        ...(this.label ? { label: this.label } : {}),
      };
      if (run.judgements.length) {
        record.judgement = { agreed: run.judgements.filter(Boolean).length, total: run.judgements.length };
      }
      try { await history.add(record); u.summary.append(el("p", { class: "muted", text: t("practice.saved") })); }
      catch (_e) { /* storage unavailable: the session still displayed */ }
    }
  }

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
    // Direction: the cavity between stopper and embouchure hole makes the end
    // correction grow with frequency, flattening the upper register. Too
    // little cavity leaves the octaves wide, so wide octaves want the stopper
    // moved AWAY from the embouchure hole; narrow ones, towards it.
    const signed = pairs.reduce((a, p) => a + p.width, 0) / pairs.length;
    const hint = signed > 2.0 ? "practice.stopper.hintWide"
               : signed < -2.0 ? "practice.stopper.hintNarrow" : "practice.stopper.hintOk";
    box.append(el("p", { class: "muted", text: t(hint) }));
    const offset = summary.results.reduce((a, r) => a + r.meanCents, 0) / summary.results.length;
    box.append(el("p", { class: "muted", text: t("practice.stopper.offset", `${offset >= 0 ? "+" : ""}${offset.toFixed(1)}`) }));

    const previous = await history.latest((r) => r.exercise === "practice: stopper").catch(() => null);
    if (previous) {
      const prevPairs = octavePairs(SessionSummary.fromDict(previous).results);
      if (prevPairs.length) {
        const last = prevPairs.reduce((a, p) => a + Math.abs(p.width), 0) / prevPairs.length;
        const verdict = error < last ? t("practice.stopper.closer") : t("practice.stopper.wider");
        box.append(el("p", { text: t("practice.stopper.previous", (previous.label ? `${previous.label}, ` : "") + (previous.at ?? "").slice(0, 16).replace("T", " "), last.toFixed(1), verdict) }));
      }
    }
    return { element: box };
  }
}
