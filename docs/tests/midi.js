/* The smallest MIDI reader that will do: note-ons, in order.
 *
 * A Standard MIDI File is the note data of a score with the spelling thrown
 * away -- 61 is C#4 and Db4 alike. That is fine here, because the detector's
 * own names are proximity guesses too, and both sides are compared on
 * chromatic index, exactly as the scale recogniser does. Timing is read but
 * not used for alignment: a player's rubato must not count against them. */

import fs from "node:fs";

/** Notes in file order, as { chroma, tick }. chroma is MIDI note number. */
export function readMidi(file) {
  const b = fs.readFileSync(file);
  if (b.toString("latin1", 0, 4) !== "MThd") throw new Error(`${file}: not a MIDI file`);
  const tracks = b.readUInt16BE(10);
  let pos = 14;
  const notes = [];

  const varlen = () => {
    let v = 0;
    for (;;) { const c = b[pos++]; v = (v << 7) | (c & 0x7f); if (c < 0x80) return v; }
  };

  for (let t = 0; t < tracks; t++) {
    if (b.toString("latin1", pos, pos + 4) !== "MTrk") throw new Error(`${file}: bad track header`);
    const len = b.readUInt32BE(pos + 4);
    pos += 8;
    const end = pos + len;
    let tick = 0, status = 0;
    while (pos < end) {
      tick += varlen();
      if (b[pos] >= 0x80) status = b[pos++];
      // `pos += varlen()` would read pos BEFORE varlen advanced it and then
      // overwrite, losing the length bytes; the length must be taken first.
      if (status === 0xff) { pos += 1; const l = varlen(); pos += l; continue; }        // meta
      if (status === 0xf0 || status === 0xf7) { const l = varlen(); pos += l; continue; } // sysex
      const hi = status & 0xf0;
      if (hi === 0xc0 || hi === 0xd0) { pos += 1; continue; }
      const d1 = b[pos], d2 = b[pos + 1];
      pos += 2;
      if (hi === 0x90 && d2 > 0) notes.push({ chroma: d1, tick });
    }
    pos = end;
  }
  return notes.sort((a, b) => a.tick - b.tick);
}

/* MIDI numbers and this app's chromaticIndex do NOT agree, and I shipped a
 * comparison tool asserting that they did. MIDI puts middle C at 60; the
 * app's SpelledPitch counts from C0 = 0 and puts C4 at 48. The first run of
 * the score comparison reported every note heard an octave low and 16%
 * recall, when the detector had in fact heard the opening note for note --
 * the raw frequencies proved it. Convert here, once, and say so. */
export const MIDI_TO_APP = -12;

/** A score's notes in the app's own index, so both sides can be compared. */
export function readScore(file) {
  return readMidi(file).map((n) => ({ ...n, chroma: n.chroma + MIDI_TO_APP }));
}
