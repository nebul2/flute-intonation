"""Monophonic pitch detection (DESIGN.md section 5).

Two interchangeable backends behind one interface:

* ``numpy`` -- a self-contained YIN. **The default.** Validated against a naive
  difference-function implementation to 1e-12 and accurate to within 1.4 cents
  across D4-A6 on synthetic tones.
* ``aubio`` -- the yinfft implementation. Available but *not* the default: on
  synthetic tones it carries a +6 cent bias at D4 with a 2048 window, and
  octave-halves at ~1245 Hz with a 4096 window. Re-evaluate on real flute audio
  before preferring it; synthetic tones do not settle the question.

The flute is monophonic and strongly harmonic, so no neural model is warranted
in v1. Median filtering suppresses the octave blips that plague YIN on breathy
low notes.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import numpy as np

DEFAULT_SAMPLE_RATE = 44100
DEFAULT_WINDOW = 2048
DEFAULT_HOP = 512

# Detection band, generously wider than the flute's D4-A6 so that a badly
# out-of-tune attempt is still reported rather than silently dropped.
MIN_HZ = 200.0
MAX_HZ = 2200.0


@dataclass(frozen=True)
class Frame:
    """One analysis frame."""

    hz: float          # 0.0 when unvoiced
    confidence: float  # 0.0-1.0
    rms_db: float

    @property
    def voiced(self) -> bool:
        return self.hz > 0.0


def _rms_db(block: np.ndarray) -> float:
    rms = float(np.sqrt(np.mean(np.square(block)))) if block.size else 0.0
    return -120.0 if rms <= 1e-12 else 20.0 * np.log10(rms)


def _refine_tau(cmnd: np.ndarray, tau: int) -> float:
    """Parabolic refinement of a discrete minimum, bounded to its neighbours.

    A sub-sample correction can only move the estimate *within* the two
    adjacent samples; a larger displacement is not a refinement of anything.
    Bounding it matters because the parabola degenerates on aperiodic input:
    with breath passing over the embouchure and no note speaking, the
    difference function has no dip anywhere in the search range, ``tau`` lands
    on the boundary where the curve is still descending, and the three samples
    are collinear.

    Measured on a real breath recording at 0.569 s: a=2.0629196, b=2.0580569,
    c=2.0531995, giving a denominator of -1.07e-5 and a "sub-sample" shift of
    +908 samples. That indexed past the end of the difference function and
    raised IndexError, so blowing across the flute without sounding a note
    crashed the live session. The former ``abs(denominator) > 1e-12`` guard is
    orders of magnitude too weak to catch a case like that.
    """
    if not 1 <= tau < cmnd.size - 1:
        return float(tau)
    a, b, c = cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]
    denominator = 2.0 * (2.0 * b - a - c)
    if abs(denominator) <= 1e-12:
        return float(tau)
    shift = (c - a) / denominator
    return float(tau) + max(-0.5, min(0.5, shift))


def _yin(block: np.ndarray, sample_rate: int, threshold: float = 0.15) -> tuple[float, float]:
    """Reference YIN. Returns (hz, confidence); hz is 0.0 when unvoiced."""
    size = block.size
    half = size // 2
    if half < 32:
        return 0.0, 0.0

    # Difference function d(tau) = sum_j (x[j] - x[j+tau])^2, expanded as
    # sum(x[j]^2) + sum(x[j+tau]^2) - 2*autocorr(tau), with the autocorrelation
    # taken via FFT. No analysis window is applied: windowing tapers the signal
    # and biases the period estimate, which is precisely the error we measure.
    # The correlation term is the *half-window* x[0:half] slid against the full
    # block, not the block's own autocorrelation -- using the latter silently
    # yields a different function and a constant frequency bias.
    signal = np.asarray(block, dtype=np.float64)
    padded = int(2 ** np.ceil(np.log2(size + half)))
    head_spectrum = np.fft.rfft(signal[:half], padded)
    full_spectrum = np.fft.rfft(signal, padded)
    correlation = np.fft.irfft(np.conjugate(head_spectrum) * full_spectrum, padded)[:half]

    power = np.concatenate(([0.0], np.cumsum(np.square(signal))))
    taus = np.arange(half)
    first_window = power[half]                         # sum of x[0..half-1]^2
    shifted_window = power[taus + half] - power[taus]   # sum of x[tau..tau+half-1]^2
    difference = first_window + shifted_window - 2.0 * correlation

    # Cumulative mean normalised difference.
    cmnd = np.ones(half)
    running = np.cumsum(difference[1:])
    nonzero = running > 0
    taus = np.arange(1, half)
    cmnd[1:][nonzero] = difference[1:][nonzero] * taus[nonzero] / running[nonzero]

    tau_min = max(2, int(sample_rate / MAX_HZ))
    tau_max = min(half - 1, int(sample_rate / MIN_HZ))
    if tau_max <= tau_min:
        return 0.0, 0.0

    window = cmnd[tau_min:tau_max]
    below = np.flatnonzero(window < threshold)
    if below.size:
        tau = tau_min + int(below[0])
        while tau + 1 < tau_max and cmnd[tau + 1] < cmnd[tau]:
            tau += 1
    else:
        tau = tau_min + int(np.argmin(window))

    # Parabolic interpolation around the dip for sub-sample precision.
    tau = _refine_tau(cmnd, tau)

    if tau <= 0:
        return 0.0, 0.0
    hz = sample_rate / tau
    # Clamped as defence in depth: the bound inside _refine_tau already keeps
    # this index inside the array, and neither should be relied on alone.
    index = max(0, min(cmnd.size - 1, int(round(tau))))
    confidence = float(np.clip(1.0 - cmnd[index], 0.0, 1.0))
    if not (MIN_HZ <= hz <= MAX_HZ):
        return 0.0, 0.0
    return float(hz), confidence


class PitchDetector:
    """Frame-by-frame pitch detection with gating and median smoothing."""

    def __init__(
        self,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        window: int = DEFAULT_WINDOW,
        hop: int = DEFAULT_HOP,
        confidence_threshold: float = 0.85,
        silence_db: float = -50.0,
        median_frames: int = 5,
        backend: str = "numpy",
    ) -> None:
        self.sample_rate = sample_rate
        self.window = window
        self.hop = hop
        self.confidence_threshold = confidence_threshold
        self.silence_db = silence_db
        self._history: deque[float] = deque(maxlen=max(1, median_frames))
        self._buffer = np.zeros(window, dtype=np.float32)
        self._aubio = None
        self._prefer_aubio = False

        if backend == "aubio" or (backend == "auto" and self._prefer_aubio):
            try:
                import aubio  # noqa: PLC0415

                self._aubio = aubio.pitch("yinfft", window, hop, sample_rate)
                self._aubio.set_unit("Hz")
                self._aubio.set_silence(silence_db)
                self.backend = "aubio"
            except Exception:  # pragma: no cover - environment dependent
                if backend == "aubio":
                    raise
                self.backend = "numpy"
        else:
            self.backend = "numpy"

    @property
    def frame_seconds(self) -> float:
        return self.hop / self.sample_rate

    def reset(self) -> None:
        self._history.clear()
        self._buffer[:] = 0.0

    def process(self, block: np.ndarray) -> Frame:
        """Consume one hop-sized block and return the resulting frame."""
        block = np.asarray(block, dtype=np.float32).reshape(-1)
        if block.size != self.hop:
            raise ValueError(f"expected {self.hop} samples, got {block.size}")

        self._buffer = np.roll(self._buffer, -self.hop)
        self._buffer[-self.hop :] = block

        # The level that matters is the one over the *analysis window*, not the
        # hop. Pitch is computed from the whole 2048-sample buffer, so gating on
        # 11.6 ms of it discards frames whose analysis window is largely full of
        # good signal. Measured on real flute takes, 0.5-2.4% of frames per take
        # were rejected on hop level while the window was above the gate. The
        # reported level stays the hop's, which is what a live meter should show.
        level = _rms_db(block)
        if _rms_db(self._buffer) < self.silence_db:
            self._history.clear()
            return Frame(0.0, 0.0, level)

        if self._aubio is not None:
            hz = float(self._aubio(block)[0])
            # aubio's yinfft does not populate get_confidence() -- it returns
            # 0.0 always in 0.4.x. Gating on it would discard every frame, so
            # voicing rests on aubio's own silence gate plus the range check.
            confidence = float(self._aubio.get_confidence())
            gate_ok = True
        else:
            hz, confidence = _yin(self._buffer, self.sample_rate)
            gate_ok = confidence >= self.confidence_threshold

        if hz <= 0.0 or not gate_ok or not (MIN_HZ <= hz <= MAX_HZ):
            # Clear the median history on *any* unvoiced frame, not only on a
            # silent one. Note changes are rejected by the confidence gate
            # rather than the level gate, so keeping the history across one
            # would blend the outgoing note's pitch into the first frames of
            # the incoming note -- precisely where a scoop already makes the
            # estimate fragile.
            self._history.clear()
            return Frame(0.0, confidence, level)

        self._history.append(hz)
        smoothed = float(np.median(self._history))
        return Frame(smoothed, confidence, level)
