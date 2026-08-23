"""Session orchestration and CLI entry point.

Two run modes:

* ``--simulate`` synthesises a player with a configurable intonation error, so
  the whole pipeline can be exercised without a microphone. This is how the
  session logic was verified before any live audio existed.
* live (default) opens the microphone via sounddevice.

    python -m flutetrainer.app --list-temperaments
    python -m flutetrainer.app --exercise scale --tonic D --mode pure --simulate
    python -m flutetrainer.app --exercise interval --tonic D --temperament vallotti
"""

from __future__ import annotations

import argparse
import json
import queue
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .audio.detector import DEFAULT_HOP, DEFAULT_SAMPLE_RATE, PitchDetector
from .audio.segmenter import NoteSegmenter, State
from .core.generator import arpeggio, interval_drill, scale
from .core.pitch import SpelledPitch
from .core.resolver import Exercise, Mode, TargetResolver
from .core.scoring import CLOSE_CENTS, IN_TUNE_CENTS, SessionSummary, analyse_note
from .core.tuning import BAROQUE_415, MODERN_440, ReferencePitch, TemperamentTuning, load_scala

TEMPERAMENT_DIR = Path(__file__).resolve().parent / "data" / "temperaments"
SESSION_DIR = Path.home() / ".flutetrainer" / "sessions"


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------


def needle(cents: float, width: int = 41) -> str:
    """A text intonation needle spanning +/-50 cents."""
    centre = width // 2
    position = int(round(centre + max(-50.0, min(50.0, cents)) / 50.0 * centre))
    cells = ["-"] * width
    cells[centre] = "|"
    cells[max(0, min(width - 1, position))] = "#"
    return "".join(cells)


def band_label(cents: float) -> str:
    magnitude = abs(cents)
    if magnitude <= IN_TUNE_CENTS:
        return "in tune"
    if magnitude <= CLOSE_CENTS:
        return "close"
    return "sharp" if cents > 0 else "flat"


# ---------------------------------------------------------------------------
# Frame sources
# ---------------------------------------------------------------------------


def simulated_frames(target_hz: float, error_cents: float, count: int, rng) -> list[np.ndarray]:
    """Blocks of a flute-like tone at a deliberate offset from the target."""
    hz = target_hz * 2.0 ** (error_cents / 1200.0)
    total = count * DEFAULT_HOP
    t = np.arange(total) / DEFAULT_SAMPLE_RATE
    signal = (
        1.00 * np.sin(2 * np.pi * hz * t)
        + 0.25 * np.sin(2 * np.pi * 2 * hz * t)
        + 0.10 * np.sin(2 * np.pi * 3 * hz * t)
    )
    signal *= np.minimum(1.0, t / 0.03)
    signal += 0.002 * rng.standard_normal(total)
    signal = (0.3 * signal).astype(np.float32)
    return [signal[i : i + DEFAULT_HOP] for i in range(0, total, DEFAULT_HOP)]


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------


def run_simulated(exercise: Exercise, resolver: TargetResolver, error_cents: float) -> SessionSummary:
    rng = np.random.default_rng(12345)
    detector = PitchDetector()
    summary = SessionSummary()

    print(f"\n{exercise.name}  |  {resolver.mode.value} mode  |  "
          f"{resolver.temperament.description}")
    if exercise.drone:
        drone_hz = resolver.temperament.target_hz(exercise.drone)
        print(f"drone: {exercise.drone} at {drone_hz:.2f} Hz")
    print(f"simulating a player {error_cents:+.1f} cents off target\n")

    for note in exercise.notes:
        target = resolver.resolve(note)
        detector.reset()
        seg = NoteSegmenter(
            target_hz=target,
            frame_seconds=detector.frame_seconds,
            required_seconds=0.6 * exercise.duration_seconds(note),
        )
        for block in simulated_frames(target, error_cents, 160, rng):
            frame = detector.process(block)
            if seg.push(frame.hz) is State.DONE:
                break

        result = analyse_note(note.pitch, target, seg.frames_hz, detector.frame_seconds)
        summary.add(result)
        if result is None:
            print(f"  {note.pitch.name:<5} {target:8.2f} Hz   (not played)")
        else:
            print(f"  {note.pitch.name:<5} {target:8.2f} Hz  "
                  f"{needle(result.mean_cents)} {result.mean_cents:+6.1f}c  "
                  f"{band_label(result.mean_cents)}")
    return summary


def run_live(exercise: Exercise, resolver: TargetResolver) -> SessionSummary:
    try:
        import sounddevice as sd
    except Exception as exc:  # pragma: no cover
        print(f"sounddevice unavailable: {exc}", file=sys.stderr)
        raise SystemExit(2)

    detector = PitchDetector()
    summary = SessionSummary()
    blocks: queue.Queue = queue.Queue()

    def callback(indata, _frames, _time, status):  # pragma: no cover
        if status:
            print(status, file=sys.stderr)
        blocks.put(indata[:, 0].copy())

    print(f"\n{exercise.name}  |  {resolver.mode.value} mode  |  "
          f"{resolver.temperament.description}")
    if exercise.drone:
        print(f"drone: {exercise.drone} at "
              f"{resolver.temperament.target_hz(exercise.drone):.2f} Hz "
              "(headphones recommended)")
    print("play each note as it appears; Ctrl-C to stop\n")

    with sd.InputStream(
        samplerate=DEFAULT_SAMPLE_RATE, channels=1, blocksize=DEFAULT_HOP,
        dtype="float32", callback=callback,
    ):
        for note in exercise.notes:
            target = resolver.resolve(note)
            detector.reset()
            seg = NoteSegmenter(
                target_hz=target,
                frame_seconds=detector.frame_seconds,
                required_seconds=0.6 * exercise.duration_seconds(note),
            )
            print(f"  {note.pitch.name:<5} {target:8.2f} Hz  ", end="", flush=True)
            last_drawn = 0.0
            while not seg.complete:
                try:
                    block = blocks.get(timeout=5.0)
                except queue.Empty:
                    print("  (timed out)")
                    break
                frame = detector.process(block)
                seg.push(frame.hz)
                now = time.monotonic()
                if frame.voiced and now - last_drawn > 0.05:
                    cents = 1200.0 * np.log2(frame.hz / target)
                    print(f"\r  {note.pitch.name:<5} {target:8.2f} Hz  "
                          f"{needle(cents)} {cents:+6.1f}c   ", end="", flush=True)
                    last_drawn = now

            result = analyse_note(note.pitch, target, seg.frames_hz, detector.frame_seconds)
            summary.add(result)
            if result is None:
                print("\r" + " " * 80 + f"\r  {note.pitch.name:<5} (not played)")
            else:
                print(f"\r  {note.pitch.name:<5} {target:8.2f} Hz  "
                      f"{needle(result.mean_cents)} {result.mean_cents:+6.1f}c  "
                      f"{band_label(result.mean_cents)}   ")
    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_exercise(args) -> Exercise:
    if args.exercise == "scale":
        return scale(args.tonic, octaves=args.octaves, tempo_bpm=args.tempo)
    if args.exercise == "arpeggio":
        return arpeggio(args.tonic, octaves=args.octaves, tempo_bpm=args.tempo)
    return interval_drill(args.tonic, (0, 2, 4), repeats=2, tempo_bpm=args.tempo)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Baroque flute intonation trainer")
    parser.add_argument("--exercise", choices=("scale", "arpeggio", "interval"), default="scale")
    parser.add_argument("--tonic", default="D")
    parser.add_argument("--octaves", type=int, default=1)
    parser.add_argument("--tempo", type=float, default=60.0)
    parser.add_argument("--mode", choices=("temperament", "pure"), default="temperament")
    parser.add_argument("--temperament", default="vallotti")
    parser.add_argument("--root", default="C", help="root pitch class of the temperament")
    parser.add_argument("--pitch", type=float, default=415.0, help="A4 in Hz")
    parser.add_argument("--simulate", action="store_true")
    parser.add_argument("--error-cents", type=float, default=-12.0)
    parser.add_argument("--list-temperaments", action="store_true")
    parser.add_argument("--no-save", action="store_true")
    args = parser.parse_args(argv)

    if args.list_temperaments:
        for path in sorted(TEMPERAMENT_DIR.glob("*.scl")):
            print(f"  {path.stem:<20} {load_scala(path).description}")
        return 0

    path = TEMPERAMENT_DIR / f"{args.temperament}.scl"
    if not path.exists():
        print(f"unknown temperament {args.temperament!r}; "
              f"try --list-temperaments", file=sys.stderr)
        return 2

    reference = ReferencePitch(SpelledPitch.parse("A4"), args.pitch)
    tuning = TemperamentTuning(load_scala(path), SpelledPitch.parse(f"{args.root}4"), reference)
    resolver = TargetResolver(Mode(args.mode), tuning)
    exercise = build_exercise(args)

    summary = (
        run_simulated(exercise, resolver, args.error_cents)
        if args.simulate
        else run_live(exercise, resolver)
    )

    print(f"\nmean absolute deviation: {summary.mean_absolute_cents:.1f} cents")
    by_class = summary.by_pitch_class()
    if by_class:
        print("by note: " + "  ".join(f"{k} {v:+.1f}" for k, v in by_class.items()))

    if not args.no_save and summary.results:
        SESSION_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        record = summary.to_dict()
        record.update({
            "exercise": exercise.name, "mode": args.mode,
            "temperament": args.temperament, "reference_hz": args.pitch,
        })
        out = SESSION_DIR / f"{stamp}.json"
        out.write_text(json.dumps(record, indent=2), encoding="utf-8")
        print(f"saved {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
