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
 *   block   -- Follow me: nothing per note while playing; at the end of each
 *              block of notes, one card saying where the partner went and how
 *              far you went with it (summary feedback -- research/pedagogy.md).
 *              The per-note rows are kept and shown when the run ends.
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
import { intervalDrill, intervalInContext, enharmonicPair, intervalAdjust, stopperCheck,
         shuffled, pickKey, PRACTICE_KEYS, CYCLE_KEYS, CYCLE_INTERVALS } from "../core/generator.js";
import { SessionSummary, analyseNote, judgeDirection, judgementTally, encouragement, CALL_DIRECTIONS,
         octavePairs, octaveBarGeometry, BAR_SPAN_CENTS, nearMiss, MAGNITUDES } from "../core/scoring.js";
import { NoteSegmenter, onsetThresholdFor } from "../audio/segmenter.js";
import { BackgroundCalibration } from "../audio/calibration.js";
import { highestFirst } from "../core/pitch.js";
import { invitation } from "../ui/feedback.js";
import { helpSection } from "../ui/help.js";
import { compareAdjustment } from "../core/adjust.js";
import { el, append, needle, meters, bandClass, bands, settleLabel, currentTuning, name, nameClass, runNav, explainer } from "../ui/widgets.js";
import { checkboxField } from "../ui/fields.js";
import { keyControl, followCentsControl, timbreControl } from "../ui/controls.js";
import { owner } from "../ui/owner.js";
import { pedal, FORWARD, BACK } from "../ui/pedal.js";
import * as profiles from "../profiles.js";
import { isRigid, validEntry } from "../core/bend.js";
import { followRun, followPattern, blockFollow, referenceFrom, shiftedHz, directionOf, unmeasuredCanBend,
         MIN_FOLLOW_OFFSET } from "../core/follow.js";
import { soundingTimbre } from "../audio/timbres.js";

/* What this flute can bend, for Follow me: the measured profile where there
 * is one -- the run's own label if a flute by that name has been measured,
 * else the only flute measured on this device -- and the built-in list for
 * every note it does not cover. A partner who asks a note to go where the
 * instrument cannot take it is not teaching anything. */
export function canBendOn(label) {
  const names = profiles.names();
  const flute = profiles.get(label) ? label : (names.length === 1 ? names[0] : null);
  const measured = new Map(flute === null ? []
    : profiles.entries(flute).filter(validEntry).map((e) => [e.pitch, e]));
  return (pitch, direction) => (measured.has(pitch.name)
    ? !isRigid(measured.get(pitch.name), direction)
    : unmeasuredCanBend(pitch, direction));
}

/* One level of Follow me. Long tones over a partner who enters first; the
 * level says at what interval. See cr/010. */
function followLevel(level) {
  return {
    follow: level, feedback: "block", help: "follow",
    explain: ["follow.what", "follow.how", "follow.why"],
    build: (tonic, quality, chosen, opts = {}) =>
      followRun(tonic, quality, level, { cents: opts.cents, beats: opts.seconds, canBend: opts.canBend }),
  };
}

/* One pass of "Predict, then see": the given intervals over one key's own
 * drone. The shape belongs to this exercise rather than to the generator --
 * the generator already offers the pass, this only says which key it is in. */
function predictPass(entry, intervals, seconds) {
  return intervalDrill(entry.tonic, { key: entry.key, intervals, beats: seconds });
}

/* Which note "again" should land on, and what has to be given back to get
 * there. Pure and exported, because this decision *is* the feature and it was
 * got wrong once already.
 *
 * 8.4.5 could only reach the note still on screen. That gave the player the
 * 900 ms between one note ending and the next beginning to decide they had
 * fluffed it; past that the press did nothing visible and silently deleted
 * the previous note's reading. It was reported, accurately, as "the left
 * pedal does nothing" -- which is what a bug looks like from the other side
 * of a flute.
 *
 * `give` says what the caller must hand back: "pending" is a reading already
 * in the summary with no row yet (the judging phase), "logged" is the last
 * finished note, "nothing" is a note in progress that has produced nothing. */
export function takeBackTarget({ phase, log = [], exIdx = 0, noteIdx = 0, hasNote = false }) {
  if (phase === "finished" || phase === "calibrating") return null;
  if (phase === "judging") return { give: "pending", exIdx, noteIdx };
  const last = log.length ? log[log.length - 1] : null;
  if (last) return { give: "logged", exIdx: last.exIdx, noteIdx: last.noteIdx };
  // Nothing finished yet: the only sensible "again" is this note over.
  return hasNote ? { give: "nothing", exIdx, noteIdx } : null;
}

/* The note length a run started with. An endless run must keep it when the
 * key changes, or the exercise quietly changes pace mid-session. Seconds and
 * beats are the same thing at the 60 bpm these exercises all run at. */
const runNoteSeconds = (run) => run.exercises[0].notes[0].beats;

/* The practice set. */
/* Every drone exercise takes its note length from one setting, because they
 * are all the same activity: sounding a note against a bass and listening to
 * what happens between them. There is no reason to hurry any of them, and a
 * player who wants longer wants longer everywhere. Seconds rather than beats,
 * at 60bpm they are the same thing, and seconds is what a player means. */
export const EXERCISES = {
  calibration: { build: (t, q, k, o = {}) => intervalDrill(t, { intervals: [0, 4, 7], beats: o.seconds }), feedback: "after" },
  intervals: { build: (t, q, k, o = {}) => intervalInContext(t, { beats: o.seconds }), feedback: "after" },
  enharmonic: { build: (t, q, k, o = {}) => enharmonicPair({ beats: o.seconds }), feedback: "after" },
  /* Predict, then see. One pass is the tonic and then every other degree
   * over that key's drone; when the pass ends the key changes and the same
   * pass begins again, round CYCLE_KEYS and round again until the player
   * finishes. Three notes in one key was not enough to settle an ear, and it
   * taught D major only -- an ear that hears a third over D and nowhere else
   * has learned the note, not the interval. It ignores the tonic chosen on
   * the list page: this exercise walks its own keys.
   *
   * `randomisable` puts a checkbox on it: same exercise, same score, with
   * nothing to anticipate -- a key drawn at random rather than the next one
   * along, never the one just played, and the intervals shuffled. It was a
   * second card on the list, which said the two were different exercises
   * when they differ in exactly one thing. The flag is read when each pass
   * is built, so it can be turned on part-way through without losing the
   * run: the current key finishes, and the next one is a surprise. */
  predict: {
    randomisable: true,
    build: (tonic, quality, chosen, opts = {}) =>
      predictPass(opts.random ? pickKey(CYCLE_KEYS) : CYCLE_KEYS[0],
                  opts.random ? shuffled(CYCLE_INTERVALS) : CYCLE_INTERVALS, opts.seconds),
    /* The next key follows the one just played rather than a count of passes,
     * so a run that has been random for a while and is set back to the cycle
     * carries on from where it actually is. */
    nextExercise: (run) => {
      const previous = run.exercises[run.exercises.length - 1].key;
      const next = CYCLE_KEYS[(CYCLE_KEYS.findIndex((e) => e.key === previous) + 1) % CYCLE_KEYS.length];
      return predictPass(run.random ? pickKey(CYCLE_KEYS, previous) : next,
                         run.random ? shuffled(CYCLE_INTERVALS) : CYCLE_INTERVALS,
                         runNoteSeconds(run));
    },
    feedback: "predict", endless: true,
  },
  /* The same written note over two basses: a third, then a fifth. Two
   * Exercises so each carries its own drone, which the runner already walks.
   * `feedback: "end"` on purpose -- a needle during would teach exactly the
   * habit this exercise exists to break. */
  adjust: {
    /* Every key the app can spell, not the five letters the shared tonic
     * select offers -- that control cannot name a flat key at all, and the
     * widest and most instructive of these are B and Ab at a full comma. */
    keys: PRACTICE_KEYS,
    build: (tonic, quality, chosen, opts = {}) =>
      intervalAdjust(chosen ? chosen.tonic : tonic,
                     { key: chosen ? chosen.key : "", beats: opts.seconds }),
    feedback: "end", report: "adjust", help: "intervals",
    explain: ["practice.adjust.what", "practice.adjust.how", "practice.adjust.why"],
  },
  /* Runs on its own page: free playing recognised afterwards, which the
   * note-by-note runner here cannot express. Experimental until it has
   * been used by someone other than the player it was calibrated on. */
  scales: { route: "scales", experimental: true },
  /* Follow me: the first two rungs of the ladder in cr/010. The fifth and the
   * thirds are built in core/follow.js and wait for these two to have been
   * used for a while. */
  followUnison: followLevel("unison"),
  followOctave: followLevel("octave"),
};

/* The stopper check: a tool, not an exercise, so it lives on its own page. */
export const STOPPER = { build: () => stopperCheck(), feedback: "end", acceptance: 120, report: "stopper" };

// During calibration and unison notes the drone is ducked to this fraction of
// its level (about -12 dB): at the drone's own pitch the measured background
// *is* the drone's bleed, and without ducking the player had to out-shout it.
const UNISON_DUCK = 0.25;
// Follow me lowers its partner this long before the player's entry: the level
// moves with a 0.08 s time constant, so 0.4 s is five of them.
const DUCK_AHEAD_SECONDS = 0.4;

/* This page's own wording: where the shared label says "off", a note being
 * scored against a target says which way it went, which is the thing the
 * player can act on. Same two lines as everywhere else. */
function bandLabel(cents) {
  const { inTuneCents, nearlyCents } = bands();
  const m = Math.abs(cents);
  if (m <= inTuneCents) return t("band.inTune");
  if (m <= nearlyCents) return t("band.close");
  return cents > 0 ? t("band.sharp") : t("band.flat");
}

/* The stopper check, drawn.
 *
 * Four octaves, four tracks. Each track is the octave itself: its centre is a
 * true 2:1, and the marker is where the player actually landed -- right of
 * centre for a wide octave, left for a narrow one. The numbers were always
 * there; what was missing was seeing the four of them at once, because the
 * stopper is one screw and it moves all four together. Whether they are
 * scattered or all leaning the same way is the whole question, and that reads
 * off a picture instantly and off a column of figures not at all.
 *
 * The geometry -- fixed scale, clamping -- is core/scoring.js.
 */
export function octaveBars(pairs, s) {
  const wrap = el("div", { class: "octaves" });
  wrap.append(el("div", { class: "octaves-scale" }, [
    el("span", { text: `−${BAR_SPAN_CENTS}` }),
    el("span", { class: "octaves-scale-mid", text: t("practice.stopper.trueOctave") }),
    el("span", { text: `+${BAR_SPAN_CENTS}` }),
  ]));

  for (const { lower, upper, width } of pairs) {
    const { percent, beyond } = octaveBarGeometry(width);
    const figure = `${width >= 0 ? "+" : ""}${width.toFixed(1)}`;
    const direction = t(width > 0 ? "practice.stopper.wide" : "practice.stopper.narrow");
    const names = `${name(lower.pitch, s)} → ${name(upper.pitch, s)}`;

    const marker = el("div", { class: `octave-mark ${bandClass(width)}${beyond ? " pinned" : ""}` });
    marker.style.left = `${percent}%`;

    wrap.append(el("div", { class: "octave-row" }, [
      el("div", { class: "octave-name", text: names }),
      el("div", {
        class: "octave-track", role: "img",
        "aria-label": t("practice.stopper.barLabel", names, figure, direction),
      }, [
        el("div", { class: "octave-true" }),   // the "as good as true" zone
        el("div", { class: "octave-centre" }), // a true octave, exactly
        marker,
      ]),
      el("div", { class: `octave-figure ${bandClass(width)}`, text: `${figure}¢` }),
    ]));
  }
  return wrap;
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
    const s = settings.get();
    const random = this.spec.randomisable ? s.practiceRandom === true : false;
    const built = this.spec.build(this.tonic, this.quality, this.chosenKey(), {
      seconds: Number(s.droneNoteSeconds) || 6, random,
      ...(this.spec.follow ? { cents: Number(s.followCents) || 20, canBend: canBendOn(this.label) } : {}),
    });
    const tuning = currentTuning(s);
    this.run = {
      key: this.key, spec: this.spec, settings: s, tuning,
      tonic: this.tonic, quality: this.quality,
      random: this.spec.randomisable ? s.practiceRandom === true : false,
      notes: [],                       // the current segment's notes (grows when endless)
      exercises: Array.isArray(built) ? built : [built],
      resolver: new TargetResolver(Mode.PURE, tuning),
      exIdx: 0, noteIdx: -1, phase: "start",
      droneHz: null, onsetDb: null, calib: null,
      seg: null, target: 0, note: null, exercise: null,
      summary: new SessionSummary(), judgements: [], stopped: false,
      /* One entry per note the run has finished with: what it put in the
       * summary, whether a call was recorded against it, its row, and where
       * it sat. Taking a note back means undoing all four together, and the
       * bare list of rows this replaces could not say which of them had a
       * reading behind it. */
      log: [], replayAt: null,
      pendingResult: null, nextTimer: null, lastJudged: false, retakes: 0,
      // Follow me: each finished block's reading and card, by exercise index,
      // and the timbre the partner actually sounds in.
      blocks: new Map(),
      timbre: soundingTimbre(s.followTimbre, s.headphones === true),
    };
    this.own = owner();
    this.buildUi();
    this.own.add(engine.onFrame((frame) => this.onFrame(frame)));
    this.mounted = true;
    requestAnimationFrame(() => this.render());
    this.nextSegment();
  }

  unmount() {
    this.mounted = false;
    if (this.own) { this.own.dispose(); this.own = null; }
    if (this.run?.nextTimer) clearTimeout(this.run.nextTimer);
    if (this.run?.duckTimer) clearTimeout(this.run.duckTimer);
    engine.drone.stop();
    engine.setNotches([]);
    this.run = null;
  }

  /* The key this run is in, when the exercise offers a choice. Remembered
   * across sessions, so picking up where you left off is the default. */
  chosenKey() {
    if (!this.spec.keys) return null;
    const at = settings.get().practiceKeyIndex ?? 0;
    return this.spec.keys[Math.min(at, this.spec.keys.length - 1)];
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
    const own = this.own;
    root.replaceChildren();
    this.ui = {
      heading: el("h2", { text: t(`practice.ex.${run.key}.title`) }),
      // Deliberately live rather than reading the run's frozen settings: the
      // note rows are labelled from the frozen copy so a mid-run naming change
      // cannot retro-label a scored session, but this control is a choice the
      // player is making now and should read in the names they have now.
      //
      // onChange lands in a microtask, which is what makes restart() safe --
      // it tears down the very select whose change event is still dispatching.
      keyPicker: run.spec.keys ? own.add(keyControl({
        keys: run.spec.keys, store: "index", bind: "practiceKeyIndex",
        label: t("practice.key"), labelKey: "practice.inKey",
        onChange: () => this.restart(),
      })) : null,
      // Harder: nothing to anticipate. Read when each pass is built, so
      // ticking it part-way through costs nothing -- the current key
      // finishes and the next one is a surprise.
      random: run.spec.randomisable ? own.add(checkboxField({
        label: t("practice.random"), look: "toggle", bind: "practiceRandom",
        onChange: (on) => { run.random = on; },
      })) : null,
      // Follow me's choices. Each restarts the run, like the key picker: a
      // session is one offset, one sound, cue or no cue, or its blocks cannot
      // be compared with each other or with the next session's.
      follow: run.spec.follow ? [
        own.add(followCentsControl({ bind: "followCents", onChange: () => this.restart() })),
        own.add(timbreControl({ bind: "followTimbre", onChange: () => this.restart() })),
        own.add(checkboxField({ label: t("follow.cue"), look: "toggle", bind: "followCue",
                                onChange: () => this.restart() })),
        own.add(checkboxField({ label: t("follow.estimate"), look: "toggle", bind: "followEstimate",
                                onChange: () => this.restart() })),
      ] : null,
      // Which key we are in now. Only exercises that change key on their own
      // show it -- everywhere else the player chose the key and knows.
      keyLine: run.spec.nextExercise ? el("p", { class: "intro key-now" }) : null,
      status: el("p", { class: "intro" }),
      noteLabel: el("div", { class: "big-note", text: "—" }),
      target: el("div", { class: "target" }),
      progress: el("div", { class: "progress" }, [el("div", { class: "progress-fill" })]),
      progressText: el("div", { class: "target" }),
      meter: meters(),
      judge: el("div", { class: "judge", hidden: true }, ["sharp", "flat", "in tune"].map((call) =>
        el("button", { class: "secondary big", text: t(`practice.call.${call}`), onclick: () => this.judge(call) }))),
      // Follow me: which way did the partner go? Asked at the end of a block,
      // before its card, when the player has chosen to be asked.
      estimate: el("div", { class: "judge", hidden: true }, ["flat", "same", "sharp"].map((call) =>
        el("button", { class: "secondary big", text: t(`follow.call.${call}`), onclick: () => this.estimate(call) }))),
      // A finished block's card waits here until the player moves on.
      onward: el("button", { class: "primary", hidden: true, text: t("follow.next"), onclick: () => this.onward() }),
      blocks: el("div", { class: "rows" }),
      rows: el("div", { class: "rows" }),
      summary: el("div", { class: "summary" }),
      nav: runNav({
        // An endless exercise has no natural end, so the button is not an
        // escape from it -- it is how you finish, and it is where the score is.
        stopLabel: run.spec.endless ? t("practice.finish") : t("practice.stop"),
        backLabel: this.backLabel,
        onStop: () => this.finish(true),
        onRedo: () => this.restart(),
        onBack: () => this.onBack(),
        onAgain: () => this.again(),
      }),
    };
    const u = this.ui;
    u.panel = el("div", { class: "card panel" }, [u.noteLabel, u.target, u.progress, u.progressText, u.meter.element,
                                                    u.judge, u.estimate, u.onward]);
    // Block feedback keeps the per-note readings out of sight until the end:
    // the block card is the feedback, and a row per note beside it would be
    // every-note feedback by the back door.
    u.rows.hidden = run.spec.feedback === "block";
    append(root,
      u.heading,
      u.keyPicker ? u.keyPicker.element : null,
      u.random ? el("div", { class: "row" }, [u.random.element]) : null,
      u.follow ? el("div", { class: "row" }, u.follow.map((c) => c.element)) : null,
      u.keyLine,
      // Short version folded away, sources behind it. The page stays clean and
      // nothing that explains WHY this exercise exists is more than a tap
      // away -- which for an exercise about harmonic intonation matters more
      // than usual, since the instruction on its own sounds like nonsense.
      run.spec.explain ? explainer(...run.spec.explain.map((k) => t(k))) : null,
      run.spec.help ? helpSection(run.spec.help).element : null,
      el("p", { class: "muted small", text: t("practice.pedal") }),
      run.spec.report === "stopper" ? el("p", { class: "note-box", text: t("practice.stopper.protocol") }) : null,
      ((run.exercises.some((e) => e.drone) || run.spec.follow) && !run.settings.headphones)
        ? el("p", { class: "note-box", text: t("drone.bleed") }) : null,
      u.status, u.nav.top, u.panel, u.summary, u.blocks, u.rows, u.nav.bottom,
    );
    /* Two feet-sized intentions, and the letters for a keyboard.
     *
     * BACK is the one this was built for: another go at the note just played,
     * without restarting the exercise. FORWARD is its opposite and is what
     * makes the pair usable -- a note you cannot get today is abandoned with
     * the other pedal rather than by waiting the segmenter out.
     *
     * Registered on the owner like every other subscription, so the listener
     * cannot outlive the run: the old hand-rolled keydown had to be
     * remembered and removed in unmount(), and was the only thing in this
     * view that did. */
    own.add(pedal((intent) => {
      if (!this.run || this.run.phase === "finished" || this.run.phase === "calibrating") return false;
      if (intent === BACK) this.again();
      else if (intent === FORWARD) this.skip();
      return true;
    }));
    // s / f / t on a keyboard, for the predict prompt. Three calls need three
    // keys, which is exactly what two pedals cannot offer -- see CR-009.
    own.add((() => {
      const onKey = (e) => {
        if (!this.run) return;
        const key = e.key.toLowerCase();
        if (this.run.phase === "estimating") {
          const call = { s: "sharp", f: "flat", t: "same", i: "same" }[key];
          if (call) this.estimate(call);
          return;
        }
        if (this.run.phase !== "judging") return;
        const call = { s: "sharp", f: "flat", t: "in tune", i: "in tune" }[key];
        if (call) this.judge(call);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    })());
  }

  contextTag(note, exercise) {
    const mixed = exercise.notes.some((n) => n.context) && exercise.notes.some((n) => !n.context);
    if (!mixed) return "";
    return note.context ? ` · ${t("practice.tag.pure")}` : ` · ${t("practice.tag.temp")}`;
  }

  nextSegment() {
    const run = this.run;
    if (!run) return;
    // An exercise that changes key never runs out: a new key is a new drone,
    // so it cannot be one more note in the current Exercise -- it is a whole
    // new one, built when the previous one is used up. Finishing is the
    // player's Finish button, never the end of the list.
    if (!run.exercises[run.exIdx] && run.spec.nextExercise) {
      run.exercises.push(run.spec.nextExercise(run));
    }
    const exercise = run.exercises[run.exIdx];
    if (!exercise) { this.finish(false); return; }
    run.exercise = exercise;
    if (this.ui.keyLine && exercise.key) {
      this.ui.keyLine.textContent =
        t("practice.nowInKey", nameClass(SpelledPitch.parse(`${exercise.key}4`), run.settings));
    }
    run.notes = [...exercise.notes];
    run.noteIdx = -1;
    // A retake that reached back across a segment boundary says where in
    // this exercise to land; nextNote() advances before it reads.
    if (run.replayAt !== null) { run.noteIdx = run.replayAt - 1; run.replayAt = null; }
    run.droneHz = null;
    // Follow me measures the background once per run, not once per block:
    // the partner moving twenty cents does not change what it bleeds.
    if (!run.spec.follow) run.onsetDb = null;

    if (run.spec.follow) {
      const unison = exercise.notes.find((n) => this.followUnison(n, exercise));
      // With headphones nothing of the partner reaches the microphone, so
      // there is no bleed to measure and no level gate to set.
      if (unison && run.onsetDb === null && run.settings.droneLevel > 0 && !run.settings.headphones) {
        const hz = this.partnerHz(unison, exercise);
        engine.drone.start(hz, run.settings.droneLevel * UNISON_DUCK, run.timbre);
        engine.setNotches(this.partnerNotches(hz, hz));
        run.phase = "calibrating";
        run.calib = new BackgroundCalibration();
        this.ui.status.textContent = t("drone.calibrating");
        return;
      }
    } else if (exercise.drone && run.settings.droneLevel > 0) {
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
        run.calib = new BackgroundCalibration();
        this.ui.status.textContent = t("drone.calibrating");
        return;
      }
    }
    this.nextNote();
  }

  /* Follow me's partner for one note: the bass of its harmonic context,
   * where the tuning puts it, moved by the block's offset. */
  partnerHz(note, exercise) {
    return shiftedHz(this.run.tuning.targetHz(note.context.bass), exercise.offsetCents);
  }

  followUnison(note, exercise) {
    const target = shiftedHz(this.run.resolver.resolve(note), exercise.offsetCents);
    return Math.abs(centsBetween(this.partnerHz(note, exercise), target)) <= 80.0;
  }

  /* The plain partner is the drone the speaker notches were built for; any
   * richer one is only offered with headphones, where there is nothing in
   * the microphone to notch. */
  partnerNotches(partnerHz, targetHz) {
    return this.run.timbre === "plain"
      ? dronePartialsToNotch(partnerHz, targetHz, this.run.spec.acceptance ?? 80.0) : [];
  }

  finishCalibration() {
    const run = this.run;
    run.onsetDb = run.calib.onsetDb;
    let text = t("practice.calibrated", run.calib.backgroundDb.toFixed(1), run.onsetDb.toFixed(1));
    if (run.calib.tooLoud) text += " — " + t("drone.calibratedWarn");
    this.ui.status.textContent = text;
    this.nextNote();
  }

  nextNote() {
    const run = this.run;
    if (!run) return;
    run.noteIdx += 1;
    const exercise = run.exercise;
    if (run.noteIdx >= run.notes.length) {
      if (run.spec.nextNote) {
        run.notes.push(run.spec.nextNote(run));    // never runs out; Finish ends it
      } else {
        engine.drone.stop();
        engine.setNotches([]);
        if (run.spec.feedback === "block" && !run.blocks.has(run.exIdx)) { this.endBlock(); return; }
        run.exIdx += 1;
        this.nextSegment();
        return;
      }
    }
    const note = run.notes[run.noteIdx];
    run.note = note;
    // Belongs to the note just left, and leaving it behind is what let a
    // press of "again" one note too late silently delete the previous note's
    // reading while appearing to do nothing at all.
    run.pendingResult = null;
    run.lastJudged = false;
    run.target = run.resolver.resolve(note);
    if (run.spec.follow) {
      run.target = shiftedHz(run.target, exercise.offsetCents);
      run.droneHz = run.settings.droneLevel > 0 ? this.partnerHz(note, exercise) : null;
    }
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
    if (run.spec.follow) { this.partnerEnters(); return; }
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

  /* Follow me: the partner plays alone first, then you join.
   *
   * A duo entry rather than a drone already sounding: the ear gets a moment
   * to hear where the partner is before committing to an attack, which is
   * where a partner's drift is first met. The target in Hz is not shown --
   * it would give the offset away to an ear that was meant to find it. With
   * the cue on, the direction is said while the partner plays alone: a cue
   * about the task, never a reading of the playing. */
  partnerEnters() {
    const run = this.run;
    const exercise = run.exercise;
    this.ui.target.textContent = "";
    // The gate is set only on speakers at unison, and only then is the
    // partner lowered -- not while it plays alone, which is when it has to be
    // heard, but just before you come in, so it has settled by the time the
    // segmenter listens. With headphones it is never lowered.
    const unison = run.seg.onsetDb !== null;
    const leadIn = Number(run.settings.followLeadIn) || 1.5;
    if (run.droneHz) {
      engine.drone.start(run.droneHz, run.settings.droneLevel, run.timbre);
      engine.setNotches(this.partnerNotches(run.droneHz, run.target));
      if (unison) {
        run.duckTimer = setTimeout(() => {
          run.duckTimer = null;
          if (this.run === run && run.phase === "leadin") engine.drone.setLevel(run.settings.droneLevel * UNISON_DUCK);
        }, Math.max(0, leadIn - DUCK_AHEAD_SECONDS) * 1000);
      }
    }
    run.phase = "leadin";
    const direction = directionOf(exercise.offsetCents);
    const cue = run.settings.followCue
      ? ` ${t(`follow.cue.${direction === "up" ? "sharp" : direction === "down" ? "flat" : "same"}`)}` : "";
    this.ui.status.textContent = t("follow.listen") + cue;
    run.nextTimer = setTimeout(() => {
      run.nextTimer = null;
      if (this.run !== run || run.phase !== "leadin") return;
      if (unison) engine.drone.setLevel(run.settings.droneLevel * UNISON_DUCK);   // in case the duck timer was late
      run.phase = "playing";
      this.ui.status.textContent = (unison ? t("follow.joinUnison") : t("follow.join")) + cue;
    }, leadIn * 1000);
  }

  /* The end of a block: the call first if the player asked to make one, then
   * the card. */
  endBlock() {
    const run = this.run;
    if (run.settings.followEstimate) {
      run.phase = "estimating";
      this.ui.estimate.hidden = false;
      this.ui.status.textContent = t("follow.whichWay");
      return;
    }
    this.showBlock(null);
  }

  estimate(called) {
    const run = this.run;
    if (!run || run.phase !== "estimating") return;
    this.ui.estimate.hidden = true;
    this.showBlock(called);
  }

  /* One card for the block just played, and a wait for the player to move
   * on -- there is no hurry, and reading it is the point. */
  showBlock(called) {
    const run = this.run;
    const exercise = run.exercise;
    const exIdx = run.exIdx;
    const readings = this.blockReadings(exIdx);
    const reading = blockFollow(readings, exercise.offsetCents, this.referenceBefore(exIdx));
    const actual = { up: "sharp", down: "flat" }[directionOf(exercise.offsetCents)] ?? "same";
    const card = el("div", { class: "result-row" }, [
      el("div", { class: "result-head" }, [
        el("span", { class: "result-name", text: t("follow.blockN", exIdx + 1, run.exercises.length) }),
      ]),
      el("p", { text: this.blockText(reading, exercise.offsetCents) }),
      called ? el("p", { class: `muted ${called === actual ? "good" : ""}`,
                         text: `${t("follow.youHeard", t(`follow.call.${called}`))} — ` +
                               (called === actual ? t("practice.agreed")
                                                  : t("follow.itWent", t(`follow.call.${actual}`))) }) : null,
    ]);
    this.ui.blocks.prepend(card);
    this.ui.noteLabel.textContent = t("follow.blockN", exIdx + 1, run.exercises.length);
    run.blocks.set(exIdx, { reading, readings, called, actual, card, offsetCents: exercise.offsetCents });
    run.phase = "block";
    this.ui.onward.hidden = false;
    this.ui.status.textContent = t("follow.blockDone");
  }

  /* The notes of one block as played: name and reading against the partner. */
  blockReadings(exIdx) {
    return this.run.log.filter((e) => e.exIdx === exIdx && e.result)
      .map((e) => ({ name: e.result.pitch.name, vsPartner: e.result.meanCents }));
  }

  /* Where each note was last played with the partner in tune, before this
   * block. Recomputed rather than kept, so a block taken back with "again"
   * and replayed is read against the same reference as the first time. */
  referenceBefore(exIdx) {
    return referenceFrom([...this.run.blocks.entries()]
      .filter(([i]) => i < exIdx).sort(([a], [b]) => a - b)
      .map(([, b]) => ({ offsetCents: b.offsetCents, readings: b.readings })));
  }

  /* Two things, kept apart: how far you moved from your own in-tune playing
   * of the same notes (the follow), and where you sat against the partner
   * (which a flute sitting sharp affects, and which is worth knowing). */
  blockText(reading, offsetCents) {
    if (!reading) return t("follow.noReading");
    const fmt = (c) => Math.abs(c).toFixed(0);
    const way = (c) => t(c >= 0 ? "follow.sharp" : "follow.flat");
    const close = (c) => Math.abs(c) <= bands(this.run.settings).inTuneCents;
    const landed = close(reading.vsPartner)
      ? t("follow.landedWith")
      : t("follow.landed", fmt(reading.vsPartner), t(reading.vsPartner >= 0 ? "follow.above" : "follow.below"));
    const sat = close(reading.vsPartner) ? t("follow.refWith")
      : t("follow.refSat", fmt(reading.vsPartner), t(reading.vsPartner >= 0 ? "follow.above" : "follow.below"));
    if (reading.shift === null) return `${t("follow.reference")} ${sat}`;
    if (Math.abs(offsetCents) < MIN_FOLLOW_OFFSET) {
      return close(reading.shift)
        ? `${t("follow.stayedWith")} ${sat}`
        : `${t("follow.movedAnyway", fmt(reading.shift), way(reading.shift))} ${sat}`;
    }
    const partner = t("follow.partnerWent", fmt(offsetCents), way(offsetCents));
    const towards = Math.sign(reading.shift) === Math.sign(offsetCents);
    const you = close(reading.shift) ? t("follow.youStayed")
      : towards
      ? t("follow.youFollowed", fmt(reading.shift), Math.round(100 * reading.ratio))
      : t("follow.youWentOther", fmt(reading.shift), way(reading.shift));
    return `${partner} ${you} ${landed}`;
  }

  /* Past a block card, on to the next block. */
  onward() {
    const run = this.run;
    if (!run || run.phase !== "block") return;
    this.ui.onward.hidden = true;
    run.exIdx += 1;
    this.nextSegment();
  }

  /* Taking a note back out of a block that has had its card: the card and
   * its reading go with it, and come back when the block is finished again. */
  dropBlock(exIdx) {
    const run = this.run;
    const block = run.blocks.get(exIdx);
    if (block) { block.card?.remove(); run.blocks.delete(exIdx); }
    this.ui.estimate.hidden = true;
    this.ui.onward.hidden = true;
  }

  /* Another go at the note just played.
   *
   * The request this was built for: mid-exercise the thing most often wanted
   * is one more attempt at the note that just went by, and the only way to
   * get it was to restart the whole exercise -- which is a strange price for
   * a fluffed note, and the reason it was being paid was that nobody had
   * given "again" a name.
   *
   * The retake *replaces* the attempt before it rather than joining it. That
   * is not squeamishness about the score: several reports index the results
   * positionally against the exercise's notes -- the adjust comparison reads
   * the first two as its two basses, the stopper check pairs them by octave
   * -- and an appended retake would have adjust comparing two goes at the
   * same bass and announcing that the note had not moved. The count of
   * retakes is kept and shown at the end, so nothing is hidden, only
   * attributed to the note it belongs to. */
  again() {
    const run = this.run;
    if (!run) return;
    const target = takeBackTarget({
      phase: run.phase, log: run.log,
      exIdx: run.exIdx, noteIdx: run.noteIdx, hasNote: !!run.note,
    });
    if (!target) return;
    if (run.nextTimer) { clearTimeout(run.nextTimer); run.nextTimer = null; }
    if (run.duckTimer) { clearTimeout(run.duckTimer); run.duckTimer = null; }

    if (target.give === "pending") {
      // A reading already in the summary, with no row yet: the judging phase.
      if (run.pendingResult) { run.summary.dropLast(); run.retakes += 1; }
    } else if (target.give === "logged") {
      const last = run.log.pop();
      if (last.counted) { run.summary.dropLast(); run.retakes += 1; }
      if (last.judged) run.judgements.pop();
      last.row.remove();
    }
    run.pendingResult = null;
    run.lastJudged = false;
    this.ui.judge.hidden = true;
    if (run.spec.feedback === "block") this.dropBlock(target.exIdx);
    this.replay(target.exIdx, target.noteIdx);
  }

  /* Put the run back on one particular note.
   *
   * Within the current exercise that is one line. Across a segment boundary
   * the exercise has to be re-entered, because its drone, its key and its
   * notes all changed when the run moved on -- and that boundary is not an
   * edge case: Adjust to the drone is two one-note exercises over different
   * basses, so the first note of it is always a segment behind by the time
   * anyone decides to play it again. */
  replay(exIdx, noteIdx) {
    const run = this.run;
    if (exIdx !== run.exIdx) {
      run.exIdx = exIdx;
      run.replayAt = noteIdx;
      engine.drone.stop();
      engine.setNotches([]);
      this.nextSegment();
      return;
    }
    run.noteIdx = noteIdx - 1;      // nextNote() advances before it reads
    this.nextNote();
  }

  /* Its opposite: this one is not happening today, move on. Without it the
   * pedal's other button would have nothing to do, and a note the player
   * cannot produce would have to be waited out or the exercise abandoned. A
   * skipped note is not scored -- it was not played -- and says so in the
   * log, which is the honest reading of an empty attempt. */
  skip() {
    const run = this.run;
    if (!run || run.phase === "finished" || run.phase === "calibrating") return;
    if (run.nextTimer) { clearTimeout(run.nextTimer); run.nextTimer = null; }
    if (run.phase === "playing" || run.phase === "leadin") { this.reveal(null, null); return; }
    // Already revealed or waiting for a call: stop waiting and go on.
    if (run.phase === "judging") { this.ui.judge.hidden = true; this.reveal(run.pendingResult, null); return; }
    // Follow me: no call this time, or past a block's card.
    if (run.phase === "estimating") { this.ui.estimate.hidden = true; this.showBlock(null); return; }
    if (run.phase === "block") { this.onward(); return; }
    this.nextNote();
  }

  onFrame(frame) {
    const run = this.run;
    if (!run) return;
    if (run.phase === "calibrating") {
      if (run.calib.push(frame)) this.finishCalibration();
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
    // The partner stops with the note: it entered first, and leaves with you.
    if (run.spec.follow) {
      if (run.duckTimer) { clearTimeout(run.duckTimer); run.duckTimer = null; }
      engine.drone.stop();
      engine.setNotches([]);
    }
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
      const children = [el("div", { class: "result-head" }, [el("span", { class: "result-name", text: label }), cents]), gauge.element,
                        el("div", { class: "muted small", text: settleLabel(result.settleSeconds) })];
      if (called) {
        const { inTuneCents, nearlyCents } = bands(run.settings);
        const actual = judgeDirection(result.meanCents, inTuneCents);
        const agreed = called === actual;
        // The cents travel with the call: without them a summary can say how
        // often the ear was right and never how nearly.
        run.judgements.push({ called, actual, agreed, cents: result.meanCents });
        run.lastJudged = true;
        const nearly = !agreed && nearMiss(called, actual, result.meanCents, nearlyCents);
        children.push(el("div", { class: `muted ${agreed ? "good" : nearly ? "close" : ""}`,
          text: `${t("practice.youSaid", t(`practice.call.${called}`))} — ` +
                (agreed ? t("practice.agreed")
                        : `${t("practice.measured", t(`practice.call.${actual}`))}${nearly ? ` · ${t("practice.almost")}` : ""}`) }));
      }
      row = el("div", { class: "result-row" }, children);
    }
    this.ui.rows.prepend(row);
    run.log.push({ counted: !!result, judged: !!called, row, result,
                   noteIdx: run.noteIdx, exIdx: run.exIdx });
    run.phase = "between";
    run.nextTimer = setTimeout(() => { run.nextTimer = null; this.nextNote(); }, 900);
  }

  render() {
    if (!this.mounted || !this.run) return;
    const run = this.run;
    if (run.phase === "finished") return;      // nothing moves once it is over
    const u = this.ui;
    const frame = engine.lastFrame;
    if (frame) u.meter.setLevel(frame.levelDb);
    if (run.phase === "playing" && run.seg) {
      const fraction = Math.min(1, run.seg.elapsedSeconds / run.seg.requiredSeconds);
      u.progress.firstChild.style.width = `${fraction * 100}%`;
      u.progressText.textContent = `${run.seg.elapsedSeconds.toFixed(1)} / ${run.seg.requiredSeconds.toFixed(1)} s`;
    } else if (run.phase === "calibrating" && run.calib) {
      u.progress.firstChild.style.width = `${run.calib.fraction * 100}%`;
      u.progressText.textContent = t("drone.stayQuiet", run.calib.remainingSeconds.toFixed(1));
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
    if (run.duckTimer) clearTimeout(run.duckTimer);
    engine.drone.stop();
    engine.setNotches([]);
    // A clear "over" state: a tick (or a square when stopped early), no
    // progress bar, no meter, the summary above the per-note rows.
    const u = this.ui;
    u.judge.hidden = true;
    u.estimate.hidden = true;
    u.onward.hidden = true;
    u.rows.hidden = false;
    u.noteLabel.textContent = stopped ? "■" : "✓";
    u.target.textContent = "";
    u.progress.hidden = true;
    u.progressText.textContent = "";
    u.meter.element.hidden = true;
    u.panel.classList.add("finished");
    u.status.textContent = stopped ? t("practice.stopped") : t("practice.done");
    u.nav.finish();

    const s = run.settings;
    const summary = run.summary;
    const parts = [];
    if (summary.results.length) {
      parts.push(el("p", { class: "mono", text: t("practice.meanAbs", summary.meanAbsoluteCents.toFixed(1)) }));
      // Said out loud rather than folded away: a retake replaces the attempt
      // before it, so the figures above are the attempts that were kept, and
      // a reader is entitled to know how many there were to choose from.
      if (run.retakes) parts.push(el("p", { class: "muted small", text: t("practice.retakes", run.retakes) }));
      const byClass = summary.byPitchClass();
      parts.push(el("p", { class: "mono", text: `${t("practice.byNote")} ` + Object.entries(byClass).map(([k, v]) =>
        `${nameClass(SpelledPitch.parse(`${k}4`), s)} ${v >= 0 ? "+" : ""}${v.toFixed(1)}`).join("  ") }));
    }
    if (run.judgements.length) parts.push(this.judgementReport(run.judgements));
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
    if (run.spec.report === "adjust") parts.push(this.adjustReport(summary, s));
    if (run.spec.follow) {
      // A block stopped part-way still counts for the notes it has; it just
      // never got a card.
      const exercise = run.exercises[run.exIdx];
      if (exercise && !run.blocks.has(run.exIdx)) {
        const readings = this.blockReadings(run.exIdx);
        const reading = blockFollow(readings, exercise.offsetCents, this.referenceBefore(run.exIdx));
        if (reading) run.blocks.set(run.exIdx, { reading, readings, called: null, actual: null, card: null,
                                                 offsetCents: exercise.offsetCents });
      }
      parts.push(this.followReport());
    }
    u.summary.replaceChildren(el("h2", { text: t("practice.summary") }), ...parts,
      helpSection("numbers").element);

    if (summary.results.length) {
      const record = {
        ...summary.toDict(),
        exercise: `practice: ${run.key}`, mode: "pure",
        temperament: s.temperament, root: s.root, reference_hz: s.referenceHz,
        naming: s.naming, lang: lang(), stopped,
        ...(run.spec.randomisable ? { random: run.random } : {}),
        ...(run.spec.follow ? { follow: this.followRecord() } : {}),
        ...(this.label ? { label: this.label } : {}),
      };
      if (run.judgements.length) {
        const tally = judgementTally(run.judgements);
        record.judgement = { agreed: tally.agreed, total: tally.total, by_actual: tally.byActual };
      }
      try {
        await history.add(record);
        u.summary.append(el("p", { class: "muted", text: t("practice.saved") }));
        // Asked once, after enough sessions to have an opinion, and never
        // again. Appended last so it can never come between the player and
        // their own results.
        const invite = invitation(`practice: ${run.key}`, await history.count());
        if (invite) u.summary.append(invite);
      } catch (_e) { /* storage unavailable: the session still displayed */ }
    }
  }

  /* How the calls went.
   *
   * Overall first, because that is the number a player comes back for, and
   * then the split by what the note actually did -- which is the half that
   * can be acted on. An ear that catches every sharp note and misses every
   * flat one scores fifty per cent and has one specific thing to practise;
   * the overall figure alone would never say so. */
  judgementReport(judgements) {
    const tally = judgementTally(judgements, bands(this.run.settings));
    const box = el("div", { class: "judgement" });
    box.append(el("p", { class: "headline", text: t(`practice.score.${encouragement(tally)}`) }));
    box.append(el("p", { text: t("practice.judgement", tally.agreed, tally.total) }));
    /* The misses that were nearly hits, said before the table rather than
     * left to be worked out from it. "Eight of fifteen" reads as a failure;
     * "eight, and four of the others were within ten cents" is the same
     * session described accurately. */
    if (tally.nearly) {
      box.append(el("p", { class: "close", text: t("practice.nearlyRight", tally.nearly,
                                                   bands(this.run.settings).nearlyCents) }));
    }
    const row = (label, { played, agreed }) => el("tr", {}, [
      el("td", { text: label }),
      el("td", { class: "num", text: `${agreed} / ${played}` }),
      el("td", { class: "muted", text: `${Math.round((100 * agreed) / played)}%` }),
    ]);
    const rows = CALL_DIRECTIONS
      .filter((direction) => tally.byActual[direction].played > 0)
      .map((direction) => row(t("practice.score.whenYouWere", t(`practice.call.${direction}`)),
                              tally.byActual[direction]));
    /* And the same session split by how far out the note actually was. This
     * is where the useful finding lives: an ear that catches every note
     * twenty cents out and misses every note eight cents out is not a bad
     * ear, it is an ear with a resolution -- and the aggregate row above
     * cannot tell the two apart. "in tune" is left out, being already a row
     * of its own above. */
    const detail = MAGNITUDES
      .filter((key) => key !== "in tune" && tally.byMagnitude[key].played > 0)
      .map((key) => row(t("practice.score.whenYouWere", t(`magnitude.${key.replace(" ", ".")}`)),
                        tally.byMagnitude[key]));
    const all = detail.length ? [...rows, ...detail] : rows;
    if (all.length) box.append(el("div", { class: "stats scroll" }, [el("table", {}, [el("tbody", {}, all)])]));
    box.append(el("p", { class: "muted small", text: t("practice.score.note") }));
    return box;
  }

  /* Follow me, over the whole session: how far you went with the partner
   * each way, and what you did when it did not move. A difference between
   * the two directions is named only when core/follow.js says the session
   * can support one; otherwise the figures stand on their own. */
  followReport() {
    const run = this.run;
    const blocks = [...run.blocks.values()].map((b) => b.reading).filter(Boolean);
    const box = el("div", { class: "adjust" });
    if (!blocks.length) { box.append(el("p", { text: t("follow.noBlocks") })); return box; }
    const pattern = followPattern(blocks);
    const pct = (r) => `${Math.round(100 * r)}%`;
    const rows = [];
    if (pattern.flatBlocks) rows.push([t("follow.whenFlat"), pct(pattern.flat), t("follow.blocks", pattern.flatBlocks)]);
    if (pattern.sharpBlocks) rows.push([t("follow.whenSharp"), pct(pattern.sharp), t("follow.blocks", pattern.sharpBlocks)]);
    if (pattern.catchBlocks) {
      rows.push([t("follow.whenSame"), `${pattern.catchMoved >= 0 ? "+" : ""}${pattern.catchMoved.toFixed(1)}¢`,
                 t("follow.blocks", pattern.catchBlocks)]);
    }
    box.append(el("div", { class: "stats scroll" }, [el("table", {}, [el("tbody", {}, rows.map(([what, value, n]) =>
      el("tr", {}, [el("td", { text: what }), el("td", { class: "num", text: value }), el("td", { class: "muted", text: n })])))])]));
    if (pattern.readier) box.append(el("p", { class: "headline", text: t(`follow.readier.${pattern.readier}`) }));
    const calls = [...run.blocks.values()].filter((b) => b.called);
    if (calls.length) {
      box.append(el("p", { text: t("follow.calls", calls.filter((b) => b.called === b.actual).length, calls.length) }));
    }
    box.append(el("p", { class: "muted small", text: t("follow.note") }));
    return box;
  }

  followRecord() {
    const run = this.run;
    const s = run.settings;
    return {
      level: run.spec.follow, cents: Number(s.followCents) || 20, cue: s.followCue === true,
      estimate: s.followEstimate === true, timbre: run.timbre,
      blocks: [...run.blocks.entries()].sort(([a], [b]) => a - b).map(([, b]) => ({
        offset_cents: b.offsetCents,
        vs_partner_cents: b.reading ? Math.round(b.reading.vsPartner * 100) / 100 : null,
        shift_cents: b.reading?.shift == null ? null : Math.round(b.reading.shift * 100) / 100,
        ratio: b.reading?.ratio == null ? null : Math.round(b.reading.ratio * 1000) / 1000,
        called: b.called, notes: b.reading?.notes ?? 0,
      })),
    };
  }

  /* Did the note move when the bass did?
   *
   * The measurement is a difference between two soundings, never a distance
   * from a reference -- so it survives a reference pitch set wrong, a flute
   * sitting sharp, and a player warming up mid-session. All three have
   * produced wrong answers elsewhere in this app; here they cancel. */
  adjustReport(summary, s) {
    const box = el("div", { class: "adjust" });
    const [first, second] = summary.results;
    const compared = compareAdjustment(first, second);
    if (!compared) {
      box.append(el("p", { text: t("practice.adjust.needBoth") }));
      return box;
    }
    const noteName = name(compared.pitch, s);
    const fmt = (c) => `${c >= 0 ? "+" : ""}${c.toFixed(1)}`;

    box.append(el("p", { class: "headline", text: t(`practice.adjust.${compared.verdict}`, noteName) }));
    if (compared.nearly) box.append(el("p", { class: "close", text: t("practice.adjust.nearly") }));
    box.append(el("div", { class: "stats scroll" }, [
      el("table", {}, [
        el("tbody", {}, [
          [t("practice.adjust.asked"), `${fmt(compared.required)}¢`, t("practice.adjust.askedWhy")],
          [t("practice.adjust.did"), `${fmt(compared.actual)}¢`, t("practice.adjust.didWhy")],
        ].map(([what, value, why]) => el("tr", {}, [
          el("td", { text: what }),
          el("td", { class: "num", text: value }),
          el("td", { class: "muted", text: why }),
        ]))),
      ]),
    ]));
    box.append(el("p", { class: "muted small", text: t("practice.adjust.note") }));
    return box;
  }

  async stopperReport(summary, s) {
    const pairs = octavePairs(summary.results).sort((p, q) => highestFirst(p.lower.pitch, q.lower.pitch));
    const box = el("div", { class: "stopper" });
    if (!pairs.length) { box.append(el("p", { text: t("practice.stopper.noPairs") })); return { element: box }; }
    box.append(el("p", { text: t("practice.stopper.title") }));
    box.append(octaveBars(pairs, s));
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
