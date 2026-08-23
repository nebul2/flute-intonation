# Baroque Flute Intonation Trainer

Implements `DESIGN.md`. Core layer complete and tested; audio layer complete and
tested offline; live microphone path written but **not yet run against a real
flute** — that is the next task, and it needs a Mac.

## Status

| Layer | State | Tests |
|---|---|---|
| `core/` — pitch, tuning, resolver, generator, scoring | complete | 41 passing |
| `audio/` — detector, segmenter | complete, validated on synthetic tones | 15 passing |
| `app.py` — session, CLI, simulated player | complete | exercised via `--simulate` |
| `ui/` — Verovio notation | not started (v2) | — |

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install numpy sounddevice pytest
pip install aubio          # optional, see "Findings" below
python -m pytest flutetrainer/tests -q
```

`aubio` 0.4.9 has no wheel for Python 3.12 and builds from source; it worked
cleanly in testing but is not required.

## Usage

```bash
python -m flutetrainer.app --list-temperaments

# no microphone needed: simulates a player 12 cents flat
python -m flutetrainer.app --exercise arpeggio --tonic D --mode pure --simulate

# live
python -m flutetrainer.app --exercise scale --tonic D \
    --mode pure --temperament vallotti --pitch 415
```

## Findings from implementation

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

## Next steps

1. **Live-microphone validation on macOS.** Latency feel, input gain, the
   silence gate (−50 dBFS is a guess), and drone bleed all need real testing.
2. **Re-measure both detector backends on recorded flute audio** and revisit the
   default.
3. Config file (`~/.flutetrainer/config.toml`) — §7 of the design; currently the
   constants live as module-level defaults with CLI overrides.
4. Verovio notation display (§6, v2).
5. Score import (§10 non-goal for v1) — the `HarmonicContext` extension point in
   `core/context.py` is where analysis would feed in.

## Layout

```
core/       pure logic: no audio, no I/O, deterministic
audio/      capture, detection, segmentation
data/       bundled .scl temperaments
tools/      make_temperaments.py — regenerates the .scl files from first principles
tests/      golden tests (core) + synthetic-tone tests (audio)
```

The dependency direction is strict: nothing in `core/` imports from `audio/` or
`ui/`. The `.scl` files, the ratio table and the golden test data are the durable
assets — they carry unchanged into a C++/JUCE or WASM port.
