"""Display-layer tests: note naming (DESIGN.md section 6).

Naming is presentation only. These tests also pin the layering rule: a naming
choice must never reach the tuning engine.
"""

from __future__ import annotations

import pytest

from flutetrainer.core.pitch import SpelledPitch
from flutetrainer.ui.naming import (
    LETTERS,
    SOLFEGE,
    note_name,
    pitch_class_name,
)


@pytest.mark.parametrize(
    "text,expected",
    [
        ("C4", "Do4"), ("D4", "Ré4"), ("E4", "Mi4"), ("F4", "Fa4"),
        ("G4", "Sol4"), ("A4", "La4"), ("B4", "Si4"),
    ],
)
def test_fixed_do_maps_every_natural_degree(text, expected):
    assert note_name(SpelledPitch.parse(text), SOLFEGE) == expected


@pytest.mark.parametrize(
    "text,expected",
    [("F#4", "Fa♯4"), ("Bb3", "Si♭3"), ("Eb5", "Mi♭5"),
     ("C##4", "Do♯♯4"), ("Abb4", "La♭♭4")],
)
def test_accidentals_render(text, expected):
    assert note_name(SpelledPitch.parse(text), SOLFEGE) == expected


def test_solfege_is_fixed_do_not_movable():
    """Do is C in every key; the name cannot depend on musical context.

    Movable do would make a pitch's displayed name change with the exercise's
    key, reintroducing exactly the context-dependence the spelled-pitch model
    exists to avoid.
    """
    d_major_tonic = SpelledPitch.parse("D4")
    g_major_tonic = SpelledPitch.parse("G4")
    assert note_name(d_major_tonic, SOLFEGE) == "Ré4"
    assert note_name(g_major_tonic, SOLFEGE) == "Sol4"


def test_letters_style_matches_the_model_spelling():
    for text in ("C4", "F#5", "Bb3", "Eb5"):
        pitch = SpelledPitch.parse(text)
        assert note_name(pitch, LETTERS) == pitch.name


def test_octave_can_be_suppressed_for_summary_tables():
    assert note_name(SpelledPitch.parse("F#5"), SOLFEGE, octave=False) == "Fa♯"
    assert note_name(SpelledPitch.parse("F#5"), LETTERS, octave=False) == "F#"
    assert pitch_class_name("B", -1, SOLFEGE) == "Si♭"


def test_unknown_style_is_rejected():
    with pytest.raises(ValueError, match="unknown naming style"):
        note_name(SpelledPitch.parse("C4"), "movable-do")
