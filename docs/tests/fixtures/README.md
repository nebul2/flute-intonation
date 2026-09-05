# Test fixtures

Short excerpts cut from real flute recordings by
`python -m flutetrainer.tools.make_excerpts`. The full takes stay out of
the repository; these carry the behaviour worth pinning.

**sustained.wav** — Two held notes. Nothing here may be taken for an ornament, and the detector must read them steadily: the false-positive case.

**tongued.wav** — The same note tongued several times. Repetition is not alternation, because the pitch never changes.

**trill.wav** — An accelerating trill, slow to fast. Its alternations shorten from about half a second to a twentieth, every one long enough to be a region of its own -- which is why the first trill rule, written to catch a pitch leaving and returning within one region, never fired.

**trill_fingering.wav** — A trill whose fingering gives way as it accelerates: the upper pole drifts up by tens of cents and settles about 155 cents above the main note, between the written auxiliary and its neighbour.

**scales_run_together.wav** — Two scales with no breath between them -- D major straight into G major. Silence cannot separate these: within a scale the notes are contiguous (median gap 0.00s) and these two are 0.05s apart, so a gap threshold can never split them and the contour must.

**scale_two_octave.wav** — The ascent of a two-octave D major scale, containing one of the detector's octave jumps: E5 heard as E4. Left unrepaired it breaks the run in half and the scale is lost.

**slurred.wav** — A slurred passage. The pitch genuinely sounds the notes in between, so a region that is still travelling is a transition, not a note -- the fault that reported an F natural in a prelude that has none.
