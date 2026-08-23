"""Note naming for display (DESIGN.md section 6).

Presentation only. The model stays a ``SpelledPitch`` throughout -- letter,
alter and octave -- and nothing here feeds back into tuning, so a naming choice
can never change a target frequency.

Solfège here is *fixed do*, the Romance convention: C is always Do regardless
of key, which is how the syllables are used in France and Italy and is implied
by naming the seventh degree "si" rather than "ti". Movable do, where Do is the
tonic of the current key, is a different system and is not offered: it would
make a note's displayed name depend on the exercise's key, which is exactly the
kind of context-dependence the spelled-pitch model exists to avoid.

Octave numbers stay scientific (A4 = the reference A), matching the rest of the
program. The Franco-Belgian convention numbers the same octave differently; the
number shown here is the one the model uses.
"""

from __future__ import annotations

from ..core.pitch import SpelledPitch

SOLFEGE = "solfege"
LETTERS = "letters"
STYLES = (SOLFEGE, LETTERS)

_SYLLABLES = {
    "C": "Do", "D": "Ré", "E": "Mi", "F": "Fa",
    "G": "Sol", "A": "La", "B": "Si",
}

_ACCIDENTALS = {-2: "♭♭", -1: "♭", 0: "", 1: "♯", 2: "♯♯"}


def note_name(pitch: SpelledPitch, style: str = SOLFEGE, octave: bool = True) -> str:
    """Render a pitch for display in the requested style."""
    if style == LETTERS:
        return pitch.name if octave else pitch.name.rstrip("0123456789-")
    if style != SOLFEGE:
        raise ValueError(f"unknown naming style {style!r}; expected one of {STYLES}")

    accidental = _ACCIDENTALS.get(pitch.alter)
    if accidental is None:
        raise ValueError(f"no display accidental for alter {pitch.alter}")
    body = f"{_SYLLABLES[pitch.letter]}{accidental}"
    return f"{body}{pitch.octave}" if octave else body


def pitch_class_name(letter: str, alter: int, style: str = SOLFEGE) -> str:
    """Name a pitch class with no octave, for summary tables."""
    return note_name(SpelledPitch(letter, alter, 4), style, octave=False)
