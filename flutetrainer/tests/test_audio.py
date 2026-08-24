"""Audio-layer tests that need no microphone (DESIGN.md section 8).

Synthesised tones are fed through the detector and segmenter, and the recovered
pitch is asserted to within +/-2 cents. Passing this suite is the gate before
any live-microphone work begins.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from flutetrainer.audio.detector import PitchDetector
from flutetrainer.audio.segmenter import NoteSegmenter, State
from flutetrainer.core.pitch import cents_between

SR = 44100
HOP = 512

# Only the default backend is held to the +/-2 cent gate. aubio's measured
# deviation is documented by its own test below rather than left to chat.
BACKENDS = ["numpy"]

try:
    import aubio  # noqa: F401

    HAVE_AUBIO = True
except Exception:  # pragma: no cover
    HAVE_AUBIO = False


def flute_tone(hz: float, seconds: float, sample_rate: int = SR) -> np.ndarray:
    """A crude flute-like tone: strong fundamental, weak upper harmonics."""
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    signal = (
        1.00 * np.sin(2 * np.pi * hz * t)
        + 0.25 * np.sin(2 * np.pi * 2 * hz * t)
        + 0.10 * np.sin(2 * np.pi * 3 * hz * t)
        + 0.04 * np.sin(2 * np.pi * 4 * hz * t)
    )
    envelope = np.minimum(1.0, t / 0.03)  # 30 ms attack
    return (0.3 * signal * envelope).astype(np.float32)


def blocks(signal: np.ndarray, hop: int = HOP):
    for start in range(0, len(signal) - hop + 1, hop):
        yield signal[start : start + hop]


def detect_steady(hz: float, backend: str, seconds: float = 1.0) -> float:
    """Median detected frequency over the steady portion of a tone."""
    detector = PitchDetector(sample_rate=SR, hop=HOP, backend=backend)
    signal = flute_tone(hz, seconds)
    voiced = [
        frame.hz
        for i, frame in enumerate(detector.process(b) for b in blocks(signal))
        if frame.voiced and i > 12  # discard attack and filter warm-up
    ]
    assert voiced, f"no voiced frames detected for {hz} Hz ({backend})"
    return float(np.median(voiced))


@pytest.mark.parametrize("backend", BACKENDS)
@pytest.mark.parametrize(
    "hz",
    [
        277.18,   # D4 at A=415, lowest note of the baroque flute
        415.00,   # A4, the reference itself
        554.58,   # D5 in Vallotti at A=415
        697.16,   # F#5 in Vallotti
        880.00,
        1244.51,  # near the top of the practical range
    ],
)
def test_steady_tones_recovered_within_two_cents(hz, backend):
    detected = detect_steady(hz, backend)
    assert abs(cents_between(hz, detected)) < 2.0


@pytest.mark.parametrize("backend", BACKENDS)
def test_twenty_cents_flat_is_measured_as_twenty_cents_flat(backend):
    target = 783.99  # G5
    played = target * 2 ** (-20 / 1200)
    detected = detect_steady(played, backend)
    assert cents_between(target, detected) == pytest.approx(-20.0, abs=2.0)


@pytest.mark.parametrize("backend", BACKENDS)
def test_silence_produces_no_voiced_frames(backend):
    detector = PitchDetector(sample_rate=SR, hop=HOP, backend=backend)
    quiet = (1e-5 * np.random.default_rng(0).standard_normal(SR // 2)).astype(np.float32)
    assert not any(detector.process(b).voiced for b in blocks(quiet))


@pytest.mark.parametrize("backend", BACKENDS)
def test_no_octave_errors_on_low_register(backend):
    """The classic YIN failure: reporting D5 when D4 is played."""
    for hz in (277.18, 293.66, 311.13):
        detected = detect_steady(hz, backend)
        assert abs(cents_between(hz, detected)) < 2.0, f"{hz}: got {detected}"


# ---------------------------------------------------------------------------
# Segmenter
# ---------------------------------------------------------------------------


def test_segmenter_completes_after_required_duration():
    seg = NoteSegmenter(target_hz=415.0, frame_seconds=0.0116, required_seconds=0.2)
    for _ in range(40):
        seg.push(415.0)
    assert seg.complete
    assert seg.elapsed_seconds >= 0.2


def test_segmenter_ignores_frames_far_from_target():
    """A drone on D must not be mistaken for the F# being practised."""
    seg = NoteSegmenter(target_hz=697.16, frame_seconds=0.0116, required_seconds=0.2)
    for _ in range(30):
        seg.push(554.58)  # the drone, a major third below
    assert seg.state is State.WAITING
    assert seg.frames_hz == []


def test_segmenter_accepts_notes_within_the_acceptance_window():
    """50 cents flat is bad intonation, not a wrong note -- it must be scored."""
    seg = NoteSegmenter(target_hz=415.0, frame_seconds=0.0116, required_seconds=0.1)
    flat = 415.0 * 2 ** (-50 / 1200)
    for _ in range(20):
        seg.push(flat)
    assert seg.complete
    assert len(seg.frames_hz) > 0


def test_a_release_alone_does_not_complete_a_note():
    """Duration is the only route to DONE. Supersedes DESIGN.md section 5.

    The spec says a note "closes on >= M silent/unstable frames" and also that
    it advances once "sounded long enough". Those conflict when a release comes
    early, and the original reading -- complete on release regardless of
    duration -- scores a note from whatever fragment was collected. Observed
    live at 20 bpm, where a 12-second note needs 7.2 s sustained: notes
    completed "almost instantly" because no attack survives 7.2 s unbroken by
    chance. A tenth of a second of audio is not an intonation measurement.
    """
    seg = NoteSegmenter(
        target_hz=415.0, frame_seconds=0.0116, required_seconds=5.0, release_frames=6
    )
    for _ in range(20):
        seg.push(415.0)
    for _ in range(6):
        seg.push(0.0)
    assert not seg.complete
    assert seg.state is State.WAITING


def test_a_breath_mid_note_keeps_the_progress_before_it():
    """Going silent is not the same as playing something else."""
    seg = NoteSegmenter(
        target_hz=415.0, frame_seconds=0.0116, required_seconds=1.0, release_frames=6
    )
    for _ in range(40):
        seg.push(415.0)
    collected = len(seg.frames_hz)
    for _ in range(10):
        seg.push(0.0)                      # a breath
    assert seg.state is State.WAITING
    assert len(seg.frames_hz) == collected, "a breath must not lose progress"

    for _ in range(60):                    # resume, and the note completes
        seg.push(415.0)
    assert seg.complete


def test_wandering_onto_another_note_discards_the_fragment():
    """Frames collected for one target must not describe a different one."""
    seg = NoteSegmenter(
        target_hz=415.0, frame_seconds=0.0116, required_seconds=1.0, release_frames=6
    )
    for _ in range(40):
        seg.push(415.0)
    assert seg.frames_hz
    for _ in range(10):
        seg.push(311.13)                   # a fourth below: a different note
    assert seg.state is State.WAITING
    assert not seg.frames_hz


def test_release_after_the_duration_is_met_still_completes():
    seg = NoteSegmenter(
        target_hz=415.0, frame_seconds=0.0116, required_seconds=0.2, release_frames=6
    )
    for _ in range(30):
        seg.push(415.0)
    assert seg.complete


@pytest.mark.skipif(not HAVE_AUBIO, reason="aubio not installed")
def test_aubio_low_register_bias_is_documented():
    """Finding: aubio yinfft is not accurate enough at the flute's low register.

    With a 2048 window it reads D4 (277.18 Hz at A=415) about 6 cents sharp --
    larger than the whole "in tune" band -- and with a 4096 window it octave-
    halves around 1245 Hz. This test pins the observation so that a future
    switch to aubio is a deliberate decision backed by real-instrument data,
    not an accident. Update the bounds if a newer aubio improves on this.
    """
    detected = detect_steady(277.18, "aubio")
    bias = cents_between(277.18, detected)
    assert bias > 2.0, (
        "aubio's low-register bias appears to have improved; re-evaluate "
        "which backend should be the default"
    )
    assert bias < 12.0


def test_end_to_end_synthetic_note_scores_in_tune():
    """Detector -> segmenter -> scoring, with no microphone involved."""
    from flutetrainer.core.pitch import SpelledPitch
    from flutetrainer.core.scoring import analyse_note

    target = 554.58
    detector = PitchDetector(sample_rate=SR, hop=HOP)
    seg = NoteSegmenter(
        target_hz=target, frame_seconds=detector.frame_seconds, required_seconds=0.5
    )
    for block in blocks(flute_tone(target, 1.5)):
        frame = detector.process(block)
        if seg.push(frame.hz) is State.DONE:
            break

    result = analyse_note(
        SpelledPitch.parse("D5"), target, seg.frames_hz, detector.frame_seconds
    )
    assert result is not None
    assert abs(result.mean_cents) < 2.0
    assert result.band == "in tune"


# ---------------------------------------------------------------------------
# Regression: breath noise crashed the detector (found on real flute audio)
# ---------------------------------------------------------------------------


def test_parabolic_refinement_is_bounded_on_a_degenerate_parabola():
    """The exact values that crashed the detector on a real breath recording.

    Blowing across the embouchure without sounding a note leaves the difference
    function with no dip in the search range, so tau lands on the boundary with
    the curve still descending and the three samples collinear. The parabola is
    degenerate, and the unbounded correction leapt +908 samples, indexing past
    the end of the array.
    """
    from flutetrainer.audio.detector import _refine_tau

    cmnd = np.ones(1024)
    tau = 219
    cmnd[tau - 1], cmnd[tau], cmnd[tau + 1] = 2.0629196026, 2.0580568623, 2.0531994724

    refined = _refine_tau(cmnd, tau)
    assert abs(refined - tau) <= 0.5
    assert 0 <= int(round(refined)) < cmnd.size


def test_refinement_still_sharpens_a_real_minimum():
    """Bounding the correction must not blunt it where it is legitimate."""
    from flutetrainer.audio.detector import _refine_tau

    # A clean parabola with its true minimum a quarter-sample above tau.
    cmnd = np.ones(1024)
    for offset in (-1, 0, 1):
        cmnd[100 + offset] = (offset - 0.25) ** 2

    refined = _refine_tau(cmnd, 100)
    assert refined == pytest.approx(100.25, abs=0.01)


def test_unpitched_noise_never_raises_and_never_invents_a_pitch():
    """Whatever the input, the detector reports a pitch in range or nothing."""
    from flutetrainer.audio.detector import MAX_HZ, MIN_HZ, _yin

    rng = np.random.default_rng(20260823)
    cases = [
        np.zeros(2048),                                   # digital silence
        np.ones(2048),                                    # DC
        np.linspace(-1.0, 1.0, 2048),                     # ramp
        np.sign(rng.standard_normal(2048)),               # square-ish noise
        np.clip(4.0 * rng.standard_normal(2048), -1, 1),  # clipped noise
    ]
    cases += [0.3 * rng.standard_normal(2048) for _ in range(50)]
    cases += [0.3 * np.sin(2 * np.pi * hz * np.arange(2048) / SR)
              for hz in (10.0, 40.0, 60.0, 120.0, 190.0, 3000.0, 8000.0)]

    for case in cases:
        hz, confidence = _yin(np.asarray(case, dtype=np.float32), SR)
        assert hz == 0.0 or MIN_HZ <= hz <= MAX_HZ
        assert 0.0 <= confidence <= 1.0


def test_level_gate_uses_the_analysis_window_not_the_hop():
    """A brief dip must not discard a frame whose window is full of signal.

    Pitch is computed from the whole 2048-sample buffer, so a single quiet
    11.6 ms hop says little about whether the frame is analysable. Gating on
    the hop threw away frames mid-note on real flute takes.
    """
    detector = PitchDetector(sample_rate=SR, hop=HOP, silence_db=-50.0)
    tone = flute_tone(554.37, 0.5)

    voiced_before = 0
    for block in blocks(tone):
        if detector.process(block).voiced:
            voiced_before += 1
    assert voiced_before > 10, "setup: the tone should be voiced"

    # One near-silent hop, with the rest of the window still full of tone.
    quiet = np.zeros(HOP, dtype=np.float32)
    frame = detector.process(quiet)
    assert frame.voiced, "a single quiet hop must not gate out the frame"


def test_median_history_is_cleared_across_an_unvoiced_gap():
    """The old note's pitch must not bleed into the new note's first frames.

    Note changes are rejected by the confidence gate rather than the level
    gate, so a history that survives one would blend the outgoing pitch into
    the incoming note exactly where the attack already makes it fragile.
    """
    rng = np.random.default_rng(4)
    detector = PitchDetector(sample_rate=SR, hop=HOP)

    low, high = 415.0, 622.25          # a fifth apart, far beyond any smoothing
    for block in blocks(flute_tone(low, 0.5)):
        detector.process(block)

    # Unvoiced noise, long enough to flush the analysis buffer entirely.
    for _ in range(8):
        detector.process((0.2 * rng.standard_normal(HOP)).astype(np.float32))

    readings = []
    for block in blocks(flute_tone(high, 0.5)):
        frame = detector.process(block)
        if frame.voiced:
            readings.append(frame.hz)

    assert readings, "the new note should be detected"
    assert abs(cents_between(high, readings[0])) < 20.0, (
        f"first frame after the gap read {readings[0]:.1f} Hz, "
        f"expected close to {high:.1f} Hz"
    )


# ---------------------------------------------------------------------------
# Drone (DESIGN.md section 5)
# ---------------------------------------------------------------------------


def test_drone_sounds_the_requested_pitch():
    """Rendered offline and read back by this project's own detector."""
    from flutetrainer.audio.drone import render

    target = 277.29
    detector = PitchDetector(sample_rate=SR, hop=HOP)
    heard = [
        frame.hz for frame in
        (detector.process(block) for block in blocks(render(target, 2.0)))
        if frame.voiced
    ]
    assert heard
    assert abs(cents_between(target, float(np.median(heard)))) < 2.0


def test_drone_partials_roll_off_by_twelve_db_per_octave():
    from flutetrainer.audio.drone import render

    hz = 277.29
    # Skip the attack ramp so the envelope does not distort the measurement.
    signal = render(hz, 2.0)[4096:]
    spectrum = np.abs(np.fft.rfft(signal * np.hanning(signal.size)))
    freqs = np.fft.rfftfreq(signal.size, 1.0 / SR)

    def level_at(frequency):
        return spectrum[int(np.argmin(np.abs(freqs - frequency)))]

    fundamental = level_at(hz)
    second = 20.0 * math.log10(level_at(2 * hz) / fundamental)
    assert second == pytest.approx(-12.0, abs=2.0)


def test_drone_is_continuous_across_callback_boundaries():
    """A phase discontinuity between callbacks is audible as a click."""
    from flutetrainer.audio.drone import Drone

    drone = Drone(277.29, sample_rate=SR)
    first = np.zeros((HOP, 1), dtype=np.float32)
    second = np.zeros((HOP, 1), dtype=np.float32)
    drone._callback(first, HOP, None, None)
    drone._callback(second, HOP, None, None)

    joined = np.concatenate([first[:, 0], second[:, 0]])
    inside = np.max(np.abs(np.diff(joined[10 : HOP - 10])))
    across = np.max(np.abs(np.diff(joined[HOP - 4 : HOP + 4])))
    assert across <= inside * 1.5


def test_drone_rejects_impossible_settings():
    from flutetrainer.audio.drone import Drone

    with pytest.raises(ValueError, match="positive"):
        Drone(0.0)
    with pytest.raises(ValueError, match="at least one partial"):
        Drone(440.0, harmonics=0)


# ---------------------------------------------------------------------------
# Tuner mode note identification
# ---------------------------------------------------------------------------


def test_tuner_names_notes_in_the_selected_temperament():
    """The reading must follow the chosen temperament, not equal temperament."""
    from flutetrainer.app import TEMPERAMENT_DIR, nearest_note, tuner_candidates
    from flutetrainer.core.pitch import SpelledPitch
    from flutetrainer.core.tuning import ReferencePitch, TemperamentTuning, load_scala

    tuning = TemperamentTuning(
        load_scala(TEMPERAMENT_DIR / "vallotti.scl"),
        SpelledPitch.parse("C4"),
        ReferencePitch(SpelledPitch.parse("A4"), 415.0),
    )
    candidates = tuner_candidates(tuning)

    for text in ("D4", "F#4", "A4", "D5", "Bb4", "G5"):
        expected = SpelledPitch.parse(text)
        pitch, target, cents = nearest_note(candidates, tuning.target_hz(expected))
        assert pitch == expected
        assert abs(cents) < 0.5
        assert target == pytest.approx(tuning.target_hz(expected), rel=1e-9)

    # A note 30 cents flat is still identified, with the deviation reported.
    flat = tuning.target_hz(SpelledPitch.parse("F#4")) * 2.0 ** (-30.0 / 1200.0)
    pitch, _, cents = nearest_note(candidates, flat)
    assert pitch == SpelledPitch.parse("F#4")
    assert cents == pytest.approx(-30.0, abs=0.5)


def test_onset_level_check_rejects_bleed_at_the_unison():
    """A drone at the target pitch must not open a note by itself.

    Pitch cannot separate them: at the unison the drone's frequency *is* the
    expected frequency. Level can, and this is the only thing standing between
    a drone exercise and a fabricated score.
    """
    target = 277.29
    seg = NoteSegmenter(
        target_hz=target, frame_seconds=0.0116, required_seconds=0.5,
        onset_db=-30.0,
    )
    for _ in range(200):
        seg.push(target, -45.0)          # dead on pitch, but only bleed-loud
    assert seg.state is State.WAITING
    assert not seg.frames_hz

    for _ in range(200):
        seg.push(target, -18.0)          # the player joins in
    assert seg.state is State.DONE


def test_a_sounding_note_may_decay_below_the_onset_level():
    """The onset check must not cut a diminuendo short."""
    target = 554.37
    seg = NoteSegmenter(
        target_hz=target, frame_seconds=0.0116, required_seconds=1.0,
        onset_db=-30.0,
    )
    for _ in range(10):
        seg.push(target, -15.0)
    assert seg.state is State.SOUNDING

    for _ in range(200):
        seg.push(target, -55.0)          # much quieter, still the same note
    assert seg.state is State.DONE
    assert len(seg.frames_hz) > 50


def test_without_a_configured_onset_level_behaviour_is_unchanged():
    target = 415.0
    seg = NoteSegmenter(target_hz=target, frame_seconds=0.0116, required_seconds=0.2)
    for _ in range(100):
        seg.push(target)
    assert seg.state is State.DONE


def test_onset_check_applies_only_where_pitch_cannot_separate_the_drone():
    """Quiet playing must not be refused on notes the pitch window handles.

    Applying a level floor to every note broke the interval drill: a note
    played more quietly than the drone never opened, even though the detector
    was reading its pitch correctly, because the measured background included
    the bleed.
    """
    from flutetrainer.app import onset_threshold_for

    drone = 277.29                      # D4
    assert onset_threshold_for(drone, drone, -30.0) == -30.0

    # A third and a fifth above sit far outside the acceptance window.
    for target in (346.62, 415.94):
        assert onset_threshold_for(target, drone, -30.0) is None

    # Just inside and just outside the window.
    inside = drone * 2.0 ** (70.0 / 1200.0)
    outside = drone * 2.0 ** (90.0 / 1200.0)
    assert onset_threshold_for(inside, drone, -30.0) == -30.0
    assert onset_threshold_for(outside, drone, -30.0) is None

    # No drone, or no calibration, means no check at all.
    assert onset_threshold_for(drone, None, -30.0) is None
    assert onset_threshold_for(drone, drone, None) is None


def test_every_practice_exercise_builds_and_resolves():
    """Each registry entry must produce notes a PURE-mode resolver can price.

    Guards the registry itself: a builder that raises, returns an empty
    exercise, or produces an unresolvable note would otherwise only be
    discovered live, mid-practice.
    """
    from flutetrainer.app import PRACTICE, TEMPERAMENT_DIR
    from flutetrainer.core.pitch import SpelledPitch
    from flutetrainer.core.resolver import Mode, TargetResolver
    from flutetrainer.core.tuning import ReferencePitch, TemperamentTuning, load_scala

    tuning = TemperamentTuning(
        load_scala(TEMPERAMENT_DIR / "vallotti.scl"),
        SpelledPitch.parse("C4"),
        ReferencePitch(SpelledPitch.parse("A4"), 415.0),
    )
    resolver = TargetResolver(Mode.PURE, tuning)

    for name, (description, build, feedback) in PRACTICE.items():
        assert description
        assert feedback in ("live", "after", "predict")
        built = build("D")
        exercises = list(built) if isinstance(built, (list, tuple)) else [built]
        assert exercises, name
        for exercise in exercises:
            assert exercise.notes, f"{name}: empty exercise"
            for note in exercise.notes:
                assert resolver.resolve(note) > 0.0

    # The centrepiece really mixes the two target kinds.
    built = PRACTICE["intervals"][1]("D")
    assert any(n.context is None for n in built.notes)
    assert any(n.context is not None for n in built.notes)


def test_choose_commits_on_an_unambiguous_prefix(monkeypatch):
    """Piped stdin exercises the fallback, which shares the prefix rule with
    the raw-keystroke path: one letter is enough once it narrows to one name."""
    from flutetrainer.app import choose

    options = {"calibration": "calibration", "intervals": "intervals",
               "enharmonic": "enharmonic", "predict": "predict"}

    for typed, expected in (("c", "calibration"), ("i", "intervals"),
                            ("e", "enharmonic"), ("p", "predict"),
                            ("cal", "calibration"), ("intervals", "intervals")):
        monkeypatch.setattr("builtins.input", lambda _prompt="", t=typed: t)
        assert choose("? ", options) == expected

    # Nothing typed, or a prefix that matches nothing, is no choice.
    for typed in ("", "x", "z9"):
        monkeypatch.setattr("builtins.input", lambda _prompt="", t=typed: t)
        assert choose("? ", options) is None


def test_choose_aliases_map_to_one_value(monkeypatch):
    """The predict prompt accepts t and i for the same call."""
    from flutetrainer.app import choose

    options = {"sharp": "sharp", "flat": "flat",
               "tune": "in tune", "in tune": "in tune"}
    for typed, expected in (("s", "sharp"), ("f", "flat"),
                            ("t", "in tune"), ("i", "in tune")):
        monkeypatch.setattr("builtins.input", lambda _prompt="", t=typed: t)
        assert choose("? ", options) == expected
