/* Compare temperaments: what every one of them makes of every note.
 *
 * Not the same page as views/temperament.js, which listens to an instrument
 * and works out how it is tuned. This one decides nothing and needs no
 * microphone: it is the table an advanced student reads to see what choosing
 * a temperament actually does to the notes under their fingers.
 *
 * All five columns are anchored so A sounds the reference pitch -- the way a
 * tuner is set -- which is what makes them comparable. The lesson is the
 * spread column: A is identical everywhere by construction, D and E barely
 * move, and E flat, G sharp and B flat swing about twenty cents. That last is
 * audible and playable, which is what makes this a practical exercise rather
 * than a table of numbers.
 *
 * With the microphone on it also marks what you played, against every column
 * at once. Where several columns agree, several light up: no amount of careful
 * playing separates notes the temperaments put in the same place, and saying
 * otherwise would teach the wrong lesson.
 */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import { RegionTracker, driftCents, GLIDE_CENTS } from "../audio/regions.js";
import { postAttack } from "../core/scoring.js";
import { TEMPERAMENT_ORDER } from "../core/temperaments.js";
import {
  temperamentTable, matchRow, classifyHz, PITCH_CLASSES, INDISTINGUISHABLE_CENTS,
} from "../core/identify.js";
import { el, append, audioControl, levelBar, temperamentLabel, explainer } from "../ui/widgets.js";
import { helpSection } from "../ui/help.js";

const SOLFEGE = ["Do", "Do♯", "Ré", "Ré♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];
const className = (i, s) => (s.naming === "solfege" ? SOLFEGE[i] : PITCH_CLASSES[i]);

const median = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length % 2 ? o[o.length >> 1] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
};

export default {
  title: () => t("temperaments.title"),

  mount(root) {
    const s0 = settings.get();
    const ref = Number(s0.referenceHz) || 415;
    let rootClass = PITCH_CLASSES.indexOf((s0.root || "C").replace("b", "#"));
    if (rootClass < 0) rootClass = 0;
    let octave = 4;
    const played = Array.from({ length: 12 }, () => []);

    const table = el("table", { class: "temp-table" });
    const control = audioControl({ showGranted: false });
    this.control = control;
    const level = levelBar();

    const rootSelect = el("select", { class: "select" },
      PITCH_CLASSES.map((_, i) => el("option", { value: String(i), text: className(i, s0) })));
    rootSelect.value = String(rootClass);
    rootSelect.addEventListener("change", () => { rootClass = Number(rootSelect.value); draw(); });

    const octaveSelect = el("select", { class: "select" },
      [3, 4, 5, 6].map((o) => el("option", { value: String(o), text: String(o) })));
    octaveSelect.value = String(octave);
    octaveSelect.addEventListener("change", () => { octave = Number(octaveSelect.value); draw(); });

    const draw = () => {
      const s = settings.get();
      const rows = temperamentTable({ referenceHz: ref, root: rootClass, octave });
      table.replaceChildren();
      table.append(el("thead", {}, [el("tr", {}, [
        el("th", { text: t("temperaments.col.note") }),
        ...TEMPERAMENT_ORDER.map((k) => el("th", { text: temperamentLabel(k) })),
        el("th", { text: t("temperaments.col.spread") }),
      ])]));

      const body = el("tbody");
      for (const row of rows) {
        const heard = played[row.index].length ? median(played[row.index]) : null;
        const hit = heard === null ? null : matchRow(row, heard);
        const cells = row.cells.map((cell) => {
          const lit = hit ? hit.matches.includes(cell.temperament) : false;
          return el("td", { class: `temp-cell${lit ? " hit" : ""}` }, [
            el("div", { class: "temp-hz", text: cell.hz.toFixed(1) }),
            el("div", { class: "temp-cents",
              text: `${cell.cents >= 0 ? "+" : ""}${cell.cents.toFixed(1)}` }),
          ]);
        });
        body.append(el("tr", { class: `${row.indistinguishable ? "same" : ""}${heard === null ? "" : " played"}` }, [
          el("th", { class: "temp-note" }, [
            el("div", { text: className(row.index, s) }),
            heard === null ? null
              : el("div", { class: "temp-you", text: t("temperaments.you",
                  `${heard >= 0 ? "+" : ""}${heard.toFixed(1)}`) }),
          ]),
          ...cells,
          el("td", { class: "temp-spread", text: row.indistinguishable
            ? t("temperaments.same")
            : `${row.spreadCents.toFixed(0)}¢` }),
        ]));
      }
      table.append(body);
    };

    /* Each played note is folded onto its pitch class -- the octave it was
     * played in changes the frequencies but not one thing about the choice
     * between temperaments. */
    const tracker = new RegionTracker({
      frameSeconds: engine.detector ? engine.detector.frameSeconds : 512 / 44100,
    });
    this.offFrame = engine.onFrame((frame) => {
      level.set(frame.levelDb);
      const region = tracker.push(frame);
      if (!region || region.short) return;
      const [framesHz] = postAttack(region.framesHz, tracker.frameSeconds, region.levelsDb);
      if (!framesHz.length) return;
      if (Math.abs(driftCents(framesHz)) >= GLIDE_CENTS) return;
      const { index, cents } = classifyHz(median(framesHz), ref);
      played[index].push(cents);
      draw();
    });

    this.offSettings = settings.subscribe(() => {
      const s = settings.get();
      rootSelect.querySelectorAll("option").forEach((o, i) => { o.textContent = className(i, s); });
      draw();
    });

    append(root,
      explainer(t("temperaments.intro"), t("temperaments.lesson", INDISTINGUISHABLE_CENTS),
                t("temperaments.how", ref)),
      el("div", { class: "row" }, [
        el("label", { class: "field" }, [t("temperaments.root"), rootSelect]),
        el("label", { class: "field" }, [t("temperaments.octave"), octaveSelect]),
      ]),
      control.element,
      level.node,
      el("div", { class: "scroll" }, [table]),
      helpSection("temperaments").element,
      el("div", { class: "controls" }, [
        el("button", { class: "primary", text: t("temperaments.clear"), onclick: () => {
          played.forEach((xs) => { xs.length = 0; });
          tracker.flush();
          draw();
        } }),
      ]),
    );
    draw();
  },

  unmount() {
    if (this.offFrame) this.offFrame();
    if (this.offSettings) this.offSettings();
    if (this.control) this.control.dispose();
  },
};
