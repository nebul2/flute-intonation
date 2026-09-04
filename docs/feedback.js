/* Asking the people testing this what they think, without pestering them.
 *
 * A static site has nowhere to POST to, and the people using this are flute
 * teachers rather than GitHub users, so feedback goes by mail: a link that
 * opens their own mail app with the subject and the setup already filled in.
 * They can read and edit every word before it is sent, which is the whole
 * reason to prefer it over a form -- nothing leaves the device unseen, and no
 * third party sits in the middle of a message meant for one person.
 *
 * What is prefilled is the part a teacher should not have to describe: which
 * version, which tuning, what the microphone was actually given. Bug reports
 * from non-technical users are usually unactionable for want of exactly this.
 */

import { VERSION } from "./app-version.js";

/* Where feedback goes.
 *
 * PUT A THROWAWAY ALIAS HERE, not a personal address: this file is in a public
 * repository and harvesters read it. A Proton alias can be burnt and replaced
 * if it starts attracting spam, and nothing else has to change.
 *
 * Left empty, the app falls back to copying the report to the clipboard and
 * pointing at the issue tracker, so the feature works either way -- it is just
 * friendlier once this is filled in.
 */
export const ADDRESS = "";

export const ISSUES = "https://github.com/nebul2/flute-intonation/issues/new";

/** Sessions saved before the app asks what the player thinks. */
export const INVITE_AFTER_SESSIONS = 3;

/**
 * The setup, as a few lines the sender can read.
 *
 * Deliberately plain text rather than an encoded blob: someone about to email
 * a stranger should be able to see exactly what they are attaching, and delete
 * any line of it. A blob would be more complete and less honest.
 */
export function diagnostics({ settings, engine, page, language, navigator: nav } = {}) {
  const lines = [];
  lines.push(`app: ${VERSION}`);
  if (language) lines.push(`language: ${language}`);
  if (page) lines.push(`page: ${page}`);
  if (settings) {
    lines.push(`tuning: ${settings.temperament} on ${settings.root}, `
      + `A = ${settings.referenceHz} Hz, ${settings.mode}`);
  }
  if (engine && engine.sampleRate) {
    const g = engine.granted ?? {};
    lines.push(`audio: ${engine.sampleRate} Hz`
      + `, AGC ${g.autoGainControl !== false ? "on" : "off"}`
      + `, noise suppression ${g.noiseSuppression !== false ? "on" : "off"}`
      + `, echo cancellation ${g.echoCancellation !== false ? "on" : "off"}`);
  }
  const agent = nav ?? (typeof navigator === "undefined" ? null : navigator);
  if (agent && agent.userAgent) lines.push(`browser: ${agent.userAgent}`);
  return lines.join("\n");
}

/** The whole message: their words first, the machine's afterwards. */
export function body(context, prompt) {
  return `${prompt}\n\n\n\n--\n${diagnostics(context)}\n`;
}

export function mailto(subject, context, prompt) {
  if (!ADDRESS) return null;
  return `mailto:${ADDRESS}`
    + `?subject=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(body(context, prompt))}`;
}

/**
 * Whether to invite feedback now.
 *
 * Once, after enough use to have formed an opinion, and never again once it
 * has been dismissed or acted on. A prompt that reappears is a nag, and the
 * people being asked here are doing a favour.
 */
export function shouldInvite({ sessions, asked }) {
  return !asked && sessions >= INVITE_AFTER_SESSIONS;
}
