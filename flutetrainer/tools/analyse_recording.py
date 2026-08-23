"""Measure what the detector actually does with real recorded audio.

Companion to ``tools/record.py``. Everything in ``audio/`` was validated on
synthesised tones, which have no breath noise, no harmonic irregularity and no
room; this tool re-runs the *real* ``PitchDetector`` over a recording and
reports where its gates and thresholds land.

The central output is gate attribution: of all the frames in a take, how many
were discarded by the silence gate, how many by the confidence threshold, how
many by the range check, and how many survived. A live path that feels dead
usually has one gate eating everything, and this says which.

Two design points worth knowing:

* Raw YIN output, confidence and level are recorded per frame *before* any
  gating, so ``--sweep`` can re-decide every threshold question by arithmetic
  alone, without re-analysing the audio. Threshold choice becomes a table
  lookup rather than a series of guesses.
* A spectral cross-check tests each detected f0 against where the energy
  actually is, so a YIN octave error cannot hide behind itself. Octave errors
  are the failure mode that looks perfectly plausible in isolation.

    python -m flutetrainer.tools.analyse_recording recordings/
    python -m flutetrainer.tools.analyse_recording recordings/fork.wav --expect-hz 440
    python -m flutetrainer.tools.analyse_recording recordings/longtones.wav --trace
    python -m flutetrainer.tools.analyse_recording recordings/breath.wav --sweep
"""

from __future__ import annotations

import argparse
import math
import statistics
import sys
import time
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..audio.detector import (
    DEFAULT_HOP,
    DEFAULT_SAMPLE_RATE,
    DEFAULT_WINDOW,
    MAX_HZ,
    MIN_HZ,
    PitchDetector,
    _rms_db,
    _yin,
)
from ..core.pitch import cents_between

# Frame verdicts, in the order the detector applies them.
VOICED = "voiced"
SILENCE = "silence"        # level below the silence gate
RANGE = "range"            # YIN found nothing inside MIN_HZ..MAX_HZ
CONFIDENCE = "confidence"  # YIN found a pitch, the confidence gate rejected it

VERDICTS = (VOICED, SILENCE, RANGE, CONFIDENCE)

# A run of voiced frames must last at least this long to count as a sustained
# note rather than a blip. 0.20 s is well under the shortest note the exercises
# generate at 60 bpm, so nothing musical is excluded.
MIN_REGION_SECONDS = 0.20

# Matches analyse_note()'s attack skip, so region statistics here mean the same
# thing as the statistics the app will actually score.
ATTACK_SKIP_SECONDS = 0.060

# Beyond this, a frame is not mistuned -- it is a different note. Used to
# separate octave errors from ordinary deviation.
OUTLIER_CENTS = 600.0

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


# ---------------------------------------------------------------------------
# WAV input
# ---------------------------------------------------------------------------


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """Read a WAV to mono float64 in -1..1. Handles 16-, 24- and 32-bit PCM."""
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        raw = handle.readframes(handle.getnframes())

    if width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float64) / float(2**15)
    elif width == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float64) / float(2**31)
    elif width == 3:
        packed = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        ints = (
            packed[:, 0].astype(np.int32)
            | (packed[:, 1].astype(np.int32) << 8)
            | (packed[:, 2].astype(np.int8).astype(np.int32) << 16)
        )
        data = ints.astype(np.float64) / float(2**23)
    else:
        raise ValueError(f"{path.name}: unsupported sample width {width * 8}-bit")

    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, rate


# ---------------------------------------------------------------------------
# Per-frame analysis
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FrameRecord:
    """One analysis frame, recorded before and after gating."""

    index: int
    time_s: float
    hop_db: float       # level over the 512-sample hop -- what the gate uses today
    window_db: float    # level over the 2048-sample analysis window
    raw_hz: float       # YIN output with no confidence gate applied
    confidence: float
    verdict: str
    detector_hz: float  # the detector's actual output, median-smoothed, 0.0 if gated


def analyse_frames(
    samples: np.ndarray,
    sample_rate: int,
    silence_db: float,
    confidence_threshold: float,
    window: int = DEFAULT_WINDOW,
    hop: int = DEFAULT_HOP,
) -> tuple[list[FrameRecord], float, int]:
    """Run the real detector over ``samples``, recording pre-gate values too.

    Returns the records, the mean per-frame processing time in seconds, and a
    count of frames where this module's gate attribution disagreed with the
    detector's own voicing decision (which should always be zero -- a non-zero
    count means the two have drifted apart and the attribution is not
    trustworthy).
    """
    detector = PitchDetector(
        sample_rate=sample_rate, window=window, hop=hop,
        confidence_threshold=confidence_threshold, silence_db=silence_db,
        backend="numpy",
    )

    records: list[FrameRecord] = []
    buffer = np.zeros(window, dtype=np.float32)
    disagreements = 0
    elapsed = 0.0

    usable = samples.size - samples.size % hop
    for index, start in enumerate(range(0, usable, hop)):
        block = samples[start : start + hop].astype(np.float32)

        # Mirror the detector's own ring buffer so the raw values below come
        # from exactly the same audio the detector saw.
        buffer = np.roll(buffer, -hop)
        buffer[-hop:] = block

        hop_db = _rms_db(block)
        window_db = _rms_db(buffer)
        raw_hz, confidence = _yin(buffer, sample_rate)

        # Attribution order follows detector.process(): level first, then YIN's
        # own range rejection, then the confidence gate. The detector tests the
        # last two in a single expression, so splitting them is this module's
        # choice, not an observation about the detector. The level tested is the
        # analysis window's, matching the detector; the disagreement counter
        # returned below exists to catch these two drifting apart again.
        if window_db < silence_db:
            verdict = SILENCE
        elif raw_hz <= 0.0:
            verdict = RANGE
        elif confidence < confidence_threshold:
            verdict = CONFIDENCE
        else:
            verdict = VOICED

        started = time.perf_counter()
        frame = detector.process(block)
        elapsed += time.perf_counter() - started

        if (verdict == VOICED) is not frame.voiced:
            disagreements += 1

        records.append(FrameRecord(
            index=index, time_s=index * hop / sample_rate,
            hop_db=hop_db, window_db=window_db,
            raw_hz=raw_hz, confidence=confidence,
            verdict=verdict, detector_hz=frame.hz,
        ))

    mean_seconds = elapsed / len(records) if records else 0.0
    return records, mean_seconds, disagreements


# ---------------------------------------------------------------------------
# Independent estimator, for cross-checking YIN
# ---------------------------------------------------------------------------


def _peak_near(
    spectrum: np.ndarray, sample_rate: int, size: int, hz: float, radius: int = 2,
) -> float:
    """Largest magnitude within a couple of bins of ``hz``.

    A small neighbourhood rather than a single bin, because a partial rarely
    lands exactly on a bin centre and leakage would otherwise understate it.
    """
    if hz <= 0.0:
        return 0.0
    centre = int(round(hz * size / sample_rate))
    low = max(0, centre - radius)
    high = min(spectrum.size, centre + radius + 1)
    if high <= low:
        return 0.0
    return float(np.max(spectrum[low:high]))


def cross_check(
    samples: np.ndarray, sample_rate: int, records: list[FrameRecord],
    window: int = DEFAULT_WINDOW, hop: int = DEFAULT_HOP,
) -> tuple[int, int, int]:
    """Test each voiced frame's f0 for spectral self-consistency.

    This deliberately does *not* run a second full pitch estimator. The obvious
    candidate, a harmonic product spectrum, is degenerate on a near-pure tone --
    with no harmonics to multiply, its product peaks at a subharmonic and it
    reports a confident octave error on perfectly good audio. A tuning fork is
    very nearly a pure sine, so that estimator would misfire on precisely the
    take whose whole purpose is ground truth.

    Instead, ask the narrower question the cross-check actually exists to
    answer -- is this f0 an octave error? -- by looking at where the energy is:

    * an octave-low error reports f0 where the real fundamental is 2*f0, so the
      reported f0 carries almost no energy while 2*f0 is strong;
    * an octave-high error reports f0 where the real fundamental is f0/2, so
      there is as much or more energy an octave below the reported f0.

    Returns (frames compared, octave-low suspects, octave-high suspects).
    """
    buffer = np.zeros(window, dtype=np.float64)
    taper = np.hanning(window)
    voiced_indices = {r.index: r.raw_hz for r in records if r.verdict == VOICED}

    compared = 0
    octave_low = 0
    octave_high = 0
    usable = samples.size - samples.size % hop

    for index, start in enumerate(range(0, usable, hop)):
        buffer = np.roll(buffer, -hop)
        buffer[-hop:] = samples[start : start + hop]
        f0 = voiced_indices.get(index)
        if f0 is None or f0 <= 0.0:
            continue

        spectrum = np.abs(np.fft.rfft(buffer * taper))
        at_half = _peak_near(spectrum, sample_rate, window, f0 / 2.0)
        at_f0 = _peak_near(spectrum, sample_rate, window, f0)
        at_double = _peak_near(spectrum, sample_rate, window, f0 * 2.0)
        compared += 1

        if at_f0 < 0.1 * at_double:
            octave_low += 1
        elif at_half > at_f0:
            octave_high += 1

    return compared, octave_low, octave_high


# ---------------------------------------------------------------------------
# Derived views
# ---------------------------------------------------------------------------


def nearest_note(hz: float, reference_hz: float) -> tuple[str, float]:
    """Nearest *equal-tempered* note to ``hz``, and the deviation in cents.

    Equal temperament is used deliberately: this is a label to help you read the
    output ("that region is roughly F#5"), not a tuning target. Real targets
    come from the resolver, which is where temperament belongs.
    """
    semitones = 12.0 * math.log2(hz / reference_hz)
    nearest = int(round(semitones))
    cents = 100.0 * (semitones - nearest)
    name = NOTE_NAMES[(nearest + 9) % 12]
    octave = 4 + (nearest + 9) // 12
    return f"{name}{octave}", cents


@dataclass(frozen=True)
class Region:
    """A run of consecutive voiced frames long enough to be a note."""

    start_index: int
    frames: list[float]      # detector_hz, in order
    frame_seconds: float

    @property
    def duration_seconds(self) -> float:
        return len(self.frames) * self.frame_seconds

    @property
    def scored(self) -> list[float]:
        """The frames the app would actually score, after the attack skip."""
        skip = int(round(ATTACK_SKIP_SECONDS / self.frame_seconds))
        return [hz for hz in self.frames[skip:] if hz > 0.0]


def find_regions(records: list[FrameRecord], frame_seconds: float,
                 min_region_seconds: float = MIN_REGION_SECONDS) -> list[Region]:
    """Split the voiced frames into one region per sounded note.

    Splitting on non-voiced frames alone is not enough. Notes played without a
    clear gap between them -- slurred, or simply taken at a normal pace -- run
    together into a single region, and its statistics then describe the
    interval between two notes rather than the steadiness of either. Measured
    on a real long-tone take, merged regions reported standard deviations of
    86 to 247 cents where cleanly separated notes in the same take reported 1
    to 4 cents; the giveaway was maximum excursions of around 200 cents, one
    whole tone.

    So a region also ends where the pitch moves away and stays away. The
    threshold sits well above any intonation drift within a note and well
    below a semitone, and the move must persist, so that a single stray frame
    does not fragment a good note.
    """
    split_cents = 70.0
    confirm_frames = 3

    regions: list[Region] = []
    current: list[float] = []
    start = 0

    def flush() -> None:
        if current:
            regions.append(Region(start, list(current), frame_seconds))

    voiced = [r for r in records if r.verdict == VOICED and r.detector_hz > 0.0]
    for position, record in enumerate(voiced):
        hz = record.detector_hz

        if not current:
            start = record.index
            current.append(hz)
            continue

        # A gap in frame indices means unvoiced frames came between.
        contiguous = record.index == voiced[position - 1].index + 1
        reference = statistics.median(current[-5:])
        moved = abs(cents_between(reference, hz)) > split_cents

        if moved and contiguous:
            following = voiced[position : position + confirm_frames]
            if len(following) == confirm_frames and all(
                abs(cents_between(reference, f.detector_hz)) > split_cents
                for f in following
            ):
                flush()
                current = [hz]
                start = record.index
                continue

        if not contiguous:
            flush()
            current = [hz]
            start = record.index
            continue

        current.append(hz)

    flush()

    minimum = min_region_seconds / frame_seconds
    return [r for r in regions if len(r.frames) >= minimum]


def find_dropouts(
    records: list[FrameRecord], silence_db: float = -50.0,
) -> list[tuple[int, int, str]]:
    """Gaps that break a single sounded note apart.

    Being flanked by voiced frames is *not* sufficient, which an earlier version
    of this function assumed. Every change from one note to the next is also
    flanked by voiced frames, so that definition counted ordinary musical
    silence -- the rests in an arpeggio, the gaps between repeated tongued
    notes -- as detector failures, and reported dozens of them where none
    existed. The pitch must be substantially the same on both sides before a
    gap says anything about fragmentation.

    Nor is matching pitch sufficient on its own: a deliberately repeated note --
    the same G5 tongued eight times -- has identical pitch either side of every
    rest. What separates a defect from music is whether sound was still
    present. If the level stayed above the silence gate and voicing was lost
    anyway, the detector dropped a note that was still sounding; if the level
    collapsed, the player simply stopped.

    Returns (start index, length, dominant verdict).
    """
    same_pitch_cents = 70.0
    edge_frames = 10

    # Split the stream into alternating voiced and unvoiced segments.
    segments: list[tuple[bool, list[FrameRecord]]] = []
    for record in records:
        voiced = record.verdict == VOICED and record.detector_hz > 0.0
        if segments and segments[-1][0] == voiced:
            segments[-1][1].append(record)
        else:
            segments.append((voiced, [record]))

    dropouts: list[tuple[int, int, str]] = []
    for position in range(1, len(segments) - 1):
        voiced, middle = segments[position]
        if voiced:
            continue
        # Segments alternate, so the neighbours here are voiced by construction.
        before = segments[position - 1][1]
        after = segments[position + 1][1]
        hz_before = statistics.median([r.detector_hz for r in before[-edge_frames:]])
        hz_after = statistics.median([r.detector_hz for r in after[:edge_frames]])
        if abs(cents_between(hz_before, hz_after)) > same_pitch_cents:
            continue          # a different note followed: musical, not a defect
        if statistics.median([r.window_db for r in middle]) < silence_db:
            continue          # the sound stopped: a rest, not a dropout
        verdicts = [r.verdict for r in middle]
        dropouts.append((middle[0].index, len(middle),
                         max(set(verdicts), key=verdicts.count)))
    return dropouts


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


def _percentiles(values: list[float] | np.ndarray, points=(10.0, 50.0, 90.0)) -> str:
    if len(values) == 0:
        return "n/a"
    return " / ".join(f"{float(np.percentile(values, p)):.1f}" for p in points)


def report_levels(records: list[FrameRecord], silence_db: float) -> None:
    hop_levels = np.array([r.hop_db for r in records])
    window_levels = np.array([r.window_db for r in records])

    print("  levels (10th/50th/90th percentile, dBFS)")
    print(f"    over the 512-sample hop    {_percentiles(hop_levels)}")
    print(f"    over the 2048-sample window {_percentiles(window_levels)}")

    below_hop = float(np.mean(hop_levels < silence_db))
    below_window = float(np.mean(window_levels < silence_db))
    print(f"    below the {silence_db:.0f} dBFS gate: "
          f"{100.0 * below_hop:.1f}% by hop, {100.0 * below_window:.1f}% by window")

    # How many frames the old hop-based gate would have discarded needlessly.
    # Kept as a running check on the value of gating on the analysis window.
    flipped = int(np.count_nonzero((hop_levels < silence_db) & (window_levels >= silence_db)))
    if flipped:
        print(f"    {flipped} frames ({100.0 * flipped / len(records):.1f}%) would have been "
              f"gated on hop level but are kept on window level")


def report_gates(records: list[FrameRecord]) -> None:
    total = len(records)
    print("  gate attribution")
    for verdict in VERDICTS:
        count = sum(1 for r in records if r.verdict == verdict)
        print(f"    {verdict:<12} {count:6d}  {100.0 * count / total:5.1f}%")


def report_confidence(records: list[FrameRecord], confidence_threshold: float) -> None:
    """Confidence distribution over frames that passed the level gate.

    Gating on confidence is only meaningful where there is signal, so frames the
    silence gate already rejected are excluded -- including them would make the
    threshold look far more permissive than it is.
    """
    audible = [r.confidence for r in records if r.verdict != SILENCE and r.raw_hz > 0.0]
    if not audible:
        print("  confidence: no frames with signal and a pitch candidate")
        return

    print(f"  confidence over {len(audible)} frames with signal "
          f"(10th/50th/90th) {_percentiles(audible)}")
    print("    pass rate by threshold: ", end="")
    values = np.array(audible)
    print("  ".join(
        f"{t:.2f}:{100.0 * float(np.mean(values >= t)):.0f}%"
        for t in (0.50, 0.60, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95)
    ))
    print(f"    current threshold {confidence_threshold:.2f} passes "
          f"{100.0 * float(np.mean(values >= confidence_threshold)):.1f}%")


def report_regions(regions: list[Region], reference_hz: float) -> None:
    if not regions:
        print("  no sustained regions found")
        return

    durations = [r.duration_seconds for r in regions]
    print(f"  {len(regions)} note(s) resolved, shortest {min(durations) * 1000.0:.0f} ms, "
          f"median {statistics.median(durations) * 1000.0:.0f} ms")
    print("  post-attack statistics")
    print("      start    dur   nearest ET note      stdev   max excursion")
    for region in regions:
        scored = region.scored
        if not scored:
            continue
        median = statistics.median(scored)
        name, cents_off = nearest_note(median, reference_hz)
        deviations = [cents_between(median, hz) for hz in scored]
        stdev = statistics.pstdev(deviations) if len(deviations) > 1 else 0.0
        excursion = max(abs(d) for d in deviations)
        print(f"    {region.start_index * region.frame_seconds:6.2f}s "
              f"{region.duration_seconds:5.2f}s  {median:7.2f} Hz  "
              f"{name:<4} {cents_off:+6.1f}c  {stdev:5.1f}c  {excursion:6.1f}c")


def report_outliers(records: list[FrameRecord]) -> None:
    """Frames far from their local neighbourhood -- the octave-error symptom."""
    voiced = [r for r in records if r.verdict == VOICED and r.raw_hz > 0.0]
    if len(voiced) < 11:
        print("  too few voiced frames to look for outliers")
        return

    frequencies = np.array([r.raw_hz for r in voiced])
    half = 12
    octave_down = octave_up = other = 0

    for position in range(len(voiced)):
        low = max(0, position - half)
        high = min(len(voiced), position + half + 1)
        neighbourhood = np.concatenate([
            frequencies[low:position], frequencies[position + 1 : high],
        ])
        if neighbourhood.size < 4:
            continue
        deviation = cents_between(float(np.median(neighbourhood)), frequencies[position])
        if abs(deviation) <= OUTLIER_CENTS:
            continue
        if -1400.0 < deviation < -1000.0:
            octave_down += 1
        elif 1000.0 < deviation < 1400.0:
            octave_up += 1
        else:
            other += 1

    total = len(voiced)
    print(f"  outliers among {total} voiced frames: "
          f"octave-down {octave_down} ({100.0 * octave_down / total:.2f}%), "
          f"octave-up {octave_up} ({100.0 * octave_up / total:.2f}%), "
          f"other {other} ({100.0 * other / total:.2f}%)")


def report_dropouts(
    records: list[FrameRecord], frame_seconds: float, silence_db: float,
) -> None:
    dropouts = find_dropouts(records, silence_db)
    if not dropouts:
        print("  no dropouts inside sustained sound")
        return

    lengths = [length for _, length, _ in dropouts]
    causes: dict[str, int] = {}
    for _, _, cause in dropouts:
        causes[cause] = causes.get(cause, 0) + 1

    print(f"  {len(dropouts)} dropout(s) inside sustained sound; "
          f"lengths in frames (10th/50th/90th) {_percentiles(lengths)}")
    print(f"    longest {max(lengths)} frames "
          f"({max(lengths) * frame_seconds * 1000.0:.0f} ms), caused by: "
          + ", ".join(f"{k} {v}" for k, v in sorted(causes.items())))


def report_timing(mean_seconds: float, frame_seconds: float) -> None:
    budget = 100.0 * mean_seconds / frame_seconds
    verdict = "real-time" if budget < 100.0 else "TOO SLOW -- latency will diverge"
    print(f"  detector cost {mean_seconds * 1000.0:.2f} ms/frame against an "
          f"{frame_seconds * 1000.0:.1f} ms budget ({budget:.1f}%, {verdict})")


def report_trace(
    records: list[FrameRecord], reference_hz: float, frame_seconds: float, rows: int = 48,
) -> None:
    """A coarse time view: one line per bucket, note name or gate verdict."""
    if not records:
        return
    per_row = max(1, len(records) // rows)
    print(f"  trace (one line per {per_row} frames, "
          f"{per_row * frame_seconds * 1000.0:.0f} ms)")

    for start in range(0, len(records), per_row):
        bucket = records[start : start + per_row]
        voiced = [r for r in bucket if r.verdict == VOICED and r.detector_hz > 0.0]
        level = statistics.fmean(r.window_db for r in bucket)
        if voiced:
            median = statistics.median([r.detector_hz for r in voiced])
            name, cents = nearest_note(median, reference_hz)
            label = f"{median:7.2f} Hz  {name:<4} {cents:+6.1f}c"
        else:
            verdicts = [r.verdict for r in bucket]
            label = f"({max(set(verdicts), key=verdicts.count)})"
        share = int(round(10.0 * len(voiced) / len(bucket)))
        print(f"    {bucket[0].time_s:6.2f}s  {level:6.1f} dB  "
              f"[{'#' * share}{'-' * (10 - share)}]  {label}")


def report_sweep(records: list[FrameRecord]) -> None:
    """Re-decide both thresholds from the recorded pre-gate values.

    No audio is re-analysed: raw level, raw pitch and raw confidence are
    independent of the thresholds, so the entire grid is arithmetic over
    values already in hand.
    """
    silence_grid = (-70.0, -65.0, -60.0, -55.0, -50.0, -45.0, -40.0)
    confidence_grid = (0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.85, 0.90)

    print("  sweep: % of frames surviving both gates")
    print("           " + "".join(f"{c:>8.2f}" for c in confidence_grid))
    for silence_db in silence_grid:
        cells = []
        for threshold in confidence_grid:
            survivors = sum(
                1 for r in records
                if r.window_db >= silence_db and r.raw_hz > 0.0 and r.confidence >= threshold
            )
            cells.append(f"{100.0 * survivors / len(records):>7.1f}%")
        print(f"    {silence_db:>5.0f} dB" + "".join(cells))


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def analyse_file(path: Path, args) -> None:
    samples, rate = read_wav(path)
    frame_seconds = args.hop / rate

    print(f"\n{'=' * 74}")
    print(f"{path.name}   {samples.size / rate:.1f}s   {rate} Hz")
    print("=" * 74)

    if samples.size < args.window:
        print("  too short to analyse")
        return

    records, mean_seconds, disagreements = analyse_frames(
        samples, rate, args.silence_db, args.confidence, args.window, args.hop,
    )
    if not records:
        print("  no frames")
        return

    if disagreements:
        print(f"  WARNING gate attribution disagreed with the detector on "
              f"{disagreements} frame(s) -- attribution below is unreliable")

    report_levels(records, args.silence_db)
    report_gates(records)
    report_confidence(records, args.confidence)

    regions = find_regions(records, frame_seconds, args.min_region_ms / 1000.0)
    report_regions(regions, args.reference_hz)
    report_outliers(records)
    report_dropouts(records, frame_seconds, args.silence_db)

    if args.expect_hz is not None:
        voiced = [r.detector_hz for r in records if r.verdict == VOICED and r.detector_hz > 0.0]
        if voiced:
            median = statistics.median(voiced)
            print(f"  ground truth: expected {args.expect_hz:.2f} Hz, "
                  f"detected median {median:.2f} Hz, "
                  f"{cents_between(args.expect_hz, median):+.1f} cents")
        else:
            print(f"  ground truth: expected {args.expect_hz:.2f} Hz but nothing was voiced")

    if not args.no_cross_check:
        compared, octave_low, octave_high = cross_check(
            samples, rate, records, args.window, args.hop,
        )
        if compared:
            print(f"  spectral cross-check on {compared} voiced frames: "
                  f"octave-low suspects {octave_low} "
                  f"({100.0 * octave_low / compared:.2f}%), "
                  f"octave-high suspects {octave_high} "
                  f"({100.0 * octave_high / compared:.2f}%)")
        else:
            print("  spectral cross-check: no voiced frames to compare")

    report_timing(mean_seconds, frame_seconds)

    if args.sweep:
        report_sweep(records)
    if args.trace:
        report_trace(records, args.reference_hz, frame_seconds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Measure detector behaviour on recorded audio",
    )
    parser.add_argument("paths", nargs="+", help="WAV files, or directories of them")
    parser.add_argument("--silence-db", type=float, default=-50.0)
    parser.add_argument("--confidence", type=float, default=0.85)
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW)
    parser.add_argument("--hop", type=int, default=DEFAULT_HOP)
    parser.add_argument("--reference-hz", type=float, default=415.0,
                        help="A4 in Hz, for note labelling only")
    parser.add_argument("--expect-hz", type=float, default=None,
                        help="known frequency, for the tuning-fork take")
    parser.add_argument("--sweep", action="store_true",
                        help="table of survival rates across threshold pairs")
    parser.add_argument("--trace", action="store_true", help="coarse pitch-vs-time view")
    parser.add_argument("--min-region-ms", type=float, default=MIN_REGION_SECONDS * 1000.0,
                        help="shortest run of voiced frames counted as a note "
                             "(default 200 ms; lower it to study fast passages)")
    parser.add_argument("--no-cross-check", action="store_true",
                        help="skip the spectral octave-error check")
    args = parser.parse_args(argv)

    files: list[Path] = []
    for raw in args.paths:
        path = Path(raw)
        if path.is_dir():
            files.extend(sorted(path.glob("*.wav")))
        elif path.exists():
            files.append(path)
        else:
            print(f"no such path: {path}", file=sys.stderr)
            return 2

    if not files:
        print("no WAV files found", file=sys.stderr)
        return 2

    print(f"gates under test: silence {args.silence_db:.0f} dBFS, "
          f"confidence {args.confidence:.2f}, window {args.window}, hop {args.hop}")

    for path in files:
        analyse_file(path, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
