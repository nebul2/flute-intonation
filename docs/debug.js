/* A debug record of a Listen to me session, to send to whoever is looking
 * into the app's behaviour on a device.
 *
 * Asked for after two devices listening to the same playing agreed on pitch
 * to well under a cent and still found different notes. What a device found
 * is in the history; why it found that is not. This keeps, for one session:
 * every frame the detector produced (time, pitch, level), every region the
 * tracker closed and what it was classified as, the audio path's own report
 * of itself, and -- if asked -- the microphone audio exactly as the detector
 * received it, so the same sound can be run through the pipeline again on
 * another machine (docs/tests/wavpipe.js) and compared
 * (docs/tests/debugdiff.js).
 *
 * Off by default (Settings), nothing leaves the device unless the player
 * sends the file themselves. No DOM here: views/listen.js shows the button,
 * download.js hands the files over. */

export const DEBUG_VERSION = 1;

/* Every frame, in three parallel arrays rather than an object each: a
 * three-minute session is ~17 000 frames, and this keeps the file to a few
 * hundred kilobytes. Times are milliseconds from the first frame. */
export class FrameLog {
  constructor() { this.t0 = null; this.t = []; this.hz = []; this.db = []; }

  push(frame) {
    const now = Number.isFinite(frame.t) ? frame.t : 0;
    if (this.t0 === null) this.t0 = now;
    this.t.push(Math.round((now - this.t0) * 10) / 10);
    this.hz.push(frame.hz > 0 ? Math.round(frame.hz * 100) / 100 : 0);
    this.db.push(Number.isFinite(frame.levelDb) ? Math.round(frame.levelDb * 10) / 10 : null);
  }

  /* Milliseconds from the first frame to `now` on the same clock. */
  at(now) { return this.t0 === null ? 0 : Math.round((now - this.t0) * 10) / 10; }

  get length() { return this.t.length; }

  /* Gaps in the frame clock longer than `factor` frames, and how many frames
   * are actually missing. The two differ: an iPad delivers frames in late
   * bunches (gaps of 2-3 frames) with nothing lost -- its first debug record
   * had 28 such gaps and a frame count matching its audio sample for sample.
   * `lost` is the clock's span against the frames that arrived; only that
   * says audio went missing. */
  drops(frameSeconds, factor = 1.8) {
    const limit = frameSeconds * 1000 * factor;
    let count = 0, longest = 0;
    for (let i = 1; i < this.t.length; i++) {
      const gap = this.t[i] - this.t[i - 1];
      if (gap > limit) { count += 1; longest = Math.max(longest, gap); }
    }
    const span = this.t.length ? this.t[this.t.length - 1] / 1000 : 0;
    const lost = Math.max(0, Math.round(span / frameSeconds) + 1 - this.t.length);
    return { count, longestMs: Math.round(longest * 10) / 10, lost };
  }

  toJSON() { return { t_ms: this.t, hz: this.hz, db: this.db }; }
}

/* The microphone, as 16-bit samples at the analysis rate. */
export class AudioTape {
  constructor(sampleRate) { this.sampleRate = sampleRate; this.chunks = []; this.samples = 0; }

  push(block) {
    const out = new Int16Array(block.length);
    for (let i = 0; i < block.length; i++) {
      const v = Math.max(-1, Math.min(1, block[i]));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    this.chunks.push(out);
    this.samples += out.length;
  }

  get seconds() { return this.sampleRate ? this.samples / this.sampleRate : 0; }

  /* A mono 16-bit PCM WAV, as bytes. */
  toWav() { return wavBytes(this.chunks, this.sampleRate); }
}

export function wavBytes(chunks, sampleRate) {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples * 2, true);
  let at = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++, at += 2) view.setInt16(at, chunk[i], true);
  }
  return bytes;
}

/* A short name for the device, for the file name: what a person would call
 * it, guessed from the user agent. iPadOS reports itself as a Mac, so a Mac
 * with a touch screen is an iPad. */
export function deviceName(userAgent = "", touchPoints = 0) {
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return "iPad";
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  return "device";
}

/* "20261003-181502": sortable, and safe in every file system. */
export function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-`
       + `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/* The record itself. `regions` are the tracker's closed regions with the
 * kind each ended as; `trackerStartMs` is when the first frame reached the
 * tracker, on the frame log's clock, so a region's `at_s` can be placed
 * against the frames. */
export function debugRecord({ app, device, settings, session, frameSeconds, log, trackerStartMs,
                              regions, notes, audioFile = null, audioSeconds = 0, at = new Date() }) {
  const r = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
  return {
    kind: "listen-debug", v: DEBUG_VERSION, app, at: at.toISOString(),
    device, settings, session,
    frame_s: frameSeconds,
    tracker_start_ms: trackerStartMs,
    drops: log.drops(frameSeconds),
    frames: log.toJSON(),
    regions: regions.map((g) => ({
      at_s: r(g.atSeconds, 3), seconds: r(g.seconds, 3), median_hz: r(g.medianHz),
      frames: g.frames, blips: g.blips ?? null, kind: g.kind,
      ...(g.note ? { note: g.note } : {}),
    })),
    notes,
    audio: audioFile ? { file: audioFile, seconds: r(audioSeconds, 1) } : null,
  };
}
