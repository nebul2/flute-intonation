"""Per-note statistics and session aggregation (DESIGN.md section 6)."""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field

from .pitch import SpelledPitch

# Display bands in cents. Defaults only -- configurable.
IN_TUNE_CENTS = 5.0
CLOSE_CENTS = 15.0
SETTLE_CENTS = 10.0

# Which part of a held note is the note. Mirrors docs/core/scoring.js; see the
# comments there for the measurements these came from.
ATTACK_SKIP_SECONDS = 0.060
TAPER_SKIP_SECONDS = 0.100
TAPER_BODY_SECONDS = 0.150
SETTLE_BODY_SECONDS = 0.350
SETTLE_PROBE_SECONDS = 0.150
SCORING_RULE = "settled"


def cents_deviation(detected_hz: float, target_hz: float) -> float:
    """Positive means sharp of target."""
    if detected_hz <= 0.0 or target_hz <= 0.0:
        raise ValueError("frequencies must be positive")
    return 1200.0 * math.log2(detected_hz / target_hz)


def judge_direction(mean_cents: float, in_tune_cents: float = IN_TUNE_CENTS) -> str:
    """'sharp', 'flat' or 'in tune', for comparing against a player's own call.

    Exists for the predict-then-see exercise: the player commits to a judgement
    before seeing the measurement, and the two are scored side by side. The
    boundary is the display band, so the verdict never disagrees with the
    colour the number would have shown.
    """
    if mean_cents > in_tune_cents:
        return "sharp"
    if mean_cents < -in_tune_cents:
        return "flat"
    return "in tune"


def band(mean_cents: float) -> str:
    magnitude = abs(mean_cents)
    if magnitude <= IN_TUNE_CENTS:
        return "in tune"
    if magnitude <= CLOSE_CENTS:
        return "close"
    return "off"


@dataclass(frozen=True)
class NoteResult:
    pitch: SpelledPitch
    target_hz: float
    mean_cents: float
    stdev_cents: float
    settle_seconds: float | None
    frame_count: int

    @property
    def band(self) -> str:
        return band(self.mean_cents)


def post_attack(frames_hz: list[float], frame_seconds: float) -> list[float]:
    """The frames of a note that describe the note rather than its attack.

    At least one frame always survives, so a note barely longer than the skip
    still yields something.
    """
    if frame_seconds <= 0 or not frames_hz:
        return list(frames_hz)
    skip = min(len(frames_hz) - 1, int(round(ATTACK_SKIP_SECONDS / frame_seconds)))
    return list(frames_hz[skip:])


def scored_window(
    frames_hz: list[float], frame_seconds: float
) -> tuple[list[float], float | None]:
    """The part of a held note that is the note: after the attack, before the
    taper, from where the pitch settled.

    ``frames_hz`` must already be post-attack and voiced. Stability is measured
    against the note's own tail rather than a target, so the window is a
    property of the note alone. The returned settle time is None when no
    settled run was found -- a finding, not a failure -- and the whole body is
    returned instead.
    """
    if not frames_hz or frame_seconds <= 0:
        return list(frames_hz), None

    def in_frames(seconds: float) -> int:
        return max(1, int(round(seconds / frame_seconds)))

    seconds = len(frames_hz) * frame_seconds
    body = (
        list(frames_hz[: -in_frames(TAPER_SKIP_SECONDS)])
        if seconds - TAPER_SKIP_SECONDS >= TAPER_BODY_SECONDS
        else list(frames_hz)
    )

    probe = in_frames(SETTLE_PROBE_SECONDS)
    if len(body) * frame_seconds < SETTLE_BODY_SECONDS or len(body) <= probe:
        return body, None

    anchor = statistics.median(body[-probe:])
    i = len(body) - 1
    while i > 0 and abs(cents_deviation(body[i - 1], anchor)) < SETTLE_CENTS:
        i -= 1
    if len(body) - i < probe:
        return body, None
    return body[i:], i * frame_seconds


def analyse_note(
    pitch: SpelledPitch,
    target_hz: float,
    frames_hz: list[float],
    frame_seconds: float,
    skip_attack_seconds: float = ATTACK_SKIP_SECONDS,
) -> NoteResult | None:
    """Reduce a note's voiced frames to statistics, over scored_window().

    The first ``skip_attack_seconds`` are discarded: flute attacks scoop, and
    including them would systematically bias every note flat.
    """
    skip = (
        min(max(len(frames_hz) - 1, 0), int(round(skip_attack_seconds / frame_seconds)))
        if frame_seconds > 0
        else 0
    )
    usable = [hz for hz in frames_hz[skip:] if hz > 0.0]
    if not usable:
        return None

    scored, settle = scored_window(usable, frame_seconds)
    if not scored:
        scored = usable

    deviations = [cents_deviation(hz, target_hz) for hz in scored]
    mean = statistics.fmean(deviations)
    stdev = statistics.pstdev(deviations) if len(deviations) > 1 else 0.0

    return NoteResult(pitch, target_hz, mean, stdev, settle, len(scored))


def sounded_hz(result: NoteResult) -> float:
    """The frequency the player actually produced, reconstructed from the
    measured deviation and the target it was measured against."""
    return result.target_hz * 2.0 ** (result.mean_cents / 1200.0)


def octave_pairs(
    results: list[NoteResult],
) -> list[tuple[NoteResult, NoteResult, float]]:
    """Adjacent-octave pairs of the same spelled pitch class, with the width
    error of each pair in cents (0 = a true 2:1 octave; positive = wide).

    This is the stopper check's arithmetic: the width is computed between the
    *sounded* frequencies, so it is independent of what the targets were and
    of where the flute sat against the tuner -- which is the whole point of
    the exercise.
    """
    pairs = []
    for lower in results:
        for upper in results:
            if (upper.pitch.letter == lower.pitch.letter
                    and upper.pitch.alter == lower.pitch.alter
                    and upper.pitch.octave == lower.pitch.octave + 1):
                width = 1200.0 * math.log2(sounded_hz(upper) / sounded_hz(lower))
                pairs.append((lower, upper, width - 1200.0))
    return pairs


@dataclass
class SessionSummary:
    results: list[NoteResult] = field(default_factory=list)

    def add(self, result: NoteResult | None) -> None:
        if result is not None:
            self.results.append(result)

    @property
    def mean_absolute_cents(self) -> float:
        if not self.results:
            return 0.0
        return statistics.fmean(abs(r.mean_cents) for r in self.results)

    def by_pitch_class(self) -> dict[str, float]:
        """Mean signed deviation grouped by note name.

        This is the pedagogically valuable view: "your F# runs 12 cents sharp".
        """
        buckets: dict[str, list[float]] = {}
        for result in self.results:
            key = f"{result.pitch.letter}{'#' * result.pitch.alter if result.pitch.alter > 0 else 'b' * -result.pitch.alter}"
            buckets.setdefault(key, []).append(result.mean_cents)
        return {k: statistics.fmean(v) for k, v in sorted(buckets.items())}

    def to_dict(self) -> dict:
        return {
            "v": 1,
            "notes": [
                {
                    "pitch": r.pitch.name,
                    "target_hz": round(r.target_hz, 4),
                    "mean_cents": round(r.mean_cents, 2),
                    "stdev_cents": round(r.stdev_cents, 2),
                    "settle_s": None if r.settle_seconds is None else round(r.settle_seconds, 3),
                    "frames": r.frame_count,
                }
                for r in self.results
            ],
            "mean_absolute_cents": round(self.mean_absolute_cents, 2),
            "by_pitch_class": {k: round(v, 2) for k, v in self.by_pitch_class().items()},
        }
