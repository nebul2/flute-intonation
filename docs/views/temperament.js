/* "What is this instrument tuned to?"
 *
 * Play every pitch class once; each note's distance from equal is measured,
 * the twelve of them make a shape, and the shape is matched against every
 * temperament at every root (core/identify.js). Built for a harpsichord --
 * fixed pitches, held still, one note at a time -- which is the only kind of
 * instrument where this can work: on a flute the embouchure moves the pitch
 * by more than the temperaments differ from each other.
 *
 * Notes are collected by pitch class, not by octave, and the median of each
 * class's readings is used: a class played twice at different octaves should
 * agree, and where it does not the median is the honest summary.
 */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import { RegionTracker, driftCents, GLIDE_CENTS } from "../audio/regions.js";
import { postAttack } from "../core/scoring.js";
import { identify, classifyHz, PITCH_CLASSES, MIN_CLASSES, FULL_CLASSES } from "../core/identify.js";
import { el, append, audioControl, levelBar, temperamentLabel } from "../ui/widgets.js";

/* Display names per pitch class, in the naming the player has chosen. The
 * spelling is arbitrary here -- a temperament has twelve pitch classes, not
 * twelve spellings -- so the sharp side is used throughout and said plainly. */
const SOLFEGE = ["Do", "Do♯", "Ré", "Ré♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];
const className = (i, s) => (s.naming === "solfege" ? SOLFEGE[i] : PITCH_CLASSES[i]);

const median = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length % 2 ? o[o.length >> 1] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
};

export default {
  title: () => t("temperament.title"),

  mount(root) {
    const s0 = settings.get();
    const ref = Number(s0.referenceHz) || 415;
    // Readings per pitch class, one entry per note played.
    const heard = Array.from({ length: 12 }, () => []);

    const grid = el("div", { class: "pc-grid" });
    const cells = PITCH_CLASSES.map((_, i) => {
      const cell = el("div", { class: "pc" }, [
        el("div", { class: "pc-name", text: className(i, s0) }),
        el("div", { class: "pc-cents", text: "—" }),
      ]);
      grid.append(cell);
      return cell;
    });
    const status = el("p", { class: "status", text: t("temperament.waiting") });
    const level = levelBar();
    const control = audioControl({ showGranted: false });
    const result = el("div", { class: "result" });

    /* One note: name it by proximity at the current reference, and keep its
     * distance from that name. Proximity is safe because no temperament here
     * moves a note more than about 25 cents, so only a badly set reference
     * pitch can misname one -- which identify() flags rather than hides. */
    const record = (hz) => {
      const { index, cents } = classifyHz(hz, ref);
      heard[index].push(cents);
      const cell = cells[index];
      cell.classList.add("heard");
      cell.querySelector(".pc-cents").textContent =
        `${median(heard[index]) >= 0 ? "+" : ""}${median(heard[index]).toFixed(1)}`;
      cell.querySelector(".pc-name").textContent = className(index, settings.get());
      update();
    };

    const deviations = () => heard.map((xs) => (xs.length ? median(xs) : null));
    const count = () => heard.filter((xs) => xs.length).length;

    const update = () => {
      const n = count();
      status.textContent = n < MIN_CLASSES
        ? t("temperament.needMore", MIN_CLASSES - n)
        : n < FULL_CLASSES ? t("temperament.partial", n) : t("temperament.complete");
      show();
    };

    /* The verdict, recomputed as each note lands so the player can watch it
     * settle -- and see for themselves when another note stops changing it. */
    const show = () => {
      result.replaceChildren();
      if (count() < MIN_CLASSES) return;
      const r = identify(deviations(), { referenceHz: ref });
      const parts = [];

      const named = (c) => (c.root === null
        ? temperamentLabel(c.temperament)
        : t("temperament.on", temperamentLabel(c.temperament), className(c.root, settings.get())));

      if (r.verdict === "temperament") {
        parts.push(el("p", { class: "headline", text: named(r.best) }));
      } else if (r.verdict === "unsure") {
        parts.push(el("p", { class: "headline", text: t("temperament.unsure") }));
      } else {
        parts.push(el("p", { class: "headline", text: t(`temperament.family.${r.verdict}`) }));
        if (r.root !== null) {
          parts.push(el("p", { text: t("temperament.rootedOn", className(r.root, settings.get())) }));
        }
        parts.push(el("p", { class: "muted", text: t("temperament.tooClose",
          r.contenders.map(named).join(", ")) }));
      }

      parts.push(el("p", { class: "mono", text: r.measuredFrom === "a"
        ? t("temperament.pitchA", r.measuredHz.toFixed(1))
        : t("temperament.pitchMean", r.measuredHz.toFixed(1)) }));
      if (r.offsetSuspect) {
        parts.push(el("p", { class: "warn", text: t("temperament.offsetSuspect") }));
      }
      if (r.partial) parts.push(el("p", { class: "muted", text: t("temperament.partialWarn") }));

      parts.push(el("div", { class: "stats scroll" }, [
        el("table", {}, [
          el("thead", {}, [el("tr", {}, [
            el("th", { text: t("temperament.col.candidate") }),
            el("th", { text: t("temperament.col.distance") }),
          ])]),
          el("tbody", {}, r.ranked.slice(0, 6).map((c) => el("tr",
            { class: c.distance - r.best.distance <= 1e-9 ? "best" : "" }, [
              el("td", { text: named(c) }),
              el("td", { class: "num", text: `${c.distance.toFixed(1)}` }),
            ]))),
        ]),
      ]));
      parts.push(el("p", { class: "muted small", text: t("temperament.limits") }));
      append(result, ...parts);
    };

    const tracker = new RegionTracker({
      frameSeconds: engine.detector ? engine.detector.frameSeconds : 512 / 44100,
    });
    this.offFrame = engine.onFrame((frame) => {
      level.set(frame.levelDb);
      const region = tracker.push(frame);
      if (!region || region.short) return;
      const [framesHz] = postAttack(region.framesHz, tracker.frameSeconds, region.levelsDb);
      if (!framesHz.length) return;
      // A pitch still travelling is not a reading; on a plucked string this
      // also throws out the pluck itself, which bends before it settles.
      if (Math.abs(driftCents(framesHz)) >= GLIDE_CENTS) return;
      record(median(framesHz));
    });

    const reset = () => {
      heard.forEach((xs) => { xs.length = 0; });
      cells.forEach((cell, i) => {
        cell.classList.remove("heard");
        cell.querySelector(".pc-cents").textContent = "—";
        cell.querySelector(".pc-name").textContent = className(i, settings.get());
      });
      tracker.flush();
      update();
    };

    this.offSettings = settings.subscribe(() => {
      cells.forEach((cell, i) => {
        cell.querySelector(".pc-name").textContent = className(i, settings.get());
      });
      show();
    });

    append(root,
      el("p", { class: "note-box warn", text: t("temperament.experimental") }),
      el("p", { class: "intro", text: t("temperament.intro") }),
      el("p", { class: "muted small", text: t("temperament.how", ref) }),
      control,
      level.node,
      status,
      grid,
      result,
      el("div", { class: "controls" }, [
        el("button", { class: "primary", text: t("temperament.clear"), onclick: reset }),
      ]),
    );
    update();
  },

  unmount() {
    if (this.offFrame) this.offFrame();
    if (this.offSettings) this.offSettings();
  },
};
