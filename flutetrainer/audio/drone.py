"""Synthesised reference drone (DESIGN.md section 5).

A sine with two upper partials rolled off at -12 dB/octave -- so partial n has
amplitude 1/n^2 -- and a gentle attack, played through a ``sounddevice`` output
stream at whatever frequency the resolver anchored the bass to.

Phase is accumulated in radians per partial and wrapped, rather than by
computing sin() of an ever-growing sample index: the naive form loses precision
over a long session and the wrap keeps every partial continuous across callback
boundaries, which is what stops the drone clicking.

**Feedback warning.** The drone leaves the speakers and re-enters the
microphone. For most notes the segmenter's +/-80 cent acceptance window rejects
it, but when the expected note *is* the drone pitch -- the tonic of an arpeggio
over its own root, say -- the two coincide exactly and the trainer can score a
note the player never sounded. Headphones remove the problem entirely and are
worth recommending in the UI.
"""

from __future__ import annotations

import math

import numpy as np

DEFAULT_SAMPLE_RATE = 44100
DEFAULT_AMPLITUDE = 0.15
DEFAULT_HARMONICS = 3
DEFAULT_ATTACK_SECONDS = 0.3


class Drone:
    """A continuously sounding reference tone."""

    def __init__(
        self,
        hz: float,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        amplitude: float = DEFAULT_AMPLITUDE,
        harmonics: int = DEFAULT_HARMONICS,
        attack_seconds: float = DEFAULT_ATTACK_SECONDS,
        device=None,
    ) -> None:
        if hz <= 0.0:
            raise ValueError(f"drone frequency must be positive, got {hz}")
        if harmonics < 1:
            raise ValueError(f"need at least one partial, got {harmonics}")

        self.hz = float(hz)
        self.sample_rate = int(sample_rate)
        self.amplitude = float(amplitude)
        self.attack_seconds = float(attack_seconds)
        self.device = device

        partials = np.arange(1, harmonics + 1, dtype=np.float64)
        # -12 dB per octave: doubling the partial number attenuates by a factor
        # of four, which is amplitude proportional to 1/n^2.
        self._weights = 1.0 / np.square(partials)
        self._weights /= self._weights.sum()          # keep the sum bounded
        self._increments = 2.0 * math.pi * self.hz * partials / self.sample_rate
        self._phases = np.zeros(harmonics, dtype=np.float64)
        self._elapsed = 0
        self._stream = None

    def _callback(self, outdata, frames, _time, _status):  # pragma: no cover - live audio
        steps = np.arange(frames, dtype=np.float64)
        block = np.zeros(frames, dtype=np.float64)
        for index, increment in enumerate(self._increments):
            block += self._weights[index] * np.sin(self._phases[index] + increment * steps)
            self._phases[index] = (self._phases[index] + increment * frames) % (2.0 * math.pi)

        if self.attack_seconds > 0.0:
            attack = self.attack_seconds * self.sample_rate
            envelope = np.clip((self._elapsed + steps) / attack, 0.0, 1.0)
            block *= envelope
        self._elapsed += frames

        outdata[:, 0] = (self.amplitude * block).astype(np.float32)

    def start(self) -> None:
        import sounddevice as sd  # noqa: PLC0415

        self._stream = sd.OutputStream(
            device=self.device, samplerate=self.sample_rate, channels=1,
            dtype="float32", callback=self._callback,
        )
        self._stream.start()

    def stop(self) -> None:
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None

    def __enter__(self) -> "Drone":
        self.start()
        return self

    def __exit__(self, *_exc) -> None:
        self.stop()


def render(
    hz: float, seconds: float, sample_rate: int = DEFAULT_SAMPLE_RATE,
    amplitude: float = DEFAULT_AMPLITUDE, harmonics: int = DEFAULT_HARMONICS,
    attack_seconds: float = DEFAULT_ATTACK_SECONDS,
) -> np.ndarray:
    """Render the same waveform offline, so it can be tested without a device."""
    drone = Drone(hz, sample_rate, amplitude, harmonics, attack_seconds)
    frames = int(round(seconds * sample_rate))
    out = np.zeros((frames, 1), dtype=np.float32)
    drone._callback(out, frames, None, None)
    return out[:, 0]
