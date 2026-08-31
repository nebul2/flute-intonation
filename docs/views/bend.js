/* Setting up my flute: how far each note actually bends.
 *
 * Three readings a note, in the order that makes them mean something: as it
 * comes with no correction, then as flat as it will go, then as sharp. The
 * first is the datum -- where this flute puts this note -- and the other two
 * say what the player can do about it.
 *
 * Hands-free by necessity: a flute player has no spare hand for a button, so
 * the three readings are simply the next three notes played, separated by
 * breaths. The app knows which note was asked for, so nothing has to be
 * identified -- a note bent forty cents flat is still the note we asked for,
 * and that is exactly the case where naming it by proximity would fail.
 *
 * The profile accumulates across sittings and is kept per instrument, because
 * averaging two flutes gives a flute that does not exist.
 */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import * as profiles from "../profiles.js";
import { SpelledPitch, centsBetween } from "../core/pitch.js";
import { postAttack } from "../core/scoring.js";
import { RegionTracker } from "../audio/regions.js";
import { reach, isRigid, bestOffset, validEntry, RIGID_CENTS } from "../core/bend.js";
import {
  el, append, audioControl, levelBar, labelField, currentTuning, name, explainer,
} from "../ui/widgets.js";

/* Enough of the note to be a reading rather than a stab. */
const MIN_READING_SECONDS = 0.55;
const PHASES = ["natural", "floor", "ceiling"];

const median = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length % 2 ? o[o.length >> 1] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
};

/* The notes worth profiling: the traverso's practical compass, with the foot
 * notes included only when the player has said they have them. */
function compass(s) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const out = [];
  for (let octave = 4; octave <= 6; octave++) {
    for (const n of names) {
      if (octave === 4 && (n === "C" || n === "C#") && (s.registerBreak ?? "D") !== "C") continue;
      if (octave === 6 && !["C", "C#", "D"].includes(n)) continue;
      out.push(`${n}${octave}`);
    }
  }
  return out;
}

export default {
  title: () => t("bend.title"),

  mount(root) {
    this.root = root;
    this.render();
  },

  unmount() { this.teardown(); },

  teardown() {
    if (this.offFrame) { this.offFrame(); this.offFrame = null; }
    if (this.offSettings) { this.offSettings(); this.offSettings = null; }
    if (this.control) { this.control.dispose(); this.control = null; }
    if (this.label) { this.label = null; }
  },

  render() {
    this.teardown();
    const root = this.root;
    root.replaceChildren();
    const s = settings.get();
    const tuning = currentTuning(s);
    const tuningStamp = {
      temperament: s.temperament, root: s.root,
      referenceHz: Number(s.referenceHz) || 415, mode: s.mode,
    };

    const label = labelField();
    this.label = label;
    const control = audioControl({ showGranted: false });
    this.control = control;
    const level = levelBar();
    const status = el("p", { class: "status", text: t("bend.pick") });
    const prompt = el("div", { class: "bend-prompt" });
    const grid = el("div", { class: "bend-grid" });
    const summary = el("div", { class: "bend-summary" });

    /* Which note is being measured, and how far through its three readings. */
    let target = null;
    let readings = [];

    const instrument = () => label.value;

    const targetHz = (pitchName) => tuning.targetHz(SpelledPitch.parse(pitchName));

    const drawGrid = () => {
      const done = new Map(profiles.entries(instrument()).map((e) => [e.pitch, e]));
      grid.replaceChildren();
      for (const pitchName of compass(s)) {
        const pitch = SpelledPitch.parse(pitchName);
        const entry = done.get(pitchName);
        const chosen = target === pitchName;
        const cell = el("button", {
          class: `bend-cell${entry ? " done" : ""}${chosen ? " active" : ""}`,
          onclick: () => { target = pitchName; readings = []; drawGrid(); drawPrompt(); },
        }, [
          el("div", { class: "bend-cell-name", text: name(pitch, s) }),
          entry
            ? el("div", { class: "bend-cell-reach", text:
                `−${reach(entry).down.toFixed(0)} / +${reach(entry).up.toFixed(0)}` })
            : el("div", { class: "bend-cell-reach", text: "·" }),
        ]);
        grid.append(cell);
      }
    };

    const drawPrompt = () => {
      prompt.replaceChildren();
      if (!target) { status.textContent = t("bend.pick"); return; }
      const pitch = SpelledPitch.parse(target);
      status.textContent = t("bend.measuring", name(pitch, s), targetHz(target).toFixed(1));
      const rows = PHASES.map((phase, i) => el("div", {
        class: `bend-phase${i === readings.length ? " now" : ""}${i < readings.length ? " got" : ""}`,
      }, [
        el("div", { class: "bend-phase-label", text: t(`bend.phase.${phase}`) }),
        el("div", { class: "bend-phase-value", text: i < readings.length
          ? `${readings[i] >= 0 ? "+" : ""}${readings[i].toFixed(1)}¢` : "—" }),
      ]));
      append(prompt, ...rows,
        el("div", { class: "controls left" }, [
          el("button", { class: "secondary", text: t("bend.redoNote"),
                         onclick: () => { readings = []; drawPrompt(); } }),
        ]));
    };

    /* Every completed note is the next reading, in order. Nothing is named:
     * the player told us what they are playing, so a forty-cent bend is still
     * that note rather than its neighbour. */
    const tracker = new RegionTracker({
      frameSeconds: engine.detector ? engine.detector.frameSeconds : 512 / 44100,
    });
    this.offFrame = engine.onFrame((frame) => {
      level.set(frame.levelDb);
      const region = tracker.push(frame);
      if (!region || !target || readings.length >= 3) return;
      if (region.short || region.seconds < MIN_READING_SECONDS) return;
      const [framesHz] = postAttack(region.framesHz, tracker.frameSeconds, region.levelsDb);
      if (!framesHz.length) return;
      readings.push(centsBetween(targetHz(target), median(framesHz)));
      if (readings.length === 3) finish();
      drawPrompt();
    });

    const finish = () => {
      const [natural, floor, ceiling] = readings;
      const entry = { natural, floor, ceiling };
      if (!validEntry(entry)) {
        // Almost always the readings arriving out of order -- a bend that went
        // the wrong way, or a stray note between two of them.
        status.textContent = t("bend.outOfOrder");
        readings = [];
        return;
      }
      profiles.setNote(instrument(), target, entry, tuningStamp, new Date().toISOString());
      target = null;
      readings = [];
      drawGrid();
      drawSummary();
    };

    const drawSummary = () => {
      summary.replaceChildren();
      const measured = profiles.entries(instrument());
      if (!measured.length) return;
      const parts = [el("h2", { text: t("bend.summary", measured.length) })];

      const rigid = measured.filter((e) => isRigid(e, "up") || isRigid(e, "down"));
      if (rigid.length) {
        parts.push(el("p", { text: t("bend.rigid", RIGID_CENTS) }));
        parts.push(el("ul", { class: "plain" }, rigid.map((e) => el("li", {
          text: t(isRigid(e, "up") ? "bend.rigidUp" : "bend.rigidDown",
                  name(SpelledPitch.parse(e.pitch), s),
                  (isRigid(e, "up") ? reach(e).up : reach(e).down).toFixed(0)),
        }))));
      }

      // The recommendation this whole page exists to make honest.
      const best = bestOffset(measured);
      if (best && measured.length >= 4) {
        parts.push(el("p", { class: "headline", text: best.offset >= 0
          ? t("bend.placeSharper", Math.abs(best.offset).toFixed(0))
          : t("bend.placeFlatter", Math.abs(best.offset).toFixed(0)) }));
        parts.push(el("p", { class: "muted", text:
          t("bend.placeReach", best.reachable, best.total, best.meanBend.toFixed(0)) }));
        if (best.unreachable.length) {
          parts.push(el("p", { class: "muted", text: t("bend.placeGiveUp",
            best.unreachable.map((e) => name(SpelledPitch.parse(e.pitch), s)).join(", ")) }));
        }
        parts.push(el("p", { class: "muted small", text: t("bend.placeCaveat") }));
      } else {
        parts.push(el("p", { class: "muted", text: t("bend.needMore", Math.max(0, 4 - measured.length)) }));
      }
      append(summary, ...parts);
    };

    this.offSettings = settings.subscribe(() => { drawGrid(); drawPrompt(); drawSummary(); });
    label.element.addEventListener("change", () => { drawGrid(); drawSummary(); });

    append(root,
      explainer(t("bend.intro"), t("bend.protocol"), t("bend.why")),
      el("div", { class: "row" }, [label.element]),
      control.element,
      level.node,
      status,
      prompt,
      grid,
      summary,
    );
    drawGrid();
    drawPrompt();
    drawSummary();
  },
};
