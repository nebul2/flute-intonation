/* Play scales, and be told afterwards what was heard.
 *
 * A listening page, not an exercise run. The drills in views/run.js walk a
 * fixed list of target notes and hold each until the segmenter is satisfied,
 * which is the opposite of practising scales: the player wants to play freely
 * for as long as they like and be left alone while they do it.
 *
 * So nothing is judged while playing. The note names appear as they register
 * -- enough to see that the microphone is alive, and to catch it hearing Fa
 * where you played Fa sharp -- and no cents, no needle, no colour. Being
 * watched note by note is the opposite of practising.
 *
 * Three ways to choose what to play, and ONE recogniser behind all of them.
 * Guided names a key, Key lets the player pick one, Free says nothing. In
 * every mode the run is recognised on its own merits, so playing something
 * other than what was asked still counts and the suggestion simply moves on:
 * guidance must never become a cage.
 *
 * Guided is the default because it is the most reliable, not the least. A
 * declared tonic turns identification into verification, and a run too
 * damaged for free mode to place can still be accepted when the app already
 * knows which key to expect.
 */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import * as history from "../history.js";
import { SpelledPitch } from "../core/pitch.js";
import { postAttack } from "../core/scoring.js";
import { RegionTracker, driftCents, isOscillating, alternationRuns, GLIDE_CENTS } from "../audio/regions.js";
import { recogniseSession } from "../core/scales.js";
import { scaleReport, CROSS_KEY_NOTABLE_CENTS, CROSS_KEY_ROWS } from "../core/scaleReport.js";
import { PureIntervalTuning } from "../core/tuning.js";
import { STANDOUT_CENTS } from "../core/stats.js";
import { tunerCandidates, nearestCandidate } from "../core/naming.js";
import {
  el, append, audioControl, levelBar, runNav, currentTuning, name, nameClass, bandClass, explainer,
} from "../ui/widgets.js";

/* The order the player asked for: the traverso's home key first, then outward
 * through the sharps, then the flats. Each carries its own tonic letter and
 * signature name, because a flat key's name is not a letter -- Bb major is
 * tonic "B" under key "Bb" -- and `maxOctaves` because B, C and Bb run off
 * the top of the instrument before a second octave is finished. */
export const GUIDED_KEYS = Object.freeze([
  { key: "D", maxOctaves: 2 },
  { key: "G", maxOctaves: 2 },
  { key: "A", maxOctaves: 1 },
  { key: "E", maxOctaves: 1 },
  { key: "C", maxOctaves: 1 },
  { key: "F", maxOctaves: 2 },
  { key: "Bb", maxOctaves: 1 },
  { key: "Eb", maxOctaves: 2 },
]);

/* How long the player must stop for before the suggestion moves on.
 *
 * Without this the key advanced the moment a run was recognised, which is
 * part-way up the scale -- the recogniser is happy with an ascent alone, so
 * it fired before the descent had been played. Silence is what says "I have
 * finished", and nothing else in the signal does. */
export const ADVANCE_SILENCE_MS = 1500;


/* A key name parses whole: "Bb" is B flat, not B. Taking key[0] made guided
 * mode expect B where the player was asked for B flat -- a semitone out, so
 * it could never match, and the flat keys silently never advanced. */
const tonicOf = (key) => SpelledPitch.parse(`${key}4`);
const keyLabel = (entry, s) => nameClass(tonicOf(entry.key), s);

export default {
  title: () => t("scales.title"),

  mount(root) {
    this.root = root;
    this.showStart();
  },

  unmount() { this.teardown(); },

  teardown() {
    if (this.offFrame) { this.offFrame(); this.offFrame = null; }
    if (this.control) { this.control.dispose(); this.control = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.run = null;
  },

  /* ---- start screen --------------------------------------------------- */

  showStart() {
    this.teardown();
    const root = this.root;
    root.replaceChildren();
    const s = settings.get();
    let mode = s.scalesMode ?? "guided";
    let keyIndex = Math.min(s.scalesKeyIndex ?? 0, GUIDED_KEYS.length - 1);

    const control = audioControl({ showGranted: false });
    this.control = control;

    const modeSelect = el("select", { class: "select", onchange: (e) => {
      mode = e.target.value;
      settings.set({ scalesMode: mode });
      keyRow.hidden = mode !== "key";
      hint.textContent = t(`scales.mode.${mode}.hint`);
    } }, ["guided", "key", "free"].map((m) => el("option", {
      value: m, selected: m === mode || null, text: t(`scales.mode.${m}`),
    })));

    const keySelect = el("select", { class: "select", onchange: (e) => {
      keyIndex = Number(e.target.value);
      settings.set({ scalesKeyIndex: keyIndex });
    } }, GUIDED_KEYS.map((entry, i) => el("option", {
      value: String(i), selected: i === keyIndex || null,
      text: t("scales.keyName", keyLabel(entry, s)),
    })));
    const keyRow = el("div", { class: "row" }, [
      el("label", { class: "field" }, [t("scales.whichKey"), keySelect]),
    ]);
    keyRow.hidden = mode !== "key";

    const hint = el("p", { class: "muted small", text: t(`scales.mode.${mode}.hint`) });
    const start = el("button", {
      class: "primary", text: t("scales.start"), disabled: !engine.listening,
      onclick: () => this.startSession(mode, keyIndex),
    });
    this.offFrame = engine.onState(() => { start.disabled = !engine.listening; });

    append(root,
      el("p", { class: "note-box warn", text: t("scales.experimental") }),
      explainer(t("scales.intro"), t("scales.protocol"), t("scales.why")),
      el("div", { class: "row" }, [
        el("label", { class: "field" }, [t("scales.mode"), modeSelect]),
      ]),
      keyRow,
      hint,
      el("div", { class: "row" }, [control.element, start]),
      engine.listening ? null : el("p", { class: "note-box", text: t("practice.needMic") }),
    );
  },

  /* ---- the session ---------------------------------------------------- */

  startSession(mode, keyIndex) {
    this.teardown();
    const root = this.root;
    root.replaceChildren();
    const s = settings.get();
    const tuning = currentTuning(s);

    const run = this.run = {
      settings: s, tuning, mode, keyIndex,
      pure: new PureIntervalTuning(tuning),
      candidates: tunerCandidates(tuning),
      regions: [], notes: [], runs: [],
      askedAtIndex: 0, lastNoteAt: 0,
      startedAt: Date.now(),
      limitMs: Math.max(1, Number(s.scalesMinutes) || 15) * 60_000,
      tracker: new RegionTracker({
        frameSeconds: engine.detector ? engine.detector.frameSeconds : 512 / 44100,
      }),
    };

    const asked = el("div", { class: "scales-asked" });
    const heard = el("div", { class: "scales-heard" });
    const tally = el("p", { class: "status" });
    const clock = el("span", { class: "mono muted small" });
    const level = levelBar();
    const summary = el("div", { class: "summary" });
    const nav = runNav({
      onStop: () => this.finish(false),
      onRedo: () => this.showStart(),
      onBack: () => this.showStart(),
      stopLabel: t("scales.done"),
      backLabel: t("scales.change"),
      extras: [clock],
    });
    run.ui = { asked, heard, tally, clock, level, summary, nav };

    append(root,
      nav.top,
      asked,
      level.element,
      heard,
      tally,
      summary,
      nav.bottom,
    );

    this.offFrame = engine.onFrame((frame) => this.onFrame(frame));
    this.timer = setInterval(() => this.tick(), 1000);
    this.askNext();
    this.retally();
  },

  /** What the app is asking for, if anything. Never enforced. */
  askNext() {
    const run = this.run;
    const s = run.settings;
    // Only what is played from here on can satisfy the new ask. Without this,
    // a scale played five minutes ago in the key now being suggested would
    // advance it instantly, and the sequence would race ahead untouched.
    run.askedAtIndex = run.notes.length;
    run.ui.asked.replaceChildren();
    if (run.mode === "free") {
      run.ui.asked.append(el("p", { class: "intro", text: t("scales.freePrompt") }));
      return;
    }
    const entry = GUIDED_KEYS[run.keyIndex];
    run.ui.asked.append(
      el("div", { class: "scales-key" }, [
        el("div", { class: "scales-key-name", text: t("scales.keyName", keyLabel(entry, s)) }),
        el("div", { class: "scales-key-note", text: entry.maxOctaves === 2
          ? t("scales.oneOrTwo") : t("scales.oneOnly") }),
      ]),
      run.mode === "guided"
        ? el("div", { class: "controls left" }, [
            el("button", { class: "secondary", text: t("scales.skip"), onclick: () => {
              run.keyIndex = (run.keyIndex + 1) % GUIDED_KEYS.length;
              settings.set({ scalesKeyIndex: run.keyIndex });
              this.askNext();
            } }),
          ])
        : null,
    );
  },

  tick() {
    const run = this.run;
    if (!run) return;
    const left = run.limitMs - (Date.now() - run.startedAt);
    if (left <= 0) { this.finish(true); return; }
    this.maybeAdvance();
    const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000);
    run.ui.clock.textContent = `${m}:${String(sec).padStart(2, "0")}`;
  },

  onFrame(frame) {
    const run = this.run;
    if (!run) return;
    run.ui.level.set(frame.levelDb);
    const region = run.tracker.push(frame);
    if (region) this.addRegion(region);
  },

  /* Same triage as views/listen.js. The trill filter is load-bearing rather
   * than incidental: a trill alternates by a semitone or two, which is
   * exactly the shape a stepwise matcher reads as a scale, so ornaments must
   * be stripped before the recogniser ever sees the notes. */
  addRegion(region) {
    const run = this.run;
    const entry = { region, kind: "note", note: null };
    if (region.short) entry.kind = "short";
    else if (isOscillating(region)) entry.kind = "trill";
    else {
      const [framesHz, levelsDb] = postAttack(region.framesHz, run.tracker.frameSeconds, region.levelsDb);
      if (!framesHz.length) entry.kind = "short";
      else if (Math.abs(driftCents(framesHz)) >= GLIDE_CENTS) entry.kind = "slur";
      else entry.note = { region, framesHz, levelsDb };
    }
    run.regions.push(entry);
    run.lastNoteAt = Date.now();
    this.reconcile();
  },

  /* Unlike trills, a scale's extent AND its key legitimately change as later
   * notes arrive -- a one-octave run becomes a two-octave one, and the key
   * can be revised. So the whole list is rebuilt every time rather than
   * assuming, as listen.js may, that runs only ever grow. */
  reconcile() {
    const run = this.run;
    const ornament = new Set();
    for (const { start, end } of alternationRuns(run.regions.map((e) => e.region))) {
      for (let i = start; i < end; i++) ornament.add(i);
    }

    run.notes = [];
    run.regions.forEach((entry, i) => {
      if (ornament.has(i) || entry.kind !== "note" || !entry.note) return;
      const { framesHz, region } = entry.note;
      const ordered = [...framesHz].sort((a, b) => a - b);
      const medianHz = ordered[ordered.length >> 1];
      const near = nearestCandidate(run.candidates, medianHz);
      run.notes.push({
        pitch: near.pitch,
        index: run.notes.length,
        atSeconds: region.atSeconds,
        seconds: region.seconds,
        medianHz, framesHz,
        levelsDb: entry.note.levelsDb,
      });
    });

    const expectTonic = run.mode === "free" ? null
      : tonicOf(GUIDED_KEYS[run.keyIndex].key).pitchClass;
    // Never restrict the whole session to the key being suggested now: that
    // un-recognises everything played in every earlier key. recogniseSession
    // reads it free first and lets the declared key only ever add.
    run.runs = recogniseSession(run.notes, { expectTonic });

    this.renderHeard();
    this.retally();
  },

  /** Names only. No cents, no colour, nothing that judges the pitch. */
  renderHeard() {
    const run = this.run;
    const s = run.settings;
    const recent = run.notes.slice(-28);
    run.ui.heard.replaceChildren(...recent.map((n) =>
      el("span", { class: "scales-note", text: name(n.pitch, s) })));
  },

  retally() {
    const run = this.run;
    const found = run.runs.length;
    run.ui.tally.textContent = found === 0
      ? t("scales.noneYet")
      : t("scales.tally", found, new Set(run.runs.map((r) => r.tonicName ?? r.pitchClassName)).size);

  },

  /* Has the asked-for key been played, and has the player stopped?
   *
   * Both halves matter. The recogniser is satisfied by an ascent alone -- a
   * player who stops at the top has still played a scale -- so it fires
   * part-way through, and advancing then snatches the key away mid-descent.
   * Silence is the only thing in the signal that means "I have finished". */
  maybeAdvance() {
    const run = this.run;
    if (run.mode !== "guided") return;
    const wanted = GUIDED_KEYS[run.keyIndex].key;
    const done = run.runs.some((r) => r.tonicName === wanted && r.start >= run.askedAtIndex);
    if (!done) return;
    if (Date.now() - run.lastNoteAt < ADVANCE_SILENCE_MS) return;
    run.keyIndex = (run.keyIndex + 1) % GUIDED_KEYS.length;
    settings.set({ scalesKeyIndex: run.keyIndex });
    this.askNext();
  },

  /* ---- the report ----------------------------------------------------- */

  async finish(timedOut) {
    const run = this.run;
    if (!run) return;
    const last = run.tracker.flush();
    if (last) this.addRegion(last);
    if (this.offFrame) { this.offFrame(); this.offFrame = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }

    run.ui.nav.finish();
    run.ui.level.element.hidden = true;
    run.ui.asked.replaceChildren();

    /* Everything the report says is worked out in core/scaleReport.js, which
     * can be run over a real recording in a terminal. That matters more than
     * it sounds: this report was silently broken three times -- most recently
     * by a variable used above the line that declared it, thrown inside an
     * async method nobody was awaiting, so the whole summary vanished without
     * a word while the session tally kept counting scales happily. The view
     * renders and decides nothing, and if it throws anyway it now says so
     * rather than showing an empty page. */
    try {
      run.ui.summary.replaceChildren(...this.report(timedOut));
    } catch (error) {
      run.ui.summary.replaceChildren(
        el("p", { class: "note-box warn", text: t("scales.reportFailed", error.message) }));
      throw error;
    }
    await this.save(timedOut);
  },

  report(timedOut) {
    const run = this.run;
    const s = run.settings;
    const parts = [];
    if (timedOut) parts.push(el("p", { class: "muted", text: t("scales.timeUp") }));

    if (!run.runs.length) {
      parts.push(el("p", { class: "headline", text: t("scales.nothingFound") }));
      parts.push(el("p", { class: "muted", text: t("scales.nothingFoundWhy") }));
      return parts;
    }

    const report = scaleReport({
      notes: run.notes, runs: run.runs, tuning: run.tuning, pure: run.pure,
      frameSeconds: run.tracker.frameSeconds,
      expectedKeys: GUIDED_KEYS.map((k) => k.key),
    });
    run.report = report;

    parts.push(el("p", { class: "headline",
      text: t("scales.found", report.scaleCount, report.keys.length) }));

    if (report.overall) {
      parts.push(el("p", { class: "muted", text: report.action === null
        ? t("scales.centred")
        : t("scales.offset", Math.abs(report.offsetCents).toFixed(1),
             t(report.offsetCents > 0 ? "listen.score.sharp" : "listen.score.flat"),
             t(`listen.score.${report.action}`)) }));
    }
    if (report.best) {
      const measurable = report.keys.filter((k) => k.score).length;
      parts.push(el("p", { text: t(measurable > 1 ? "scales.bestKey" : "scales.oneKey",
        report.best.label, report.best.score.relative.toFixed(1)) }));
    }

    parts.push(el("div", { class: "stats scroll" }, [
      el("table", {}, [
        el("thead", {}, [el("tr", {}, ["key", "runs", "notes", "accuracy", "spread"].map((k) =>
          el("th", { text: t(`scales.col.${k}`) })))]),
        el("tbody", {}, report.keys.map((k) => el("tr", { class: k === report.best ? "best" : "" }, [
          el("td", { text: k.spellable ? k.label : t("scales.unspelled", k.label) }),
          el("td", { class: "num", text: String(k.runCount) }),
          el("td", { class: "num", text: String(k.noteCount) }),
          el("td", { class: "num", text: k.score ? `${k.score.relative.toFixed(1)}¢` : "—" }),
          el("td", { class: "num", text: k.score && k.score.repeatability !== null
            ? `${k.score.repeatability.toFixed(1)}¢` : "—" }),
        ]))),
      ]),
    ]));

    /* Which notes were out, across everything played. Works after a single
     * scale, which the cross-key table below cannot: it needs two keys. */
    parts.push(el("h2", { text: t("scales.notes") }));
    if (!report.standouts.list.length) {
      parts.push(el("p", { text: t("scales.notesAllClose", STANDOUT_CENTS) }));
    } else {
      parts.push(el("p", { text: t("scales.notesLead", report.standouts.list.length) }));
      parts.push(el("div", { class: "stats scroll" }, [
        el("table", {}, [
          el("thead", {}, [el("tr", {}, ["note", "n", "out", "spread"].map((k) =>
            el("th", { text: t(`scales.col.${k}`) })))]),
          el("tbody", {}, report.standouts.list.map((n) => el("tr", {}, [
            el("th", { class: "temp-note", text: name(n.pitch, s) }),
            el("td", { class: "num", text: String(n.n) }),
            el("td", { class: `num ${bandClass(n.mean)}`,
              text: `${n.mean >= 0 ? "+" : ""}${n.mean.toFixed(0)}¢ ${t(`listen.standouts.${n.direction}`)}` }),
            el("td", { class: "num muted", text: n.once ? t("scales.once") : `${n.spread.toFixed(0)}¢` }),
          ]))),
        ]),
      ]));
      if (report.standouts.more) {
        parts.push(el("p", { class: "muted small", text: t("listen.standouts.more", report.standouts.more) }));
      }
    }

    if (report.crossKey.length) {
      const worst = report.crossKey[0];
      const high = worst.cells.reduce((a, b) => (b.mean > a.mean ? b : a));
      const low = worst.cells.reduce((a, b) => (b.mean < a.mean ? b : a));
      parts.push(el("h2", { text: t("scales.sameNote") }));
      parts.push(el("p", { text: worst.spread >= CROSS_KEY_NOTABLE_CENTS
        ? t("scales.sameNoteLead", nameClass(worst.pitch, s), worst.spread.toFixed(0), high.key, low.key)
        : t("scales.sameNoteSteady", worst.spread.toFixed(0)) }));

      const keys = report.keys.map((k) => k.label);
      parts.push(el("div", { class: "stats scroll" }, [
        el("table", {}, [
          el("thead", {}, [el("tr", {}, [
            el("th", { text: t("scales.col.note") }),
            ...keys.map((k) => el("th", { text: k })),
            el("th", { text: t("scales.col.across") }),
          ])]),
          el("tbody", {}, report.crossKey.slice(0, CROSS_KEY_ROWS).map((row) => el("tr", {}, [
            el("th", { class: "temp-note", text: nameClass(row.pitch, s) }),
            ...keys.map((k) => {
              const cell = row.cells.find((c) => c.key === k);
              return el("td", { class: `num${cell ? " " + bandClass(cell.mean) : ""}`,
                text: cell ? `${cell.mean >= 0 ? "+" : ""}${cell.mean.toFixed(0)}` : "·" });
            }),
            el("td", { class: "num muted", text: `${row.spread.toFixed(0)}¢` }),
          ]))),
        ]),
      ]));
      parts.push(el("p", { class: "muted small", text: t("scales.sameNoteNote") }));
    }

    if (report.missed.length && report.missed.length < GUIDED_KEYS.length) {
      parts.push(el("p", { class: "muted small", text: t("scales.notYet", report.missed.join(", ")) }));
    }
    parts.push(el("p", { class: "muted small", text: t("scales.pureNote") }));
    return parts;
  },

  async save(stopped) {
    const run = this.run;
    const s = run.settings;
    const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
    const record = {
      v: 1,
      exercise: "practice: scales",
      mode: s.mode, temperament: s.temperament, root: s.root,
      reference_hz: s.referenceHz, naming: s.naming, stopped,
      scales_mode: run.mode,
      notes: (run.report?.keys ?? []).flatMap((b) => b.notes.map((n) => ({
        pitch: n.pitch.name, mean_cents: r2(n.primaryCents), stdev_cents: r2(n.stdev),
        target_hz: null, settle_s: null, frames: null, key: b.label,
      }))),
      scale_runs: run.runs.map((r) => ({
        key: r.tonicName ?? r.pitchClassName, spellable: r.spellable,
        octaves: r.octaves, shape: r.shape, fit: r2(r.fit),
        wrong: r.wrongNotes, missing: r.missingNotes, octave_errors: r.octaveErrors,
      })),
      by_key: (run.report?.keys ?? []).map((b) => ({
        key: b.label, runs: b.runCount, notes: b.noteCount,
        accuracy: r2(b.score?.accuracy ?? null),
        repeatability: r2(b.score?.repeatability ?? null),
      })),
    };
    try {
      await history.add(record);
      run.ui.summary.append(el("p", { class: "muted", text: t("practice.saved") }));
    } catch (_e) { /* storage unavailable: the session still displayed */ }
  },
};
