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
import { compare } from "../core/compare.js";
import { el, append, name, bandClass } from "../ui/widgets.js";

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

function tuningLabel(record) {
  const temperament = t(`temperament.${record.temperament}`);
  return `A=${record.reference_hz} · ${temperament} · ${t(`mode.${record.mode}`)}`;
}

function when(record) {
  return (record.at ?? "").slice(0, 16).replace("T", " ");
}

export default {
  title: () => t("sessions.title"),

  mount(root) {
    this.root = root;
    this.selected = [];
    this.records = [];
    this.load();
  },

  unmount() {},

  async load() {
    try { this.records = await history.all(); } catch (_e) { this.records = []; }
    this.render();
  },

  toggle(id) {
    const index = this.selected.indexOf(id);
    if (index >= 0) this.selected.splice(index, 1);
    else {
      this.selected.push(id);
      if (this.selected.length > 2) this.selected.shift();   // a third replaces the oldest
    }
    this.render();
  },

  async remove(id) {
    if (!window.confirm(t("sessions.deleteConfirm"))) return;
    await history.remove(id);
    this.selected = this.selected.filter((s) => s !== id);
    this.load();
  },

  row(record) {
    const selected = this.selected.includes(record.id);
    const details = [
      kindLabel(record),
      record.label ? null : null,
      record.tonic ? `${t("practice.tonic")} ${name(SpelledPitch.parse(record.tonic), settings.get())}` : null,
      t("sessions.notes", (record.notes ?? []).length),
      tuningLabel(record),
    ].filter(Boolean).join(" · ");

    const box = el("input", {
      type: "checkbox", checked: selected || null,
      "aria-label": record.label || t("sessions.unnamed"),
      onchange: () => this.toggle(record.id),
    });
    const body = el("div", { class: "session-body", onclick: () => this.toggle(record.id) }, [
      el("div", { class: "session-head" }, [
        el("span", { class: "session-label", text: record.label || t("sessions.unnamed") }),
        el("span", { class: "muted", text: when(record) }),
      ]),
      el("div", { class: "muted", text: details }),
    ]);
    const remove = el("button", {
      class: "link-button", text: t("sessions.delete"),
      onclick: (e) => { e.stopPropagation(); this.remove(record.id); },
    });
    return el("div", { class: `session${selected ? " selected" : ""}` }, [box, body, remove]);
  },

  render() {
    const root = this.root;
    root.replaceChildren();
    const ready = this.selected.length === 2;
    const compareButton = el("button", {
      class: "primary", text: t("sessions.compare"), disabled: !ready,
      onclick: () => this.showComparison(),
    });
    this.panel = el("div", { class: "compare" });

    append(root,
      el("p", { class: "intro", text: t("sessions.intro") }),
      this.records.length ? null : el("p", { class: "note-box", text: t("sessions.empty") }),
      this.records.length
        ? el("div", { class: "row" }, [compareButton,
            el("span", { class: "muted", text: ready ? "" : t("sessions.selectTwo") })])
        : null,
      el("div", { class: "sessions" }, this.records.map((record) => this.row(record))),
      this.panel,
    );
  },

  showComparison() {
    const picked = this.records.filter((r) => this.selected.includes(r.id));
    if (picked.length !== 2) return;
    // Older first, so the report reads "B sits sharper than A".
    const [a, b] = [...picked].sort((x, y) => ((x.at ?? "") < (y.at ?? "") ? -1 : 1));
    const labelA = a.label || `${kindLabel(a)} ${when(a)}`;
    const labelB = b.label || `${kindLabel(b)} ${when(b)}`;
    const result = compare(a, b);

    const parts = [el("h2", { text: t("compare.title") }),
                   el("p", { class: "mono", text: `A — ${labelA}     B — ${labelB}` })];

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

    // The pitch difference, reported once and separately from the tuning.
    const offset = result.offsetDiff;
    parts.push(el("p", { text: Math.abs(offset) < 1
      ? t("compare.offsetSame")
      : t(offset > 0 ? "compare.offsetSharper" : "compare.offsetFlatter",
          labelB, Math.abs(offset).toFixed(1)) }));
    parts.push(el("p", { text: t("compare.internal", labelA, result.internalA.toFixed(1),
                                 labelB, result.internalB.toFixed(1)) }));
    const gap = result.internalA - result.internalB;
    parts.push(el("p", { class: "muted", text: Math.abs(gap) < 1
      ? t("compare.internalEqual")
      : t("compare.internalBetter", gap > 0 ? labelB : labelA) }));

    for (const warning of result.warnings) {
      const text = warning.kind === "differentKind"
        ? t("compare.warn.differentKind", kindLabel({ exercise: warning.a }), kindLabel({ exercise: warning.b }))
        : t(`compare.warn.${warning.kind}`, warning.count);
      parts.push(el("p", { class: "note-box", text }));
    }

    parts.push(el("p", { class: "muted", text: t("compare.corrected") }));
    const s = settings.get();
    const head = ["note", "a", "aSpread", "b", "bSpread", "diff", "verdict"];
    parts.push(el("div", { class: "stats scroll" }, [
      el("table", {}, [
        el("thead", {}, [el("tr", {}, head.map((k) => el("th", { text: t(`compare.col.${k}`) })))]),
        el("tbody", {}, result.rows.map((row) => el("tr", {}, [
          el("td", { class: "name", text: name(row.pitch, s) }),
          el("td", { class: "num", text: `${fmt(row.aCorrected)} (${row.aN})` }),
          el("td", { class: "num spread", text: row.aN > 1 ? `±${row.aSpread.toFixed(1)}` : "—" }),
          el("td", { class: "num", text: `${fmt(row.bCorrected)} (${row.bN})` }),
          el("td", { class: "num spread", text: row.bN > 1 ? `±${row.bSpread.toFixed(1)}` : "—" }),
          el("td", { class: `num ${row.verdict === "notable" ? bandClass(row.diff) : ""}`, text: fmt(row.diff) }),
          el("td", { class: `verdict ${row.verdict}`, text: t(`compare.verdict.${row.verdict}`) }),
        ]))),
      ]),
    ]));

    if (result.octaves?.length) {
      parts.push(el("h2", { text: t("compare.octaves") }));
      parts.push(el("div", { class: "stats scroll" }, [
        el("table", {}, [
          el("thead", {}, [el("tr", {}, ["note", "a", "b", "diff"].map((k) =>
            el("th", { text: t(`compare.col.${k}`) })))]),
          el("tbody", {}, result.octaves.map((pair) => el("tr", {}, [
            el("td", { class: "name", text: `${name(pair.lower, s)} → ${name(pair.upper, s)}` }),
            el("td", { class: "num", text: fmt(pair.a) }),
            el("td", { class: "num", text: fmt(pair.b) }),
            el("td", { class: "num", text: fmt(pair.b - pair.a) }),
          ]))),
        ]),
      ]));
    }

    this.panel.replaceChildren(...parts);
    this.panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },
};
