/* Listen to me: play freely; the app names what it heard and says what it can.
 *
 * It asks for the tonic first. That is more than a warm-up: the tonic sets the
 * harmonic context, so in pure mode every note that follows can be judged as
 * an interval above it -- the same F# reads against the pure third over D --
 * not only against the temperament. Each note gets both readings; the current
 * mode decides which one leads.
 *
 * Live feedback is allowed here (this is free play, not a graded exercise), so
 * the needle moves as in the tuner, and a list of the notes heard grows
 * underneath with each one's deviation, stability and length. Notes under
 * ~120 ms are counted but not measured: below that a reading is not
 * trustworthy, as measured on real tongued onsets. */

import { t, lang } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import * as history from "../history.js";
import { SpelledPitch, centsBetween } from "../core/pitch.js";
import { HarmonicContext, PureIntervalTuning } from "../core/tuning.js";
import { RegionTracker } from "../audio/regions.js";
import { el, audioControl, needle, levelBar, bandClass, currentTuning, name, tunerCandidates, nearestCandidate } from "../ui/widgets.js";

const TONICS = ["D", "G", "A", "C", "F"];
const TONIC_FRAMES = 40;          // ~0.45 s of the tonic to begin
const UNSTABLE_CENTS = 8.0;

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

  showStart() {
    this.teardown();
    const root = this.root;
    root.replaceChildren();
    const control = audioControl({ showGranted: false });
    this.control = control;
    const tonicSelect = el("select", { class: "select", onchange: (e) => { this.tonic = e.target.value; } },
      TONICS.map((k) => el("option", { value: k, selected: k === this.tonic || null,
                                       text: name(SpelledPitch.parse(`${k}4`)).replace(/4$/, "") })));
    const start = el("button", { class: "primary", text: t("listen.start"), disabled: !engine.listening,
                                 onclick: () => this.startSession() });
    this.offState = engine.onState(() => { start.disabled = !engine.listening; });
    root.append(
      el("p", { class: "intro", text: t("listen.intro") }),
      el("div", { class: "row" }, [control.element, el("span", { text: t("practice.tonic") }), tonicSelect, start]),
    );
  },

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
      phase: "tonic", tonicRun: 0,
      tracker: new RegionTracker({ frameSeconds: engine.detector ? engine.detector.frameSeconds : 512 / 44100 }),
      notes: [], shortCount: 0, lastVoiced: null,
    };
    const run = this.run;
    const root = this.root;
    root.replaceChildren();

    this.ui = {
      status: el("p", { class: "intro", text: t("listen.tonicPrompt", name(tonicPitch, s).replace(/4$/, "")) }),
      note: el("div", { class: "big-note", text: "—" }),
      readout: el("div", { class: "readout" }, [el("span"), el("span")]),
      gauge: needle(), level: levelBar(),
      rows: el("div", { class: "rows" }),
      summary: el("div", { class: "summary" }),
      stop: el("button", { class: "secondary", text: t("listen.stop"), onclick: () => this.finish() }),
    };
    const u = this.ui;
    u.panel = el("div", { class: "card panel" }, [u.note, u.readout, u.gauge.element, u.level.element]);
    root.append(u.status, u.panel, u.summary, u.rows, el("div", { class: "controls" }, [u.stop]));

    this.offFrame = engine.onFrame((frame) => this.onFrame(frame));
    this.mounted = true;
    requestAnimationFrame(() => this.render());
  },

  onFrame(frame) {
    const run = this.run;
    if (!run || run.phase === "finished") return;
    if (frame.hz > 0) run.lastVoiced = frame;

    if (run.phase === "tonic") {
      if (frame.hz > 0) {
        const near = nearestCandidate(run.candidates, frame.hz);
        const isTonic = near.pitch.letter === run.tonicPitch.letter && near.pitch.alter === run.tonicPitch.alter;
        run.tonicRun = isTonic ? run.tonicRun + 1 : 0;
        if (run.tonicRun >= TONIC_FRAMES) {
          run.phase = "free";
          this.ui.status.textContent = t("listen.tonicHeard");
        }
      } else {
        run.tonicRun = 0;
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
    const primaryHz = run.settings.mode === "pure" && pureHz ? pureHz : near.hz;
    const deviations = region.framesHz.map((hz) => centsBetween(primaryHz, hz));
    const meanDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const stdev = Math.sqrt(deviations.reduce((a, d) => a + (d - meanDev) ** 2, 0) / deviations.length);
    return { pitch: near.pitch, temperedHz: near.hz, temperedCents, pureHz, pureCents,
             primary: run.settings.mode === "pure" && pureHz ? "pure" : "tempered",
             primaryCents: run.settings.mode === "pure" && pureHz ? pureCents : temperedCents,
             stdev, seconds: region.seconds, medianHz: region.medianHz };
  },

  addRegion(region) {
    const run = this.run;
    if (region.short) { run.shortCount += 1; return; }
    const note = this.score(region);
    run.notes.push(note);
    const s = run.settings;
    const tonicName = name(run.tonicPitch, s).replace(/4$/, "");
    const fmt = (c) => `${c >= 0 ? "+" : ""}${c.toFixed(1)}¢`;
    const primaryLabel = note.primary === "pure" ? t("listen.pureOver", tonicName) : t("listen.tempered");
    const secondary = note.primary === "pure"
      ? `${t("listen.tempered")} ${fmt(note.temperedCents)}`
      : (note.pureCents === null ? "" : `${t("listen.pureOver", tonicName)} ${fmt(note.pureCents)}`);
    const row = el("div", { class: "result-row" }, [
      el("div", { class: "result-head" }, [
        el("span", { class: "result-name", text: name(note.pitch, s) }),
        el("span", { class: `mono ${bandClass(note.primaryCents)}`, text: `${fmt(note.primaryCents)} ${primaryLabel}` }),
      ]),
      el("div", { class: "muted", text: [
        secondary,
        `${note.seconds.toFixed(2)} s`,
        note.stdev > UNSTABLE_CENTS ? `~ ${t("listen.unstable")} (±${note.stdev.toFixed(1)}¢)` : null,
      ].filter(Boolean).join(" · ") }),
    ]);
    this.ui.rows.prepend(row);
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
      u.readout.children[1].textContent = `${near.cents >= 0 ? "+" : ""}${near.cents.toFixed(1)}¢`;
      u.readout.children[1].className = bandClass(near.cents);
      u.gauge.set(near.cents);
    } else {
      u.note.textContent = "—";
      u.readout.children[0].textContent = run.phase === "tonic" ? "" : t("listen.playing");
      u.readout.children[1].textContent = "";
      u.gauge.set(null);
    }
    requestAnimationFrame(() => this.render());
  },

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
    u.panel.classList.add("finished");
    u.status.textContent = t("practice.done");
    u.stop.textContent = t("listen.again");
    u.stop.onclick = () => this.showStart();

    const parts = [el("h2", { text: t("listen.summary") })];
    if (!run.notes.length) {
      parts.push(el("p", { text: t("listen.noNotes") }));
    } else {
      parts.push(el("p", { class: "mono", text: t("listen.count", run.notes.length) }));
      const buckets = new Map();
      for (const n of run.notes) {
        const key = name(n.pitch, s).replace(/-?\d+$/, "");
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(n.primaryCents);
      }
      const byNote = [...buckets.entries()].map(([k, v]) => {
        const m = v.reduce((a, b) => a + b, 0) / v.length;
        return `${k} ${m >= 0 ? "+" : ""}${m.toFixed(1)} (${v.length})`;
      }).join("  ");
      parts.push(el("p", { class: "mono", text: `${t("listen.byNote")} ${byNote}` }));
      const unstable = run.notes.filter((n) => n.stdev > UNSTABLE_CENTS).length;
      if (unstable) parts.push(el("p", { class: "muted", text: `${unstable} ~ ${t("listen.unstable")}` }));
    }
    if (run.shortCount) parts.push(el("p", { class: "muted", text: t("listen.short", run.shortCount) }));
    u.summary.replaceChildren(...parts);

    if (run.notes.length) {
      const record = {
        v: 1, exercise: "listen", mode: s.mode, temperament: s.temperament, root: s.root,
        reference_hz: s.referenceHz, tonic: run.tonicPitch.name, lang: lang(),
        notes: run.notes.map((n) => ({
          pitch: n.pitch.name, target_hz: Math.round((n.primary === "pure" ? n.pureHz : n.temperedHz) * 1e4) / 1e4,
          mean_cents: Math.round(n.primaryCents * 100) / 100, stdev_cents: Math.round(n.stdev * 100) / 100,
          settle_s: null, frames: Math.round(n.seconds / run.tracker.frameSeconds),
          tempered_cents: Math.round(n.temperedCents * 100) / 100,
          pure_cents: n.pureCents === null ? null : Math.round(n.pureCents * 100) / 100,
        })),
        short_notes: run.shortCount,
      };
      try { await history.add(record); u.summary.append(el("p", { class: "muted", text: t("practice.saved") })); }
      catch (_e) { /* storage unavailable */ }
    }
  },
};
