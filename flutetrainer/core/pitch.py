"""Spelled pitch representation and interval arithmetic.

Pitches are *spelled*, never reduced to MIDI numbers or pitch-class integers.
In meantone and just systems D-sharp and E-flat are different frequencies;
collapsing enharmonics here would poison every target computed downstream.
See DESIGN.md section 3.1.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Diatonic (letter) index and chromatic offset within an octave, C-based.
_LETTERS = "CDEFGAB"
_DIATONIC = {ltr: i for i, ltr in enumerate(_LETTERS)}
_CHROMA = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

# Semitone span of each perfect/major simple interval, indexed by generic size.
_REFERENCE_SEMITONES = {1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11}
_PERFECT_SIZES = {1, 4, 5}

_ALTER_TO_TEXT = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}
_TEXT_TO_ALTER = {
    "": 0, "n": 0,
    "#": 1, "s": 1, "##": 2, "x": 2, "###": 3,
    "b": -1, "f": -1, "bb": -2, "ff": -2,
}

_PITCH_RE = re.compile(r"^([A-Ga-g])([#bsfnx]*)(-?\d+)$")


@dataclass(frozen=True, order=False)
class SpelledPitch:
    """A pitch identified by letter, accidental and scientific octave.

    ``octave`` follows scientific pitch notation, where the octave number
    increments at C. A4 is the conventional reference pitch.
    """

    letter: str
    alter: int
    octave: int

    def __post_init__(self) -> None:
        if self.letter not in _DIATONIC:
            raise ValueError(f"letter must be one of A-G, got {self.letter!r}")
        if not -3 <= self.alter <= 3:
            raise ValueError(f"alter out of supported range: {self.alter}")

    # -- construction ---------------------------------------------------

    @classmethod
    def parse(cls, text: str) -> "SpelledPitch":
        """Parse names like ``'F#5'``, ``'Bb3'``, ``'D4'``, ``'C##4'``."""
        match = _PITCH_RE.match(text.strip())
        if match is None:
            raise ValueError(f"cannot parse pitch name: {text!r}")
        letter, accidental, octave = match.groups()
        key = accidental.lower()
        if key not in _TEXT_TO_ALTER:
            raise ValueError(f"unrecognised accidental in {text!r}")
        return cls(letter.upper(), _TEXT_TO_ALTER[key], int(octave))

    # -- derived properties ---------------------------------------------

    @property
    def diatonic_index(self) -> int:
        """Absolute diatonic step count; contiguous across octaves (C4 -> 28)."""
        return self.octave * 7 + _DIATONIC[self.letter]

    @property
    def chromatic_index(self) -> int:
        """Absolute semitone count from C0, including the accidental."""
        return self.octave * 12 + _CHROMA[self.letter] + self.alter

    @property
    def pitch_class(self) -> int:
        """Chromatic pitch class 0-11. Enharmonics collapse here by design."""
        return self.chromatic_index % 12

    def transpose_octaves(self, n: int) -> "SpelledPitch":
        return SpelledPitch(self.letter, self.alter, self.octave + n)

    @property
    def name(self) -> str:
        return f"{self.letter}{_ALTER_TO_TEXT.get(self.alter, '?')}{self.octave}"

    def __str__(self) -> str:
        return self.name


@dataclass(frozen=True)
class SpelledInterval:
    """A directed interval described by quality and generic size.

    ``generic`` is the simple (octave-reduced) size 1-7, ``octaves`` carries the
    compound part and may be negative for descending intervals. The pure-interval
    tuning selects ratios by ``(quality, generic)``, which is exactly why
    intervals must be spelled rather than counted in semitones.
    """

    quality: str  # 'P', 'M', 'm', 'A', 'd', 'AA', 'dd'
    generic: int  # 1-7
    octaves: int  # 0 for simple ascending intervals

    @property
    def simple_name(self) -> str:
        return f"{self.quality}{self.generic}"

    def __str__(self) -> str:
        if self.octaves:
            return f"{self.simple_name}{self.octaves:+d}oct"
        return self.simple_name


def _quality_from(generic: int, semitones: int) -> str:
    deviation = semitones - _REFERENCE_SEMITONES[generic]
    if generic in _PERFECT_SIZES:
        table = {0: "P", 1: "A", 2: "AA", -1: "d", -2: "dd"}
    else:
        table = {0: "M", -1: "m", 1: "A", 2: "AA", -2: "d", -3: "dd"}
    if deviation not in table:
        raise ValueError(
            f"interval of generic size {generic} spanning {semitones} semitones "
            "is outside the supported quality range"
        )
    return table[deviation]


def interval_between(lower: SpelledPitch, upper: SpelledPitch) -> SpelledInterval:
    """Return the spelled interval from ``lower`` to ``upper``.

    Descending intervals are supported and produce a negative ``octaves``
    component, so a pitch below the bass still resolves to the correct ratio.
    """
    diatonic_delta = upper.diatonic_index - lower.diatonic_index
    semitone_delta = upper.chromatic_index - lower.chromatic_index

    octaves = diatonic_delta // 7
    generic = (diatonic_delta % 7) + 1
    simple_semitones = semitone_delta - 12 * octaves

    return SpelledInterval(_quality_from(generic, simple_semitones), generic, octaves)


def cents_between(lower_hz: float, upper_hz: float) -> float:
    """Cents from ``lower_hz`` to ``upper_hz``. Positive means sharp."""
    import math

    if lower_hz <= 0.0 or upper_hz <= 0.0:
        raise ValueError("frequencies must be positive")
    return 1200.0 * math.log2(upper_hz / lower_hz)
