"""Guided note segmentation.

v1 advances through the exercise note by note: the player plays the highlighted
note, and this state machine decides when it has been sounded long enough to
score and move on. That removes score-following alignment entirely, which is
both simpler and the right pedagogical shape for intonation work.

Written as an explicit, documented state machine so it ports unchanged to C++
(DESIGN.md sections 5 and 11).

    WAITING  --(enough voiced frames near target)--------> SOUNDING
    SOUNDING --(sounded for required_seconds)------------> DONE
    SOUNDING --(goes silent, not yet long enough)--------> WAITING (frames kept)
    SOUNDING --(wanders off target, not yet long enough)-> WAITING (frames dropped)

    Duration is the only route to DONE. A release on its own never completes a
    note, or a hesitation just after the attack would score it from a fragment.
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
    the target for every note -- **except the unison**, where the drone's pitch
    and the expected pitch coincide exactly and a pitch window cannot separate
    them at all. Measured live: with a D drone sounding through speakers and
    nobody playing, the opening D4 of a D arpeggio scored "+1.9 cents, in tune".

    ``onset_db`` closes that hole. A note may only *open* when the input is
    louder than this, which distinguishes a played note from bleed by level
    rather than by pitch: playing sits 20-30 dB above a drone leaking back
    through the microphone. It applies to the onset alone; once a note is
    sounding it is allowed to decay, so a diminuendo is not cut short. Left at
    ``None`` the check is skipped entirely and behaviour is unchanged.
    """

    target_hz: float
    frame_seconds: float
    required_seconds: float
    acceptance_cents: float = 80.0
    onset_frames: int = 4
    release_frames: int = 6
    onset_db: float | None = None

    state: State = field(default=State.WAITING, init=False)
    frames_hz: list[float] = field(default_factory=list, init=False)
    _candidate: list[float] = field(default_factory=list, init=False)
    _silent_run: int = field(default=0, init=False)
    _off_target_run: int = field(default=0, init=False)

    def _near_target(self, hz: float) -> bool:
        if hz <= 0.0:
            return False
        return abs(cents_between(self.target_hz, hz)) <= self.acceptance_cents

    def _loud_enough(self, level_db: float | None) -> bool:
        """Whether a frame may open a note. Unknown level is treated as loud."""
        if self.onset_db is None or level_db is None:
            return True
        return level_db >= self.onset_db

    def push(self, hz: float, level_db: float | None = None) -> State:
        """Feed one frame's frequency (0.0 for unvoiced). Returns the new state."""
        if self.state is State.DONE:
            return self.state

        if self.state is State.WAITING:
            if self._near_target(hz) and self._loud_enough(level_db):
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
            self._off_target_run = 0
            if self.elapsed_seconds >= self.required_seconds:
                self.state = State.DONE
        else:
            self._silent_run += 1
            if hz > 0.0:
                self._off_target_run += 1
            if self._silent_run >= self.release_frames:
                self._release()
        return self.state

    def _release(self) -> None:
        """Handle a run of frames that are silent or away from the target.

        The note completes only if it has actually been sounded for long
        enough. Completing on release alone -- which this did originally --
        scores a note from whatever fragment happened to be collected: a
        momentary drop just after the attack ended the note instantly with a
        tenth of a second of audio. That stayed hidden while notes needed 1.2 s
        and surfaced at slow tempi, where a 12-second note needs 7.2 s and no
        attack survives that long unbroken by chance.

        Otherwise the attempt is abandoned and the note waits to be played
        again. The two reasons for abandoning it are not the same, and the
        distinction is the one DESIGN.md section 5 draws:

        * gone *silent* -- the player breathed. Keep the frames already
          collected, because a breath in the middle of a long tone should not
          throw away the progress before it.
        * gone *off-target* -- the player is sounding a different note, so what
          was collected does not describe this target. Discard it.
        """
        if self.elapsed_seconds >= self.required_seconds:
            self.state = State.DONE
            return

        self.state = State.WAITING
        if self._off_target_run >= self.release_frames:
            self.frames_hz.clear()
        self._silent_run = 0
        self._off_target_run = 0
        self._candidate.clear()

    @property
    def elapsed_seconds(self) -> float:
        return len(self.frames_hz) * self.frame_seconds

    @property
    def complete(self) -> bool:
        return self.state is State.DONE
