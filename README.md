# Baroque Flute Intonation Trainer

If you're not into Python, in a hurry, and just want to try out the pitch trainer:
https://nebul2.github.io/flute-intonation/

Implements `DESIGN.md`. Generates exercises suited to the baroque flute, listens
through the microphone, and reports intonation in cents against a *context-aware*
target: either a historical temperament or pure intervals over a drone.

Validated against real flute audio and exercised live on macOS. `README.md`
records findings that supersede parts of the frozen v1 spec — where the two
disagree, this file is the later evidence.

## Status
| Layer | State | Notes |
|---|---|---|
| `core/` — pitch, tuning, resolver, generator, scoring | complete | golden tests, hand-computed |
| `audio/` — detector, segmenter, drone | complete | validated on real flute audio, not only synthetic tones |
| `app.py` — guided session, tuner mode, CLI | complete | exercised live against a flute |
| `ui/` — note naming | naming only | Verovio notation is still v2 |
| `tools/` — record, analyse_recording | complete | capture and measure real audio |

`python -m pytest flutetrainer/tests -q` — 88 passed, 1 skipped.

## Setup
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install numpy sounddevice pytest
python -m pytest flutetrainer/tests -q
```

Python 3.14. **Do not install aubio**: it has no wheel for 3.14, it is optional,
and the one finding that depends on it is flagged as unresolved below.

## Usage

```bash
python -m flutetrainer.app --list-temperaments

# no microphone needed: simulates a player 12 cents flat
python -m flutetrainer.app --exercise arpeggio --tonic D --mode pure --simulate

# live
python -m flutetrainer.app --exercise scale --tonic D \
    --mode pure --temperament vallotti --pitch 415
```

### Note naming and tuner mode

Note names display as fixed-do solfège by default (Do Ré Mi Fa Sol La Si, so
C is always Do regardless of key); `--naming letters` gives C D E F G A B.
Naming lives in `ui/naming.py` and never reaches the tuning engine.

```bash
# just listen and name what is played, in the chosen temperament
python -m flutetrainer.app --tuner --temperament vallotti --pitch 415
```

Tuner mode reports the nearest note *as the selected temperament defines it*,
not equal temperament, so at A=415 in Vallotti a played F♯4 reads against
348.58 Hz rather than against an equal-tempered value.

### Practice exercises

```bash
python -m flutetrainer.app --practice              # list them
python -m flutetrainer.app --practice intervals    # the centrepiece
```

Four to start, following the pedagogy plan: `calibration` (long tones over the
drone), `intervals` (the same written note twice — tempered, then pure over the
drone; in Vallotti at 415 the pure third sits 9.8 cents lower), `enharmonic`
(D♯5 over B, then E♭5 over C — one fingering, two targets, 39 cents apart, the
exercise the spelled-pitch model exists for), `predict` (call sharp, flat
or in tune before the number is revealed; agreement is scored), and `stopper`
(place le bouchon: the three D's and the three G's with a set embouchure —
nothing is revealed per note, and the report gives each octave's width in
cents, the mean octave error to minimise, and whether it tightened or widened
since the previous saved run). The stopper check deliberately ignores absolute
pitch — the criterion is the internal truth of the octaves, which is exactly
what a tuner cannot show — and offers no "move it in/out" advice, because that
sign depends on the instrument: run, move, run again, and the comparison says
whether the move helped. The acceptance window widens to ±120 cents there,
since the flute's own tuning is the thing under test.

Menu and predict prompts commit the moment the input is unambiguous — `c`
selects calibration, `i` intervals, and in predict a single `s`, `f`, `t` or
`i` registers the call without Enter, because hands holding a flute get one
keystroke. Esc answers "no choice"; piped stdin falls back to a line read with
the same prefix rule.

Practice exercises show **no needle while you play** — only progress toward the
required duration — and reveal the measurement when the note ends, per the
guidance-hypothesis risk the plan documents. The live needle stays in the tuner
and in `--exercise` runs. Practice always runs in pure mode: the resolver's
documented fallback sends context-free notes to the temperament, which is what
lets one exercise contain both target kinds.

The tuner reacts to `--temperament`, `--root` and `--pitch`; it deliberately
ignores `--mode`, because a pure target needs a bass and a free tuner has none
(it says so when asked). A tuner-with-drone that reads pure intervals over a
chosen tonic is a natural later addition.

### Recording reference audio

Validating the live path needs *fixed* audio to measure against, not a fresh
performance each time. `tools/record.py` captures a scripted set of takes at
exactly the settings the live path uses (44.1 kHz, mono, 512-sample blocks):

```bash
python -m flutetrainer.tools.record --monitor        # set your playing position
python -m flutetrainer.tools.record --all            # every take, in order
python -m flutetrainer.tools.record --take longtones # just one
```

Seven takes land in `recordings/` (gitignored) as mono 32-bit PCM WAV:
`silence`, `breath`, `fork`, `longtones`, `attacks`, `dynamics`, `arpeggio`.
Each is a separate file so that a gate failure can be attributed to a single
cause — mixing breath noise and long tones into one recording would make that
impossible.

Each take prompts before it starts: Enter records, `s` skips, `q` quits.
Ctrl-C means "stop what is happening now", which depends on where you are — at
the prompt it quits the session, during the countdown it abandons the take
before any audio exists, and during recording it ends the take and **keeps what
was played**. That last case is the normal way to finish a long take early, so
it must never lose audio; all three paths are tested by sending real SIGINTs.

32-bit rather than 16-bit so that the noise floor of the *room* is never
confused with the noise floor of the *format*: a silence gate calibrated
against quantisation noise would be measuring the wrong thing.

### Measuring the detector against a recording

`tools/analyse_recording.py` re-runs the real `PitchDetector` over a WAV and
reports where its gates land. The headline output is *gate attribution* — of
all frames, how many the silence gate discarded, how many the confidence
threshold, how many the range check, and how many survived. A live path that
feels dead usually has one gate eating everything, and this says which.

```bash
python -m flutetrainer.tools.analyse_recording recordings/
python -m flutetrainer.tools.analyse_recording recordings/fork.wav --expect-hz 440
python -m flutetrainer.tools.analyse_recording recordings/longtones.wav --trace
python -m flutetrainer.tools.analyse_recording recordings/breath.wav --sweep
```

Raw level, raw pitch and raw confidence are recorded per frame *before* gating,
so `--sweep` re-decides both thresholds by arithmetic over values already in
hand — no audio is re-analysed. Threshold choice becomes a table lookup rather
than a series of guesses.

Validated against synthetic signals with known answers: a clean tone reads
+0.1c against its true frequency, a tone below the gate reads 100 % silence, a
tone at 0 dB SNR reads 99.6 % confidence-gated, and a deliberate 100 ms gap is
reported as exactly one 116 ms dropout attributed to the silence gate.

## Web version

**https://nebul2.github.io/flute-intonation/** — served by GitHub Pages from
`docs/`; `git push` is the whole release process. Zero build step: plain ES
modules, no bundler, no dependencies. French by default in a French browser,
EN·FR toggle.

Landing page in three groups — Tools (Tuner, Stopper check, Hardware check),
Play (Practice, Listen to me), Set up (Mode & temperament, Settings) — over
a status strip that always shows the tuning the app is about to judge you
against. The stopper check is a tool on its own page, not a practice
exercise; its report now says which way to move the stopper: octaves wide →
away from the embouchure hole, narrow → towards it (the cavity behind the
hole makes the end correction grow with frequency, flattening the upper
register; too little cavity leaves octaves wide). Every run-style page gets
its Stop / Redo / Back bars from one shared `runNav()`. One shared
audio engine (`docs/audio/engine.js`) keeps the microphone across sections.

The core is ported, not re-imagined: `docs/core/` mirrors `flutetrainer/core/`,
the five `.scl` files are embedded byte-for-byte by
`tools/make_web_temperaments.py`, and the golden tests from `test_core.py`
run against the port (`cd docs && npm test`: Vallotti at 415 to ±0.01 Hz, the
pure 5:4, the meantone cross-validation). The detector port (`docs/audio/yin.js`)
carries every real-audio fix and reads within ±0.9 cents across D4–A6 at both
44.1 and 48 kHz. The tuner therefore reads against the selected temperament,
not equal temperament.

The practice exercises run in the browser too — calibration, interval in
context, D♯/E♭, predict-then-see, and an endless variant that draws random
notes of the chosen major or minor scale over the tonic drone until you stop — on ports of the
segmenter, generator and scoring (`docs/audio/segmenter.js`, `docs/core/`),
with the desktop rules intact: no needle while playing, duration the only
route to a completed note, the drone-unison guard calibrated from 1.5 s of
measured background, and the stopper report comparing against the previous
run. Practice history lives on the device (IndexedDB), in the desktop session
schema, with export to a JSON file from Settings. The PWA manifest and icon
set make *Add to Home Screen* install it as an app.

Listen to me is free play with feedback: it asks for the tonic first, which
sets the harmonic context, so every note that follows is read both against the
temperament and as a pure interval above the tonic; notes are segmented online
(`docs/audio/regions.js`) and those under 120 ms are counted, not measured. A
per-note table fills in as you play (`docs/core/stats.js`): occurrences, mean
and min…max deviation, within-note stability, time held, mean level, whether
the note goes sharp or flat when louder (a fit across occurrences, reported
only over ≥ 4 notes spanning ≥ 6 dB), and drift across the piece; the
note-by-note log is an option, off by default.
With a drone through speakers, three notch filters on the drone's partials sit
between the microphone and the detector — engaged only where the expected note
is not that partial — so the player no longer has to out-play the bleed.

Anonymous audience counts go to GoatCounter (`docs/analytics.js`): the name
of the section opened, once per navigation, and nothing else — no URL, no
setting, no note, no result. GoatCounter sets no cookie and keeps no IP.
The script is fetched only when counting is enabled; the Settings toggle
switches it off entirely, Do Not Track is honoured, localhost is never
counted, and the footer says so. This keeps it inside the CNIL's
audience-measurement exemption rather than consent-banner territory.

Offline use comes from a network-first service worker (`docs/sw.js`): while
online every request goes to the network and refreshes the cache, so a
visitor always runs the files just pushed; only when the network fails is
the cached copy served. The whole app is precached on install, and a test
fails if any served file is missing from the list. Cross-origin requests
(the audience counter) are never intercepted. A footer chip says when you
are offline.

Sessions can be named ("flute 1", "flute 2") and are browsable in a
Sessions view, where ticking two compares them (`docs/core/compare.js`).
Two or three sessions compare at once. The comparison refuses outright when
the tuning settings differ — the numbers would not be on the same scale — and
warns when it is thin. It opens with a score: each instrument's mean distance
from its own pitch centre, in cents, alongside repeatability and steadiness,
and a verdict naming the better-tuned one *only when a paired test says the
lead survives the note-to-note scatter*. One note badly out moves the score
but does not earn a verdict, which is deliberate — a winner declared on noise
would be worse than no winner, since it would be acted on. Its
central move is removing each instrument's own pitch centre before
comparing notes: a flute sitting eight cents sharp throughout would
otherwise read "+8" on every note, which describes its pitch, not its
tuning. The overall difference is reported once, separately, and each
per-note difference is marked as beyond or within the spread so small
samples are not over-read. Two stopper checks also compare octave widths.

Notes are listed high at the top, low at the bottom everywhere, and octaves
read by register — Ré grave, Ré médium, Ré aigu — rather than by number.
Where the bands break is a setting, since it depends on the instrument: **D**
by default, because that is where the one-keyed flute's registers break, so
the three D's of the stopper check read exactly as low, middle and high —
breaking at C would call C♯5 a "medium" note although it is played as a
low-register one. A flute with a C foot can set the break to C, which also
makes the register names line up with the octave numbers. Numbers remain
available, and notes outside the bands keep theirs.

Background documents ship with the app under `docs/help/`, one Markdown file
per topic per language, fetched on demand and precached so they read
offline. `ui/markdown.js` parses a small subset to a block tree — a pure
function, so the shipped documents are themselves tested: every link
absolute, no unparsed markers, real sections. `helpSection(topic)` drops a
native `<details>` disclosure into any page, with a download button that
hands over the original `.md`. The stopper check uses it for the background
on why one stopper position cannot true every octave at once.

Still to build: routines by length.

## Findings

**The detector default changed.** `DESIGN.md` §5 proposed aubio's `yinfft`.
Measured on synthetic flute-like tones across D4–A6, the bundled numpy YIN holds
within **1.4 cents** everywhere, while aubio reads D4 about **6 cents sharp** at
a 2048 window and octave-halves near 1245 Hz at 4096. Six cents is larger than
the entire "in tune" band, so aubio is not the default. It stays selectable
(`backend="aubio"`), and `test_aubio_low_register_bias_is_documented` pins the
observation so a future switch is deliberate. **Synthetic tones do not settle
this** — real flute audio has breath noise and a different harmonic balance, so
re-measure both backends on live recordings before concluding.

Also: aubio's `yinfft` never populates `get_confidence()` (returns 0.0 in
0.4.x). Gating on it silently discards every frame.

**CoreAudio input streams begin with ~150 ms of garbage.** Measured on the
built-in MacBook Pro mic: the first dozen blocks of a stream ramp from the room
floor down to about −175 dBFS and back up before settling. `tools/record.py`
therefore discards `WARMUP_SECONDS` (0.25 s) at the head of every take —
without it the `silence` take's noise floor, which is precisely the number the
−50 dBFS gate should be derived from, is dragged tens of dB below anything the
room actually produces. **`run_live` in `app.py` does not yet do this** and
consumes the transient as if it were real audio.

For reference, that same measurement puts the room floor on this machine at
roughly −68 dBFS RMS, some 18 dB below the current gate.

**Breath noise crashed the detector.** Found by the `breath` take on the first
real-audio pass, in `_yin`'s parabolic interpolation. With breath passing over
the embouchure and no note speaking, the difference function has no dip
anywhere in the search range, so `tau` lands on the boundary with the curve
still descending and the three samples collinear. The parabola degenerates and
the "sub-sample" correction leapt **+908 samples**, indexing past the end of a
1024-element array: `IndexError`. The old `abs(denominator) > 1e-12` guard is
orders of magnitude too weak for that case. The correction is now bounded to
half a sample either way — a refinement of a discrete minimum cannot
legitimately move further — and the confidence lookup clamps its index as
defence in depth. Pinned by
`test_parabolic_refinement_is_bounded_on_a_degenerate_parabola` using the
values measured from the recording. **Synthetic tones could never have found
this**: a periodic signal always has a well-conditioned dip.

**A harmonic product spectrum cannot cross-check a tuning fork.** The obvious
way to catch YIN octave errors is a second, independent estimator, and HPS is
the obvious choice. It is degenerate on a near-pure tone: with no harmonics to
multiply, the product peaks at a subharmonic. Measured on a synthetic 415 Hz
sine it reported an octave disagreement on 100 % of frames while agreeing
perfectly on a harmonically rich D4 — a confident false alarm on exactly the
`fork` take whose only purpose is ground truth. `analyse_recording.py`
therefore asks the narrower question instead: for each detected f0, is there
energy at f0, at f0/2, at 2*f0? An octave-low error reports an f0 carrying
almost no energy while 2*f0 is strong; an octave-high error leaves as much
energy an octave below as at the reported f0. That test fires correctly on
injected errors in both directions, on both pure and harmonic tones, with no
false positives on correct input.

**Two bugs worth knowing about, both now fixed and regression-tested.** The YIN
difference function needs the *half-window* correlated against the full block,
not the block's own autocorrelation — the wrong version produced a constant
−30 cent bias that looked plausible. And applying a Hann window before YIN
biases the period estimate; YIN takes the raw signal.

**Cross-validation of the tuning engine.** In quarter-comma meantone the
tempered F♯ over D and the pure 5:4 F♯ over D agree to 0.00 cents, as they must,
since that temperament has pure major thirds by construction. The two values are
computed by completely independent paths (Scala cents arithmetic vs. a rational
ratio), so their agreement is real evidence rather than a tautology.

### Drone feedback is a real hazard, measured

The drone (`audio/drone.py`) is now implemented and sounds through the default
output. Verified offline: this project's own detector reads it at +0.03 cents,
its partials roll off −12.6 dB and −20.2 dB, and it is continuous across
callback boundaries so it does not click.

Played through **speakers**, it re-enters the microphone, and a live run of the
D arpeggio over a D drone showed both consequences with nobody playing:

* the opening Ré4 — the note that *is* the drone pitch — was scored **+1.9
  cents, "in tune"**. The trainer reported a result for a note nobody sounded.
  A wrong answer is worse than a missing feature.
* every later note showed the display pegged at −385 cents, which is exactly
  the drone's D4 seen from an F♯4 target. The ±80-cent acceptance window
  rejected it correctly, so those notes never completed — the segmenter
  behaved as designed.

The design's mitigation (§5) therefore holds for every note *except* the
unison, which is the one that matters most in a drone exercise.

**Fixed by a measured onset level.** Pitch cannot separate a drone from a
played note at the unison, because the two frequencies are identical. Level
can: playing sits 20–30 dB above bleed. Rather than hard-code a threshold —
which would depend on speaker volume, room and microphone distance, all of
which change between sessions — the session now spends 1.5 s at the start
listening with the drone already sounding and nobody playing. Whatever it hears
*is* the bleed. A note may only **open** above `background + 10 dB`
(`--onset-margin-db`); once sounding it may decay freely, so a diminuendo is
not cut short.

Re-running the same scenario, drone through speakers and nobody playing: the
opening Ré4 now reports **"(not played)"** where it previously scored "+1.9
cents, in tune".

The same measurement doubles as the adaptive silence gate that "Next steps"
called for: with headphones and no bleed it calibrates against the room floor
instead, so it tracks a 10 dB change of room without a constant to re-tune.

**The check applies only at the unison.** A first version imposed it on every
note and broke the interval drill: a note played more quietly than the drone
never opened, because the measured background includes the bleed, even though
the detector was reading its pitch correctly the whole time. Everywhere except
the drone's own pitch the ±80-cent window already rejects the drone, so a level
floor there does nothing but harm. The session prints which notes the check
covers, so "(not played)" is never a mystery.

If the drone is loud enough that the computed threshold exceeds typical playing
level (−20 dBFS at this microphone), the session says so rather than silently
refusing every note. `--drone-level` sets the drone amplitude, `--no-drone`
silences it, and `--no-calibrate` disables the check entirely.

### A release no longer completes a note (supersedes DESIGN.md §5)

The spec says a note "closes on >= M silent/unstable frames" *and* that it
advances once "sounded long enough". Those two readings conflict whenever a
release arrives early, and the original code took the first: any release
completed the note, scoring it from whatever had been collected.

Observed live at 20 bpm, where `interval_drill`'s 4-beat notes last 12 s and
need 7.2 s sustained — the second and third notes "matched almost instantly",
because no attack survives 7.2 s unbroken by chance and a momentary drop ended
the note with about a tenth of a second of audio. It stayed hidden at faster
tempi, where notes usually reached their 1.2 s requirement before any wobble.

**Duration is now the only route to DONE.** A release abandons the attempt
instead, and the two reasons for one are treated differently, which is the
distinction §5 itself draws:

* gone *silent* — the player breathed. The frames already collected are kept,
  so a breath in a long tone does not throw away the progress before it.
* gone *off target* — the player is sounding a different note, so the fragment
  does not describe this target and is discarded.

### Measured on real flute audio

First pass over seven takes (baroque flute at A=415, built-in MacBook Pro mic,
~3 min of audio). Two predictions from reading the code were wrong, which is
why the recordings exist.

**Caveat on every level figure below.** These takes were recorded in a
basement, which is far quieter than a normal practice room: the measured floor
of −68.8 dBFS leaves about 19 dB of headroom under the −50 dBFS gate. A typical
room could sit 15–25 dB higher, leaving little or none. Treat the level numbers
as a best case, not a specification, and re-measure somewhere noisier before
fixing a silence-gate default — or make the gate adaptive to the observed floor
instead of a fixed constant. The confidence gate, which does the real work of
separating breath from notes, does not depend on absolute level and should
transfer far better.

**The confidence gate is not too strict — it is the thing that works.** The
prediction was that 0.85 would reject real flute wholesale. It passes **96–97 %**
of frames on every take containing notes, and rejects **97 %** of the `breath`
take. Breath noise sits at a median −27.7 dBFS, far above the silence gate, so
level alone cannot distinguish blowing from playing; confidence can, and does.
Lowering the threshold would *admit* breath noise: at 0.50, 13 % of breath
frames would pass as pitch. Leave it at 0.85.

**The silence gate is sound but is measured on the wrong buffer.** Room floor
is −68.8 dBFS median, some 19 dB below the −50 gate, so the value itself is
fine. But the gate reads the 512-sample hop while pitch comes from the 2048
window, and 0.1–2.4 % of frames per take are discarded on hop level while the
analysis window is above the gate. Small, and worth fixing.

**Absolute accuracy through a real mic and room: +0.4 cents** against an
880 Hz reference tone, with a standard deviation of 0.0 cents over 15 seconds.

**Octave errors are rare and register-dependent**, as predicted: 0.10 %
octave-down across the long-tone sweep, none at all in the arpeggio, and 1.34 %
in the `attacks` take — they cluster on tongued onsets. Two independent methods
(local-median outliers, spectral energy) agree to within a few frames.

**Notes do not fragment — an earlier claim here was wrong.** The first pass
reported 8–16 dropouts per take and called it the main defect. That was an
artefact of how this repo's own analyser defined a dropout: any unvoiced gap
flanked by voiced frames, which counts every ordinary note change and every
rest between repeated notes. Measured properly — the pitch must match on both
sides *and* the level must have stayed above the gate, so sound was still
present when voicing was lost — the whole corpus contains **2 dropouts of
about 50 ms and 3 of a single frame**. The `dynamics` take runs 11.9 seconds
continuously from pp to ff and back with none at all. Both the definition and
the misleading numbers are fixed.

**Cost is 0.08–0.15 ms per frame against an 11.6 ms budget** (under 1.5 %), so
real-time is not in question.

#### Changes made on this evidence

* The level gate now reads the **analysis window** rather than the 512-sample
  hop, since that is the buffer the pitch is computed from. Recovers 12–26
  frames per take with **no change** to breath rejection (33 frames, 2.6 %) or
  to the silence take (0 %). Expected to matter considerably more in a noisier
  room than the one these takes were made in.
* The median history is now cleared on **any** unvoiced frame, not only a
  silent one. Note changes are rejected by the confidence gate, so the old
  behaviour blended the outgoing note's pitch into the first frames of the
  incoming note — right where the attack scoop already makes the estimate
  fragile.
* Thresholds themselves are **unchanged**: 0.85 confidence and −50 dBFS both
  measured correct on this evidence.

## Next steps

1. **Short notes in imported music.** Measured against real tongued onsets:
   ~40 ms is enough to identify *which* note was played (±80 cents), ~100 ms
   for a trustworthy intonation reading, ~120–150 ms before accuracy stops
   improving. The floor is architectural, not acoustic — 46 ms to fill the
   2048-sample window plus the 60 ms attack skip — so it is the same at D4 as
   at A6. Plan: classify each imported note at load time as measurable
   (≥120 ms, scored), passable (40–120 ms, confirms position only) or ignored,
   treat measurable notes as anchors, advance through short runs on the time
   grid and re-sync at the next anchor. Mark unmeasured notes visibly rather
   than dropping them silently.
2. **The session waits forever for a note.** Fine for guided practice, wrong
   for imported music: an anchor that never arrives must time out and be marked
   missed. Needed before item 1 is usable.
3. **Guard against breath opening a note.** Gentle blowing excites the flute's
   air column into confident false pitches (17–35 % of breath frames voiced,
   producing 0.2–0.3 s spurious regions at D4/D5/D6). Too short to *complete* a
   note, but long enough to open one inside the ±80-cent window and contaminate
   its statistics, since the attack skip discards only 60 ms. The onset level
   check added for the drone is the same mechanism; it currently applies only
   at the drone's pitch and would need widening carefully — a first attempt at
   applying it everywhere broke quiet playing.
4. **Parameterise the sample rate in `app.py`.** The detector already takes it
   as an argument and reads within ±0.8 cents at 48 kHz across D4–A6, but the
   session hard-codes 44.1 kHz. This is the one portability blocker sitting in
   the code today, and mobile captures at 48 kHz.
5. **A general adaptive silence gate.** Partly done: the session now measures
   the background and derives an onset threshold from it, which handles the
   drone unison and adapts to the room. The −50 dBFS constant that decides
   whether a frame is analysed at all is still fixed, and the room floor moved
   10 dB between two rooms in one evening (−68.8 to −58.6 dBFS), leaving 16 dB
   and 5 dB of headroom respectively.
6. **Re-measure both detector backends on recorded flute audio** and revisit
   the default. Blocked: aubio is not installed and has no wheels for 3.14, so
   that comparison still rests on synthetic tones alone.
7. Config file (`~/.flutetrainer/config.toml`) — §7 of the design; the
   constants currently live as module-level defaults with CLI overrides.
8. **Mobile.** A web app (PWA) is the shortest route to something testable on a
   phone: `core/` is pure logic and the `.scl` files, ratio table and golden
   test data port unchanged, so the golden tests can be re-run in TypeScript to
   prove the port. `getUserMedia` must disable `autoGainControl`,
   `noiseSuppression` and `echoCancellation`, or browser AGC will destroy the
   level-based calibration.
9. Verovio notation display (§6, v2).
10. Score import (§10 non-goal for v1) — the `HarmonicContext` extension point
    in `core/context.py` is where analysis would feed in.

## Layout

```
core/       pure logic: no audio, no I/O, deterministic
audio/      detector, segmenter, drone
ui/         naming.py — note-name styles (display only)
data/       bundled .scl temperaments
tools/      make_temperaments.py  — regenerates the .scl files from first principles
            record.py             — captures reference takes of real playing
            analyse_recording.py  — measures the detector against a recording
tests/      golden tests (core), synthetic-tone and real-audio regression tests
```

The dependency direction is strict: nothing in `core/` imports from `audio/` or
`ui/`, and note naming is presentation, so a naming choice can never reach a
target frequency. The `.scl` files, the ratio table and the golden test data are
the durable assets — they carry unchanged into a C++/JUCE or WASM port.
