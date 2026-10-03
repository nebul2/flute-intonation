"""Known sequences for Listen to me, to play from a third device into several.

make_probe_tones pins down what a *scoring rule* should read on one note.
This is for the free-play page, where the questions are different: which
notes are found at all, what each is named, and whether two devices
listening to the same sound agree. A side-by-side session on the iPad and
the MacBook (2 October 2026) agreed to 0.6 cents on eleven B flats while
finding different notes -- a C at -46 on one only, six B flats on one
against two B flats and three A's on the other. Flute playing cannot say
which device was right. These can: every note is synthesised to a stated
pitch, length and shape, and the answer key says what each should be.

Play the WAV from a phone or laptop speaker placed between the devices,
with every device set to the tuning the files were built in (equal
temperament, A = 415 unless told otherwise). Then compare each device's
Listen session against the key -- and against what the shipped pipeline
reads with no speaker in the way:

    python -m flutetrainer.tools.make_listen_probes
    node docs/tests/wavpipe.js recordings/probes/listen/*.wav

Synthetic tones do not find detector defects (CLAUDE.md); that is not the
job here. The job is a sound that is identical for every device, with a
known answer, so that a disagreement is the devices' and not the flute's.
"""

from __future__ import annotations

import argparse
import json
import math
import wave

import numpy as np

from ..core.pitch import SpelledPitch
from .make_probe_tones import SAMPLE_RATE, PEAK, HARMONICS, TARGET_DIR, tuning, silence

OUT = TARGET_DIR / "listen"

# A traverso's low D: the octave partial is stronger than the fundamental.
# This is the shape that tempts a detector into reading the octave.
WEAK_FUNDAMENTAL = ((1, 0.45), (2, 1.0), (3, 0.35), (4, 0.12))


def tone(hz: float, seconds: float, rng, cents=None, harmonics=HARMONICS) -> np.ndarray:
    """One note: `cents(t)` is its deviation over time (default: dead on)."""
    n = int(seconds * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    dev = np.zeros(n) if cents is None else np.asarray(cents(t), dtype=float)
    phase = 2 * math.pi * np.cumsum(hz * np.power(2.0, dev / 1200.0)) / SAMPLE_RATE
    out = sum(a * np.sin(k * phase) for k, a in harmonics)
    out = out + 0.012 * rng.standard_normal(n)
    attack = np.clip(t / 0.040, 0, 1)
    release = np.clip((seconds - t) / 0.030, 0, 1)
    return (out * attack * release * PEAK / sum(a for _, a in harmonics)).astype(np.float32)


class Sequence:
    """Blocks of sound with an answer key: what starts when, what it is."""

    def __init__(self, tun, rng):
        self.tun, self.rng = tun, rng
        self.blocks = [silence(0.5)]
        self.at = 0.5
        self.key: list[dict] = []

    def hz(self, name: str) -> float:
        return self.tun.target_hz(SpelledPitch.parse(name), None)

    def note(self, name: str, seconds: float, cents: float = 0.0, *, shape=None,
             harmonics=HARMONICS, expect: str = "", section: str = ""):
        dev = shape if shape is not None else (lambda t, c=cents: np.full_like(t, c))
        self.blocks.append(tone(self.hz(name), seconds, self.rng, dev, harmonics))
        self.key.append({"start_s": round(self.at, 2), "seconds": seconds, "note": name,
                         "cents": cents, "section": section, "expect": expect})
        self.at += seconds

    def rest(self, seconds: float):
        self.blocks.append(silence(seconds))
        self.at += seconds

    def write(self, name: str):
        OUT.mkdir(parents=True, exist_ok=True)
        samples = np.concatenate(self.blocks + [silence(0.8)])
        with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
        return len(samples) / SAMPLE_RATE


CHROMATIC = ["D4", "Eb4", "E4", "F4", "F#4", "G4", "G#4", "A4", "Bb4", "B4", "C5", "C#5",
             "D5", "Eb5", "E5", "F5", "F#5", "G5", "G#5", "A5", "Bb5", "B5", "C6", "C#6",
             "D6", "Eb6", "E6", "F6", "F#6", "G6", "G#6", "A6"]


def chromatic(tun, rng) -> tuple[Sequence, str]:
    seq = Sequence(tun, rng)
    for name in CHROMATIC:
        seq.note(name, 1.5, expect="named, ~0", section="ladder")
        seq.rest(0.5)
    return seq, (f"{len(CHROMATIC)} notes, D4 up to A6 chromatically, every one exactly in tune, "
                 "1.5 s each with 0.5 s between. Every device should find all of them, name "
                 "each correctly, and read about 0.")


def traps(tun, rng) -> tuple[Sequence, str]:
    seq = Sequence(tun, rng)
    S = "boundary"
    # Near the line between two names. +45 above A is still nearer A than
    # B flat (55 below it), so the right name is A; a device that says
    # B flat is drawing the line in a different place.
    seq.note("A4", 1.5, 35, expect="A, +35", section=S); seq.rest(0.6)
    seq.note("A4", 1.5, 45, expect="A, +45", section=S); seq.rest(0.6)
    seq.note("Bb4", 1.5, -45, expect="B flat, -45", section=S); seq.rest(0.6)
    seq.note("Bb4", 1.5, -35, expect="B flat, -35", section=S); seq.rest(1.5)

    S = "slurred A / B flat"
    # The passage in which the devices disagreed: a semitone alternation
    # with no gap. Each note 0.4 s -- long enough to score.
    for _ in range(4):
        seq.note("A4", 0.4, expect="A, ~0", section=S)
        seq.note("Bb4", 0.4, expect="B flat, ~0", section=S)
    seq.rest(1.5)

    S = "trill line"
    # Listen to me calls a run of at least four alternations a trill and
    # leaves its notes out of the table when each note is at most 0.6 s and
    # the silences between them at most 80 ms (TRILL_MAX_NOTE_SECONDS,
    # TRILL_MAX_GAP_SECONDS in docs/audio/regions.js). Hard lines: two devices
    # measuring the same passage a frame apart can fall either side. These
    # sit just inside and just outside each one.
    for seconds, expect in ((0.5, "trill (notes left out)"), (0.7, "eight notes, not a trill")):
        for _ in range(4):
            seq.note("A4", seconds, expect=f"A, {expect}", section=f"{S}: {seconds:g} s notes")
            seq.note("Bb4", seconds, expect=f"B flat, {expect}", section=f"{S}: {seconds:g} s notes")
        seq.rest(1.5)
    for gap, expect in ((0.05, "trill (notes left out)"), (0.15, "eight notes, not a trill")):
        for _ in range(4):
            seq.note("A4", 0.4, expect=f"A, {expect}", section=f"{S}: {gap * 1000:g} ms gaps")
            seq.rest(gap)
            seq.note("Bb4", 0.4, expect=f"B flat, {expect}", section=f"{S}: {gap * 1000:g} ms gaps")
            seq.rest(gap)
        seq.rest(1.5)

    S = "short notes"
    # Below 40 ms nothing can be named; below about 100 ms nothing can be
    # scored (memory: short-note-detection-limits). These straddle that.
    for ms in (60, 100, 150, 250, 400):
        seq.note("D5", ms / 1000, expect=f"D5 {ms} ms: found only if long enough", section=S)
        seq.rest(0.35)
    seq.rest(1.2)

    S = "short breath"
    # Two C5s with a 120 ms breath between. Two notes, not one; at 32 ms
    # frames (a 16 kHz device before 8.9.1) these merged.
    seq.note("C5", 1.0, expect="C, ~0 (first)", section=S)
    seq.rest(0.12)
    seq.note("C5", 1.0, expect="C, ~0 (second, separate)", section=S)
    seq.rest(1.5)

    S = "scooped attack"
    # Starts 50 flat and rises to pitch over 0.2 s, then holds: the reading
    # should be the held pitch, not the scoop.
    seq.note("Bb4", 1.8, 0, expect="B flat, ~0 (the scoop ignored)", section=S,
             shape=lambda t: -50 * np.clip(1 - t / 0.2, 0, 1))
    seq.rest(1.5)

    S = "low D, weak fundamental"
    # The octave partial louder than the fundamental, as on a traverso.
    seq.note("D4", 2.5, expect="D4, ~0 -- not D5", section=S, harmonics=WEAK_FUNDAMENTAL)
    seq.rest(0.6)
    seq.note("D4", 2.5, -30, expect="D4, -30 -- not D5", section=S, harmonics=WEAK_FUNDAMENTAL)
    return seq, ("The situations side-by-side sessions disagreed on, each with a known answer: "
                 "notes near a name boundary, a slurred A / B flat alternation, alternations just "
                 "either side of the trill rule's length and gap limits, short notes, two "
                 "notes split by a 120 ms breath, a scooped attack, and a low D whose octave "
                 "partial is louder than its fundamental.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--temperament", default="equal")
    parser.add_argument("--root", default="C")
    parser.add_argument("--reference-hz", type=float, default=415.0)
    args = parser.parse_args()
    tun = tuning(args.temperament, args.root, args.reference_hz)

    lines = ["# Listen-to-me probes: known sequences for comparing devices", "",
             f"Built on **{args.temperament}** (root {args.root}), **A = {args.reference_hz:g} Hz**. "
             "Set every listening device the same way.", "",
             "Play each WAV from a third device placed between the listening devices, at a "
             "moderate level, with a Listen to me session running on each. Then compare each "
             "session against the key below, and against "
             "`node docs/tests/wavpipe.js recordings/probes/listen/*.wav`.", ""]
    report = {}
    for name, build in (("chromatic", chromatic), ("traps", traps)):
        seq, summary = build(tun, np.random.default_rng(20261003))
        seconds = seq.write(name)
        report[name] = seq.key
        lines += [f"## {name}.wav ({seconds:.0f} s)", "", summary, "",
                  "| starts | note | cents | length | expected |", "|---|---|---|---|---|"]
        lines += [f"| {k['start_s']:.2f} s | {k['note']} | {k['cents']:+g} | {k['seconds']:g} s | {k['expect']} |"
                  for k in seq.key]
        lines.append("")
        print(f"  {name}.wav  {seconds:.0f} s, {len(seq.key)} notes")
    (OUT / "README.md").write_text("\n".join(lines), encoding="utf-8")
    (OUT / "key.json").write_text(json.dumps({
        "temperament": args.temperament, "root": args.root, "referenceHz": args.reference_hz,
        "files": report}, indent=2) + "\n", encoding="utf-8")
    print(f"\n{args.temperament}, A = {args.reference_hz:g} Hz -- set the listening devices the same way")
    print(f"Written to {OUT}")


if __name__ == "__main__":
    main()
