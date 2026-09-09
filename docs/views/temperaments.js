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
 *
 * It counts held notes only, and says how many each row rests on. A note too
 * short to measure used to be folded in with the same weight as a long tone,
 * and a short note is worth up to 46 cents of noise -- enough to put a mark
 * in the wrong row. See classifyNote() for the two thresholds and the
 * measurements behind them.
 */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import { RegionTracker, driftCents, GLIDE_CENTS } from "../audio/regions.js";
import { postAttack, notePitch } from "../core/scoring.js";
import { TEMPERAMENT_ORDER } from "../core/temperaments.js";
import {
  temperamentTable, matchRow, classifyNote, INDISTINGUISHABLE_CENTS,
  CLASS_MIN_SECONDS, PITCH_CLASSES,
} from "../core/identify.js";
import { el, append, audioControl, levelBar, temperamentLabel, explainer } from "../ui/widgets.js";
import { pitchClassControl } from "../ui/controls.js";
import { selectField } from "../ui/fields.js";
import { owner } from "../ui/owner.js";
import { pitchClassLabel, pitchClassIndexOf } from "../ui/naming.js";
import { helpSection } from "../ui/help.js";

const className = (i, s) => pitchClassLabel(i, s.naming);

const median = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length % 2 ? o[o.length >> 1] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
};

/* What was played, as text that can be pasted somewhere else.
 *
 * Read off a screen and retyped, twelve numbers acquire a typo, and a typo in
 * a tuning measurement is indistinguishable from a finding -- which is the
 * whole problem with checking one device against another by eye. So the page
 * writes them out itself: the readings, how many notes each rests on, which
 * columns each lit, and what was thrown away.
 */
export function readingsReport({ rows, played, ignored, referenceHz, rootLabel, octave, naming }) {
  const lines = [
    `LBG temperaments  A=${referenceHz}  root=${rootLabel}  octave=${octave}  naming=${naming}`,
    `columns: ${TEMPERAMENT_ORDER.join(" ")}`,
  ];
  for (const row of rows) {
    const heard = played[row.index];
    if (!heard.length) continue;
    const you = median(heard);
    const hit = matchRow(row, you);
    lines.push(`${PITCH_CLASSES[row.index].padEnd(3)} n=${String(heard.length).padStart(2)}`
      + `  you ${you >= 0 ? "+" : ""}${you.toFixed(1)}`
      + `  cols ${row.cells.map((c) => c.cents.toFixed(1)).join(" ")}`
      + `  lit ${hit.matches.join(",") || "-"}`);
  }
  lines.push(`ignored: ${ignored.short} too short, ${ignored.between} between rows`);
  return lines.join("\n");
}

export default {
  title: () => t("temperaments.title"),

  mount(root) {
    const s0 = settings.get();
    const ref = Number(s0.referenceHz) || 415;
    // The saved root is a key name -- "Bb" -- and turning it into an index by
    // replacing b with # landed a semitone out on every flat key.
    let rootClass = pitchClassIndexOf(s0.root || "C");
    let octave = 4;
    const own = owner();
    this.own = own;
    const played = Array.from({ length: 12 }, () => []);
    // Notes heard but not counted, by reason. Shown, not swallowed: playing
    // something and seeing nothing happen needs an explanation on the page.
    const ignored = { short: 0, between: 0 };

    const table = el("table", { class: "temp-table" });
    const skipped = el("p", { class: "muted small" });
    const copied = el("div", { class: "muted small" });
    const control = own.add(audioControl({ showGranted: false }));
    const level = levelBar();

    // Unbound on purpose: this page compares temperaments from a root of its
    // own choosing and must not rewrite the root the whole app is tuned to.
    // It still relabels itself when the naming setting changes, which is the
    // control's business rather than this view's.
    const rootField = own.add(pitchClassControl({
      label: t("temperaments.root"), value: rootClass,
      onChange: (index) => { rootClass = index; draw(); },
    }));
    const octaveField = own.add(selectField({
      label: t("temperaments.octave"), value: octave, parse: Number,
      options: [3, 4, 5, 6].map((o) => ({ value: o, label: String(o) })),
      onChange: (chosen) => { octave = chosen; draw(); },
    }));

    let drawnRows = [];
    const draw = () => {
      const s = settings.get();
      const rows = temperamentTable({ referenceHz: ref, root: rootClass, octave });
      drawnRows = rows;
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
                  `${heard >= 0 ? "+" : ""}${heard.toFixed(1)}`, played[row.index].length) }),
          ]),
          ...cells,
          el("td", { class: "temp-spread", text: row.indistinguishable
            ? t("temperaments.same")
            : `${row.spreadCents.toFixed(0)}¢` }),
        ]));
      }
      table.append(body);
      skipped.textContent = ignored.short || ignored.between
        ? t("temperaments.ignored", ignored.short, ignored.between, CLASS_MIN_SECONDS)
        : "";
    };

    /* Each played note is folded onto its pitch class -- the octave it was
     * played in changes the frequencies but not one thing about the choice
     * between temperaments. */
    const tracker = new RegionTracker({
      frameSeconds: engine.detector ? engine.detector.frameSeconds : 512 / 44100,
    });
    own.add(engine.onFrame((frame) => {
      level.set(frame.levelDb);
      const region = tracker.push(frame);
      if (!region || region.short) return;
      const [framesHz] = postAttack(region.framesHz, tracker.frameSeconds, region.levelsDb);
      if (!framesHz.length) return;
      if (Math.abs(driftCents(framesHz)) >= GLIDE_CENTS) return;
      const { index, cents, usable, why } = classifyNote(
        notePitch(framesHz, tracker.frameSeconds).hz, ref, region.seconds);
      if (usable) played[index].push(cents);
      else ignored[why] += 1;
      draw();
    }));

    // The table's own note names still follow the setting; the two controls
    // now relabel themselves.
    own.add(settings.subscribe(() => draw()));

    append(root,
      explainer(t("temperaments.intro"), t("temperaments.lesson", INDISTINGUISHABLE_CENTS),
                t("temperaments.how", ref)),
      el("div", { class: "row" }, [rootField.element, octaveField.element]),
      control.element,
      level.element,
      el("div", { class: "scroll" }, [table]),
      skipped,
      helpSection("temperaments").element,
      copied,
      el("div", { class: "controls" }, [
        el("button", { class: "secondary", text: t("temperaments.copy"), onclick: async () => {
          const text = readingsReport({
            rows: drawnRows, played, ignored, referenceHz: ref,
            rootLabel: PITCH_CLASSES[rootClass], octave,
            naming: settings.get().naming,
          });
          try {
            await navigator.clipboard.writeText(text);
            copied.replaceChildren(el("span", { text: t("temperaments.copied") }));
          } catch (_error) {
            // Denied, or an insecure context. The text on the page can still
            // be selected by hand: worse, but it never fails.
            copied.replaceChildren(
              el("textarea", { class: "feedback-fallback", rows: 10, readonly: true, text }));
          }
        } }),
        el("button", { class: "primary", text: t("temperaments.clear"), onclick: () => {
          played.forEach((xs) => { xs.length = 0; });
          ignored.short = 0;
          ignored.between = 0;
          copied.replaceChildren();
          tracker.flush();
          draw();
        } }),
      ]),
    );
    draw();
  },

  unmount() { if (this.own) { this.own.dispose(); this.own = null; } },
};
