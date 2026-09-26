/* Hardware check: the phase-0 page on the shared engine. Equal-temperament
 * names here on purpose -- this page tests the microphone and speakers, not
 * the tuning -- and it says so.
 *
 * The equal-temperament arithmetic is the page's own decision and stays. Its
 * *spelling* does not: this file carried a private table that hard-coded
 * solfege, so a player who had chosen letters was shown "Do#4" here whatever
 * they had set, on the one page whose whole purpose is to confirm things are
 * working. Names come from ui/naming.js now, like everywhere else. */

import { t } from "../i18n.js";
import { engine } from "../audio/engine.js";
import * as settings from "../settings.js";
import { el, append, audioControl, meters, bandClass, explainer } from "../ui/widgets.js";
import { pitchClassLabel } from "../ui/naming.js";
import { owner } from "../ui/owner.js";
import { pedal, tableIntent, assignments, FORWARD, BACK } from "../ui/pedal.js";

/* The octave stays a bare number here rather than following octaveStyle. On
 * every other page a register word ("Re grave") is the friendlier name; on a
 * hardware check, where the question is whether the machine hears what is in
 * the room, an unambiguous number is the useful answer. */
function describe(hz, referenceHz, naming) {
  const semis = 12 * Math.log2(hz / referenceHz);
  const nearest = Math.round(semis);
  const cents = 100 * (semis - nearest);
  const index = ((nearest % 12) + 12 + 9) % 12;
  const octave = 4 + Math.floor((nearest + 9) / 12);
  return { name: `${pitchClassLabel(index, naming)}${octave}`, cents };
}

export default {
  title: () => t("check.title"),

  mount(root) {
    const own = owner();
    this.own = own;
    const ref = Number(settings.get().referenceHz) || 415;
    const droneHz = ref * Math.pow(2, -7 / 12);      // D below the reference A

    const note = el("div", { class: "big-note", text: "—" });
    const hz = el("span", { text: t("check.pressStart") });
    const cents = el("span");
    const meter = meters({ intonation: true });
    // Whether frames are arriving at all, and what is in them. Without this
    // "listening but the bar never moves" has three different causes that
    // look identical: no frames (the graph is not being pulled, or the
    // context is suspended), frames of digital silence (the input iPadOS
    // chose is not the one in the room), or a level bar that is simply low.
    const diag = el("div", { class: "diag" });
    const control = own.add(audioControl());
    const drone = el("button", { class: "secondary", text: t("check.drone"), disabled: true });

    const updateDrone = () => {
      drone.disabled = !engine.listening;
      drone.textContent = engine.drone.playing
        ? t("check.droneStop", droneHz.toFixed(2)) : t("check.drone");
    };
    drone.addEventListener("click", () => {
      if (engine.drone.playing) engine.drone.stop();
      else engine.drone.start(droneHz, settings.get().droneLevel);
    });
    own.add(engine.onState(updateDrone));
    updateDrone();

    let frames = 0;
    let lastVoiced = null;
    own.add(engine.onFrame((frame) => {
      frames += 1;
      if (frame.hz > 0) lastVoiced = frame;
      meter.setLevel(frame.levelDb);
    }));

    const render = () => {
      if (!this.mounted) return;
      const now = performance.now();
      if (engine.listening && lastVoiced && now - lastVoiced.t < 400) {
        const d = describe(lastVoiced.hz, ref, settings.get().naming);
        note.textContent = d.name;
        hz.textContent = `${lastVoiced.hz.toFixed(2)} Hz`;
        cents.textContent = `${d.cents >= 0 ? "+" : ""}${d.cents.toFixed(1)}¢`;
        cents.className = bandClass(d.cents);
        meter.setCents(d.cents);
      } else {
        note.textContent = "—";
        hz.textContent = engine.listening ? t("check.listening") : t("check.pressStart");
        cents.textContent = "";
        meter.setCents(null);
      }
      const last = engine.lastFrame;
      diag.textContent = t("check.diag", frames,
        `${engine.contextState} ${engine.sampleRate || "?"} Hz`, engine.trackInfo,
        last && Number.isFinite(last.levelDb) ? last.levelDb.toFixed(1) : "—");
      requestAnimationFrame(render);
    };
    this.mounted = true;
    requestAnimationFrame(render);

    /* ---- the foot pedal ------------------------------------------------
     *
     * A pedal is hardware, so it is checked where the microphone and the
     * speakers are checked. It earns its place twice over: it tells a player
     * whether the thing under her foot works at all, and it tells us what her
     * pedal actually sends -- which is the one fact CR-009 could not get at,
     * the key table there having been reasoned out rather than measured.
     *
     * So the panel reports the raw key before it reports any verdict. When
     * the key is one nobody predicted, the name of it is the useful output,
     * and the two buttons below turn that from a bug report into a setting. */
    let lastKey = null;
    const pedalNote = el("div", { class: "big-note", text: "—" });
    const pedalVerdict = el("span");
    const pedalKey = el("span", { class: "mono" });
    const pedalLog = el("div", { class: "diag" });
    const presses = [];

    const assignButton = (which, label) => el("button", {
      class: "secondary", text: label, disabled: true,
      onclick: () => {
        if (!lastKey) return;
        settings.set(which === FORWARD ? { pedalForward: lastKey } : { pedalBack: lastKey });
        renderPedal();
      },
    });
    const useForward = assignButton(FORWARD, t("check.pedalUseForward"));
    const useBack = assignButton(BACK, t("check.pedalUseBack"));
    const forget = el("button", {
      class: "link-button", text: t("check.pedalForget"),
      onclick: () => { settings.set({ pedalForward: null, pedalBack: null }); renderPedal(); },
    });

    function renderPedal() {
      const set = assignments();
      const intent = lastKey
        ? (set.forward === lastKey ? FORWARD : set.back === lastKey ? BACK : tableIntent(lastKey))
        : null;
      pedalNote.textContent = intent === FORWARD ? "▶" : intent === BACK ? "◀" : lastKey ? "?" : "—";
      pedalKey.textContent = lastKey === null ? "" : lastKey === " " ? "space" : lastKey;
      pedalVerdict.textContent = !lastKey ? t("check.pedalWaiting")
        : intent === FORWARD ? t("check.pedalForward")
        : intent === BACK ? t("check.pedalBack")
        : t("check.pedalUnknown");
      pedalVerdict.className = intent ? "good" : lastKey ? "off" : "";
      useForward.disabled = useBack.disabled = !lastKey;
      const named = [set.forward && t("check.pedalAssignedForward", set.forward === " " ? "space" : set.forward),
                     set.back && t("check.pedalAssignedBack", set.back === " " ? "space" : set.back)].filter(Boolean);
      forget.hidden = !named.length;
      // Recent presses on the left, what is assigned on the right: run
      // together they read as one list and the reader cannot tell which is
      // a record of what happened and which is a setting.
      pedalLog.textContent = [presses.join(" · "), named.join(", ")].filter(Boolean).join("   —   ");
    }

    /* Every key, not only the mapped ones -- an unrecognised press is the
     * finding this panel exists to surface, and a listener that ignored it
     * would report silence for the one pedal worth hearing about. The shared
     * subscription is not used here for the same reason. */
    own.add((() => {
      const onKey = (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const tag = event.target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        lastKey = event.key.toLowerCase();
        presses.unshift(lastKey === " " ? "space" : lastKey);
        presses.length = Math.min(presses.length, 6);
        renderPedal();
        // Space and enter still work a focused button; anything else this
        // page has no other use for.
        if (!((lastKey === " " || lastKey === "enter") && (tag === "BUTTON" || tag === "A"))) {
          event.preventDefault();
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    })());
    own.add(settings.subscribe(renderPedal));
    renderPedal();

    append(root, 
      explainer(t("check.intro"), t("check.note")),
      el("div", { class: "card panel" }, [
        note,
        el("div", { class: "readout" }, [hz, cents]),
        meter.element,
        diag,
        el("div", { class: "controls" }, [control.element, drone]),
      ]),
      el("h2", { text: t("check.pedalTitle") }),
      el("p", { class: "note-box", text: t("check.pedalIntro") }),
      el("div", { class: "card panel" }, [
        pedalNote,
        el("div", { class: "readout" }, [pedalKey, pedalVerdict]),
        pedalLog,
        el("div", { class: "controls" }, [useForward, useBack, forget]),
      ]),
    );
  },

  unmount() {
    this.mounted = false;
    if (this.own) { this.own.dispose(); this.own = null; }
  },
};
