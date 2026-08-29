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
import { HarmonicContext, PureIntervalTuning } from "../core/tuning.js";
import { RegionTracker } from "../audio/regions.js";
import { NoteSegmenter } from "../audio/segmenter.js";
import { aggregate, rowsToRecord, volumeVerdict, withinNoteVolumeLink } from "../core/stats.js";
import { el, audioControl, labelField, needle, levelBar, bandClass, currentTuning, name, nameClass, tunerCandidates, nearestCandidate, runNav } from "../ui/widgets.js";

const TONICS = ["D", "G", "A", "C", "F"];
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
    this.tonic = "D";
    this.showStart();
  },

  unmount() { this.teardown(); },

  teardown() {
    this.mounted = false;
    for (const off of [this.offFrame, this.offState]) if (off) off();
    this.offFrame = this.offState = null;
    if (this.control) { this.control.dispose(); this.control = null; }
  },

  /* ---- start screen ---------------------------------------------------- */

  showStart() {
    this.teardown();
    const root = this.root;
    root.replaceChildren();
    const control = audioControl({ showGranted: false });
    this.control = control;
    const tonicSelect = el("select", { class: "select", onchange: (e) => { this.tonic = e.target.value; } },
      TONICS.map((k) => el("option", { value: k, selected: k === this.tonic || null,
                                       text: nameClass(SpelledPitch.parse(`${k}4`)) })));
    const label = labelField();
    this.label = label;
    const start = el("button", { class: "primary", text: t("listen.start"), disabled: !engine.listening,
                                 onclick: () => this.startSession() });
    this.offState = engine.onState(() => { start.disabled = !engine.listening; });
    root.append(
      el("p", { class: "intro", text: t("listen.intro") }),
      el("div", { class: "row" }, [control.element, el("span", { text: t("practice.tonic") }), tonicSelect, start]),
      el("div", { class: "row" }, [label.element]),
    );
  },

  /* ---- a session ------------------------------------------------------- */

  startSession() {
    this.teardown();
    const s = settings.get();
    const tuning = currentTuning(s);
    const tonicPitch = SpelledPitch.parse(`${this.tonic}4`);
    this.run = {
      settings: s, tuning, tonicPitch,
      pure: new PureIntervalTuning(tuning),
      context: new HarmonicContext(tonicPitch),
      candidates: tunerCandidates(tuning),
      phase: "tonic", tonicSegs: [], label: this.label ? this.label.value : "",
      tracker: new RegionTracker({ frameSeconds: engine.detector ? engine.detector.frameSeconds : 512 / 44100 }),
      notes: [], shortCount: 0, lastVoiced: null,
    };
    const run = this.run;
    const root = this.root;
    root.replaceChildren();

    const logToggle = el("label", { class: "toggle" }, [
      el("input", { type: "checkbox", checked: s.listenLog || null,
                    onchange: (e) => { settings.set({ listenLog: e.target.checked }); this.ui.rows.hidden = !e.target.checked; } }),
      el("span", { text: t("listen.log") }),
    ]);

    this.ui = {
      status: el("p", { class: "intro", text: t("listen.tonicPrompt", nameClass(tonicPitch, s)) }),
      nav: runNav({
        stopLabel: t("listen.stop"),
        onStop: () => this.finish(),
        onRedo: () => this.startSession(),
        onBack: () => this.showStart(),
        extras: [logToggle],
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
    run.tonicSegs = run.candidates
      .filter((c) => c.pitch.letter === tonicPitch.letter && c.pitch.alter === tonicPitch.alter
                     && c.pitch.octave >= 4 && c.pitch.octave <= 6)
      .map((c) => new NoteSegmenter({ targetHz: c.hz, frameSeconds, requiredSeconds: TONIC_SECONDS }));
    root.append(u.status, u.nav.top, u.panel, u.table, u.summary, u.rows, u.nav.bottom);
    this.renderTable();

    this.offFrame = engine.onFrame((frame) => this.onFrame(frame));
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
    const near = nearestCandidate(run.candidates, region.medianHz);
    const temperedCents = near.cents;
    let pureHz = null, pureCents = null;
    try {
      pureHz = run.pure.targetHz(near.pitch, run.context);
      pureCents = centsBetween(pureHz, region.medianHz);
    } catch (_e) { /* no ratio for this spelled interval */ }
    const usePure = run.settings.mode === "pure" && pureHz !== null;
    const primaryHz = usePure ? pureHz : near.hz;
    const deviations = region.framesHz.map((hz) => centsBetween(primaryHz, hz));
    const meanDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const stdev = Math.sqrt(deviations.reduce((a, d) => a + (d - meanDev) ** 2, 0) / deviations.length);
    return {
      pitch: near.pitch, temperedHz: near.hz, temperedCents, pureHz, pureCents,
      primary: usePure ? "pure" : "tempered",
      primaryCents: usePure ? pureCents : temperedCents,
      primaryHz, stdev, seconds: region.seconds, medianHz: region.medianHz,
      meanDb: region.meanDb, levelsDb: region.levelsDb, framesHz: region.framesHz,
      withinFit: withinNoteVolumeLink(region.framesHz, region.levelsDb, primaryHz),
      index: run.notes.length,
    };
  },

  addRegion(region) {
    const run = this.run;
    if (region.short) { run.shortCount += 1; return; }
    const note = this.score(region);
    run.notes.push(note);
    this.ui.rows.prepend(this.logRow(note));
    this.renderTable();
  },

  logRow(note) {
    const s = this.run.settings;
    const tonicName = nameClass(this.run.tonicPitch, s);
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
    u.summary.replaceChildren(...parts);

    if (run.notes.length) {
      const r2 = (x) => Math.round(x * 100) / 100;
      const record = {
        v: 1, exercise: "listen", mode: s.mode, temperament: s.temperament, root: s.root,
        reference_hz: s.referenceHz, tonic: run.tonicPitch.name, lang: lang(),
        ...(run.label ? { label: run.label } : {}),
        notes: run.notes.map((n) => ({
          pitch: n.pitch.name, target_hz: Math.round(n.primaryHz * 1e4) / 1e4,
          mean_cents: r2(n.primaryCents), stdev_cents: r2(n.stdev), settle_s: null,
          frames: n.framesHz.length, mean_db: r2(n.meanDb),
          tempered_cents: r2(n.temperedCents), pure_cents: n.pureCents === null ? null : r2(n.pureCents),
        })),
        by_note: rowsToRecord(rows),
        short_notes: run.shortCount,
      };
      try { await history.add(record); u.summary.append(el("p", { class: "muted", text: t("practice.saved") })); }
      catch (_e) { /* storage unavailable */ }
    }
  },
};
