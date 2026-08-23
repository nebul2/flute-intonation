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


def cents_deviation(detected_hz: float, target_hz: float) -> float:
    """Positive means sharp of target."""
    if detected_hz <= 0.0 or target_hz <= 0.0:
        raise ValueError("frequencies must be positive")
    return 1200.0 * math.log2(detected_hz / target_hz)


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


def analyse_note(
    pitch: SpelledPitch,
    target_hz: float,
    frames_hz: list[float],
    frame_seconds: float,
    skip_attack_seconds: float = 0.060,
) -> NoteResult | None:
    """Reduce a note's voiced frames to statistics.

    The first ``skip_attack_seconds`` are discarded: flute attacks scoop, and
    including them would systematically bias every note flat.
    """
    skip = int(round(skip_attack_seconds / frame_seconds)) if frame_seconds > 0 else 0
    usable = [hz for hz in frames_hz[skip:] if hz > 0.0]
    if not usable:
        return None

    deviations = [cents_deviation(hz, target_hz) for hz in usable]
    mean = statistics.fmean(deviations)
    stdev = statistics.pstdev(deviations) if len(deviations) > 1 else 0.0

    settle: float | None = None
    for i, dev in enumerate(deviations):
        if abs(dev) < SETTLE_CENTS:
            if all(abs(d) < SETTLE_CENTS for d in deviations[i:]):
                settle = i * frame_seconds
                break

    return NoteResult(pitch, target_hz, mean, stdev, settle, len(usable))


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
