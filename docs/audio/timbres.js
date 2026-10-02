/* What the drone can sound like.
 *
 * "plain" is the drone the app has always had: a fundamental and two partials
 * at -12 dB/octave, which is exactly what the speaker notches know how to
 * take back out of the microphone. Everything else is a richer sound for
 * "Follow me", where the partner should be heard as a person rather than a
 * test tone.
 *
 * Through speakers a richer sound puts more partials into the room than three
 * notches can remove. 8.7 therefore played plain whenever headphones were not
 * set -- and the player, on speakers, chose four sounds and heard one. Their
 * own sessions then showed the flute read cleanly over the partner and over
 * whole chords (MacBook, quiet room), so since 8.8.2 every sound plays through
 * speakers, and what protects the reading is the level gate, applied wherever
 * a strong partial of the chosen sound lands on the note (see `partialsOf`
 * and views/run.js partnerShares).
 *
 * Synthesised, a few numbers each: no samples to download, nothing added to
 * load time. A sample pack is designed in cr/010 and built only if these
 * prove unconvincing in use.
 *
 * Pure data and pure functions, so it can be tested in node; the Web Audio
 * graph that plays it is in engine.js. */

/* `partials` are amplitudes of harmonics 1, 2, 3...; `detune` the cents of
 * each copy sounded together (two copies a few cents apart is what makes a
 * section rather than one player, and their mean stays at the pitch);
 * `breath` the level of filtered noise, relative to the tone; `swell` a slow
 * waver in level -- {rate in Hz, depth as a fraction} -- never in pitch,
 * because the pitch is the thing being matched. */
export const TIMBRES = Object.freeze({
  plain: Object.freeze({ partials: [1.0, 0.25, 1 / 9], detune: [0], breath: 0, swell: null }),
  // A traverso: a strong octave and twelfth over a soft fundamental, a lot of
  // breath, and a player's slow swell. The first version was within a few per
  // cent of plain, and sounded like it.
  flute: Object.freeze({
    partials: [1.0, 0.7, 0.45, 0.2, 0.12, 0.06, 0.03], detune: [0], breath: 0.12,
    swell: Object.freeze({ rate: 0.3, depth: 0.12 }),
  }),
  // Bowed: every harmonic, falling off roughly as 1/n, two players.
  strings: Object.freeze({
    partials: Array.from({ length: 16 }, (_, i) => (1 / (i + 1)) * Math.exp(-i / 10)),
    detune: [-4, 4], breath: 0, swell: null,
  }),
  // A small chamber organ: flue pipes, octave and twelfth drawn.
  organ: Object.freeze({ partials: [1.0, 0.55, 0.35, 0.3, 0.1, 0.15, 0.05, 0.1], detune: [0], breath: 0, swell: null }),
});

export const TIMBRE_ORDER = Object.freeze(["plain", "flute", "strings", "organ"]);

/* A partial weaker than this, relative to the fundamental, is not treated as
 * able to be read as a note on its own. */
export const STRONG_PARTIAL = 0.1;

/* The timbre that will sound: the one asked for, or plain if it is unknown. */
export function soundingTimbre(name) {
  return TIMBRES[name] ? name : "plain";
}

/* The frequencies a voice at `hz` puts into the room strongly enough to
 * matter: every partial of its timbre at STRONG_PARTIAL or above. */
export function partialsOf(hz, name = "plain") {
  const { partials } = TIMBRES[soundingTimbre(name)];
  return partials.flatMap((a, i) => (a / partials[0] >= STRONG_PARTIAL ? [hz * (i + 1)] : []));
}
