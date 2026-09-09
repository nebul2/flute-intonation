"""Tones with a known right answer, for checking a reading against the truth.

Real recordings say which scoring rule *moves* a reading and by how much, but
they carry no annotation of what the player meant, so they cannot say which
rule is *right*. These can: each file is synthesised to a stated intonation
shape, so the answer is known before anything is measured.

They are meant to be played out loud, from one device into another -- laptop
speaker into the iPad running the web app -- so the whole path is exercised:
speaker, room, microphone, AGC, detector, segmenter, scoring rule. A reading
that is right here and wrong on the flute is a scoring problem; a reading
wrong here is broken before the flute is involved.

This does not contradict the standing lesson that synthetic tones failed to
reveal detector defects (see CLAUDE.md). That lesson is about *finding*
defects in pitch detection, which needs the mess of real audio. This is the
opposite job: pinning down what the answer should be for a shape a real
recording can only approximate. The two are used together -- recordings to
find where the rules disagree, these to say which one was correct.

    python -m flutetrainer.tools.make_probe_tones
    node docs/tests/wavpipe.js recordings/probes/*.wav      # what the app reads
"""

from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np

from ..core.pitch import SpelledPitch
from ..core.tuning import ReferencePitch, TemperamentTuning, load_scala

ROOT = Path(__file__).resolve().parents[2]
SCALA = ROOT / "flutetrainer" / "data" / "temperaments" / "vallotti.scl"
TARGET_DIR = ROOT / "recordings" / "probes"

SAMPLE_RATE = 44100
REFERENCE_HZ = 415.0
LEAD_SECONDS = 0.35       # silence first, so the segmenter sees an onset
GAP_SECONDS = 0.45        # between notes of a ladder: past the release rule
PEAK = 0.30               # about -10 dBFS; well clear of the silence gate

# A flute is close to a sine with a little second and third. Enough harmonic
# content that YIN locks the way it does on the real instrument, not so much
# that a laptop speaker turns it into a buzz.
HARMONICS = ((1, 1.0), (2, 0.18), (3, 0.06), (4, 0.02))


def tuning() -> TemperamentTuning:
    return TemperamentTuning(
        scale=load_scala(SCALA),
        root=SpelledPitch.parse("C4"),
        reference=ReferencePitch(SpelledPitch.parse("A4"), REFERENCE_HZ),
    )


def tone(target_hz: float, shape, seconds: float, rng: np.random.Generator) -> np.ndarray:
    """One note whose deviation in cents over time is given by `shape(t)`."""
    n = int(seconds * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    cents = np.asarray(shape(t), dtype=float)
    hz = target_hz * np.power(2.0, cents / 1200.0)
    # Integrate the frequency, or a glide would land at the wrong pitch: the
    # phase is what is heard, and it is the integral of frequency, not the
    # frequency itself. Getting this wrong is the classic way a synthesised
    # glide tests something other than what it claims to.
    phase = 2 * math.pi * np.cumsum(hz) / SAMPLE_RATE
    wave_out = sum(a * np.sin(k * phase) for k, a in HARMONICS)
    # Breath: broadband, well below the tone, so the detector has something
    # to reject rather than a mathematically perfect signal.
    wave_out += 0.012 * rng.standard_normal(n)
    # A flute attack is fast but not instant; the release here is deliberately
    # quick so the taper under test is the *pitch* taper, not an amplitude one.
    attack = np.clip(t / 0.040, 0, 1)
    release = np.clip((seconds - t) / 0.030, 0, 1)
    return (wave_out * attack * release * PEAK / sum(a for _, a in HARMONICS)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def ramp(t, hold, glide, start_cents, end_cents):
    """Flat at `start_cents`, then a smooth glide, then flat at `end_cents`."""
    x = np.clip((t - hold) / glide, 0, 1)
    return start_cents + (end_cents - start_cents) * (0.5 - 0.5 * np.cos(math.pi * x))


def write(name: str, blocks, note: str) -> tuple[str, str]:
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    samples = np.concatenate(blocks)
    path = TARGET_DIR / f"{name}.wav"
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return name, note


def main() -> None:
    rng = np.random.default_rng(20260909)
    tun = tuning()
    d5 = tun.target_hz(SpelledPitch.parse("D5"), None)
    made: list[tuple[str, str]] = []

    def probe(name, shape, seconds, note):
        made.append(write(name, [silence(LEAD_SECONDS), tone(d5, shape, seconds, rng),
                                 silence(GAP_SECONDS)], note))

    probe("steady", lambda t: np.zeros_like(t), 2.0,
          "D5 dead on, throughout.  Every rule must read 0 ± a cent or two.")
    probe("sharp20", lambda t: np.full_like(t, 20.0), 2.0,
          "D5 held 20 cents sharp.  Reads +20: a steady note is not 'settled at 0'.")
    probe("corrected", lambda t: ramp(t, 0.6, 0.5, -30.0, 0.0), 2.0,
          "Starts 30 flat, corrected to 0 at 1.1s, held.  The reading under test: "
          "should be ~0, not the ~-11 a whole-note average gives.")
    probe("late-sharp", lambda t: ramp(t, 1.0, 0.4, 0.0, 25.0), 2.0,
          "Starts at 0, pushed to +25 late and held 0.6s.  Should read ~+25.")
    probe("droop", lambda t: ramp(t, 1.4, 0.3, 0.0, -60.0), 1.7,
          "Dead on for 1.4s, then falls away 60 cents as it dies.  Should read ~0: "
          "the fall is letting go, not playing.")
    probe("vibrato", lambda t: 25.0 * np.sin(2 * math.pi * 5.5 * t), 2.2,
          "Centred on 0 with a wide (+/-25 cent) vibrato.  Should read ~0, and read "
          "the same twice: this is the one that catches a rule scoring a fragment.")

    # Every pitch class in turn, all exactly in tune, for the pages that name
    # a note rather than score one. A wrong row here is a naming defect and
    # has nothing to do with which window was scored.
    ladder = [silence(LEAD_SECONDS)]
    names = ["D5", "Eb5", "E5", "F5", "F#5", "G5", "Ab5", "A5", "Bb5", "B5", "C6", "C#6"]
    for name in names:
        hz = tun.target_hz(SpelledPitch.parse(name), None)
        ladder.append(tone(hz, lambda t: np.zeros_like(t), 1.1, rng))
        ladder.append(silence(GAP_SECONDS))
    made.append(write("ladder", ladder,
                      "Twelve notes, " + " ".join(names) + ", each exactly in tune. "
                      "Every one must be named correctly and read ~0."))

    lines = [
        "# Probe tones: readings with a known right answer",
        "",
        f"Generated by `python -m flutetrainer.tools.make_probe_tones`, at A = {REFERENCE_HZ:.0f},",
        "Vallotti on C -- the app's defaults. Regenerate rather than edit; they are",
        "not in git.",
        "",
        "Play one from a laptop speaker into the device running the app, or run",
        "`node docs/tests/wavpipe.js recordings/probes/*.wav` to see what the shipped",
        "pipeline makes of them without a speaker in the way.",
        "",
    ]
    for name, note in made:
        lines += [f"**{name}.wav** — {note}", ""]
    (TARGET_DIR / "README.md").write_text("\n".join(lines), encoding="utf-8")

    for name, note in made:
        print(f"  {name}.wav")
        print(f"      {note}")
    print(f"\nWritten to {TARGET_DIR}")


if __name__ == "__main__":
    main()
