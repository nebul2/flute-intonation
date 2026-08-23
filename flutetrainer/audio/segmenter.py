"""Guided note segmentation.

v1 advances through the exercise note by note: the player plays the highlighted
note, and this state machine decides when it has been sounded long enough to
score and move on. That removes score-following alignment entirely, which is
both simpler and the right pedagogical shape for intonation work.

Written as an explicit, documented state machine so it ports unchanged to C++
(DESIGN.md sections 5 and 11).

    WAITING --(enough voiced frames near target)--> SOUNDING
    SOUNDING --(enough silent frames, or duration met)--> DONE
    SOUNDING --(pitch wanders far off)--> WAITING (frames discarded)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from ..core.pitch import cents_between


class State(Enum):
    WAITING = "waiting"
    SOUNDING = "sounding"
    DONE = "done"


@dataclass
class NoteSegmenter:
    """Collects the voiced frames belonging to one expected note.

    ``acceptance_cents`` is deliberately wide: the point is to recognise *which*
    note is being played, not to judge it. Judgement happens in scoring. It also
    rejects a drone bleeding into the microphone, since the drone sits far from
    the target for every note except the unison.
    """

    target_hz: float
    frame_seconds: float
    required_seconds: float
    acceptance_cents: float = 80.0
    onset_frames: int = 4
    release_frames: int = 6

    state: State = field(default=State.WAITING, init=False)
    frames_hz: list[float] = field(default_factory=list, init=False)
    _candidate: list[float] = field(default_factory=list, init=False)
    _silent_run: int = field(default=0, init=False)

    def _near_target(self, hz: float) -> bool:
        if hz <= 0.0:
            return False
        return abs(cents_between(self.target_hz, hz)) <= self.acceptance_cents

    def push(self, hz: float) -> State:
        """Feed one frame's frequency (0.0 for unvoiced). Returns the new state."""
        if self.state is State.DONE:
            return self.state

        if self.state is State.WAITING:
            if self._near_target(hz):
                self._candidate.append(hz)
                if len(self._candidate) >= self.onset_frames:
                    self.state = State.SOUNDING
                    self.frames_hz.extend(self._candidate)
                    self._candidate.clear()
                    self._silent_run = 0
            else:
                self._candidate.clear()
            return self.state

        # SOUNDING
        if self._near_target(hz):
            self.frames_hz.append(hz)
            self._silent_run = 0
            if self.elapsed_seconds >= self.required_seconds:
                self.state = State.DONE
        else:
            self._silent_run += 1
            if self._silent_run >= self.release_frames:
                self.state = State.DONE if self.frames_hz else State.WAITING
                if self.state is State.WAITING:
                    self.frames_hz.clear()
        return self.state

    @property
    def elapsed_seconds(self) -> float:
        return len(self.frames_hz) * self.frame_seconds

    @property
    def complete(self) -> bool:
        return self.state is State.DONE
