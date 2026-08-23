"""Tuning systems: the layer that answers "what frequency should this note be?".

Two implementations satisfy the same protocol (DESIGN.md section 3.3):

* :class:`TemperamentTuning` -- a fixed historical temperament loaded from a
  Scala ``.scl`` file. Ignores harmonic context. Enharmonics collapse, which is
  what a 12-note keyboard temperament *is*, not a defect.
* :class:`PureIntervalTuning` -- pure ratios above a sounding bass. Requires
  harmonic context. Distinguishes enharmonics.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Protocol, runtime_checkable

from .context import HarmonicContext
from .pitch import SpelledPitch, interval_between

# --------------------------------------------------------------------------
# Reference pitch
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ReferencePitch:
    """Anchors the whole system to a concert pitch, e.g. A4 = 415 Hz."""

    pitch: SpelledPitch
    hz: float

    def __post_init__(self) -> None:
        if self.hz <= 0.0:
            raise ValueError("reference frequency must be positive")


BAROQUE_415 = ReferencePitch(SpelledPitch.parse("A4"), 415.0)
MODERN_440 = ReferencePitch(SpelledPitch.parse("A4"), 440.0)


# --------------------------------------------------------------------------
# Scala .scl parsing
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ScalaScale:
    """A parsed Scala scale.

    ``degrees_cents`` includes the implicit 1/1 at index 0 and the period as the
    final entry, so a 12-note scale yields 13 values ending at (normally) 1200.
    """

    description: str
    degrees_cents: tuple[float, ...]

    @property
    def note_count(self) -> int:
        return len(self.degrees_cents) - 1

    @property
    def period_cents(self) -> float:
        return self.degrees_cents[-1]


def _parse_scala_value(token: str) -> float:
    """A value containing '.' is cents; otherwise it is a ratio or integer."""
    token = token.split()[0]  # trailing comments on the value line are allowed
    if "." in token:
        return float(token)
    if "/" in token:
        ratio = Fraction(token)
        if ratio <= 0:
            raise ValueError(f"non-positive ratio in scale: {token!r}")
        return 1200.0 * math.log2(float(ratio))
    value = int(token)
    if value <= 0:
        raise ValueError(f"non-positive ratio in scale: {token!r}")
    return 1200.0 * math.log2(float(value))


def parse_scala(text: str) -> ScalaScale:
    """Parse Scala ``.scl`` content.

    Full-line comments start with ``!``. The first non-comment line is the
    description, the second is the note count, and the remaining lines are the
    pitch values -- the last of which is the period, not a note.
    """
    lines = [ln for ln in text.splitlines() if not ln.lstrip().startswith("!")]
    if len(lines) < 2:
        raise ValueError("scala file too short: missing description or note count")

    description = lines[0].strip()
    try:
        declared = int(lines[1].strip().split()[0])
    except (ValueError, IndexError) as exc:
        raise ValueError(f"invalid note count line: {lines[1]!r}") from exc

    values: list[float] = []
    for line in lines[2:]:
        stripped = line.strip()
        if not stripped:
            continue
        values.append(_parse_scala_value(stripped))

    if len(values) != declared:
        raise ValueError(
            f"scale declares {declared} notes but {len(values)} pitch values follow"
        )
    if not values:
        raise ValueError("scale contains no pitch values")
    if any(b <= a for a, b in zip(values, values[1:])):
        raise ValueError("scale pitch values must be strictly ascending")

    return ScalaScale(description, (0.0, *values))


def load_scala(path: str | Path) -> ScalaScale:
    return parse_scala(Path(path).read_text(encoding="utf-8", errors="replace"))


# --------------------------------------------------------------------------
# Tuning protocol
# --------------------------------------------------------------------------


@runtime_checkable
class TuningSystem(Protocol):
    def target_hz(
        self, pitch: SpelledPitch, context: HarmonicContext | None
    ) -> float: ...


# --------------------------------------------------------------------------
# Temperament tuning
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class TemperamentTuning:
    """A fixed temperament rooted on a pitch class, anchored to a reference.

    v1 requires a 12-note scale. The parser itself does not assume 12, so
    non-standard scales can be supported later without touching it.
    """

    scale: ScalaScale
    root: SpelledPitch  # only the pitch class is used
    reference: ReferencePitch
    _root_hz_octave0: float = field(init=False, repr=False, default=0.0)

    def __post_init__(self) -> None:
        if self.scale.note_count != 12:
            raise ValueError(
                f"v1 supports 12-note temperaments only; "
                f"{self.scale.description!r} declares {self.scale.note_count}"
            )
        if abs(self.scale.period_cents - 1200.0) > 1e-6:
            raise ValueError("v1 supports octave-repeating temperaments only")
        # Solve for the frequency the root would have in octave 0, such that the
        # reference pitch lands exactly on its stated frequency.
        offset = self._cents_above_root(self.reference.pitch)
        object.__setattr__(
            self,
            "_root_hz_octave0",
            self.reference.hz / (2.0 ** (offset / 1200.0)),
        )

    def _cents_above_root(self, pitch: SpelledPitch) -> float:
        steps = pitch.chromatic_index - (self.root.pitch_class)
        octaves, degree = divmod(steps, 12)
        return self.scale.degrees_cents[degree] + 1200.0 * octaves

    def target_hz(
        self, pitch: SpelledPitch, context: HarmonicContext | None = None
    ) -> float:
        """Context is accepted and ignored: a temperament is context-free."""
        return self._root_hz_octave0 * 2.0 ** (self._cents_above_root(pitch) / 1200.0)

    @property
    def description(self) -> str:
        return f"{self.scale.description} on {self.root.letter}"


# --------------------------------------------------------------------------
# Pure-interval tuning
# --------------------------------------------------------------------------

#: Ratios keyed by simple spelled interval. Ambiguous entries (M2, m7) are the
#: documented v1 defaults and are overridable via configuration -- see
#: DESIGN.md section 3.3.
DEFAULT_RATIOS: dict[str, Fraction] = {
    "P1": Fraction(1, 1),
    "m2": Fraction(16, 15),
    "M2": Fraction(9, 8),      # alternative: 10/9
    "m3": Fraction(6, 5),
    "M3": Fraction(5, 4),
    "P4": Fraction(4, 3),
    "A4": Fraction(45, 32),
    "d5": Fraction(64, 45),
    "P5": Fraction(3, 2),
    "m6": Fraction(8, 5),
    "M6": Fraction(5, 3),
    "m7": Fraction(9, 5),      # alternatives: 16/9, 7/4
    "M7": Fraction(15, 8),
    "A1": Fraction(25, 24),
    "d4": Fraction(32, 25),
    "A5": Fraction(25, 16),
    "d7": Fraction(128, 75),
    "A2": Fraction(75, 64),
    "d3": Fraction(256, 225),
}

RatioTable = dict[str, Fraction]


@dataclass(frozen=True)
class PureIntervalTuning:
    """Pure ratios above a bass whose own frequency comes from ``anchor``.

    The anchoring rule (DESIGN.md section 3.5) is deliberate: the bass is placed
    by the selected temperament, so the two modes compose rather than conflict.
    Changing temperament therefore also moves pure-mode targets, because the
    bass moves. That is musically correct.
    """

    anchor: TuningSystem
    ratios: RatioTable = field(default_factory=lambda: dict(DEFAULT_RATIOS))

    def target_hz(self, pitch: SpelledPitch, context: HarmonicContext | None) -> float:
        if context is None:
            raise ValueError(
                "pure-interval tuning requires harmonic context; "
                "the resolver should fall back to the temperament instead"
            )
        interval = interval_between(context.bass, pitch)
        try:
            ratio = self.ratios[interval.simple_name]
        except KeyError as exc:
            raise ValueError(
                f"no pure ratio defined for interval {interval.simple_name} "
                f"({context.bass} -> {pitch})"
            ) from exc
        bass_hz = self.anchor.target_hz(context.bass, None)
        return bass_hz * float(ratio) * (2.0 ** interval.octaves)
