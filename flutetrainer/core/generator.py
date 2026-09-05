"""Exercise generation. All functions are pure and seedable.

Every generated note carries its harmonic context, which is the whole reason
score import is not needed for v1: the generator *knows* that the F# in a D
major scale is a third above the D drone, because it put it there.
See DESIGN.md section 4.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from .context import HarmonicContext
from .pitch import SpelledPitch
from .resolver import Exercise, TargetNote

# Sounding range of the baroque flute. Defaults only -- configurable.
DEFAULT_LOW = SpelledPitch.parse("D4")
DEFAULT_HIGH = SpelledPitch.parse("A6")

# Letter sequence used to spell scales; spelling matters, so scales are built
# by walking letters and applying the key signature, never by adding semitones.
_LETTER_ORDER = "CDEFGAB"

#: Key signatures as {letter: alter}. Default palette favours the keys a
#: baroque flute plays well; extend freely in configuration.
KEY_SIGNATURES: dict[str, dict[str, int]] = {
    "C": {},
    "G": {"F": 1},
    "D": {"F": 1, "C": 1},
    "A": {"F": 1, "C": 1, "G": 1},
    "E": {"F": 1, "C": 1, "G": 1, "D": 1},
    "B": {"F": 1, "C": 1, "G": 1, "D": 1, "A": 1},
    "F": {"B": -1},
    "Bb": {"B": -1, "E": -1},
    "Eb": {"B": -1, "E": -1, "A": -1},
    "Ab": {"B": -1, "E": -1, "A": -1, "D": -1},
}

#: (tonic, key signature name, mode label) for the default palette.
DEFAULT_KEYS: tuple[tuple[str, str, str], ...] = (
    ("D", "D", "major"),
    ("G", "G", "major"),
    ("A", "A", "major"),
    ("C", "C", "major"),
    ("F", "F", "major"),
    ("E", "G", "minor"),   # E minor: one sharp
    ("B", "D", "minor"),   # B minor: two sharps
)

_MAJOR_STEPS = (0, 1, 2, 3, 4, 5, 6)   # diatonic degrees; quality from key sig
_TRIAD_DEGREES = (0, 2, 4)


def _spell(letter: str, octave: int, signature: dict[str, int]) -> SpelledPitch:
    return SpelledPitch(letter, signature.get(letter, 0), octave)


def _ascend(start: SpelledPitch, degrees: int, signature: dict[str, int]) -> SpelledPitch:
    """Move ``degrees`` diatonic steps above ``start``, spelled by the key."""
    index = _LETTER_ORDER.index(start.letter) + degrees
    letter = _LETTER_ORDER[index % 7]
    octave = start.octave + index // 7
    return _spell(letter, octave, signature)


def in_range(
    pitch: SpelledPitch,
    low: SpelledPitch = DEFAULT_LOW,
    high: SpelledPitch = DEFAULT_HIGH,
) -> bool:
    return low.chromatic_index <= pitch.chromatic_index <= high.chromatic_index


def scale(
    tonic: str,
    key: str = "",
    octaves: int = 1,
    start_octave: int = 4,
    descending: bool = True,
    beats: float = 2.0,
    tempo_bpm: float = 60.0,
    drone: bool = True,
    low: SpelledPitch = DEFAULT_LOW,
    high: SpelledPitch = DEFAULT_HIGH,
) -> Exercise:
    """A scale in which every note is tagged as an interval above the tonic."""
    signature = KEY_SIGNATURES[key or tonic]
    root = _spell(tonic, start_octave, signature)
    if not in_range(root, low, high):
        root = _spell(tonic, start_octave + 1, signature)

    pitches = [_ascend(root, d, signature) for d in range(octaves * 7 + 1)]
    if descending:
        pitches += list(reversed(pitches[:-1]))
    pitches = [p for p in pitches if in_range(p, low, high)]

    context = HarmonicContext(bass=root)
    notes = tuple(TargetNote(p, beats, context) for p in pitches)
    return Exercise(
        name=f"{tonic} {('major' if signature.get(tonic, 0) >= 0 else 'minor')} scale",
        notes=notes,
        drone=root if drone else None,
        tempo_bpm=tempo_bpm,
        key=key or tonic,
    )


def interval_adjust(
    tonic: str,
    *,
    key: str = "",
    start_octave: int = 4,
    beats: float = 4.0,
    tempo_bpm: float = 60.0,
    low: SpelledPitch = DEFAULT_LOW,
    high: SpelledPitch = DEFAULT_HIGH,
) -> list[Exercise]:
    """The same written note over two different basses: a third, then a fifth.

    A written F# is a major third over D and must sit low for the third to
    ring; the same F# is a fifth over B, and sounding it that low makes the
    fifth beat. Nothing on the page changes -- the note moves, and moving it
    is most of what playing in tune means on this instrument.

    Derived from the tonic so it needs no extra choice: the note is the
    mediant, the first bass the tonic, the second the submediant an octave
    down, which turns that same note into a fifth.

    Two exercises rather than one, because each needs its own drone.
    """
    signature = KEY_SIGNATURES[key or tonic]
    root = _spell(tonic, start_octave, signature)
    if not in_range(root, low, high):
        root = _spell(tonic, start_octave + 1, signature)
    note = _ascend(root, 2, signature)                              # the mediant
    under = _ascend(root, 5, signature).transpose_octaves(-1)       # submediant, down an octave
    return [
        Exercise(
            name=f"{note} as a third over {root}",
            notes=(TargetNote(note, beats, HarmonicContext(root)),),
            drone=root,
            tempo_bpm=tempo_bpm,
            key=key or tonic,
        ),
        Exercise(
            name=f"{note} as a fifth over {under}",
            notes=(TargetNote(note, beats, HarmonicContext(under)),),
            drone=under,
            tempo_bpm=tempo_bpm,
            key=key or tonic,
        ),
    ]


def arpeggio(
    tonic: str,
    key: str = "",
    octaves: int = 1,
    start_octave: int = 4,
    beats: float = 2.0,
    tempo_bpm: float = 60.0,
    drone: bool = True,
    low: SpelledPitch = DEFAULT_LOW,
    high: SpelledPitch = DEFAULT_HIGH,
) -> Exercise:
    """Triad arpeggio -- the exercise where the two modes differ most audibly."""
    signature = KEY_SIGNATURES[key or tonic]
    root = _spell(tonic, start_octave, signature)
    if not in_range(root, low, high):
        root = _spell(tonic, start_octave + 1, signature)

    degrees = [d + 7 * o for o in range(octaves) for d in _TRIAD_DEGREES]
    degrees.append(7 * octaves)
    pitches = [_ascend(root, d, signature) for d in degrees]
    pitches += list(reversed(pitches[:-1]))
    pitches = [p for p in pitches if in_range(p, low, high)]

    context = HarmonicContext(bass=root)
    notes = tuple(TargetNote(p, beats, context) for p in pitches)
    return Exercise(
        name=f"{tonic} arpeggio",
        notes=notes,
        drone=root if drone else None,
        tempo_bpm=tempo_bpm,
        key=key or tonic,
    )


def interval_drill(
    bass: str,
    intervals: tuple[int, ...] = (2, 4, 0),
    key: str = "",
    start_octave: int = 4,
    beats: float = 4.0,
    tempo_bpm: float = 60.0,
    repeats: int = 1,
    seed: int | None = None,
    shuffle: bool = False,
    low: SpelledPitch = DEFAULT_LOW,
    high: SpelledPitch = DEFAULT_HIGH,
) -> Exercise:
    """Sustained notes at chosen diatonic distances above a fixed bass.

    ``intervals`` are diatonic step counts (0 = unison, 2 = third, 4 = fifth).
    This is the most direct intonation exercise: hold the note against the
    drone and watch the beats disappear.
    """
    signature = KEY_SIGNATURES[key or bass]
    root = _spell(bass, start_octave, signature)
    if not in_range(root, low, high):
        root = _spell(bass, start_octave + 1, signature)

    sequence = [d for _ in range(repeats) for d in intervals]
    if shuffle:
        random.Random(seed).shuffle(sequence)

    context = HarmonicContext(bass=root)
    pitches = [_ascend(root, d, signature) for d in sequence]
    notes = tuple(
        TargetNote(p, beats, context) for p in pitches if in_range(p, low, high)
    )
    return Exercise(
        name=f"interval drill over {root}",
        notes=notes,
        drone=root,
        tempo_bpm=tempo_bpm,
        key=key or bass,
    )


def interval_in_context(
    tonic: str = "D",
    degrees: tuple[int, ...] = (2, 5),
    start_octave: int = 4,
    beats: float = 4.0,
    tempo_bpm: float = 60.0,
    low: SpelledPitch = DEFAULT_LOW,
    high: SpelledPitch = DEFAULT_HIGH,
) -> Exercise:
    """The same written note twice: first tempered, then pure over the drone.

    The pair is the exercise. A context-free note resolves through the
    temperament even in pure mode (the resolver's documented fallback), so the
    first of each pair carries no context and the second carries the drone
    bass. Same fingering, same drone sounding, two targets: the player hears
    the tempered version beat against the drone and the pure version lock.

    ``degrees`` are diatonic steps above the tonic; the defaults (2, 5) are the
    third and the sixth, where pure and tempered diverge most audibly -- a pure
    major third sits roughly 14 cents below its equal-tempered spelling.
    """
    signature = KEY_SIGNATURES[tonic]
    root = _spell(tonic, start_octave, signature)
    if not in_range(root, low, high):
        root = _spell(tonic, start_octave + 1, signature)
    context = HarmonicContext(bass=root)

    notes: list[TargetNote] = []
    for degree in degrees:
        pitch = _ascend(root, degree, signature)
        if not in_range(pitch, low, high):
            continue
        notes.append(TargetNote(pitch, beats, None))      # tempered
        notes.append(TargetNote(pitch, beats, context))   # pure over the drone
    return Exercise(
        name=f"interval in context over {root}",
        notes=tuple(notes),
        drone=root,
        tempo_bpm=tempo_bpm,
        key=tonic,
    )


def enharmonic_pair(
    beats: float = 4.0,
    tempo_bpm: float = 60.0,
    repeats: int = 2,
) -> tuple[Exercise, Exercise]:
    """D# and Eb as different notes, each pure over the bass that wants it.

    Quantz built flutes with separate keys for these two, and his tuning
    treated the octave as twenty-four notes; the spelled-pitch model exists to
    preserve exactly this distinction. D#5 is a major third (plus octave) over
    a B bass; Eb5 is a minor third (plus octave) over a C bass. Two exercises
    rather than one because each needs its own drone.
    """
    pairs = (
        (SpelledPitch.parse("D#5"), SpelledPitch.parse("B3")),
        (SpelledPitch.parse("Eb5"), SpelledPitch.parse("C4")),
    )
    exercises = []
    for pitch, bass in pairs:
        context = HarmonicContext(bass=bass)
        exercises.append(Exercise(
            name=f"{pitch} over {bass}",
            notes=tuple(TargetNote(pitch, beats, context) for _ in range(repeats)),
            drone=bass,
            tempo_bpm=tempo_bpm,
        ))
    return tuple(exercises)


def stopper_check(beats: float = 4.0, tempo_bpm: float = 60.0) -> Exercise:
    """The three D's and the three G's, set embouchure, no drone.

    The classical test for placing the stopper (le bouchon): play the octaves
    with the embouchure set -- adapted for the register, but making no pitch
    correction -- and move the stopper until the octaves come out as close to
    true as possible. Absolute pitch is deliberately not the criterion; only
    the internal width of the octaves is. Quantz invented the screw-cap
    stopper precisely so this could be adjusted when changing corps de
    rechange.

    No drone and no context: the targets exist only so the detector knows
    which note is being sounded.
    """
    pitches = ("D4", "D5", "D6", "G4", "G5", "G6")
    notes = tuple(
        TargetNote(SpelledPitch.parse(name), beats, None) for name in pitches
    )
    return Exercise(name="stopper check", notes=notes, drone=None,
                    tempo_bpm=tempo_bpm)


def long_tones(
    pitches: tuple[str, ...],
    bass: str | None = None,
    beats: float = 8.0,
    tempo_bpm: float = 60.0,
) -> Exercise:
    """Explicit list of pitches, optionally against a drone."""
    parsed = [SpelledPitch.parse(p) for p in pitches]
    root = SpelledPitch.parse(bass) if bass else None
    context = HarmonicContext(bass=root) if root else None
    notes = tuple(TargetNote(p, beats, context) for p in parsed)
    return Exercise(
        name="long tones", notes=notes, drone=root, tempo_bpm=tempo_bpm
    )
