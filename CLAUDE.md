# Baroque flute intonation trainer

Read DESIGN.md first — it is the frozen v1 spec. README.md records
implementation findings that supersede parts of it — notably the pitch
detector default (aubio -> a bundled numpy YIN) and the segmenter's release
semantics (a release no longer completes a note; duration is the only route
to DONE).

Environment: Python 3.14 in ./.venv. Run everything from the repo root.
Tests: `python -m pytest flutetrainer/tests -q` — expect 99 passed, 1 skipped.
No-mic smoke test: `python -m flutetrainer.app --exercise arpeggio --tonic D --mode pure --simulate`

Real flute recordings live in ./recordings (gitignored). Measure the detector
against them with `python -m flutetrainer.tools.analyse_recording recordings/`
rather than reasoning about gates from the code; capture new material with
`python -m flutetrainer.tools.record`. Synthetic tones have repeatedly failed
to reveal defects that real audio found in minutes.

Rules:
- Nothing in core/ may import from audio/ or ui/.
- Never compare frequencies, cents or durations with ==; use approx
  comparison with an explicit tolerance.
- Pitches are spelled (letter/alter/octave), never MIDI numbers.
- Note naming is display-only and lives in ui/naming.py; solfège is
  fixed-do (C = Do) and is the default. It must never reach tuning.
- Run the tests before claiming a task is done.
- Don't install aubio; it has no wheels for 3.14 and is optional.
