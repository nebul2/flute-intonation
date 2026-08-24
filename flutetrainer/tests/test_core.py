"""Golden tests for the core layer (DESIGN.md sections 8 and 12).

Per the equality rule, no frequency, cents value or duration is compared with
``==``; every such assertion states an explicit tolerance.
"""

from __future__ import annotations

import math
from fractions import Fraction
from pathlib import Path

import pytest

from flutetrainer.core.context import HarmonicContext
from flutetrainer.core.generator import arpeggio, interval_drill, scale
from flutetrainer.core.pitch import SpelledPitch, cents_between, interval_between
from flutetrainer.core.resolver import Mode, TargetNote, TargetResolver
from flutetrainer.core.scoring import analyse_note, cents_deviation
from flutetrainer.core.tuning import (
    BAROQUE_415,
    DEFAULT_RATIOS,
    PureIntervalTuning,
    TemperamentTuning,
    load_scala,
    parse_scala,
)

DATA = Path(__file__).resolve().parent.parent / "data" / "temperaments"


def temperament(name: str, root: str = "C", reference=BAROQUE_415) -> TemperamentTuning:
    return TemperamentTuning(
        load_scala(DATA / name), SpelledPitch.parse(f"{root}4"), reference
    )


# ---------------------------------------------------------------------------
# Spelled pitch and intervals
# ---------------------------------------------------------------------------


def test_enharmonics_are_distinct_objects_but_share_pitch_class():
    d_sharp = SpelledPitch.parse("D#4")
    e_flat = SpelledPitch.parse("Eb4")
    assert d_sharp != e_flat
    assert d_sharp.pitch_class == e_flat.pitch_class


@pytest.mark.parametrize(
    "lower,upper,expected",
    [
        ("C4", "E4", "M3"),
        ("C4", "Fb4", "d4"),      # same 4 semitones as M3, different spelling
        ("D4", "F#4", "M3"),
        ("D4", "A4", "P5"),
        ("F4", "A4", "M3"),
        ("B3", "F4", "d5"),
        ("F4", "B4", "A4"),
        ("C4", "C4", "P1"),
        ("A4", "G5", "m7"),
    ],
)
def test_interval_spelling(lower, upper, expected):
    interval = interval_between(SpelledPitch.parse(lower), SpelledPitch.parse(upper))
    assert interval.simple_name == expected


def test_c_to_e_and_c_to_fb_select_different_ratios():
    """The point of spelling: 4 semitones is M3 or d4 depending on notation."""
    major_third = interval_between(SpelledPitch.parse("C4"), SpelledPitch.parse("E4"))
    dim_fourth = interval_between(SpelledPitch.parse("C4"), SpelledPitch.parse("Fb4"))
    assert DEFAULT_RATIOS[major_third.simple_name] != DEFAULT_RATIOS[dim_fourth.simple_name]


def test_compound_and_descending_intervals():
    up = interval_between(SpelledPitch.parse("D4"), SpelledPitch.parse("F#5"))
    assert (up.simple_name, up.octaves) == ("M3", 1)
    down = interval_between(SpelledPitch.parse("D5"), SpelledPitch.parse("F#4"))
    assert (down.simple_name, down.octaves) == ("M3", -1)


# ---------------------------------------------------------------------------
# Scala parsing
# ---------------------------------------------------------------------------


def test_parses_cents_and_ratio_values():
    scl = parse_scala(
        "! test.scl\n!\nmixed values\n 3\n!\n 100.0\n 3/2\n 2/1\n"
    )
    assert scl.note_count == 3
    assert scl.degrees_cents[1] == pytest.approx(100.0, abs=1e-9)
    assert scl.degrees_cents[2] == pytest.approx(701.955, abs=1e-3)
    assert scl.period_cents == pytest.approx(1200.0, abs=1e-9)


def test_rejects_wrong_note_count():
    with pytest.raises(ValueError, match="declares 3"):
        parse_scala("desc\n 3\n 100.0\n 1200.0\n")


def test_rejects_non_ascending_scale():
    with pytest.raises(ValueError, match="ascending"):
        parse_scala("desc\n 3\n 300.0\n 100.0\n 1200.0\n")


def test_rejects_non_twelve_note_temperament():
    scl = parse_scala("desc\n 3\n 100.0\n 700.0\n 1200.0\n")
    with pytest.raises(ValueError, match="12-note"):
        TemperamentTuning(scl, SpelledPitch.parse("C4"), BAROQUE_415)


# ---------------------------------------------------------------------------
# Temperament targets -- golden values
# ---------------------------------------------------------------------------


def test_equal_temperament_places_reference_exactly():
    et = temperament("equal.scl")
    assert et.target_hz(SpelledPitch.parse("A4")) == pytest.approx(415.0, abs=1e-9)
    assert et.target_hz(SpelledPitch.parse("A5")) == pytest.approx(830.0, abs=1e-9)
    assert et.target_hz(SpelledPitch.parse("A3")) == pytest.approx(207.5, abs=1e-9)


def test_equal_temperament_d5_at_415():
    """D5 is 5 equal semitones above A4."""
    et = temperament("equal.scl")
    expected = 415.0 * 2.0 ** (5.0 / 12.0)
    assert et.target_hz(SpelledPitch.parse("D5")) == pytest.approx(expected, abs=1e-6)


def test_reference_placement_is_independent_of_root():
    """Whatever the root, A4 must still sound at 415 Hz."""
    for root in ("C", "D", "F", "A"):
        tuning = temperament("vallotti.scl", root=root)
        assert tuning.target_hz(SpelledPitch.parse("A4")) == pytest.approx(415.0, abs=1e-9)


def test_quarter_comma_meantone_major_third_is_pure():
    """C-E in quarter-comma meantone is exactly 5:4."""
    mt = temperament("meantone_quarter.scl")
    c5 = mt.target_hz(SpelledPitch.parse("C5"))
    e5 = mt.target_hz(SpelledPitch.parse("E5"))
    assert e5 / c5 == pytest.approx(1.25, abs=1e-9)


def test_kirnberger3_major_third_is_pure():
    k3 = temperament("kirnberger3.scl")
    c5 = k3.target_hz(SpelledPitch.parse("C5"))
    e5 = k3.target_hz(SpelledPitch.parse("E5"))
    assert e5 / c5 == pytest.approx(1.25, abs=1e-6)


def test_vallotti_d_major_third_is_narrower_than_pythagorean():
    """Vallotti's F# over D should sit between pure (386.3c) and Pythagorean (407.8c)."""
    v = temperament("vallotti.scl")
    d5 = v.target_hz(SpelledPitch.parse("D5"))
    fs5 = v.target_hz(SpelledPitch.parse("F#5"))
    cents = 1200.0 * math.log2(fs5 / d5)
    assert 386.0 < cents < 408.0
    assert cents == pytest.approx(396.09, abs=0.01)


def test_temperament_collapses_enharmonics_by_design():
    """Documented behaviour, asserted so it cannot regress silently."""
    v = temperament("vallotti.scl")
    a = v.target_hz(SpelledPitch.parse("D#5"))
    b = v.target_hz(SpelledPitch.parse("Eb5"))
    assert a == pytest.approx(b, abs=1e-9)


def test_vallotti_all_twelve_degrees_are_stable():
    """Golden frequencies for Vallotti on C at A4=415, octave 5, to 0.01 Hz."""
    v = temperament("vallotti.scl")
    expected = {
        "C5": 495.1957, "C#5": 522.8672, "D5": 554.5845, "Eb5": 588.2256,
        "E5": 621.0957, "F5": 661.7538, "F#5": 697.1563, "G5": 741.1179,
        "G#5": 784.3009, "A5": 830.0000, "Bb5": 882.3385, "B5": 929.5418,
    }
    for name, hz in expected.items():
        assert v.target_hz(SpelledPitch.parse(name)) == pytest.approx(hz, abs=0.01), name


# ---------------------------------------------------------------------------
# Pure-interval targets
# ---------------------------------------------------------------------------


def test_pure_third_over_drone_is_exactly_five_fourths():
    anchor = temperament("vallotti.scl")
    pure = PureIntervalTuning(anchor=anchor)
    drone = SpelledPitch.parse("D5")
    context = HarmonicContext(bass=drone)
    drone_hz = anchor.target_hz(drone)
    got = pure.target_hz(SpelledPitch.parse("F#5"), context)
    assert got == pytest.approx(drone_hz * 1.25, abs=1e-9)


def test_pure_mode_distinguishes_a_as_third_and_as_fifth():
    """The motivating case: A over F is not the A over D."""
    anchor = temperament("equal.scl")
    pure = PureIntervalTuning(anchor=anchor)
    a_as_third = pure.target_hz(
        SpelledPitch.parse("A5"), HarmonicContext(bass=SpelledPitch.parse("F4"))
    )
    a_as_fifth = pure.target_hz(
        SpelledPitch.parse("A5"), HarmonicContext(bass=SpelledPitch.parse("D4"))
    )
    difference = 1200.0 * math.log2(a_as_third / a_as_fifth)
    # A pure third sits 13.686c below its equal-tempered position; a pure fifth
    # sits 1.955c above. Against equal-tempered bass notes the two readings of A
    # therefore differ by 15.64 cents -- three times the "in tune" band.
    assert difference == pytest.approx(-15.641, abs=0.01)


def test_pure_intervals_deviate_from_equal_by_textbook_amounts():
    anchor = temperament("equal.scl")
    pure = PureIntervalTuning(anchor=anchor)
    bass = SpelledPitch.parse("C4")
    context = HarmonicContext(bass=bass)
    bass_hz = anchor.target_hz(bass)
    for name, equal_semitones, expected_cents in [
        ("E4", 4, -13.686),   # pure major third
        ("G4", 7, 1.955),     # pure fifth
        ("Eb4", 3, 15.641),   # pure minor third
        ("A4", 9, -15.641),   # pure major sixth
    ]:
        got = pure.target_hz(SpelledPitch.parse(name), context)
        equal_hz = bass_hz * 2.0 ** (equal_semitones / 12.0)
        assert 1200.0 * math.log2(got / equal_hz) == pytest.approx(
            expected_cents, abs=0.01
        ), name


def test_pure_interval_requires_context():
    pure = PureIntervalTuning(anchor=temperament("equal.scl"))
    with pytest.raises(ValueError, match="requires harmonic context"):
        pure.target_hz(SpelledPitch.parse("A4"), None)


def test_ratio_table_override():
    anchor = temperament("equal.scl")
    ratios = dict(DEFAULT_RATIOS)
    ratios["M2"] = Fraction(10, 9)
    pure = PureIntervalTuning(anchor=anchor, ratios=ratios)
    context = HarmonicContext(bass=SpelledPitch.parse("C4"))
    bass_hz = anchor.target_hz(SpelledPitch.parse("C4"))
    got = pure.target_hz(SpelledPitch.parse("D4"), context)
    assert got == pytest.approx(bass_hz * 10.0 / 9.0, abs=1e-9)


# ---------------------------------------------------------------------------
# Resolver and the anchoring rule
# ---------------------------------------------------------------------------


def test_resolver_switches_modes():
    v = temperament("vallotti.scl")
    resolver = TargetResolver(Mode.TEMPERAMENT, v)
    note = TargetNote(
        SpelledPitch.parse("F#5"), 2.0, HarmonicContext(bass=SpelledPitch.parse("D5"))
    )
    tempered = resolver.resolve(note)
    resolver.set_mode(Mode.PURE)
    pure = resolver.resolve(note)
    assert tempered != pytest.approx(pure, abs=1e-6)
    # Vallotti's third is wide of pure, so the pure target must be lower.
    assert pure < tempered


def test_pure_mode_without_context_falls_back_to_temperament():
    v = temperament("vallotti.scl")
    resolver = TargetResolver(Mode.PURE, v)
    note = TargetNote(SpelledPitch.parse("F#5"), 2.0, None)
    assert resolver.resolve(note) == pytest.approx(
        v.target_hz(SpelledPitch.parse("F#5")), abs=1e-9
    )


def test_changing_temperament_moves_pure_targets_because_bass_moves():
    """The anchoring rule, asserted (DESIGN.md 3.5)."""
    note = TargetNote(
        SpelledPitch.parse("F#5"), 2.0, HarmonicContext(bass=SpelledPitch.parse("D5"))
    )
    resolver = TargetResolver(Mode.PURE, temperament("equal.scl"))
    with_equal = resolver.resolve(note)
    resolver.set_temperament(temperament("vallotti.scl"))
    with_vallotti = resolver.resolve(note)
    assert with_equal != pytest.approx(with_vallotti, abs=1e-6)
    # But the ratio to its own bass is 5:4 in both cases.
    for tuning in (temperament("equal.scl"), temperament("vallotti.scl")):
        r = TargetResolver(Mode.PURE, tuning)
        bass_hz = tuning.target_hz(SpelledPitch.parse("D5"))
        assert r.resolve(note) == pytest.approx(bass_hz * 1.25, abs=1e-9)


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------


def test_d_major_scale_is_spelled_with_f_sharp_and_c_sharp():
    ex = scale("D", octaves=1, descending=False)
    names = [n.pitch.name for n in ex.notes]
    assert names == ["D4", "E4", "F#4", "G4", "A4", "B4", "C#5", "D5"]


def test_every_generated_note_carries_context():
    ex = scale("D", octaves=1)
    assert all(n.context is not None for n in ex.notes)
    assert all(n.context.bass.name == "D4" for n in ex.notes)


def test_generated_notes_stay_in_flute_range():
    for tonic, key, _ in (("D", "D", ""), ("G", "G", ""), ("A", "A", "")):
        ex = scale(tonic, key, octaves=2)
        for note in ex.notes:
            assert 50 <= note.pitch.chromatic_index <= 81, note.pitch.name


def test_arpeggio_contains_the_third():
    ex = arpeggio("D", octaves=1)
    assert any(n.pitch.name == "F#4" for n in ex.notes)


def test_interval_drill_is_reproducible_with_seed():
    a = interval_drill("D", (0, 2, 4), repeats=3, shuffle=True, seed=7)
    b = interval_drill("D", (0, 2, 4), repeats=3, shuffle=True, seed=7)
    assert [n.pitch.name for n in a.notes] == [n.pitch.name for n in b.notes]


def test_exercise_timing_is_fractional():
    ex = scale("D", tempo_bpm=71.3, beats=1.5)
    assert ex.seconds_per_beat == pytest.approx(60.0 / 71.3, abs=1e-12)
    assert ex.duration_seconds(ex.notes[0]) == pytest.approx(1.5 * 60.0 / 71.3, abs=1e-12)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def test_cents_deviation_sign_and_magnitude():
    assert cents_deviation(440.0, 440.0) == pytest.approx(0.0, abs=1e-12)
    assert cents_deviation(440.0 * 2 ** (10 / 1200), 440.0) == pytest.approx(10.0, abs=1e-9)
    assert cents_deviation(440.0 * 2 ** (-10 / 1200), 440.0) == pytest.approx(-10.0, abs=1e-9)


def test_attack_frames_are_discarded():
    """A scooped attack must not bias the reported mean."""
    target = 415.0
    flat = [target * 2 ** (-40 / 1200)] * 5     # 58 ms of scoop at 11.6 ms/frame
    steady = [target] * 40
    result = analyse_note(
        SpelledPitch.parse("A4"), target, flat + steady, frame_seconds=0.0116
    )
    assert result is not None
    assert result.mean_cents == pytest.approx(0.0, abs=1.0)
    assert result.band == "in tune"


def test_returns_none_when_nothing_was_played():
    assert analyse_note(SpelledPitch.parse("A4"), 415.0, [], 0.0116) is None


# ---------------------------------------------------------------------------
# Practice exercise builders
# ---------------------------------------------------------------------------


def test_interval_in_context_pairs_tempered_with_pure():
    """Each degree yields the same written pitch twice: no context, then the
    drone's context. The pair is the exercise -- the resolver's documented
    pure-mode fallback sends the first to the temperament."""
    from flutetrainer.core.generator import interval_in_context

    exercise = interval_in_context("D")
    assert exercise.drone == SpelledPitch.parse("D4")
    assert len(exercise.notes) == 4
    for tempered, pure in zip(exercise.notes[::2], exercise.notes[1::2]):
        assert tempered.pitch == pure.pitch
        assert tempered.context is None
        assert pure.context is not None
        assert pure.context.bass == exercise.drone
    assert exercise.notes[0].pitch == SpelledPitch.parse("F#4")
    assert exercise.notes[2].pitch == SpelledPitch.parse("B4")


def test_interval_in_context_targets_differ_in_vallotti():
    """The whole point: same written note, two frequencies. The pure third is
    exactly 5/4 over the anchored drone; the tempered one is not."""
    from flutetrainer.core.generator import interval_in_context

    tuning = temperament("vallotti.scl")
    resolver = TargetResolver(Mode.PURE, tuning)
    exercise = interval_in_context("D")
    tempered_fs, pure_fs = exercise.notes[0], exercise.notes[1]

    drone_hz = tuning.target_hz(exercise.drone)
    assert resolver.resolve(pure_fs) == pytest.approx(drone_hz * 5.0 / 4.0, rel=1e-9)
    assert resolver.resolve(tempered_fs) == pytest.approx(
        tuning.target_hz(tempered_fs.pitch), rel=1e-9)

    gap = cents_between(resolver.resolve(tempered_fs), resolver.resolve(pure_fs))
    assert 5.0 < abs(gap) < 30.0, f"gap was {gap:.2f}c"


def test_enharmonic_pair_gives_two_notes_two_targets():
    """D#5 pure over B3 and Eb5 pure over C4 are different frequencies; a
    twelve-note tuner cannot even ask the question."""
    from flutetrainer.core.generator import enharmonic_pair

    tuning = temperament("vallotti.scl")
    resolver = TargetResolver(Mode.PURE, tuning)
    d_sharp, e_flat = enharmonic_pair()

    assert d_sharp.notes[0].pitch == SpelledPitch.parse("D#5")
    assert d_sharp.drone == SpelledPitch.parse("B3")
    assert e_flat.notes[0].pitch == SpelledPitch.parse("Eb5")
    assert e_flat.drone == SpelledPitch.parse("C4")

    hz_sharp = resolver.resolve(d_sharp.notes[0])
    hz_flat = resolver.resolve(e_flat.notes[0])
    assert hz_sharp == pytest.approx(
        tuning.target_hz(d_sharp.drone) * 5.0 / 2.0, rel=1e-9)
    assert hz_flat == pytest.approx(
        tuning.target_hz(e_flat.drone) * 12.0 / 5.0, rel=1e-9)
    assert 5.0 < abs(cents_between(hz_sharp, hz_flat)) < 60.0


def test_judge_direction_matches_the_display_bands():
    from flutetrainer.core.scoring import judge_direction

    assert judge_direction(8.0) == "sharp"
    assert judge_direction(-8.0) == "flat"
    assert judge_direction(3.0) == "in tune"
    assert judge_direction(-4.9) == "in tune"
    assert judge_direction(5.1) == "sharp"


def test_stopper_check_is_the_classical_note_set():
    """Three D's and two G's, no drone, no contexts -- targets exist only so
    the detector knows which note is sounding."""
    from flutetrainer.core.generator import stopper_check

    exercise = stopper_check()
    assert exercise.drone is None
    assert [str(n.pitch) for n in exercise.notes] == ["D4", "D5", "D6", "G4", "G5", "G6"]
    assert all(n.context is None for n in exercise.notes)


def test_octave_pairs_measure_sounded_width_not_targets():
    """The width is between sounded frequencies, so it is unchanged if the
    whole flute sits sharp or flat of the tuner -- the stopper criterion."""
    from flutetrainer.core.scoring import NoteResult, octave_pairs

    def results(offset: float):
        return [
            NoteResult(SpelledPitch.parse("D4"), 277.29, 5.0 + offset, 0.0, None, 1),
            NoteResult(SpelledPitch.parse("D5"), 554.58, -3.0 + offset, 0.0, None, 1),
            NoteResult(SpelledPitch.parse("D6"), 1109.16, 1.0 + offset, 0.0, None, 1),
            NoteResult(SpelledPitch.parse("G4"), 370.00, 0.0 + offset, 0.0, None, 1),
            NoteResult(SpelledPitch.parse("G5"), 740.00, 6.5 + offset, 0.0, None, 1),
        ]

    for offset in (0.0, -30.0, 30.0):     # the flute's absolute seat is irrelevant
        pairs = octave_pairs(results(offset))
        labels = [f"{lo.pitch}->{up.pitch}" for lo, up, _ in pairs]
        assert labels == ["D4->D5", "D5->D6", "G4->G5"]
        widths = [w for _, _, w in pairs]
        assert widths[0] == pytest.approx(-8.0, abs=0.01)   # narrow
        assert widths[1] == pytest.approx(4.0, abs=0.01)    # wide
        assert widths[2] == pytest.approx(6.5, abs=0.01)


def test_octave_pairs_respect_spelling():
    """D#5 is not an octave above D4; enharmonic collapse would fake a pair."""
    from flutetrainer.core.scoring import NoteResult, octave_pairs

    results = [
        NoteResult(SpelledPitch.parse("D4"), 277.29, 0.0, 0.0, None, 1),
        NoteResult(SpelledPitch.parse("D#5"), 587.33, 0.0, 0.0, None, 1),
    ]
    assert octave_pairs(results) == []
