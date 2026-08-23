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
import contextlib
import json
import queue
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .audio.detector import DEFAULT_HOP, DEFAULT_SAMPLE_RATE, PitchDetector
from .audio.drone import Drone
from .audio.segmenter import NoteSegmenter, State
from .core.generator import arpeggio, interval_drill, scale
from .core.pitch import SpelledPitch, cents_between
from .core.resolver import Exercise, Mode, TargetResolver
from .core.scoring import CLOSE_CENTS, IN_TUNE_CENTS, SessionSummary, analyse_note
from .core.tuning import BAROQUE_415, MODERN_440, ReferencePitch, TemperamentTuning, load_scala
from .ui.naming import LETTERS, SOLFEGE, STYLES, note_name, pitch_class_name

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


# Median level of real flute playing measured at the built-in microphone across
# the reference recordings (-18 to -28 dBFS). Used only to sanity-check a
# calibrated onset threshold, never as a gate itself.
PLAYING_LEVEL_DB = -20.0


# Spellings the tuner offers. In a 12-note temperament the enharmonics are the
# same frequency, so this choice is cosmetic; flats are used where the baroque
# flute's usual keys prefer them.
TUNER_SPELLINGS = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B")


def tuner_candidates(tuning: TemperamentTuning, low: int = 3, high: int = 7):
    """Every named pitch in a range, with the frequency this temperament gives it."""
    return [
        (pitch, tuning.target_hz(pitch))
        for octave in range(low, high + 1)
        for pitch in (SpelledPitch.parse(f"{name}{octave}") for name in TUNER_SPELLINGS)
    ]


def nearest_note(candidates, hz: float):
    """The candidate closest to ``hz``, with the deviation in cents."""
    pitch, target = min(candidates, key=lambda item: abs(cents_between(item[1], hz)))
    return pitch, target, cents_between(target, hz)


def onset_threshold_for(
    target_hz: float, drone_hz: float | None, onset_db: float | None,
    acceptance_cents: float = NoteSegmenter.acceptance_cents,
) -> float | None:
    """The level a note must exceed to open, or None if pitch already suffices.

    The check exists for one situation: a sounding drone whose pitch coincides
    with the expected note, where the segmenter's acceptance window cannot tell
    a played note from bleed. Everywhere else the window already rejects the
    drone, and imposing a level floor there does real harm -- it refuses to
    open a note played more quietly than the drone even though its pitch is
    read correctly, because the measured background includes the bleed.
    """
    if onset_db is None or drone_hz is None:
        return None
    if abs(cents_between(drone_hz, target_hz)) > acceptance_cents:
        return None
    return onset_db


def class_name(key: str, style: str) -> str:
    """Re-render a summary key such as 'F#' or 'Bb' in the chosen style."""
    letter, accidental = key[0], key[1:]
    alter = accidental.count("#") - accidental.count("b")
    return pitch_class_name(letter, alter, style)


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


def run_simulated(exercise: Exercise, resolver: TargetResolver, error_cents: float,
                  style: str = SOLFEGE) -> SessionSummary:
    rng = np.random.default_rng(12345)
    detector = PitchDetector()
    summary = SessionSummary()

    print(f"\n{exercise.name}  |  {resolver.mode.value} mode  |  "
          f"{resolver.temperament.description}")
    if exercise.drone:
        drone_hz = resolver.temperament.target_hz(exercise.drone)
        print(f"drone: {note_name(exercise.drone, style)} at {drone_hz:.2f} Hz")
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
            print(f"  {note_name(note.pitch, style):<7} {target:8.2f} Hz   (not played)")
        else:
            print(f"  {note_name(note.pitch, style):<7} {target:8.2f} Hz  "
                  f"{needle(result.mean_cents)} {result.mean_cents:+6.1f}c  "
                  f"{band_label(result.mean_cents)}")
    return summary


def run_live(exercise: Exercise, resolver: TargetResolver, device=None,
             style: str = SOLFEGE, drone_enabled: bool = True,
             drone_level: float = 0.15, onset_margin_db: float | None = 10.0,
             calibrate_seconds: float = 1.5) -> SessionSummary:
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

    def drain() -> None:
        """Discard queued audio.

        The callback keeps filling the queue while the previous note is being
        scored and printed, so without this each note would begin by consuming
        the tail of the one before it. It also discards CoreAudio's stream
        start-up transient, which is roughly 150 ms of level ramping from the
        room floor down to near-digital-silence and back.
        """
        while True:
            try:
                blocks.get_nowait()
            except queue.Empty:
                return

    print(f"\n{exercise.name}  |  {resolver.mode.value} mode  |  "
          f"{resolver.temperament.description}")
    drone_player = None
    drone_hz = None
    if exercise.drone and drone_enabled:
        drone_hz = resolver.temperament.target_hz(exercise.drone)
        drone_player = Drone(drone_hz, amplitude=drone_level)
        print(f"drone: {note_name(exercise.drone, style)} sounding at {drone_hz:.2f} Hz")
        print("  headphones strongly recommended: through speakers the drone")
        print("  re-enters the microphone, and where the expected note is the")
        print("  drone pitch the trainer can score a note you did not play.")
    elif exercise.drone:
        print(f"drone: {note_name(exercise.drone, style)} at "
              f"{resolver.temperament.target_hz(exercise.drone):.2f} Hz (silenced)")
    print("\nEach note is held until you have sounded it long enough, then it")
    print("advances on its own. Ctrl-C stops and still shows the summary.")
    if onset_margin_db is not None:
        print(f"\nFirst it listens for {calibrate_seconds:.1f}s to measure the background")
        print("(drone bleed included) -- stay quiet and do not play until told.")
    try:
        input("press Enter when you are ready to play... ")
    except (KeyboardInterrupt, EOFError):
        print()
        return summary
    print()

    interrupted = False
    with contextlib.ExitStack() as stack:
        if drone_player is not None:
            stack.enter_context(drone_player)
        stack.enter_context(sd.InputStream(
            device=device, samplerate=DEFAULT_SAMPLE_RATE, channels=1,
            blocksize=DEFAULT_HOP, dtype="float32", callback=callback,
        ))
        # CoreAudio delivers roughly the first 150 ms of a stream as a start-up
        # transient: the level ramps from the room floor down to near-digital
        # silence and back before settling. drain() cannot remove it, because
        # those blocks have not arrived yet when the note loop begins.
        for _ in range(int(0.25 * DEFAULT_SAMPLE_RATE / DEFAULT_HOP)):
            try:
                blocks.get(timeout=1.0)
            except queue.Empty:
                break

        # With the drone already sounding and nobody playing, whatever the
        # microphone hears now is exactly the bleed that must not be mistaken
        # for a played note. Measuring it beats a fixed threshold, which would
        # depend on speaker volume, room and microphone distance -- all of
        # which change between sessions.
        onset_db = None
        if onset_margin_db is not None:
            print(f"  measuring background for {calibrate_seconds:.1f}s...",
                  end="", flush=True)
            levels = []
            for _ in range(int(calibrate_seconds * DEFAULT_SAMPLE_RATE / DEFAULT_HOP)):
                try:
                    levels.append(detector.process(blocks.get(timeout=2.0)).rms_db)
                except queue.Empty:
                    break
            detector.reset()
            if levels:
                background = float(np.percentile(levels, 90.0))
                onset_db = background + onset_margin_db
                print(f" background {background:.1f} dBFS, "
                      f"a note must exceed {onset_db:.1f} dBFS to start")
                # Real flute playing was measured at -18 to -28 dBFS median at
                # this microphone. A threshold near or above that would refuse
                # to open notes the player really did sound, so say so rather
                # than let every note read "(not played)".
                unisons = [
                    note_name(n.pitch, style) for n in exercise.notes
                    if abs(cents_between(drone_hz, resolver.resolve(n)))
                    <= NoteSegmenter.acceptance_cents
                ] if drone_hz is not None else []
                if unisons:
                    print(f"  the level check applies only at the drone's own "
                          f"pitch ({', '.join(sorted(set(unisons)))}); "
                          "other notes are separated by pitch alone")
                if onset_db > PLAYING_LEVEL_DB:
                    print(f"  WARNING that is louder than typical playing "
                          f"({PLAYING_LEVEL_DB:.0f} dBFS). Notes may not register.")
                    print("  Lower --drone-level, turn the speakers down, or use "
                          "headphones.")
                print()
            else:
                print(" no audio; onset level check disabled\n")

        for note in exercise.notes:
            if interrupted:
                break
            target = resolver.resolve(note)
            detector.reset()
            drain()

            seg = NoteSegmenter(
                target_hz=target,
                frame_seconds=detector.frame_seconds,
                required_seconds=0.6 * exercise.duration_seconds(note),
                onset_db=onset_threshold_for(target, drone_hz, onset_db),
            )
            label = note_name(note.pitch, style)
            print(f"  {label:<7} {target:8.2f} Hz  ", end="", flush=True)
            last_drawn = 0.0
            try:
                while not seg.complete:
                    try:
                        block = blocks.get(timeout=5.0)
                    except queue.Empty:
                        print("  (no audio from the input device)")
                        break
                    frame = detector.process(block)
                    seg.push(frame.hz, frame.rms_db)
                    now = time.monotonic()
                    if now - last_drawn > 0.05:
                        if frame.voiced:
                            cents = 1200.0 * np.log2(frame.hz / target)
                            body = f"{needle(cents)} {cents:+6.1f}c   "
                        else:
                            # Show the level even when nothing is detected, so a
                            # silent display is distinguishable from a dead mic.
                            body = f"listening...{'':>24}{frame.rms_db:6.1f} dB"
                        print(f"\r  {label:<7} {target:8.2f} Hz  {body}",
                              end="", flush=True)
                        last_drawn = now
            except KeyboardInterrupt:
                interrupted = True

            result = analyse_note(note.pitch, target, seg.frames_hz, detector.frame_seconds)
            summary.add(result)
            if result is None:
                print("\r" + " " * 78 + f"\r  {label:<7} (not played)")
            else:
                print(f"\r  {label:<7} {target:8.2f} Hz  "
                      f"{needle(result.mean_cents)} {result.mean_cents:+6.1f}c  "
                      f"{band_label(result.mean_cents)}   ")

    if interrupted:
        print("\nstopped early")
    return summary


def run_tuner(tuning: TemperamentTuning, style: str, device=None) -> int:
    """Listen continuously and name whatever is being played.

    No exercise, no targets, no scoring: the note shown is simply the closest
    one this temperament defines, so the reading reflects the chosen
    temperament and reference pitch rather than equal temperament.
    """
    try:
        import sounddevice as sd  # noqa: PLC0415
    except Exception as exc:  # pragma: no cover
        print(f"sounddevice unavailable: {exc}", file=sys.stderr)
        return 2

    detector = PitchDetector()
    candidates = tuner_candidates(tuning)
    blocks: queue.Queue = queue.Queue()

    def callback(indata, _frames, _time, status):  # pragma: no cover
        if status:
            print(status, file=sys.stderr)
        blocks.put(indata[:, 0].copy())

    print(f"\ntuner  |  {tuning.description}  |  "
          f"A4 = {tuning.reference.hz:.1f} Hz")
    print("play anything; Ctrl-C to stop\n")

    last_drawn = 0.0
    with sd.InputStream(
        device=device, samplerate=DEFAULT_SAMPLE_RATE, channels=1,
        blocksize=DEFAULT_HOP, dtype="float32", callback=callback,
    ):
        for _ in range(int(0.25 * DEFAULT_SAMPLE_RATE / DEFAULT_HOP)):
            try:
                blocks.get(timeout=1.0)
            except queue.Empty:
                break
        try:
            while True:
                try:
                    block = blocks.get(timeout=5.0)
                except queue.Empty:
                    print("\n  (no audio from the input device)")
                    break
                frame = detector.process(block)
                now = time.monotonic()
                if now - last_drawn <= 0.05:
                    continue
                last_drawn = now
                if frame.voiced:
                    pitch, target, cents = nearest_note(candidates, frame.hz)
                    print(f"\r  {note_name(pitch, style):<7} "
                          f"{needle(cents)} {cents:+6.1f}c  "
                          f"{band_label(cents):<7} "
                          f"heard {frame.hz:7.2f} Hz  target {target:7.2f} Hz  ",
                          end="", flush=True)
                else:
                    print(f"\r  {'--':<7} {' ' * 41} "
                          f"listening... {frame.rms_db:6.1f} dB{' ' * 22}",
                          end="", flush=True)
        except KeyboardInterrupt:
            pass
    print("\n")
    return 0


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
    parser.add_argument("--device", default=None,
                        help="input device index or name (default: system default)")
    parser.add_argument("--list-devices", action="store_true")
    parser.add_argument("--naming", choices=STYLES, default=SOLFEGE,
                        help="note-name style for display (default: solfege)")
    parser.add_argument("--tuner", action="store_true",
                        help="just listen and name what is played; no exercise")
    parser.add_argument("--no-drone", action="store_true",
                        help="do not sound the drone")
    parser.add_argument("--drone-level", type=float, default=0.15,
                        help="drone amplitude, 0-1 (default 0.15)")
    parser.add_argument("--onset-margin-db", type=float, default=10.0,
                        help="dB above the measured background a note must "
                             "reach to start (default 10)")
    parser.add_argument("--no-calibrate", action="store_true",
                        help="skip background measurement and the onset level check")
    args = parser.parse_args(argv)

    if args.list_devices:
        import sounddevice as sd  # noqa: PLC0415

        print(sd.query_devices())
        return 0

    if args.device is not None and args.device.lstrip("-").isdigit():
        args.device = int(args.device)

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
    if args.tuner:
        return run_tuner(tuning, args.naming, args.device)

    resolver = TargetResolver(Mode(args.mode), tuning)
    exercise = build_exercise(args)

    summary = (
        run_simulated(exercise, resolver, args.error_cents, args.naming)
        if args.simulate
        else run_live(exercise, resolver, args.device, args.naming,
                      not args.no_drone, args.drone_level,
                      None if args.no_calibrate else args.onset_margin_db)
    )

    print(f"\nmean absolute deviation: {summary.mean_absolute_cents:.1f} cents")
    by_class = summary.by_pitch_class()
    if by_class:
        print("by note: " + "  ".join(
            f"{class_name(k, args.naming)} {v:+.1f}" for k, v in by_class.items()))

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
