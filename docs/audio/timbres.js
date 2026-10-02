/* What the drone can sound like.
 *
 * "plain" is the drone the app has always had: a fundamental and two partials
 * at -12 dB/octave, which is exactly what the speaker notches know how to
 * take back out of the microphone. Everything else is a richer sound for
 * "Follow me", where the partner should be heard as a person rather than a
 * test tone -- and every one of them puts more partials into the room than
 * three notches can remove, so they are offered only with headphones (see
 * cr/010).
 *
 * Synthesised, a few numbers each: no samples to download, nothing added to
 * load time. A sample pack is designed in cr/010 and built only if these
 * prove unconvincing in use.
 *
 * Pure data and one pure function, so it can be tested in node; the Web
 * Audio graph that plays it is in engine.js. */

/* `partials` are amplitudes of harmonics 1, 2, 3...; `detune` the cents of
 * each copy sounded together (two copies a few cents apart is what makes a
 * section rather than one player, and their mean stays at the pitch);
 * `breath` the level of filtered noise, relative to the tone. */
export const TIMBRES = Object.freeze({
  plain: Object.freeze({ partials: [1.0, 0.25, 1 / 9], detune: [0], breath: 0, headphones: false }),
  // A traverso is nearly a sine an octave up and the breath is half of it.
  flute: Object.freeze({ partials: [1.0, 0.32, 0.12, 0.05, 0.02], detune: [0], breath: 0.05, headphones: true }),
  // Bowed: every harmonic, falling off roughly as 1/n, two players.
  strings: Object.freeze({
    partials: Array.from({ length: 16 }, (_, i) => (1 / (i + 1)) * Math.exp(-i / 10)),
    detune: [-4, 4], breath: 0, headphones: true,
  }),
  // A small chamber organ: flue pipes, octave and twelfth drawn.
  organ: Object.freeze({ partials: [1.0, 0.55, 0.35, 0.3, 0.1, 0.15, 0.05, 0.1], detune: [0], breath: 0, headphones: true }),
});

export const TIMBRE_ORDER = Object.freeze(["plain", "flute", "strings", "organ"]);

/* The timbre that will actually sound: the one asked for when the setup
 * allows it, otherwise plain. Through speakers a rich drone would come back
 * in through the microphone with more partials than can be notched, so it
 * falls back rather than quietly corrupting the readings. */
export function soundingTimbre(name, headphones) {
  const timbre = TIMBRES[name];
  if (!timbre) return "plain";
  return timbre.headphones && !headphones ? "plain" : name;
}
