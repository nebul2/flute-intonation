"""The resolver: turns a target note into a frequency under the active mode.

A pure function of its inputs. No caching -- an exercise is tens of notes.
See DESIGN.md section 3.6.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from .context import HarmonicContext
from .pitch import SpelledPitch
from .tuning import PureIntervalTuning, TemperamentTuning


class Mode(Enum):
    TEMPERAMENT = "temperament"
    PURE = "pure"


@dataclass(frozen=True)
class TargetNote:
    """One note of an exercise, carrying its harmonic context by construction."""

    pitch: SpelledPitch
    beats: float = 1.0
    context: HarmonicContext | None = None

    def __post_init__(self) -> None:
        if self.beats <= 0.0:
            raise ValueError("beats must be positive")


@dataclass(frozen=True)
class Exercise:
    name: str
    notes: tuple[TargetNote, ...]
    drone: SpelledPitch | None = None
    tempo_bpm: float = 60.0
    key: str = ""

    def __post_init__(self) -> None:
        if self.tempo_bpm <= 0.0:
            raise ValueError("tempo_bpm must be positive")

    @property
    def seconds_per_beat(self) -> float:
        return 60.0 / self.tempo_bpm

    def duration_seconds(self, note: TargetNote) -> float:
        return note.beats * self.seconds_per_beat


@dataclass
class TargetResolver:
    """Resolves target frequencies under the active mode.

    The temperament serves double duty: it is the target source in
    TEMPERAMENT mode and the *anchor* for the bass in PURE mode, which is what
    lets the two modes compose (DESIGN.md section 3.5).
    """

    mode: Mode
    temperament: TemperamentTuning
    _pure: PureIntervalTuning = field(init=False, repr=False)
    ratios: dict | None = None

    def __post_init__(self) -> None:
        kwargs = {"anchor": self.temperament}
        if self.ratios:
            kwargs["ratios"] = self.ratios
        object.__setattr__(self, "_pure", PureIntervalTuning(**kwargs))

    def resolve(self, note: TargetNote) -> float:
        """Return the target frequency in Hz for ``note``.

        In PURE mode a note without context falls back to the temperament,
        which is why :class:`PureIntervalTuning` may safely reject ``None``.
        """
        if self.mode is Mode.PURE and note.context is not None:
            return self._pure.target_hz(note.pitch, note.context)
        return self.temperament.target_hz(note.pitch, None)

    def set_mode(self, mode: Mode) -> None:
        self.mode = mode

    def set_temperament(self, temperament: TemperamentTuning) -> None:
        """Changing the temperament also moves pure-mode targets, because the
        bass is anchored by it. This is intended."""
        self.temperament = temperament
        object.__setattr__(self, "_pure", PureIntervalTuning(anchor=temperament))
