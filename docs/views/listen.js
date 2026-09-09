/* Listen to me: play freely; the app names what it heard and says what it can.
 *
 * It asks for the tonic first. That is more than a warm-up: the tonic sets the
 * harmonic context, so in pure mode every note that follows can be judged as
 * an interval above it -- the same F# reads against the pure third over D --
 * not only against the temperament. Each note gets both readings; the current
 * mode decides which one leads.
 *
 * Live feedback is allowed here (this is free play, not a graded exercise).
 * The overview is a per-note table that fills in as you play: occurrences,
 * average and spread, stability, time held, level, whether the note goes
 * sharp when louder, and drift across the piece. The note-by-note log is a
 * remembered option, off by default, so a long piece does not scroll away.
 * Notes under ~120 ms are counted but not measured. */

import { t, lang } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import * as history from "../history.js";
import { SpelledPitch, centsBetween } from "../core/pitch.js";
import { scaleKeyFor } from "../core/generator.js";
import { spellInKey } from "../core/naming.js";
import { HarmonicContext, PureIntervalTuning } from "../core/tuning.js";
import { RegionTracker, driftCents, isOscillating, alternationRuns, GLIDE_CENTS } from "../audio/regions.js";
import { NoteSegmenter } from "../audio/segmenter.js";
import { aggregate, rowsToRecord, volumeVerdict, withinNoteVolumeLink, sessionScore, scorableRows, standouts, offsetAction } from "../core/stats.js";
import { reviewSession, impossible } from "../core/bend.js";
import * as profiles from "../profiles.js";
import { invitation } from "../ui/feedback.js";
import { helpSection } from "../ui/help.js";
import { selectField, checkboxField } from "../ui/fields.js";
import { keyQuality, startRow } from "../ui/controls.js";
import { owner } from "../ui/owner.js";
import { postAttack, scoredWindow, SCORING_RULE } from "../core/scoring.js";
import { el, append, labelField, needle, levelBar, bandClass, bandLabel, settleLabel, currentTuning, name, nameClass, tunerCandidates, nearestCandidate, runNav, explainer } from "../ui/widgets.js";

/* How long the tonic must be held to begin. Collected by the same state
 * machine the exercises use, so a brief dropout costs progress rather than
 * resetting it: counting *consecutive* frames meant one bad frame in forty
 * sent the count back to zero, which a clean Mac microphone hid and an iPad
 * did not. */
const TONIC_SECONDS = 0.45;
const UNSTABLE_CENTS = 8.0;

const fmt = (c, digits = 1) => `${c >= 0 ? "+" : ""}${c.toFixed(digits)}`;

export default {
  title: () => t("listen.title"),

  mount(root) {
    this.root = root;
    this.showStart();
  },

  unmount() { this.teardown(); },

  teardown() {
    this.mounted = false;
    if (this.own) this.own.dispose();
    this.own = owner();
  },

  /* ---- start screen ---------------------------------------------------- */

  showStart() {
    this.teardown();
    const root = this.root;
    const own = this.own;
    root.replaceChildren();

    /* Three ways to ground a session, in order of how much the app then
     * knows. Stating the key gives it a tonic AND a scale: every note can be
     * read as a pure interval over the tonic, and spelled the way the key
     * writes it rather than by proximity -- which is what turns an E major
     * D sharp back from "Eb". Playing the tonic first gives it the tonic
     * only. Neither gives it nothing, and the page says plainly what that
     * costs, because it must still be possible to just play. */
    /* All three bound, so the start screen no longer keeps its own copy of
     * what the settings already hold. The key vocabulary narrows with the
     * quality -- a minor scale is only spellable from some tonics -- which is
     * the pairing keyQuality() exists for. */
    const chooser = own.add(keyQuality({ keyBind: "listenKey", qualityBind: "listenQuality" }));
    const hint = el("p", { class: "muted small" });
    const groundingField = own.add(selectField({
      label: t("listen.groundingLabel"), bind: "listenGrounding",
      options: () => ["key", "tonic", "none"].map((g) => ({ value: g, label: t(`listen.grounding.${g}`) })),
      onChange: refresh,
    }));
    const grounding = () => groundingField.value;
    function refresh() {
      chooser.element.hidden = grounding() === "none";
      // The tonic gate needs a tonic, not a mode.
      chooser.quality.element.hidden = grounding() !== "key";
      hint.textContent = t(`listen.grounding.${grounding()}.hint`);
      hint.classList.toggle("warn", grounding() === "none");
    }
    refresh();

    const label = labelField();
    this.label = label;
    const row = own.add(startRow({
      label: t("listen.start"), needMicNote: false,
      onStart: () => this.startSession({
        grounding: grounding(), key: chooser.key.key,
        quality: grounding() === "key" ? chooser.quality.value : "major" }),
    }));
    append(root,
      explainer(t("listen.intro"), t("listen.introGrounding")),
      groundingField.element,
      chooser.element,
      hint,
      row.element,
      el("div", { class: "row" }, [label.element]),
    );
  },

  /* ---- a session ------------------------------------------------------- */

  startSession({ grounding = "key", key = "D", quality = "major" } = {}) {
    this.lastStart = { grounding, key, quality };
    this.teardown();
    const s = settings.get();
    const tuning = currentTuning(s);
    const tonicPitch = grounding === "none" ? null : SpelledPitch.parse(`${key}4`);
    // The signature to spell notes by. Minor keys borrow their relative major's.
    let keyName = null;
    if (grounding === "key") { try { keyName = scaleKeyFor(key, quality); } catch (_e) { keyName = null; } }
    this.run = {
      settings: s, tuning, tonicPitch, grounding, key, quality, keyName,
      keyChanges: [],            // [{atIndex, key, quality}] -- a piece modulates
      pure: new PureIntervalTuning(tuning),
      context: tonicPitch ? new HarmonicContext(tonicPitch) : null,
      candidates: tunerCandidates(tuning),
      // Only the tonic gate waits; stating the key, or nothing, starts at once.
      phase: grounding === "tonic" ? "tonic" : "free", tonicSegs: [], label: this.label ? this.label.value : "",
      tracker: new RegionTracker({ frameSeconds: engine.detector ? engine.detector.frameSeconds : 512 / 44100 }),
      notes: [], regions: [], shortCount: 0, glideCount: 0, trillCount: 0, lastVoiced: null,
    };
    const run = this.run;
    const root = this.root;
    root.replaceChildren();

    const logToggle = this.own.add(checkboxField({
      label: t("listen.log"), look: "toggle", bind: "listenLog",
      onChange: (on) => { this.ui.rows.hidden = !on; },
    }));

    this.ui = {
      status: el("p", { class: "intro", text: grounding === "tonic"
        ? t("listen.tonicPrompt", nameClass(tonicPitch, s))
        : grounding === "key" ? t("listen.keyPrompt", nameClass(tonicPitch, s)) : t("listen.freePrompt") }),
      nav: runNav({
        stopLabel: t("listen.stop"),
        onStop: () => this.finish(),
        onRedo: () => this.startSession(this.lastStart),   // not the defaults: those are D major
        onBack: () => this.showStart(),
        extras: [logToggle.element],
      }),
      note: el("div", { class: "big-note", text: "—" }),
      progress: el("div", { class: "progress" }, [el("div", { class: "progress-fill" })]),
      readout: el("div", { class: "readout" }, [el("span"), el("span")]),
      gauge: needle(), level: levelBar(),
      table: el("div", { class: "stats scroll" }),
      rows: el("div", { class: "rows", hidden: !s.listenLog }),
      summary: el("div", { class: "summary" }),
    };
    const u = this.ui;
    u.panel = el("div", { class: "card panel" }, [u.note, u.readout, u.progress, u.gauge.element, u.level.element]);

    // The tonic may be played in any octave the flute has it in; whichever
    // lands first opens the session.
    const frameSeconds = engine.detector ? engine.detector.frameSeconds : 512 / 44100;
    run.tonicSegs = tonicPitch === null || grounding !== "tonic" ? [] : run.candidates
      .filter((c) => c.pitch.letter === tonicPitch.letter && c.pitch.alter === tonicPitch.alter
                     && c.pitch.octave >= 4 && c.pitch.octave <= 6)
      .map((c) => new NoteSegmenter({ targetHz: c.hz, frameSeconds, requiredSeconds: TONIC_SECONDS }));
    /* A piece modulates, and a practice session moves between keys. Notes
     * already scored keep the context they were scored in; only notes from
     * here on take the new one, and the change is written into the record
     * with the note it happened at. Not offered to an ungrounded session --
     * there is no key to change. */
    let keyRow = null;
    if (grounding !== "none") {
      const rekey = ({ key: nextKey, quality: nextQuality }) => {
        run.key = nextKey; run.quality = nextQuality;
        run.tonicPitch = SpelledPitch.parse(`${nextKey}4`);
        run.context = new HarmonicContext(run.tonicPitch);
        run.keyName = null;
        if (grounding === "key") { try { run.keyName = scaleKeyFor(nextKey, nextQuality); } catch (_e) { /* unspelled */ } }
        run.keyChanges.push({ atIndex: run.notes.length, key: nextKey, quality: nextQuality });
        u.status.textContent = t("listen.keyChanged", nameClass(run.tonicPitch, s));
      };
      /* The same control as the start screen, with neither half bound: this
       * changes the session in progress and must never rewrite the
       * preference. `source` gives it the run's frozen settings, so a naming
       * change mid-session cannot leave half a scored session reading in Do
       * and half in D -- the rows above it are already labelled. */
      const mid = this.own.add(keyQuality({
        source: () => run.settings, key: run.key, quality: run.quality,
        label: t("listen.changeKey"), onChange: rekey,
      }));
      mid.quality.element.hidden = grounding !== "key";
      keyRow = el("div", { class: "row keyrow" }, [mid.element]);
    }
    // The shared helper, not Node.append: an ungrounded session has no key
    // row, and Node.append renders a null as the text "null".
    append(root, u.status, keyRow, u.nav.top, u.panel, u.table, u.summary, u.rows, u.nav.bottom);
    this.renderTable();

    this.own.add(engine.onFrame((frame) => this.onFrame(frame)));
    this.mounted = true;
    requestAnimationFrame(() => this.render());
  },

  onFrame(frame) {
    const run = this.run;
    if (!run || run.phase === "finished") return;
    if (frame.hz > 0) run.lastVoiced = frame;

    if (run.phase === "tonic") {
      for (const seg of run.tonicSegs) {
        seg.push(frame.hz, frame.levelDb);
        if (seg.complete) {
          run.phase = "free";
          this.ui.progress.hidden = true;
          this.ui.status.textContent = t("listen.tonicHeard");
          break;
        }
      }
      return;
    }

    const region = run.tracker.push(frame);
    if (region) this.addRegion(region);
  },

  /* Both readings for a closed note: against the temperament, and as a pure
   * interval above the tonic. The current mode decides which leads. */
  score(region) {
    const run = this.run;
    // Discard the attack before measuring anything: a flute's attack scoops,
    // so those frames describe the attack, not the note. The exercises have
    // always done this through analyseNote; free play did not, which inflated
    // every steadiness figure and biased every mean flat.
    const [framesHz, levelsDb] =
      postAttack(region.framesHz, run.tracker.frameSeconds, region.levelsDb);
    // Which part of the note is the note: before the taper, from where the
    // pitch settled. The whole post-attack series is still what the drift and
    // volume-link figures below are measured over -- they are about how the
    // note moved, and trimming them would hide the very thing they look for.
    const window = scoredWindow(framesHz, run.tracker.frameSeconds);
    const scored = window.frames.length ? window.frames : framesHz;
    const ordered = [...scored].sort((a, b) => a - b);
    const medianHz = ordered[ordered.length >> 1];
    const meanDb = levelsDb.reduce((a, b) => a + b, 0) / levelsDb.length;

    const near = nearestCandidate(run.candidates, medianHz);
    // Proximity named it; the key, when known, spells it. Same pitch class,
    // so the temperament target is unchanged -- only the name is corrected,
    // and only where the key actually contains the note.
    const pitch = (run.keyName && spellInKey(near.pitch.chromaticIndex, run.keyName,
      { minorTonic: run.quality === "minor" ? run.key : null })) || near.pitch;
    const temperedCents = near.cents;
    let pureHz = null, pureCents = null;
    if (run.context) {
      try {
        pureHz = run.pure.targetHz(pitch, run.context);
        pureCents = centsBetween(pureHz, medianHz);
      } catch (_e) { /* no ratio for this spelled interval */ }
    }
    const usePure = run.settings.mode === "pure" && pureHz !== null;
    const primaryHz = usePure ? pureHz : near.hz;
    const deviations = scored.map((hz) => centsBetween(primaryHz, hz));
    const meanDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const stdev = Math.sqrt(deviations.reduce((a, d) => a + (d - meanDev) ** 2, 0) / deviations.length);
    return {
      pitch, temperedHz: near.hz, temperedCents, pureHz, pureCents,
      primary: usePure ? "pure" : "tempered",
      primaryCents: usePure ? pureCents : temperedCents,
      primaryHz, stdev, seconds: region.seconds, medianHz,
      settleSeconds: window.settleSeconds,
      meanDb, levelsDb, framesHz,
      withinFit: withinNoteVolumeLink(framesHz, levelsDb, primaryHz),
      index: run.notes.length,
    };
  },

  addRegion(region) {
    const entry = { region, baseKind: "note", note: null, row: null };
    if (region.short) {
      entry.baseKind = "short";
    } else if (isOscillating(region)) {
      // A pitch that leaves and returns within one region: a trill too fast
      // for its alternations to become regions of their own.
      entry.baseKind = "trill";
    } else {
      const note = this.score(region);
      // A pitch still on its way somewhere is not a note. Measured after the
      // attack trim, so a scooped start is not mistaken for a slur.
      if (Math.abs(driftCents(note.framesHz)) >= GLIDE_CENTS) entry.baseKind = "slur";
      else entry.note = note;
    }
    this.run.regions.push(entry);
    this.reconcile();
  },

  /* Which regions were notes, decided over the whole session so far.
   *
   * A trill only becomes visible as a *run* of regions alternating between two
   * pitches, so a region cannot be judged when it closes: the alternations
   * that prove it are still to come. Everything is therefore kept, the runs
   * are recomputed as each region arrives, and any note already shown that
   * turns out to belong to an ornament is taken back out. Runs only grow, so
   * nothing is ever restored. */
  reconcile() {
    const run = this.run;
    const runs = alternationRuns(run.regions.map((entry) => entry.region));
    const ornament = new Set();
    for (const { start, end } of runs) for (let i = start; i < end; i++) ornament.add(i);

    run.notes = [];
    let short = 0, slurs = 0, oscillating = 0;
    run.regions.forEach((entry, i) => {
      if (ornament.has(i)) {
        if (entry.row) { entry.row.remove(); entry.row = null; }
        return;
      }
      if (entry.baseKind === "short") { short += 1; return; }
      if (entry.baseKind === "slur") { slurs += 1; return; }
      if (entry.baseKind === "trill") { oscillating += 1; return; }
      entry.note.index = run.notes.length;
      run.notes.push(entry.note);
      if (!entry.row) {
        entry.row = this.logRow(entry.note);
        this.ui.rows.prepend(entry.row);
      }
    });
    run.shortCount = short;
    run.glideCount = slurs;
    run.trillCount = runs.length + oscillating;
    this.renderTable();
  },

  logRow(note) {
    const s = this.run.settings;
    const tonicName = this.run.tonicPitch ? nameClass(this.run.tonicPitch, s) : null;
    const primaryLabel = note.primary === "pure" ? t("listen.pureOver", tonicName) : t("listen.tempered");
    const secondary = note.primary === "pure"
      ? `${t("listen.tempered")} ${fmt(note.temperedCents)}¢`
      : (note.pureCents === null ? "" : `${t("listen.pureOver", tonicName)} ${fmt(note.pureCents)}¢`);
    return el("div", { class: "result-row" }, [
      el("div", { class: "result-head" }, [
        el("span", { class: "result-name", text: name(note.pitch, s) }),
        el("span", { class: `mono ${bandClass(note.primaryCents)}`, text: `${fmt(note.primaryCents)}¢ ${primaryLabel}` }),
      ]),
      el("div", { class: "muted", text: [
        secondary,
        `${note.seconds.toFixed(2)} s`,
        `${note.meanDb.toFixed(0)} dB`,
        settleLabel(note.settleSeconds),
        note.stdev > UNSTABLE_CENTS ? `~ ${t("listen.unstable")} (±${note.stdev.toFixed(1)}¢)` : null,
      ].filter(Boolean).join(" · ") }),
    ]);
  },

  /* The per-note overview, rebuilt from scratch each time a note lands. */
  renderTable() {
    const run = this.run, s = run.settings;
    const rows = aggregate(run.notes);
    const head = ["note", "n", "mean", "range", "stability", "time", "level", "volume", "trend"];
    const table = el("table", {}, [
      el("thead", {}, [el("tr", {}, head.map((k) => el("th", { text: t(`listen.col.${k}`), title: t(`listen.colTitle.${k}`) })))]),
      el("tbody", {}, rows.map((row) => {
        const verdict = volumeVerdict(row.volume);
        let volumeText = "·", volumeTitle = t("listen.volume.few");
        if (verdict === "none") { volumeText = "—"; volumeTitle = t("listen.volume.none"); }
        else if (verdict) {
          volumeText = `${verdict === "sharper" ? "↑" : "↓"} ${fmt(row.volume.slope)} ¢/dB`;
          volumeTitle = t(`listen.volume.${verdict}`);
        } else if (row.withinVolume && Math.abs(row.withinVolume.slope) >= 0.5 && Math.abs(row.withinVolume.r) >= 0.5) {
          volumeText = `(${row.withinVolume.slope > 0 ? "↑" : "↓"} ${fmt(row.withinVolume.slope)})`;
          volumeTitle = t("listen.volume.within");
        }
        const trendText = row.trend === null ? "—" : `${row.trend > 0 ? "↑" : "↓"} ${fmt(row.trend)}`;
        return el("tr", {}, [
          el("td", { class: "name", text: name(row.pitch, s) }),
          el("td", { class: "num", text: String(row.n) }),
          el("td", { class: `num ${bandClass(row.meanCents)}`, text: fmt(row.meanCents) }),
          el("td", { class: "num", text: row.n > 1 ? `${fmt(row.minCents)}…${fmt(row.maxCents)}` : "—" }),
          el("td", { class: "num", text: `±${row.stability.toFixed(1)}` }),
          el("td", { class: "num", text: row.totalSeconds.toFixed(1) }),
          el("td", { class: "num", text: row.meanDb === null ? "—" : row.meanDb.toFixed(0) }),
          el("td", { class: "num", text: volumeText, title: volumeTitle }),
          el("td", { class: "num", text: trendText, title: row.trend === null ? "" : t(row.trend > 0 ? "listen.trend.up" : "listen.trend.down") }),
        ]);
      })),
    ]);
    this.ui.table.replaceChildren(rows.length ? table : el("p", { class: "muted", text: t("listen.tableEmpty") }));
  },

  render() {
    if (!this.mounted || !this.run || this.run.phase === "finished") return;
    const run = this.run, u = this.ui;
    const frame = engine.lastFrame;
    if (frame) u.level.set(frame.levelDb);
    const now = performance.now();
    if (run.lastVoiced && now - run.lastVoiced.t < 400) {
      const near = nearestCandidate(run.candidates, run.lastVoiced.hz);
      u.note.textContent = name(near.pitch, run.settings);
      u.readout.children[0].textContent = `${run.lastVoiced.hz.toFixed(2)} Hz`;
      u.readout.children[1].textContent = `${fmt(near.cents)}¢`;
      u.readout.children[1].className = bandClass(near.cents);
      u.gauge.set(near.cents);
    } else {
      u.note.textContent = "—";
      // Say something during the tonic phase too: a blank panel while the
      // gate refuses to lock is indistinguishable from a dead microphone.
      u.readout.children[0].textContent = t("listen.playing");
      u.readout.children[1].textContent = "";
      u.gauge.set(null);
    }
    if (run.phase === "tonic") {
      const best = run.tonicSegs.reduce((most, seg) =>
        Math.max(most, seg.elapsedSeconds / seg.requiredSeconds), 0);
      u.progress.firstChild.style.width = `${Math.min(1, best) * 100}%`;
    }
    requestAnimationFrame(() => this.render());
  },

  /* ---- the end --------------------------------------------------------- */

  async finish() {
    const run = this.run;
    if (!run || run.phase === "finished") return;
    const last = run.tracker.flush();
    if (last && run.phase === "free") this.addRegion(last);
    run.phase = "finished";
    const u = this.ui, s = run.settings;
    u.note.textContent = "✓";
    u.readout.children[0].textContent = "";
    u.readout.children[1].textContent = "";
    u.gauge.element.hidden = true;
    u.level.element.hidden = true;
    u.progress.hidden = true;
    u.panel.classList.add("finished");
    u.status.textContent = t("practice.done");
    u.nav.finish();
    this.renderTable();

    const rows = aggregate(run.notes);
    const parts = [el("h2", { text: t("listen.summary") })];
    if (!run.notes.length) {
      parts.push(el("p", { text: t("listen.noNotes") }));
    } else {
      const score = sessionScore(scorableRows(rows));
      parts.push(el("p", { class: "headline",
        text: t("listen.scoreHeadline", score.accuracy.toFixed(1), bandLabel(score.accuracy)) }));

      const measures = [["accuracy", score.accuracy], ["internal", score.relative],
                        ["repeatability", score.repeatability], ["steadiness", score.steadiness]];
      parts.push(el("div", { class: "stats scroll" }, [
        el("table", {}, [
          el("tbody", {}, measures.map(([key, value]) => el("tr", {}, [
            el("td", { class: "name", title: t(`listen.score.${key}Help`), text: t(`listen.score.${key}`) }),
            el("td", { class: "num", text: value === null ? "—" : value.toFixed(1) }),
            el("td", { class: "muted", text: value === null ? t("listen.score.needsRepeats") : "¢" }),
          ]))),
        ]),
      ]));

      // Say how much of the error is one uniform shift: that part is the
      // headjoint's business, and correcting it costs nothing musical.
      const action = offsetAction(score.offset);
      parts.push(el("p", { class: "muted", text: action === null
        ? t("listen.score.centred")
        : t("listen.score.offset",
             `${Math.abs(score.offset).toFixed(1)}`,
             t(score.offset > 0 ? "listen.score.sharp" : "listen.score.flat"),
             t(`listen.score.${action}`),
             score.relative.toFixed(1)) }));
      parts.push(el("p", { class: "muted small", text: t("listen.score.notSubtraction") }));
      if (run.grounding === "none") {
        parts.push(el("p", { class: "note-box warn", text: t("listen.ungrounded") }));
      }

      /* Before naming anyone's faults, ask the instrument. A note the flute
       * cannot bring to its target was never the player's to fix, and saying
       * so is worth more than a tidier-looking list of failings. Only notes
       * this flute has actually been measured on are spoken about; the rest
       * are passed over rather than guessed at. */
      const profile = profiles.get(run.label ?? "");
      const cannot = profile
        ? impossible(reviewSession(profile.notes ?? {},
            rows.map((r) => ({ pitch: r.pitch.name, meanCents: r.meanCents }))))
        : [];
      if (cannot.length) {
        parts.push(el("p", { text: t("listen.bend.title", cannot.length) }));
        parts.push(el("ul", { class: "plain" }, cannot.map((r) => el("li", {
          text: t("listen.bend.note", name(SpelledPitch.parse(r.pitch), s),
                  `${r.playedCents >= 0 ? "+" : ""}${r.playedCents.toFixed(1)}`,
                  r.shortfall.toFixed(0)),
        }))));
        parts.push(el("p", { class: "muted small", text: t("listen.bend.note2") }));
      }
      // Name the notes that are actually out of tune. When none clears that
      // bar, the single furthest out is still worth knowing, but it is not
      // presented as a fault.
      const flagged = standouts(scorableRows(rows));
      if (flagged.list.length) {
        parts.push(el("p", { text: t("listen.standouts.title", flagged.list.length) }));
        parts.push(el("div", { class: "stats scroll" }, [
          el("table", {}, [
            el("tbody", {}, flagged.list.map((note) => el("tr", {}, [
              el("td", { class: "name", text: name(note.pitch, s) }),
              el("td", { class: "num off", text: `${note.mean >= 0 ? "+" : ""}${note.mean.toFixed(1)}¢` }),
              el("td", { class: "muted", text: t(`listen.standouts.${note.direction}`) }),
              el("td", { class: "muted", text: note.once
                ? t("listen.standouts.once")
                : note.unreliable
                  ? t("listen.standouts.unreliable", note.n, note.spread.toFixed(1))
                  : t("listen.standouts.consistent", note.n) }),
            ]))),
          ]),
        ]));
        if (flagged.more) {
          parts.push(el("p", { class: "muted small", text: t("listen.standouts.more", flagged.more) }));
        }
      } else if (score.worst && Math.abs(score.worst.mean) > 1) {
        parts.push(el("p", { class: "muted", text: t("listen.score.worst",
          name(score.worst.pitch, s), `${score.worst.mean >= 0 ? "+" : ""}${score.worst.mean.toFixed(1)}`) }));
      }
      parts.push(el("p", { class: "mono", text: t("listen.count", run.notes.length) }));
      const unstable = run.notes.filter((n) => n.stdev > UNSTABLE_CENTS).length;
      if (unstable) parts.push(el("p", { class: "muted", text: `${unstable} ~ ${t("listen.unstable")}` }));
      for (const row of rows) {
        const verdict = volumeVerdict(row.volume);
        if (verdict && verdict !== "none") {
          parts.push(el("p", { class: "muted", text: `${name(row.pitch, s)} : ${t(`listen.volume.${verdict}`)} (${fmt(row.volume.slope)} ¢/dB, r ${row.volume.r.toFixed(2)})` }));
        }
      }
    }
    if (run.shortCount) parts.push(el("p", { class: "muted", text: t("listen.short", run.shortCount) }));
    if (run.glideCount) parts.push(el("p", { class: "muted", text: t("listen.glides", run.glideCount) }));
    if (run.trillCount) parts.push(el("p", { class: "muted", text: t("listen.trills", run.trillCount) }));
    u.summary.replaceChildren(...parts);

    if (run.notes.length) {
      const r2 = (x) => Math.round(x * 100) / 100;
      const record = {
        v: 1, exercise: "listen", mode: s.mode, temperament: s.temperament, root: s.root,
        reference_hz: s.referenceHz, tonic: run.tonicPitch ? run.tonicPitch.name : null, lang: lang(),
        scoring: SCORING_RULE,
        grounding: run.grounding, key: run.key, quality: run.quality,
        key_changes: run.keyChanges,
        ...(run.label ? { label: run.label } : {}),
        notes: run.notes.map((n) => ({
          pitch: n.pitch.name, target_hz: Math.round(n.primaryHz * 1e4) / 1e4,
          mean_cents: r2(n.primaryCents), stdev_cents: r2(n.stdev),
          settle_s: n.settleSeconds === null ? null : Math.round(n.settleSeconds * 1000) / 1000,
          frames: n.framesHz.length, mean_db: r2(n.meanDb),
          tempered_cents: r2(n.temperedCents), pure_cents: n.pureCents === null ? null : r2(n.pureCents),
        })),
        by_note: rowsToRecord(rows),
        standouts: standouts(scorableRows(rows)).list.map((n) => ({
          pitch: n.pitch.name, mean_cents: r2(n.mean), n: n.n,
          spread_cents: r2(n.spread), unreliable: n.unreliable,
        })),
        score: (() => {
          const sc = sessionScore(scorableRows(rows));
          return sc && { accuracy: r2(sc.accuracy), offset: r2(sc.offset), relative: r2(sc.relative),
                         repeatability: sc.repeatability === null ? null : r2(sc.repeatability),
                         steadiness: r2(sc.steadiness), notes: sc.notes, occurrences: sc.occurrences };
        })(),
        short_notes: run.shortCount,
        glides: run.glideCount,
        trills: run.trillCount,
      };
      u.summary.append(helpSection("numbers").element);
      try {
        await history.add(record);
        u.summary.append(el("p", { class: "muted", text: t("practice.saved") }));
        // Last of all, and only ever once: the results are what they came for.
        const invite = invitation("listen", await history.count());
        if (invite) u.summary.append(invite);
      } catch (_e) { /* storage unavailable */ }
    }
  },
};
