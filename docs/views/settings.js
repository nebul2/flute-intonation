/* Settings. Everything writes through settings.set(), so the status strip
 * and any mounted view re-render immediately.
 *
 * This page is now almost entirely declarations: a bound field per setting,
 * and side effects hung off onChange where a setting is not enough on its own
 * -- restarting a playing drone at the new level, switching the microphone,
 * telling i18n the language changed. It was the longest hand-written list of
 * controls in the app, and it is the page where the two checkbox conventions
 * and the three label shapes were most visible next to each other. */

import { t, setLanguage } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import * as history from "../history.js";
import { el, append, audioControl, currentTuning, tunerCandidates, nearestCandidate } from "../ui/widgets.js";
import { selectField, checkboxField, radioGroup, rangeField, segmentedField } from "../ui/fields.js";
import { owner } from "../ui/owner.js";
import { RegionTracker, driftCents, isOscillating, GLIDE_CENTS } from "../audio/regions.js";
import { analyseNote, notePitch, postAttack } from "../core/scoring.js";
import { aggregate, scorableRows, sessionScore } from "../core/stats.js";
import { instrumentOffset, referenceFromOffset, referenceVerdict } from "../core/reference.js";

const REFERENCES = [392, 415, 430, 440, 442];
const DRONE_SECONDS = [4, 5, 6, 8, 10, 12];
const SCALES_MINUTES = [5, 10, 15, 20, 30, 45];

export default {
  title: () => t("settings.title"),

  mount(root) {
    const own = owner();
    this.own = own;
    const s = settings.get();

    /* reference pitch: the common ones as a pill group, anything else typed.
     * The group marks nothing as active when the value is not one of its own,
     * which is what a custom pitch should look like -- and is now the control's
     * behaviour rather than a querySelectorAll in this file. */
    const refs = own.add(segmentedField({
      bind: "referenceHz", options: REFERENCES.map((hz) => ({ value: hz, label: String(hz) })),
      onChange: () => { custom.value = ""; },
    }));
    const custom = el("input", {
      type: "number", class: "number", min: "380", max: "470", step: "0.1",
      value: REFERENCES.includes(Number(s.referenceHz)) ? "" : s.referenceHz,
      placeholder: t("settings.custom"),
      onchange: (e) => {
        const hz = Number(e.target.value);
        if (hz >= 380 && hz <= 470) settings.set({ referenceHz: hz });
      },
    });

    /* ---- the reference, measured rather than chosen --------------------
     *
     * The reference is a number the player is expected to know, and on a
     * baroque flute they often do not: the instrument sits where the
     * headjoint and the room put it, not at the 415 printed on the box. When
     * it is wrong, every session report opens by announcing an offset that is
     * the tuning of the flute rather than anything about the playing.
     *
     * So: play, and the app reads the instrument's pitch off the playing. The
     * one rule it will not bend -- see core/reference.js -- is that this is
     * never taken from a single note. Several different notes, their common
     * offset, and the disagreement between them shown next to it, because an
     * average over notes that do not agree is not a pitch. Nothing is written
     * until the player presses the button that names the number. */
    let offFrame = null;
    const measure = { tracker: null, notes: [], candidates: [], hz: null };
    own.add(() => { if (offFrame) { offFrame(); offFrame = null; } });

    const measureStatus = el("div", { class: "diag" });
    const measureResult = el("p", { class: "note-box", hidden: true });
    const applyButton = el("button", { class: "secondary", hidden: true });
    const startButton = el("button", { class: "secondary", text: t("settings.measureStart") });

    const setReference = (hz) => {
      settings.set({ referenceHz: hz });
      // The pill group is bound and re-reads itself; the custom box is not.
      custom.value = REFERENCES.includes(hz) ? "" : String(hz);
    };

    function showMeasurement() {
      const rows = scorableRows(aggregate(measure.notes));
      const score = sessionScore(rows);
      measureStatus.textContent = score
        ? t("settings.measureHeard", score.notes, score.occurrences)
        : t("settings.measureListening");
      const verdict = referenceVerdict(score);
      measure.hz = null;
      if (!verdict.ready) {
        measureResult.hidden = !score || verdict.reason !== "scattered";
        if (verdict.reason === "scattered") measureResult.textContent = t("settings.measureScattered");
        else if (score) measureStatus.textContent += ` ${t("settings.measureMore")}`;
        applyButton.hidden = true;
        return;
      }
      // The median of the notes, not sessionScore()'s mean: see instrumentOffset().
      const offset = instrumentOffset(rows);
      const hz = referenceFromOffset(Number(settings.get().referenceHz) || 415, offset);
      measureResult.hidden = false;
      if (hz === null) {
        measureResult.textContent = t("settings.measureOutOfRange");
        applyButton.hidden = true;
        return;
      }
      measure.hz = hz;
      measureResult.textContent = t("settings.measureResult",
        Math.abs(offset).toFixed(1),
        t(offset >= 0 ? "settings.measureSharp" : "settings.measureFlat"),
        hz.toFixed(1), score.relative.toFixed(1));
      applyButton.textContent = t("settings.measureApply", hz.toFixed(1));
      applyButton.hidden = false;
    }

    /* One closed region becomes one sounding, or is thrown away. The same
     * three exclusions free play makes: too short to measure, alternating
     * rather than settling, and still travelling -- a slur read as a note
     * would put its whole journey into the average. */
    function addSounding(region) {
      if (region.short || isOscillating(region)) return;
      const frameSeconds = measure.tracker.frameSeconds;
      const [settled] = postAttack(region.framesHz, frameSeconds);
      if (Math.abs(driftCents(settled)) >= GLIDE_CENTS) return;
      const played = notePitch(region.framesHz, frameSeconds);
      if (!(played.hz > 0)) return;
      const near = nearestCandidate(measure.candidates, played.hz);
      const result = analyseNote(near.pitch, near.hz, region.framesHz, frameSeconds);
      if (!result) return;
      measure.notes.push({
        pitch: near.pitch, primaryCents: result.meanCents, stdev: result.stdevCents,
        seconds: region.seconds, meanDb: region.meanDb, index: measure.notes.length,
      });
      showMeasurement();
    }

    function stopMeasuring() {
      if (offFrame) { offFrame(); offFrame = null; }
      const last = measure.tracker ? measure.tracker.flush() : null;
      if (last) addSounding(last);
      startButton.textContent = t("settings.measureStart");
      showMeasurement();
    }

    startButton.onclick = () => {
      if (offFrame) { stopMeasuring(); return; }
      if (!engine.listening) { measureStatus.textContent = t("settings.measureNeedsMic"); return; }
      const tuning = currentTuning(settings.get());
      measure.candidates = tunerCandidates(tuning);
      measure.tracker = new RegionTracker({
        frameSeconds: engine.detector ? engine.detector.frameSeconds : 512 / 44100,
      });
      measure.notes = [];
      measure.hz = null;
      measureResult.hidden = true;
      applyButton.hidden = true;
      measureStatus.textContent = t("settings.measureListening");
      startButton.textContent = t("settings.measureStop");
      offFrame = engine.onFrame((frame) => {
        const region = measure.tracker.push(frame);
        if (region) addSounding(region);
      });
    };

    applyButton.onclick = () => {
      if (measure.hz === null) return;
      setReference(measure.hz);
      measureResult.textContent = t("settings.measureDone", measure.hz.toFixed(1));
      applyButton.hidden = true;
      measure.hz = null;
    };

    const naming = own.add(radioGroup({
      name: "naming", bind: "naming",
      options: ["solfege", "letters"].map((style) => ({
        value: style, label: () => t(`settings.naming.${style}`),
      })),
    }));

    const octaveStyle = own.add(radioGroup({
      name: "octaveStyle", bind: "octaveStyle",
      options: ["register", "number"].map((style) => ({
        value: style, label: () => t(`settings.octaveStyle.${style}`),
      })),
    }));

    const registerBreak = own.add(selectField({
      label: t("settings.registerBreak"), bind: "registerBreak",
      options: () => ["D", "C"].map((letter) => ({
        value: letter, label: t(`settings.registerBreak.${letter}`),
      })),
    }));

    /* Language is the one control that is deliberately not bound. The setting
     * is null by default, meaning "follow the browser", and a bound group
     * would show nothing chosen rather than the language actually in use. */
    const language = own.add(segmentedField({
      value: s.lang ?? document.documentElement.lang,
      options: ["fr", "en"].map((code) => ({ value: code, label: code.toUpperCase() })),
      onChange: (code) => { settings.set({ lang: code }); setLanguage(code); },
    }));

    /* The device list arrives later, so the options are a function over a
     * list this fills in, and the control is refreshed once it has. */
    let devices = [];
    const mic = own.add(selectField({
      label: t("settings.mic"), bind: "deviceId", parse: (v) => v || null,
      options: () => [{ value: "", label: t("settings.micDefault") },
                      ...devices.map((d, i) => ({
                        value: d.deviceId, label: d.label || `${t("settings.mic")} ${i + 1}`,
                      }))],
      onChange: (deviceId) => {
        if (engine.listening) { engine.stop(); engine.start({ deviceId }); }
      },
    }));
    const micNote = el("div", { class: "diag", text: engine.listening ? "" : t("settings.micNeedsStart") });
    engine.inputDevices().then((list) => { devices = list; mic.refresh(); }).catch(() => {});

    const droneLevel = own.add(rangeField({
      bind: "droneLevel", min: 0.02, max: 0.5, step: 0.01,
      onChange: (level) => { if (engine.drone.playing) engine.drone.start(engine.drone.hz, level); },
    }));

    const droneNoteSeconds = own.add(selectField({
      label: t("settings.droneNoteSeconds"), bind: "droneNoteSeconds", parse: Number,
      options: () => DRONE_SECONDS.map((sec) => ({ value: sec, label: t("settings.seconds", sec) })),
    }));

    const scalesMinutes = own.add(selectField({
      label: t("settings.scalesMinutes"), bind: "scalesMinutes", parse: Number,
      options: () => SCALES_MINUTES.map((m) => ({ value: m, label: t("settings.minutes", m) })),
    }));

    const explainToggle = own.add(checkboxField({
      look: "option", bind: "explainOpen",
      label: t("settings.explainOpen"), help: t("settings.explainOpenHelp"),
    }));
    const headphones = own.add(checkboxField({
      look: "option", bind: "headphones", label: t("settings.headphones"),
    }));
    const analyticsToggle = own.add(checkboxField({
      look: "option", bind: "analytics",
      label: t("settings.analytics"), help: t("settings.analyticsHelp"),
    }));

    const control = own.add(audioControl());

    /* history */
    const historyNote = el("div", { class: "diag" });
    history.count().then((n) => { historyNote.textContent = t("settings.historyCount", n); }).catch(() => {});
    const exportButton = el("button", { class: "secondary", text: t("settings.export"), onclick: async () => {
      const { count, filename } = await history.exportFile();
      historyNote.textContent = t("settings.exported", count, filename);
    } });
    const clearButton = el("button", { class: "secondary", text: t("settings.clear"), onclick: async () => {
      if (!window.confirm(t("settings.clearConfirm"))) return;
      await history.clear();
      historyNote.textContent = t("settings.cleared");
    } });

    append(root,
      el("h2", { text: t("settings.reference") }),
      el("div", { class: "row" }, [refs.element, custom]),
      el("p", { class: "note-box", text: t("settings.measureHelp") }),
      el("div", { class: "controls left" }, [startButton, applyButton]),
      measureStatus, measureResult,
      el("h2", { text: t("settings.naming") }), naming.element,
      el("h2", { text: t("settings.reading") }), explainToggle.element,
      scalesMinutes.element,
      el("h2", { text: t("settings.octaveStyle") }), octaveStyle.element,
      el("p", { class: "note-box", text: t("settings.octaveStyleHelp") }),
      registerBreak.element,
      el("p", { class: "note-box", text: t("settings.registerBreakHelp") }),
      el("h2", { text: t("settings.language") }), language.element,
      el("h2", { text: t("settings.mic") }), control.element, mic.element, micNote,
      el("h2", { text: t("settings.droneLevel") }), droneLevel.element,
      droneNoteSeconds.element,
      el("p", { class: "note-box", text: t("settings.droneNoteSecondsHelp") }),
      headphones.element,
      el("h2", { text: t("settings.history") }),
      el("div", { class: "controls left" }, [exportButton, clearButton]),
      historyNote,
      el("h2", { text: t("settings.privacy") }),
      analyticsToggle.element,
    );
  },

  unmount() { if (this.own) { this.own.dispose(); this.own = null; } },
};
