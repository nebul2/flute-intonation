# Baroque Flute Intonation Trainer — v1 Design Specification

Status: design frozen for v1 implementation. Target platform: macOS desktop, Python prototype (aubio + sounddevice), with the core designed to survive a later port to C++/JUCE or WASM unchanged in structure.

## 1. Purpose and scope

The application displays generated exercises (scales, arpeggios, intervals) suited to the baroque flute, listens to the player through the microphone, and gives real-time and per-note feedback on intonation in cents against a *context-aware target frequency*. Two target modes are supported and switchable: a fixed historical temperament, and pure intervals against a bass/drone. Score import (MusicXML/MIDI) is explicitly out of scope for v1, but every design decision below must not preclude it.

## 2. Architectural principle

The system is split into three layers with a strict dependency direction: `core` (pure logic, no I/O, no audio, fully unit-testable, deterministic) ← `audio` (capture, pitch detection, note segmentation) ← `app/ui` (display, session flow). The core layer is the intellectual property of this project; the audio and UI layers are replaceable plumbing. Nothing in `core` may import from `audio` or `ui`. All frequencies flow one way: `core` computes targets; `audio` produces observations; `app` compares them.

```
core/       pitch.py, tuning.py, context.py, resolver.py, generator.py, scoring.py
audio/      capture.py, detector.py, segmenter.py, drone.py
ui/         display.py (v1: simple; later Verovio)
app.py      session orchestration + config
tests/      golden tests for core, synthesized-tone tests for audio
```

## 3. Core data model

### 3.1 SpelledPitch — the foundational decision

Pitches are represented as *spelled* pitches, never as MIDI numbers or pitch-class integers. In meantone and just systems, D♯ and E♭ are different frequencies; collapsing enharmonics is the classic mistake that would poison everything downstream, including future score import.

```python
@dataclass(frozen=True)
class SpelledPitch:
    letter: str        # 'A'..'G'
    alter: int         # -2..+2 (♭♭ .. ##), 0 = natural
    octave: int        # scientific pitch notation; A4 = the reference A
```

Derived properties (implemented as pure functions in `pitch.py`): diatonic index, chromatic pitch class, and *spelled interval* between two SpelledPitches (quality + generic size, e.g. "major 3rd", "diminished 5th"). Spelled-interval computation is required because the pure-interval mode selects ratios by interval *quality*, not by semitone count.

### 3.2 Reference pitch

```python
@dataclass(frozen=True)
class ReferencePitch:
    pitch: SpelledPitch      # normally A4
    hz: float                # 415.0, 440.0, 442.0, or arbitrary
```

### 3.3 TuningSystem — the abstraction both modes share

A TuningSystem answers exactly one question: *given a SpelledPitch and an optional HarmonicContext, what is the target frequency in Hz?*

```python
class TuningSystem(Protocol):
    def target_hz(self, pitch: SpelledPitch,
                  context: HarmonicContext | None) -> float: ...
```

Two implementations in v1:

**TemperamentTuning.** Constructed from a Scala `.scl` file (plus root pitch and ReferencePitch). Ignores `context`. Implementation notes: (a) parse `.scl` per the Scala spec — comment lines start with `!`, values are either cents (contain a `.`) or integer ratios; (b) the scale's last entry is the octave (normally `2/1` or `1200.`) and must be handled as the period, not as a note; (c) scales are not guaranteed to have 12 notes — v1 may *require* 12-note scales and raise a clear error otherwise, but the parser must not assume 12; (d) mapping from SpelledPitch to scale degree goes through chromatic pitch class relative to the configured root. Enharmonic distinction within a 12-note temperament is inherently lost (that is what a keyboard temperament *is*); this is correct behaviour, not a bug — document it in the UI ("temperament mode treats D♯ and E♭ alike; pure mode does not").

Ship with a small curated set of bundled `.scl` files: equal temperament (control), quarter-comma meantone, Vallotti, Werckmeister III, Kirnberger III. Allow loading any user-supplied `.scl`.

**PureIntervalTuning.** Requires `context`. Computes `bass_hz * ratio(spelled_interval(bass, pitch))` where `bass_hz` is itself resolved by an *anchor tuning* (see §3.5). The ratio table is keyed by spelled interval quality and size, octave-reduced then re-expanded:

```
P1 1/1   m2 16/15   M2 9/8*   m3 6/5   M3 5/4   P4 4/3
A4 45/32 d5 64/45   P5 3/2    m6 8/5   M6 5/3   m7 9/5**  M7 15/8
```

(*) The major second is famously ambiguous in just intonation (9/8 vs 10/9). v1 decision: default 9/8, expose the table in config so the user can override per-interval. (**) m7 alternatives 16/9 and 7/4 likewise config-overridable; default 9/5. The table lives in data (a dict in config), not in code.

### 3.4 HarmonicContext

```python
@dataclass(frozen=True)
class HarmonicContext:
    bass: SpelledPitch           # the sounding or implied reference note
    # room to grow (v2+): chord quality, figured bass, beat position
```

The exercise generator produces contexts *by construction*; no harmonic analysis exists anywhere in v1. This dataclass is deliberately minimal but is the extension point through which future score-import analysis will feed the same resolver.

### 3.5 Anchoring rule (the subtle design decision)

In pure mode, the bass itself must have a frequency. Rule: **the bass/drone is anchored via the currently selected TemperamentTuning** (falling back to equal temperament at the chosen reference pitch if none is selected). This makes the two modes compose rather than conflict: e.g. drone on D anchored in Vallotti@415, melody notes tuned pure above it. The resolver therefore holds *both* an anchor tuning and an active mode. Consequence worth stating in the spec: switching temperament changes pure-mode targets too (because the bass moves). This is musically correct.

### 3.6 Resolver

```python
class TargetResolver:
    def __init__(self, mode: Mode,               # TEMPERAMENT | PURE
                 temperament: TemperamentTuning, # also serves as anchor
                 ratio_table: RatioTable): ...
    def resolve(self, note: TargetNote) -> float  # Hz
```

Pure function of its inputs; no caching required at v1 scale (an exercise is tens of notes).

## 4. Exercise model and generator

```python
@dataclass(frozen=True)
class TargetNote:
    pitch: SpelledPitch
    beats: float
    context: HarmonicContext | None    # None ⇒ temperament-only note

@dataclass(frozen=True)
class Exercise:
    name: str
    notes: list[TargetNote]
    drone: SpelledPitch | None         # audible reference, if any
    tempo_bpm: float
    key: str                           # display only
```

Generator functions (all pure, seedable for reproducibility):
`scale(key, mode, octaves, range_limits)`, `arpeggio(...)`, `interval_drill(bass, interval_list)`, `long_tones(pitch_list)`. Every generated note carries its context: in a D-major scale over a D drone, the F♯ is tagged `HarmonicContext(bass=D)` and pure mode will target 5/4 above the drone's resolved Hz.

Range constraint: baroque flute sounding range D4–A6 (D4 ≈ 293.66 Hz at A=440; ≈ 277 Hz at A=415). The generator must clamp to a configurable range with these defaults. Key palette default: D, G, A, E minor, B minor, C, F — configurable; do not hard-code assumptions beyond defaults.

## 5. Audio layer

**Capture:** `sounddevice` input stream, 44.1 kHz mono, block size 512 samples (≈11.6 ms). Device selection exposed in config.

**Detection:** window 2048, hop 512 (~11.6 ms/frame). Two interchangeable backends. **Revised during implementation:** the default is a self-contained numpy YIN, not aubio. Measured on synthetic flute-like tones across D4-A6, the numpy YIN holds within 1.4 cents everywhere, while aubio's `yinfft` reads D4 about 6 cents sharp at a 2048 window and octave-halves near 1245 Hz at 4096. Six cents exceeds the entire "in tune" band, so aubio cannot be the default on this evidence. aubio remains selectable and should be re-evaluated against real flute audio, which synthetic tones do not settle. Note also that aubio's `yinfft` never populates `get_confidence()` (it returns 0.0 in 0.4.x), so voicing for that backend rests on the silence gate and range check alone. No neural models in v1. Post-filter: 5-point median on the Hz stream to kill octave blips, plus a gate on aubio's confidence and on RMS level (silence gate, default −50 dBFS, configurable — mic setups vary).

**Segmentation:** a note event opens when ≥ N consecutive frames (default 4 ≈ 46 ms) are voiced and within ±80 cents of the *current expected target*; closes on ≥ M silent/unstable frames (default 6). v1 advances through the exercise expected-note by expected-note (no free score-following): the player plays the highlighted note; the segmenter decides when it has been sounded long enough (default: 60% of its notated duration at the session tempo) and moves on. This "guided" mode eliminates alignment ambiguity entirely and is the right pedagogical shape for long-tone intonation work. Attack transients: discard the first 60 ms of each note event before computing statistics (flute attacks scoop).

**Drone:** simple synthesized drone (sine + 2–3 harmonics at −12 dB/octave, gentle attack) through `sounddevice` output at the anchor-resolved frequency. Feedback risk (drone re-entering the mic) is mitigated by the ±80-cent acceptance window around the expected note plus the confidence gate; recommend headphones in the UI copy but do not require them.

## 6. Scoring and feedback

Per-frame deviation: `1200 * log2(f_detected / f_target)` cents. Per-note statistics over the post-attack voiced frames: mean deviation, standard deviation ("steadiness"), and time-to-settle (frames until |dev| < 10 cents sustained). Display bands (defaults, configurable): |mean| ≤ 5 cents "in tune", ≤ 15 "close", else "off", colour-coded. Session summary: per-note table + aggregate by pitch class (this is the pedagogically valuable view: "your F♯ runs 12 cents sharp in pure mode"). Persist sessions as JSON lines in `~/.flutetrainer/sessions/` for later progress tracking; schema versioned with a `"v": 1` field.

Real-time display in v1: current target note (name + staff position acceptable as text/simple graphics), large cents needle with the two tolerance bands, and a scrolling 5-second pitch trace. Verovio-rendered notation is v2.

## 7. Configuration

Single TOML file `~/.flutetrainer/config.toml`, all defaults embedded in code and dumped on first run. Contents: reference pitch, temperament file + root, mode, ratio-table overrides, mic device, gates and thresholds, tolerance bands, flute range, key palette. No hidden constants: every number named in §5–6 must live here.

## 8. Testing strategy (write these first)

Golden tests for the resolver, hand-computed and committed as data: e.g. in Vallotti rooted on C with A4=415 Hz, assert Hz values for all 12 pitch classes across two octaves to ±0.01 Hz; in pure mode, assert F♯5 over D5 drone = drone × 5/4 exactly. Scala parser tests against at least one cents-based and one ratio-based `.scl`, plus rejection tests (non-12-note file, malformed line). Interval-spelling tests (C→E major 3rd, C→F♭ diminished 4th — must select *different* ratios). Audio tests without a mic: feed synthesized sines and sawtooths (415.0 Hz, 439.0 Hz, a 20-cent-flat G5) through the detector+segmenter offline and assert detected cents within ±2. These synthetic tests are the acceptance gate before any live-mic work.

## 9. Acceptance criteria for v1

Runs on macOS from `python app.py`. Player selects an exercise, mode, temperament, and drone; plays through it guided note-by-note; sees live cents feedback with < 100 ms perceived latency; receives a per-note and per-pitch-class summary; session saved. Switching mode between temperament and pure changes targets correctly per §3.5, verifiable in the summary against golden values.

## 10. Explicit non-goals for v1 (do not implement)

MusicXML/MIDI import; harmonic analysis of any kind; free score-following/alignment; polyphony; vibrato analysis; mobile/web builds; Verovio engraving; user accounts or cloud anything.

## 11. Port-survival notes

Everything in `core` must be expressible with dataclasses, dicts, and pure functions — no Python-only cleverness (no metaclasses, no dynamic dispatch beyond the one Protocol). The `.scl` bundle, the ratio table, and the golden-test data are the durable assets; they carry unchanged into a C++/JUCE or WASM port. The guided-segmentation state machine (§5) should be written as an explicit, documented state machine for the same reason.

## 12. Addendum: numeric types and equality

**Rule: integers count, floats measure.** `int` is used only for discrete, naturally equality-comparable quantities — `alter` (−2..+2), `octave`, frame counts, sample counts, scale-degree indices. `float` is used for every physical or continuous quantity — Hz, cents, seconds, beats, dBFS, and `tempo_bpm`.

`tempo_bpm` is a float because tempo is a *rate*, not a count. Integer BPM is a convention of mechanical metronomes, not a property of the music or the arithmetic: playing along with a recording sitting at 71.3 bpm, ramping tempo gradually across sessions, or halving an odd tempo all require fractional values. The first operation performed on tempo is `60.0 / bpm`, which is float regardless, so an int field would only guarantee a conversion at first use. A UI may snap tempo input to whole numbers; that is a presentation constraint and does not belong in the data model.

`beats` cannot be integral at all — a dotted quarter is 1.5, a triplet eighth is 1/3. Binary representation error for 1/3 is ~1e-16 of a beat against tolerances measured in tens of milliseconds, so it is musically irrelevant, but it does matter for test authoring:

**Equality rule: never compare frequencies, cents, or durations with `==`.** All golden tests in §8 use approximate comparison (`math.isclose` or `pytest.approx`) with an explicit tolerance stated per assertion. Exact `==` is permitted only on `SpelledPitch`, interval names, and integer counts.

Precision is not a concern: doubles carry ~15 significant digits, nothing here needs more than 6, and every target frequency is computed fresh from the reference pitch in two or three multiplications — there are no accumulation loops in which error could compound.
