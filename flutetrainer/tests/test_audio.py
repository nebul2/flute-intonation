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


def test_segmenter_releases_after_silence():
    seg = NoteSegmenter(
        target_hz=415.0, frame_seconds=0.0116, required_seconds=5.0, release_frames=6
    )
    for _ in range(20):
        seg.push(415.0)
    for _ in range(6):
        seg.push(0.0)
    assert seg.complete  # ended early by release, not by reaching the duration
    assert seg.elapsed_seconds < 5.0


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
