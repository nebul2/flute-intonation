"""Harmonic context: the information that makes a target pitch context-aware.

Deliberately minimal in v1. The exercise generator produces contexts *by
construction* -- there is no harmonic analysis anywhere in the system. This
dataclass is the extension point through which future score-import analysis
will feed the same resolver (DESIGN.md section 3.4).
"""

from __future__ import annotations

from dataclasses import dataclass

from .pitch import SpelledPitch


@dataclass(frozen=True)
class HarmonicContext:
    """The sounding or implied reference against which a note is tuned."""

    bass: SpelledPitch
    # Room to grow (v2+): chord quality, figured bass, beat position.

    def __str__(self) -> str:
        return f"over {self.bass}"
