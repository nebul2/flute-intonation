"""Capture reference recordings of real flute playing for offline analysis.

Everything in ``audio/`` has so far been validated only against synthesised
tones, which have no breath noise, no harmonic irregularity and no room. This
tool captures real material once, to a WAV file, so that the detector's gates
and thresholds can be measured repeatedly against fixed audio instead of
against a fresh performance every time. Analysis lives in
``tools/analyse_recording.py``; this module only records.

Capture matches the live path exactly -- 44.1 kHz, mono, 512-sample blocks --
so the block structure on disk is the block structure the detector will see.

    python -m flutetrainer.tools.record --list-devices
    python -m flutetrainer.tools.record --monitor          # set your position
    python -m flutetrainer.tools.record --take longtones
    python -m flutetrainer.tools.record --all

Recording stops early on Ctrl-C and still writes the file, so the durations
below are upper bounds -- play until you are done and interrupt.
"""

from __future__ import annotations

import argparse
import queue
import sys
import time
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# The detector's own level function, imported rather than reimplemented: the
# meter must report exactly the number the silence gate will later compare
# against, and two copies of that formula would eventually drift apart.
from ..audio.detector import DEFAULT_HOP, DEFAULT_SAMPLE_RATE, _rms_db

RECORDING_DIR = Path(__file__).resolve().parents[2] / "recordings"

# Meter range. Chosen to straddle the -50 dBFS silence gate with room on both
# sides: a usable flute take should sit well above it, room tone well below.
METER_FLOOR_DB = -72.0
METER_CEILING_DB = 0.0

# CoreAudio delivers roughly the first 150 ms of a stream as a startup
# transient -- the level ramps down to near-digital-silence and back before
# settling. Discarding it matters most for the silence take, whose whole
# purpose is an honest noise floor; a -175 dBFS artefact would drag the
# estimate far below anything the room actually produces.
WARMUP_SECONDS = 0.25

# Advisory levels for the post-take report. Peaks above the first risk clipping
# on a built-in mic with no gain control; peaks below the second mean the
# player is too far away for the gate work to mean anything.
PEAK_HOT_DB = -3.0
PEAK_QUIET_DB = -30.0


# Outcomes of one scripted take, returned by run_take().
RECORDED = "recorded"
SKIPPED = "skipped"
QUIT = "quit"


@dataclass(frozen=True)
class Take:
    """One scripted recording."""

    name: str
    seconds: float
    instruction: str


# The take list. Each is a separate file so it can be analysed independently:
# mixing breath noise and long tones into one recording would make it
# impossible to attribute a gate failure to either.
TAKES: tuple[Take, ...] = (
    Take(
        "silence", 15.0,
        "Stay still and quiet. Don't shift in your chair, don't breathe\n"
        "  towards the laptop. This measures the room's true noise floor, which\n"
        "  is what the -50 dBFS silence gate should actually be derived from.",
    ),
    Take(
        "breath", 15.0,
        "Blow across the embouchure at your normal playing effort, but angled\n"
        "  so no note speaks. Loud but unpitched -- the adversarial case for a\n"
        "  gate that only looks at level.",
    ),
    Take(
        "fork", 15.0,
        "Sound the tuning fork (or your tuner's reference tone) and hold it\n"
        "  near the mic; re-strike as needed to keep it audible. This is the\n"
        "  only ground truth in the whole set -- a known frequency through your\n"
        "  actual mic and room.",
    ),
    Take(
        "longtones", 180.0,
        "D4 up to A6, about 4 seconds per note, mezzo-forte, as straight a\n"
        "  tone as you can manage. Leave a clear silent gap between notes so\n"
        "  each one segments cleanly. Ctrl-C when you reach the top.",
    ),
    Take(
        "attacks", 45.0,
        "One mid-register note -- G5 is a good choice -- tongued, about two\n"
        "  seconds each, eight or so times with silence between. Attack the way\n"
        "  you would while playing, not carefully.",
    ),
    Take(
        "dynamics", 30.0,
        "One comfortable mid-register note. Start as quietly as it will speak,\n"
        "  swell to as loud as you can, and come back down. One continuous\n"
        "  note -- this is the gate against your real dynamic range.",
    ),
    Take(
        "trills", 60.0,
        "Trills, isolated, with silence between. Play each the baroque way:\n"
        "  start slow and accelerate to as fast as it will go. Four or five of\n"
        "  them, on different notes and at different pitches. An accelerating\n"
        "  trill sweeps the whole range of alternation speeds in one gesture,\n"
        "  which is exactly what the segmenter needs to be tested against.",
    ),
    Take(
        "trillfingering", 45.0,
        "Trills whose fingering changes as they speed up. The written\n"
        "  auxiliary is unplayable fast, so it gives way to its neighbour:\n"
        "  a trill on B starts do-si-do-si and continues do#-si-do#-si, and\n"
        "  one on E turns its fa into fa#. Play each slow, then let it\n"
        "  accelerate until the substitution takes over, several times.",
    ),
    Take(
        "piece", 90.0,
        "A short piece with trills in place -- a prelude, or a few phrases.\n"
        "  Play it as you would perform it, ornaments and all. This is the\n"
        "  realistic case: trills next to slurs, next to plain notes.",
    ),
    Take(
        "arpeggio", 45.0,
        "The D major arpeggio the app generates -- D4 F#4 A4 D5 A4 F#4 D4 --\n"
        "  at roughly 60 bpm, played the way you'd actually practise it.",
    ),
)

TAKES_BY_NAME = {take.name: take for take in TAKES}


# ---------------------------------------------------------------------------
# Level metering
# ---------------------------------------------------------------------------


def _peak_db(block: np.ndarray) -> float:
    peak = float(np.max(np.abs(block))) if block.size else 0.0
    return -120.0 if peak <= 1e-12 else 20.0 * float(np.log10(peak))


def _meter_bar(level_db: float, width: int = 40) -> str:
    """A bar spanning METER_FLOOR_DB..METER_CEILING_DB with the gate marked."""
    span = METER_CEILING_DB - METER_FLOOR_DB
    filled = int(round((level_db - METER_FLOOR_DB) / span * width))
    filled = max(0, min(width, filled))
    gate_at = int(round((-50.0 - METER_FLOOR_DB) / span * width))

    cells = ["#" if i < filled else "-" for i in range(width)]
    if 0 <= gate_at < width and gate_at >= filled:
        cells[gate_at] = ":"          # gate position, visible only when unlit
    return "".join(cells)


def _draw_meter(rms_db: float, peak_db: float, peak_hold_db: float, suffix: str = "") -> None:
    if not sys.stdout.isatty():   # the \r meter is noise in a redirected log
        return
    sys.stdout.write(
        f"\r  rms {rms_db:6.1f}  peak {peak_db:6.1f}  "
        f"[{_meter_bar(rms_db)}]  hold {peak_hold_db:6.1f} dBFS {suffix}   "
    )
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# Capture
# ---------------------------------------------------------------------------


def _open_stream(sd, device: int | str | None, sample_rate: int, blocksize: int, blocks: queue.Queue):
    def callback(indata, _frames, _time, status):  # pragma: no cover - live audio
        if status:
            print(f"\n  [stream status: {status}]", file=sys.stderr)
        blocks.put(indata[:, 0].copy())

    return sd.InputStream(
        device=device, samplerate=sample_rate, channels=1,
        blocksize=blocksize, dtype="float32", callback=callback,
    )


def monitor(sd, device: int | str | None, sample_rate: int, blocksize: int) -> None:
    """Live meter with no recording, for setting playing position."""
    blocks: queue.Queue = queue.Queue()
    peak_hold = -120.0

    print("\nInput monitor -- play or blow and find a position where the peak")
    print(f"sits between {PEAK_QUIET_DB:.0f} and {PEAK_HOT_DB:.0f} dBFS while playing.")
    print("The ':' mark on the bar is the -50 dBFS silence gate.")
    print("Ctrl-C when you're happy with the position.\n")

    try:
        with _open_stream(sd, device, sample_rate, blocksize, blocks):
            while True:
                block = blocks.get()
                peak = _peak_db(block)
                peak_hold = max(peak_hold, peak)
                _draw_meter(_rms_db(block), peak, peak_hold)
    except KeyboardInterrupt:
        print(f"\n\n  peak held at {peak_hold:.1f} dBFS")
        if peak_hold > PEAK_HOT_DB:
            print("  that is hot -- move back, clipping would corrupt the analysis")
        elif peak_hold < PEAK_QUIET_DB:
            print("  that is quiet -- move closer, or the gate work won't transfer")
        else:
            print("  good level; keep this position for every take")


def capture(
    sd,
    device: int | str | None,
    seconds: float,
    sample_rate: int,
    blocksize: int,
) -> np.ndarray:
    """Record up to ``seconds``, returning mono float32. Ctrl-C stops early."""
    blocks: queue.Queue = queue.Queue()
    captured: list[np.ndarray] = []
    wanted = int(round(seconds * sample_rate))
    warmup = int(round(WARMUP_SECONDS * sample_rate))
    peak_hold = -120.0
    collected = 0
    discarded = 0

    try:
        with _open_stream(sd, device, sample_rate, blocksize, blocks):
            while collected < wanted:
                block = blocks.get()
                if discarded < warmup:
                    discarded += block.size
                    _draw_meter(_rms_db(block), _peak_db(block), peak_hold, "warming up")
                    continue
                captured.append(block)
                collected += block.size
                peak = _peak_db(block)
                peak_hold = max(peak_hold, peak)
                remaining = max(0.0, (wanted - collected) / sample_rate)
                _draw_meter(_rms_db(block), peak, peak_hold, f"{remaining:5.1f}s left")
    except KeyboardInterrupt:
        print("\n  stopped early")

    print()
    if not captured:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(captured).astype(np.float32)


# ---------------------------------------------------------------------------
# WAV output
# ---------------------------------------------------------------------------


def write_wav(path: Path, samples: np.ndarray, sample_rate: int) -> int:
    """Write mono 32-bit PCM. Returns the number of clipped samples.

    32-bit rather than 16-bit so the noise floor of the *room* is never
    confused with the noise floor of the *format*: calibrating a silence gate
    against quantisation noise would be measuring the wrong thing entirely.
    """
    clipped = int(np.count_nonzero(np.abs(samples) >= 1.0))
    # float64 throughout: full scale (2**31 - 1) is not representable in
    # float32, so scaling there rounds up to 2**31 and overflows the cast.
    scaled = np.clip(samples.astype(np.float64), -1.0, 1.0) * float(2**31 - 1)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(4)
        handle.setframerate(sample_rate)
        handle.writeframes(np.rint(scaled).astype("<i4").tobytes())
    return clipped


def report(samples: np.ndarray, sample_rate: int, blocksize: int, clipped: int) -> None:
    """Print what was captured, and whether it is usable."""
    if samples.size < blocksize:
        print(f"  only {samples.size} samples captured -- too short to report on")
        return

    hops = samples[: samples.size - samples.size % blocksize].reshape(-1, blocksize)
    levels = np.array([_rms_db(hop) for hop in hops])
    peak = _peak_db(samples)
    floor = float(np.percentile(levels, 10.0))
    loud = float(np.percentile(levels, 90.0))

    print(f"  {samples.size / sample_rate:.1f}s   peak {peak:.1f} dBFS   "
          f"rms 10th/90th pct {floor:.1f} / {loud:.1f} dBFS")
    print(f"  hops below the -50 dBFS gate: "
          f"{100.0 * float(np.mean(levels < -50.0)):.1f}%")

    if clipped:
        print(f"  WARNING {clipped} clipped samples -- move back and re-record")
    elif peak > PEAK_HOT_DB:
        print("  WARNING very hot; move back before the next take")
    elif peak < PEAK_QUIET_DB:
        print("  WARNING quiet; move closer before the next take")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def run_take(sd, take: Take, args) -> str:
    """Prompt for, record and write one take. Returns RECORDED/SKIPPED/QUIT.

    Ctrl-C means "stop whatever is happening now", which depends on where you
    are: at the prompt nothing is under way, so it quits the session; during
    the countdown it abandons the take before any audio exists; during
    recording it ends the take and keeps what was played. That last case is the
    normal way to finish a long take early, so it must never lose audio.
    """
    print(f"\n{'=' * 70}")
    print(f"take: {take.name}   (up to {take.seconds:.0f}s)")
    print(f"  {take.instruction}")
    print("=" * 70)

    try:
        answer = input("  Enter to record, s to skip, q to quit: ").strip().lower()
    except (KeyboardInterrupt, EOFError):
        print()
        return QUIT
    if answer.startswith("q"):
        return QUIT
    if answer.startswith("s"):
        print("  skipped")
        return SKIPPED

    print("  Ctrl-C once you have finished playing to end the take early")
    try:
        for count in (3, 2, 1):
            print(f"  {count}...", end="", flush=True)
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\n  abandoned before recording started, nothing written")
        return SKIPPED
    print(" go")

    samples = capture(sd, args.device, take.seconds, args.rate, args.blocksize)
    if samples.size == 0:
        print("  nothing captured, not writing a file")
        return SKIPPED

    out = Path(args.out) / f"{take.name}.wav"
    clipped = write_wav(out, samples, args.rate)
    report(samples, args.rate, args.blocksize, clipped)
    print(f"  wrote {out}")
    return RECORDED


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Record reference flute audio for detector analysis",
    )
    parser.add_argument("--take", choices=sorted(TAKES_BY_NAME), help="record one take")
    parser.add_argument("--all", action="store_true", help="record every take in order")
    parser.add_argument("--custom", metavar="NAME",
                        help="record a one-off take under this name")
    parser.add_argument("--monitor", action="store_true", help="live meter, no recording")
    parser.add_argument("--list-devices", action="store_true")
    parser.add_argument("--device", default=None,
                        help="input device index or name (default: system default)")
    parser.add_argument("--rate", type=int, default=DEFAULT_SAMPLE_RATE)
    parser.add_argument("--blocksize", type=int, default=DEFAULT_HOP)
    parser.add_argument("--seconds", type=float, default=None,
                        help="override the take's duration")
    parser.add_argument("--out", default=str(RECORDING_DIR))
    args = parser.parse_args(argv)

    try:
        import sounddevice as sd  # noqa: PLC0415
    except Exception as exc:  # pragma: no cover - environment dependent
        print(f"sounddevice unavailable: {exc}", file=sys.stderr)
        return 2

    if args.list_devices:
        print(sd.query_devices())
        return 0

    if args.device is not None and args.device.lstrip("-").isdigit():
        args.device = int(args.device)

    if args.monitor:
        monitor(sd, args.device, args.rate, args.blocksize)
        return 0

    if args.custom:
        takes = [Take(args.custom, args.seconds or 30.0,
                      "Play whatever you meant to record. Ctrl-C when done.")]
    elif args.take:
        takes = [TAKES_BY_NAME[args.take]]
    elif args.all:
        takes = list(TAKES)
    else:
        parser.print_help()
        print("\ntakes:")
        for take in TAKES:
            print(f"  {take.name:<10} {take.seconds:5.0f}s")
        print("\nstart with --monitor to set your position.")
        return 0

    if args.seconds is not None:
        takes = [Take(t.name, args.seconds, t.instruction) for t in takes]

    recorded: list[str] = []
    skipped: list[str] = []
    for index, take in enumerate(takes):
        try:
            outcome = run_take(sd, take, args)
        except KeyboardInterrupt:
            # Anything the takes themselves did not catch: still leave cleanly
            # rather than dumping a traceback over a recording session.
            print()
            outcome = QUIT

        if outcome == QUIT:
            remaining = len(takes) - index
            print(f"\nstopped with {remaining} take(s) not attempted")
            break
        (recorded if outcome == RECORDED else skipped).append(take.name)

    print(f"\nrecorded {len(recorded)} take(s) in {args.out}"
          + (f": {', '.join(recorded)}" if recorded else ""))
    if skipped:
        print(f"skipped: {', '.join(skipped)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
