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
from .core.generator import (arpeggio, enharmonic_pair, interval_drill,
                             interval_in_context, scale)
from .core.pitch import SpelledPitch, cents_between
from .core.resolver import Exercise, Mode, TargetResolver
from .core.scoring import (CLOSE_CENTS, IN_TUNE_CENTS, SessionSummary,
                           analyse_note, judge_direction)
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


def choose(prompt: str, options: dict[str, str]) -> str | None:
    """Read a choice, committing the moment the input is unambiguous.

    ``options`` maps typed names to returned values (aliases map several names
    to one value). With a real terminal, keys are read one at a time in cbreak
    mode and the choice is made as soon as the typed prefix matches exactly one
    name -- "c" alone selects "calibration" -- with the rest of the word echoed
    so the player sees what was chosen. Hands holding a flute get one keystroke.

    Esc or Ctrl-D answers None ("no choice"); Ctrl-C propagates as
    KeyboardInterrupt so call sites keep their own stop semantics. When stdin
    is not a terminal (tests, pipes) this falls back to a plain line read with
    the same prefix rule, so scripted sessions behave identically.
    """
    names = list(options)

    def resolve(text: str) -> str | None:
        matches = [n for n in names if n.startswith(text)] if text else []
        return options[matches[0]] if len(matches) == 1 else None

    try:
        import termios  # noqa: PLC0415
        import tty  # noqa: PLC0415
        interactive = sys.stdin.isatty()
    except ImportError:  # pragma: no cover - non-POSIX
        interactive = False

    if not interactive:
        try:
            return resolve(input(prompt).strip().lower())
        except EOFError:
            return None

    print(prompt, end="", flush=True)  # pragma: no cover - needs a real tty
    fd = sys.stdin.fileno()  # pragma: no cover
    saved = termios.tcgetattr(fd)  # pragma: no cover
    buffer = ""  # pragma: no cover
    try:  # pragma: no cover
        tty.setcbreak(fd)
        while True:
            key = sys.stdin.read(1)
            if key in ("\x1b", "\x04"):          # Esc, Ctrl-D: no choice
                print()
                return None
            if key in ("\r", "\n"):
                chosen = resolve(buffer)
                if chosen is not None:
                    matched = next(n for n in names if n.startswith(buffer))
                    print(matched[len(buffer):])
                    return chosen
                continue
            if key in ("\x7f", "\b"):
                if buffer:
                    buffer = buffer[:-1]
                    print("\b \b", end="", flush=True)
                continue
            candidate = buffer + key.lower()
            if not any(n.startswith(candidate) for n in names):
                continue                          # a key that narrows nothing
            buffer = candidate
            print(key, end="", flush=True)
            chosen = resolve(buffer)
            if chosen is not None:
                matched = next(n for n in names if n.startswith(buffer))
                print(matched[len(buffer):])
                return chosen
    finally:  # pragma: no cover
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)


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
             calibrate_seconds: float = 1.5,
             feedback: str = "live") -> SessionSummary:
    try:
        import sounddevice as sd
    except Exception as exc:  # pragma: no cover
        print(f"sounddevice unavailable: {exc}", file=sys.stderr)
        raise SystemExit(2)

    detector = PitchDetector()
    summary = SessionSummary()
    blocks: queue.Queue = queue.Queue()

    # ``feedback`` is the policy the practice research argues over:
    #   live    -- the cents needle moves while you play (the original mode)
    #   after   -- nothing but progress while you play; the reading appears
    #              when the note ends, so you commit by ear first
    #   predict -- like after, but you also call sharp/flat/in tune before the
    #              number is revealed, and the agreement is scored
    judgements: list[bool] = []

    # When an exercise mixes tempered and pure targets for the same written
    # note, say which half is which; tagging every note of an all-pure
    # exercise would be noise.
    mixed_contexts = (
        any(n.context is not None for n in exercise.notes)
        and any(n.context is None for n in exercise.notes)
    )

    def context_tag(note) -> str:
        if not mixed_contexts:
            return ""
        return " pure" if note.context is not None else " temp"

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
            label = note_name(note.pitch, style) + context_tag(note)
            print(f"  {label:<12} {target:8.2f} Hz  ", end="", flush=True)
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
                        if feedback != "live":
                            # No needle: progress toward the required duration
                            # is all the note shows, so the ear does the tuning
                            # and the measurement waits until the note is over.
                            filled = int(20 * min(
                                1.0, seg.elapsed_seconds / seg.required_seconds))
                            body = (f"[{'#' * filled}{'-' * (20 - filled)}] "
                                    f"{seg.elapsed_seconds:4.1f}/"
                                    f"{seg.required_seconds:.1f}s "
                                    f"{frame.rms_db:6.1f} dB")
                        elif frame.voiced:
                            cents = 1200.0 * np.log2(frame.hz / target)
                            body = f"{needle(cents)} {cents:+6.1f}c   "
                        else:
                            # Show the level even when nothing is detected, so a
                            # silent display is distinguishable from a dead mic.
                            body = f"listening...{'':>24}{frame.rms_db:6.1f} dB"
                        print(f"\r  {label:<12} {target:8.2f} Hz  {body}",
                              end="", flush=True)
                        last_drawn = now
            except KeyboardInterrupt:
                interrupted = True

            result = analyse_note(note.pitch, target, seg.frames_hz, detector.frame_seconds)
            summary.add(result)

            called = None
            if feedback == "predict" and result is not None and not interrupted:
                print("\r" + " " * 78, end="")
                try:
                    # "tune" and "in tune" are aliases, so t and i both land
                    # on the same call with a single keystroke.
                    called = choose(f"\r  {label:<12} your call -- "
                                    "[s]harp, [f]lat, [t] in tune? ",
                                    {"sharp": "sharp", "flat": "flat",
                                     "tune": "in tune", "in tune": "in tune"})
                except KeyboardInterrupt:
                    print()
                    interrupted = True

            if result is None:
                print("\r" + " " * 78 + f"\r  {label:<12} (not played)")
            else:
                print(f"\r  {label:<12} {target:8.2f} Hz  "
                      f"{needle(result.mean_cents)} {result.mean_cents:+6.1f}c  "
                      f"{band_label(result.mean_cents)}   ")
                if called is not None:
                    actual = judge_direction(result.mean_cents)
                    agreed = called == actual
                    judgements.append(agreed)
                    print(f"  {'':<12} you said {called} -- "
                          + ("your ear agreed with the measurement"
                             if agreed else f"the measurement says {actual}"))

    if judgements:
        print(f"\njudgement: your ear agreed with the measurement on "
              f"{sum(judgements)} of {len(judgements)} notes")
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
# Practice exercises
# ---------------------------------------------------------------------------

# name -> (description, exercise builder, feedback policy). Builders take the
# tonic and return one Exercise or a sequence of them; every practice session
# runs in PURE mode, whose documented fallback sends context-free notes to the
# temperament -- which is exactly what the interval-in-context pairs rely on.
PRACTICE = {
    "calibration": (
        "long tones -- tonic, fifth, octave over the drone; reading after each note",
        lambda tonic: interval_drill(tonic, (0, 4, 7), repeats=1),
        "after",
    ),
    "intervals": (
        "the centrepiece: the same note twice, tempered then pure over the drone",
        interval_in_context,
        "after",
    ),
    "enharmonic": (
        "D# over B, then Eb over C -- one fingering, two notes, 39 cents apart",
        lambda tonic: enharmonic_pair(),
        "after",
    ),
    "predict": (
        "calibration notes, but you call sharp/flat/in-tune before seeing the number",
        lambda tonic: interval_drill(tonic, (0, 4, 7), repeats=1),
        "predict",
    ),
}


def run_practice(args, tuning: TemperamentTuning) -> SessionSummary | None:
    """Run one practice exercise; returns its summary, or None if aborted."""
    choice = args.practice
    if choice == "list":
        print("\npractice exercises:")
        for name, (description, _, _) in PRACTICE.items():
            print(f"  {name:<12} {description}")
        try:
            choice = choose("\nwhich one? (first letter is enough) ",
                            {name: name for name in PRACTICE})
        except KeyboardInterrupt:
            print()
            return None
        if choice is None:
            return None
    if choice not in PRACTICE:
        print(f"unknown exercise {choice!r}", file=sys.stderr)
        return None

    _, build, feedback = PRACTICE[choice]
    built = build(args.tonic)
    exercises = list(built) if isinstance(built, (list, tuple)) else [built]

    resolver = TargetResolver(Mode.PURE, tuning)
    total = SessionSummary()
    for exercise in exercises:
        # The background calibration exists solely for the drone-unison guard;
        # when no target sits inside the acceptance window of the drone, skip
        # the 1.5 s wait rather than make every segment start with a pause.
        margin = None
        if not args.no_calibrate and not args.no_drone and exercise.drone:
            drone_hz = tuning.target_hz(exercise.drone)
            if any(abs(cents_between(drone_hz, resolver.resolve(n)))
                   <= NoteSegmenter.acceptance_cents for n in exercise.notes):
                margin = args.onset_margin_db
        summary = run_live(
            exercise, resolver, args.device, args.naming, not args.no_drone,
            args.drone_level, margin, feedback=feedback,
        )
        total.results.extend(summary.results)

    # For mixed exercises, the reveal: what the two targets were and how far
    # apart. Printed after playing, so the ear works unaided first.
    for exercise in exercises:
        pairs = [
            (a, b) for a, b in zip(exercise.notes, exercise.notes[1:])
            if a.pitch == b.pitch and a.context is None and b.context is not None
        ]
        for tempered_note, pure_note in pairs:
            tempered = resolver.temperament.target_hz(tempered_note.pitch)
            pure = resolver.resolve(pure_note)
            print(f"\n{note_name(tempered_note.pitch, args.naming)}: "
                  f"tempered {tempered:.2f} Hz, pure {pure:.2f} Hz -- "
                  f"the pure interval sits {cents_between(tempered, pure):+.1f}c away")
    return total


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
    parser.add_argument("--practice", nargs="?", const="list",
                        choices=(*PRACTICE, "list"),
                        help="run a practice exercise; no name lists them")
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
        if args.mode == "pure":
            print("note: the tuner reads against the temperament alone -- a "
                  "pure target needs a bass,\nand a free tuner has none. "
                  "--temperament, --root and --pitch all apply.")
        return run_tuner(tuning, args.naming, args.device)

    if args.practice is not None:
        summary = run_practice(args, tuning)
        if summary is None:
            return 2
        exercise_name = f"practice: {args.practice}"
        mode_name = "pure"
    else:
        resolver = TargetResolver(Mode(args.mode), tuning)
        exercise = build_exercise(args)
        summary = (
            run_simulated(exercise, resolver, args.error_cents, args.naming)
            if args.simulate
            else run_live(exercise, resolver, args.device, args.naming,
                          not args.no_drone, args.drone_level,
                          None if args.no_calibrate else args.onset_margin_db)
        )
        exercise_name = exercise.name
        mode_name = args.mode

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
            "exercise": exercise_name, "mode": mode_name,
            "temperament": args.temperament, "reference_hz": args.pitch,
        })
        out = SESSION_DIR / f"{stamp}.json"
        out.write_text(json.dumps(record, indent=2), encoding="utf-8")
        print(f"saved {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
