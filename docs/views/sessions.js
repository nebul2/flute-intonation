/* Sessions: what is stored on this device, and the comparison of two of them
 * -- in practice, the same music played on two flutes.
 *
 * Nothing here leaves the device; the list simply reads back what the
 * exercises and Listen to me have saved. Picking two enables the comparison,
 * which refuses outright when the two sets of numbers are not on the same
 * scale, and warns when they are comparable but thin. */

import { t } from "../i18n.js";
import * as history from "../history.js";
import * as settings from "../settings.js";
import { SpelledPitch } from "../core/pitch.js";
import { compare, perNote, MAX_COMPARE } from "../core/compare.js";
import { sessionScore } from "../core/stats.js";
import { el, append, name, bandClass, explainer } from "../ui/widgets.js";
import { checkboxField } from "../ui/fields.js";

const fmt = (c, digits = 1) => `${c >= 0 ? "+" : ""}${c.toFixed(digits)}`;

function kindLabel(record) {
  const exercise = record.exercise ?? "";
  if (exercise === "listen") return t("listen.title");
  const match = /^practice: (.+)$/.exec(exercise);
  if (match) {
    const key = `practice.ex.${match[1]}.title`;
    const label = t(key);
    return label === key ? match[1] : label;
  }
  return exercise || t("sessions.unnamed");
}

function scoreLabel(record) {
  const score = sessionScore([...perNote(record).values()]);
  return score ? t("sessions.score", score.accuracy.toFixed(1)) : null;
}

function tuningLabel(record) {
  const temperament = t(`temperament.${record.temperament}`);
  return `A=${record.reference_hz} · ${temperament} · ${t(`mode.${record.mode}`)}`;
}

/* Was there a bass sounding? The one fact about a free-play session that
 * changes what the numbers mean and is invisible in them -- and the reason
 * this exists at all is that comparing a take with a drone against one
 * without is the obvious thing to do with the setting, and until now the two
 * rows were distinguishable only by the clock.
 *
 * Silent when the record predates the field rather than guessing: a session
 * saved before 8.4, and every practice record, simply does not say. `drone_hz`
 * is the shape 8.4 wrote for one day before the drone learned to follow a
 * key change, when a single frequency stopped being able to describe it.
 */
function droneLabel(record) {
  const had = record.drone ?? (typeof record.drone_hz === "number" ? true : record.drone_hz);
  if (had === undefined || had === null) return null;
  return t(had ? "sessions.withDrone" : "sessions.noDrone");
}

function when(record) {
  return (record.at ?? "").slice(0, 16).replace("T", " ");
}

export default {
  title: () => t("sessions.title"),

  mount(root) {
    this.root = root;
    this.selected = [];
    this.anchor = null;      // the last row clicked without shift
    this.records = [];
    this.load();
  },

  unmount() {},

  async load() {
    try { this.records = await history.all(); } catch (_e) { this.records = []; }
    this.render();
  },

  /* Clicking a row. Plain, ctrl and cmd all add or remove the one -- these
   * rows carry checkboxes and that is what a checkbox does, so there is no
   * separate "replace the selection" gesture to distinguish them from.
   * Shift extends from the last row clicked.
   *
   * Extending *adds* the range rather than replacing the selection, as a
   * tick-list does and unlike a file manager: nothing a stray shift-click
   * does can lose a selection that was already made. */
  click(id, event) {
    if (event?.shiftKey && this.anchor && this.anchor !== id) {
      // A shift-click drags a text selection across the rows otherwise.
      event.preventDefault();
      this.selectRange(this.anchor, id);
      return;
    }
    this.anchor = id;
    this.toggle(id);
  },

  selectRange(from, to) {
    const ids = this.records.map((record) => record.id);
    const a = ids.indexOf(from), b = ids.indexOf(to);
    if (a < 0 || b < 0) { this.toggle(to); return; }     // the anchor was deleted
    const [low, high] = a <= b ? [a, b] : [b, a];
    this.selected = [...new Set([...this.selected, ...ids.slice(low, high + 1)])];
    this.render();
  },

  /* No cap. Until 8.4.4 a fourth tick silently dropped the oldest, because
   * the selection existed only to be compared and comparing takes three at
   * most. It is now also what gets deleted, and a selection that quietly
   * changes under you is no basis for a delete -- so the limit moved to the
   * Compare button, where it can be seen and explained. */
  toggle(id) {
    const index = this.selected.indexOf(id);
    if (index >= 0) this.selected.splice(index, 1);
    else this.selected.push(id);
    this.render();
  },

  /* The row's own Delete. When that row is one of several ticked, the button
   * says so and takes the lot: having ticked four sessions, the next thing
   * wanted is rarely to remove exactly one of them, and a button that said
   * "Delete" while four were selected would be the ambiguous one. Untick a
   * row to delete it on its own. */
  async remove(id) {
    const bulk = this.selected.length > 1 && this.selected.includes(id);
    const doomed = bulk ? [...this.selected] : [id];
    if (!window.confirm(bulk ? t("sessions.deleteSelectedConfirm", doomed.length)
                             : t("sessions.deleteConfirm"))) return;
    for (const one of doomed) await history.remove(one);
    this.selected = this.selected.filter((s) => !doomed.includes(s));
    if (doomed.includes(this.anchor)) this.anchor = null;
    this.load();
  },

  row(record) {
    const selected = this.selected.includes(record.id);
    const details = [
      kindLabel(record),
      record.tonic ? `${t("practice.tonic")} ${name(SpelledPitch.parse(record.tonic), settings.get())}` : null,
      droneLabel(record),
      t("sessions.notes", (record.notes ?? []).length),
      // Recomputed rather than read from the record, so sessions saved before
      // scoring existed show one too.
      scoreLabel(record),
      tuningLabel(record),
    ].filter(Boolean).join(" · ");

    /* A naked box in a table row -- the third checkbox convention this app
     * had, and the reason `look` exists. Unbound: what is selected is this
     * page's own state, not a preference, and it is rebuilt on every draw. */
    const box = checkboxField({
      look: "bare", value: selected, ariaLabel: record.label || t("sessions.unnamed"),
      onChange: () => this.click(record.id),
    });
    const body = el("div", { class: "session-body", onclick: (e) => this.click(record.id, e) }, [
      el("div", { class: "session-head" }, [
        el("span", { class: "session-label", text: record.label || t("sessions.unnamed") }),
        el("span", { class: "muted", text: when(record) }),
      ]),
      el("div", { class: "muted", text: details }),
    ]);
    const remove = el("button", {
      class: "link-button",
      text: selected && this.selected.length > 1
        ? t("sessions.deleteSelected", this.selected.length) : t("sessions.delete"),
      onclick: (e) => { e.stopPropagation(); this.remove(record.id); },
    });
    return el("div", { class: `session${selected ? " selected" : ""}` }, [box.element, body, remove]);
  },

  render() {
    const root = this.root;
    root.replaceChildren();
    const picked = this.selected.length;
    const ready = picked >= 2 && picked <= MAX_COMPARE;
    const compareButton = el("button", {
      class: "primary", text: t("sessions.compare"), disabled: !ready,
      onclick: () => this.showComparison(),
    });
    this.panel = el("div", { class: "compare" });

    append(root,
      explainer(t("sessions.intro")),
      this.records.length ? null : el("p", { class: "note-box", text: t("sessions.empty") }),
      this.records.length
        ? el("div", { class: "row" }, [compareButton,
            el("span", { class: "muted",
              text: ready ? "" : picked > MAX_COMPARE
                ? t("sessions.selectTooMany", picked, MAX_COMPARE) : t("sessions.selectTwo") })])
        : null,
      el("div", { class: "sessions" }, this.records.map((record) => this.row(record))),
      this.panel,
    );
  },

  showComparison() {
    const picked = this.records.filter((r) => this.selected.includes(r.id));
    if (picked.length < 2) return;
    // Earliest first, so the letters run in the order they were played.
    const ordered = [...picked].sort((x, y) => ((x.at ?? "") < (y.at ?? "") ? -1 : 1));
    const letters = ordered.map((_, i) => String.fromCharCode(65 + i));
    const labels = ordered.map((r) => [r.label || `${kindLabel(r)} ${when(r)}`, droneLabel(r)]
      .filter(Boolean).join(" · "));
    const result = compare(ordered);

    const parts = [el("h2", { text: t("compare.title") })];
    parts.push(el("p", { class: "mono legend",
      text: letters.map((letter, i) => `${letter} — ${labels[i]}`).join("     ") }));

    if (!result.ok) {
      parts.push(el("p", { class: "note-box", text: t("compare.blocked") }));
      for (const blocker of result.blockers) {
        parts.push(el("p", { class: "muted", text: blocker.field === "noSharedNotes"
          ? t("compare.field.noSharedNotes")
          : t("compare.blockedField", t(`compare.field.${blocker.field}`), blocker.a, blocker.b) }));
      }
      this.panel.replaceChildren(...parts);
      this.panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    const s = settings.get();

    /* ---- the conclusion, first: which is better tuned, and by how much --- */
    const best = result.best;
    parts.push(el("h2", { text: t("compare.scoreTitle") }));
    parts.push(el("p", { text: best.notable
      ? t("compare.verdict.best", labels[best.index], best.gap.toFixed(1), labels[best.runnerUp])
      : t("compare.verdict.tooClose", labels[best.index], labels[best.runnerUp]) }));

    const measures = [
      ["internal", (x) => x.internal],
      ["repeatability", (x) => x.repeatability],
      ["steadiness", (x) => x.steadiness],
    ];
    parts.push(el("div", { class: "stats scroll" }, [
      el("table", {}, [
        el("thead", {}, [el("tr", {}, [el("th", { text: t("compare.col.measure") }),
          ...letters.map((letter) => el("th", { text: letter }))])]),
        el("tbody", {}, measures.map(([key, pick]) => {
          const values = result.sessions.map(pick);
          const lowest = Math.min(...values);
          return el("tr", {}, [
            el("td", { class: "name", title: t(`compare.score.${key}Help`), text: t(`compare.score.${key}`) }),
            ...values.map((value) => el("td", {
              class: `num${value === lowest ? " best" : ""}`, text: value.toFixed(1),
            })),
          ]);
        })),
      ]),
    ]));
    parts.push(el("p", { class: "muted", text: t("compare.lowerIsBetter") }));
    parts.push(el("p", { class: "note-box", text: t("compare.caveat") }));

    /* ---- pitch, reported once and separately from tuning ---------------- */
    if (ordered.length === 2) {
      const offset = result.offsets[1] - result.offsets[0];
      parts.push(el("p", { text: Math.abs(offset) < 1
        ? t("compare.offsetSame")
        : t(offset > 0 ? "compare.offsetSharper" : "compare.offsetFlatter",
            labels[1], Math.abs(offset).toFixed(1)) }));
    } else {
      parts.push(el("p", { class: "mono", text: t("compare.offsets") + " " +
        result.offsets.map((o, i) => `${letters[i]} ${o >= 0 ? "+" : ""}${o.toFixed(1)}`).join("   ") }));
    }

    for (const warning of result.warnings) {
      const text = warning.kind === "differentKind"
        ? t("compare.warn.differentKind", kindLabel({ exercise: warning.a }), kindLabel({ exercise: warning.b }))
        : t(`compare.warn.${warning.kind}`, warning.count);
      parts.push(el("p", { class: "note-box", text }));
    }

    /* ---- per note ------------------------------------------------------- */
    parts.push(el("p", { class: "muted", text: t("compare.corrected") }));
    const twoWay = ordered.length === 2;
    const head = [el("th", { text: t("compare.col.note") })];
    for (const letter of letters) {
      head.push(el("th", { text: t("compare.col.value", letter) }));
      head.push(el("th", { text: t("compare.col.spread", letter) }));
    }
    head.push(el("th", { text: twoWay ? t("compare.col.diff") : t("compare.col.range") }));
    head.push(el("th", { text: "" }));

    parts.push(el("div", { class: "stats scroll" }, [
      el("table", {}, [
        el("thead", {}, [el("tr", {}, head)]),
        el("tbody", {}, result.rows.map((row) => {
          const cells = [el("td", { class: "name", text: name(row.pitch, s) })];
          for (const value of row.values) {
            cells.push(el("td", { class: "num", text: `${fmt(value.corrected)} (${value.n})` }));
            cells.push(el("td", { class: "num spread", text: value.n > 1 ? `±${value.spread.toFixed(1)}` : "—" }));
          }
          // With two instruments the signed difference is what you scan for;
          // with three there is no single direction, so the spread is shown.
          const headline = twoWay
            ? fmt(row.values[1].corrected - row.values[0].corrected)
            : row.range.toFixed(1);
          cells.push(el("td", { class: `num ${row.verdict === "notable" ? "off" : ""}`, text: headline }));
          cells.push(el("td", { class: `verdict ${row.verdict}`, text: t(`compare.verdict.${row.verdict}`) }));
          return el("tr", {}, cells);
        })),
      ]),
    ]));

    /* ---- octave widths, when every session is a stopper check ----------- */
    if (result.octaves?.length) {
      parts.push(el("h2", { text: t("compare.octaves") }));
      parts.push(el("div", { class: "stats scroll" }, [
        el("table", {}, [
          el("thead", {}, [el("tr", {}, [el("th", { text: t("compare.col.note") }),
            ...letters.map((letter) => el("th", { text: letter }))])]),
          el("tbody", {}, result.octaves.map((pair) => el("tr", {}, [
            el("td", { class: "name", text: `${name(pair.lower, s)} → ${name(pair.upper, s)}` }),
            ...pair.widths.map((width) => el("td", { class: "num", text: fmt(width) })),
          ]))),
        ]),
      ]));
    }

    this.panel.replaceChildren(...parts);
    this.panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },
};
