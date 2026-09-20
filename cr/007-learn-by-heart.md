# CR-007 — Learning a piece by heart

Status: **proposed**, not started. Raised 20 September 2026, by the player.

## Why

> A tool to help me learn something by heart. Either LBG would have access to
> the score/midi, or I'd play it once from the sheet music, then we could look
> fun ways of repeating loops to mix muscle memory, ear and conscious thought
> to learn something by heart.

Every other exercise in this app is about one note at a time. This is the
first that is about a *piece*, and it is the one the app is strangely well
equipped for without knowing it: half of it is already built, in `tests/`,
where it was put to check the detector rather than to teach anyone anything.

What exists today, already working and already measured:

- **A score reader.** `docs/tests/midi.js` reads note-ons from a Standard MIDI
  File in order. It is deliberately minimal and already carries the right
  design decision in its header comment: *"Timing is read but not used for
  alignment: a player's rubato must not count against them."*
- **An aligner.** `alignToTemplate()` in `docs/core/scales.js` is a
  Needleman–Wunsch alignment of what was heard against what was expected,
  over chromatic indices, scoring `matched / wrong / missing / extra /
  repeats`. It already knows that a semitone off is a wrong note and a fifth
  off is a different one.
- **Four movements of real repertoire**, bundled and licensed:
  `flutetrainer/data/pieces/telemann-fantasias`, CC BY-SA 4.0, Llorenç
  Lledó's LilyPond edition, 83 to 679 notes each.
- **Two measurements on the player's own playing**, which are the whole reason
  this CR has a constraints section:

  | take | matched | wrong | missing | recall |
  |---|---|---|---|---|
  | No. 8 Largo, played slowly, 234 notes | 229 | 1 | 4 | **98 %** |
  | No. 2 Grave, free tempo, 83 notes | 61 | 4 | 18 | 73 % |

So "did you play the right notes in the right order" is a solved problem at
one tempo and an unsolved one at another, and this CR lives on that line.

## The constraint that shapes the whole thing

**Knowing the notes and hearing the notes are different, and a tool that
confuses them will be abandoned in a week.**

The 73 % take is the warning. Its failures were not memory failures and not
even detector failures in the ordinary sense:

- four "wrong" notes were F naturals sitting 60-odd cents sharp, named F♯ —
  the flute, not the playing, and not the memory;
- the missing notes were G♯/A semiquaver alternations, below the short-note
  floor (roughly 100 ms to score a note, 40 ms to identify one — an
  architectural limit, not a tuning parameter).

A memorisation tool that reports those as mistakes is lying to the player
about the thing they are trying to learn. Three consequences:

1. **"Wrong" and "not heard" must never be shown as the same thing**, and
   where the app cannot tell them apart it says so. The aligner already
   distinguishes `wrong` from `missing`; the view must not flatten them.
2. **Loops must run slow enough to be heard.** That is a real restriction, and
   it happens to be what the memorising wants anyway — Quantz X §3: never play
   a piece faster than you can keep in one tempo. But it means the tool stops
   being able to check you at exactly the point you can play the piece up to
   speed, and it should say that out loud rather than degrade quietly.
3. **Ornaments have to be matched as ornaments.** A written trill is heard as
   a run of alternating regions, not as one note; aligned naively it becomes a
   shower of wrong notes in the middle of a phrase you played perfectly. This
   is CR-001's territory and is a hard dependency for any piece with agréments
   — which, on this instrument, is all of them.

## What is out there already

**Tools.** Two families, neither of which does this:

- *Loopers* — Music Looper, Choreoloop, Amazing Slow Downer — loop and slow
  **audio**. They help you hear a passage; they cannot tell whether you played
  it.
- *Schedulers* — Phiano (iPad, spaced repetition plus chunking over sheet
  music), MemoRep (spaced repetition built for practical skills and
  repertoire), Anki used by hand for tune lists. They decide **what to review
  and when**; none of them listens.

The gap is precisely where this app sits: it already hears. A tool that knows
both what the score says and what came out of the flute can retire a loop
because you played it from memory, not because a timer said so.

**Evidence.** Verification convention as in `research/pedagogy.md` — anything
marked *(not verified)* was not read this session and must not be quoted in
the app until it is.

- **Performance cues.** Chaffin & Imreh (2002), *Psychological Science* 13,
  342–349, "Practicing perfection: Piano performance as expert memory": a
  concert pianist preparing a piece used the formal structure as a retrieval
  scheme and placed deliberate *performance cues* — landmarks tied to
  structure — and practised retrieval almost from the start rather than after
  the notes were learned. Later work (Chaffin, Ginsborg, Dixon & Demos, 2023,
  *Musicae Scientiae*) is on recovery from memory failure and the role of
  those cues (citation verified; body not read).
- **Spacing across days.** Rubin-Rabson (1940), *J. Educational Psychology*
  31, 270–284: practice spread over two days beat massed practice for piano
  memorisation. Simmons & Duke (2006), *JRME* 54: sleep between sessions helps.
  Both already verified in `research/pedagogy.md`. Note the caution recorded
  there: spacing claims are about **days, not minutes** (Wiseheart et al. 2017
  found no within-session spacing effect for a piano sequence).
- **Interleaving.** Stambaugh 2011; Carter & Grahn 2016 — mix, do not block,
  and warn the player it will feel worse and be better. Already in the design
  implications list.
- **Retrieval practice, specifically for music: not established.** A College
  Music Symposium study ("Does Retrieval Practice Enhance Memorization of
  Piano Melodies?") found the expected testing-effect benefit **absent** at a
  ten-minute retention interval, and then re-ran it at two days. I could not
  read the outcome of that second experiment (not verified). Until it is read,
  the app may *use* retrieval because it is how you find out whether you know
  something, and must not *claim* it memorises faster.
- **Strategy shape.** Secondary summaries report that faster memorisers use
  holistic and additive strategies while slower ones work segment-by-segment
  and serially (not verified — traced only to a practice blog summarising
  unnamed research). If true it cuts against naive chunk-looping, which is
  most of what this CR proposes, so it is worth chasing down before building.
- **Mental practice.** Iorio, Brattico, Munk Larsen, Vuust & Bonetti (2022),
  *Psychology of Music*, "The effect of mental practice on music memorization"
  (citation verified; results not read). Consistent with Palese & Duke (2022),
  already recorded: experienced players spend at least as long imagining the
  performance as playing it.

## Sketch

**1. Get the score in.** Three routes, in order of how well they will work:

- *Bundled pieces.* Already there, already licensed, already measured. The
  Telemann Largo is the natural first target: 234 notes, heard at 98 %.
- *MIDI import.* The reader exists but lives in `tests/` and uses `node:fs`;
  promoting it into `docs/core/` and giving it an `ArrayBuffer` entry point is
  a contained job, and the app would then take a `.mid` from anywhere.
- *"Play it once from the sheet."* The player's own second option, and the
  attractive one — no file, no import. But the 73 % take **is** a first
  read-through from the sheet, and a first read-through is the worst possible
  moment to capture ground truth: wrong notes get recorded as the piece. If it
  is offered, it must be offered as "play it three times and I will keep what
  the three agree on", not as one pass.

**2. The unit is a phrase, not a bar count.** Loops chosen at rests, slurs and
cadences — the piece's own joints — because that is what "structure as a
retrieval scheme" means in Chaffin's finding. Fixed four-bar chunks would cut
across the very landmarks the memory is supposed to hang on.

**3. Three modes, mixing the three memories the player named.** The mix is the
point; any one alone is the thing that fails on stage.

| mode | what happens | which memory |
|---|---|---|
| **with the score** | play the loop slowly, N times, score visible; the app counts and checks | muscle |
| **call and response** | the app sounds the loop, you play it back, no score | ear |
| **before you play** | the app asks *something about* the loop — the first note, the key you are now in, where it cadences — and only then do you play it | conscious |

The third is the app's existing *Predict, then see* pattern pointed at
structure instead of at pitch, and it is the one that builds Chaffin's
performance cues rather than assuming them.

**4. Retire a loop by retrieval on a later day.** Not by a repetition count.
A loop leaves the rotation when it has been played correctly from memory in a
*different session* — spacing across days, which is the part of the evidence
that is solid.

**5. Interleave the loops** rather than drilling one to fluency and moving on,
and say plainly that it will feel worse.

**6. Report in three columns, never two.** `played it / played something else
/ I could not hear it`. And where the app is measuring intonation at the same
time, keep the two verdicts apart: a note in the right place at the wrong
pitch is a memory success and a tuning problem, and conflating them would
punish the player twice for one thing.

## Open questions for the player

- **Is note-level following the right grain at all?** The alternative is much
  cheaper and might be better: "did you get from here to the end without
  stopping", timed, with no note matching. That is most of what memorising a
  piece feels like, and it would work at full tempo where the aligner will not.
- **Whole-then-parts, or parts-then-whole?** See the unverified finding above;
  the answer changes the central mechanism.
- **Does the app need a voice?** Call-and-response needs the app to *sound* the
  loop. There is a drone oscillator and nothing else. A plain sine or a simple
  synthesised flute tone is real new audio work, and on speakers it lands back
  in the bleed problem that free play now handles with a level floor.
- **Which piece first?** The Telemann Largo is the measured one. But the piece
  the player actually wants by heart is the one to build for, and if it needs
  ornaments it needs CR-001 first.
- **Repeats and da capos.** The unfolded MIDI exists for No. 8 precisely
  because repeats break order-based alignment. Whose job is that — the import,
  or the aligner?

## Relation to existing work

- `docs/core/scales.js` (`alignToTemplate`) and `docs/tests/midi.js` are the
  two pieces already built; the second needs promoting out of the test tree.
- `flutetrainer/data/pieces/telemann-fantasias` supplies the repertoire, the
  licence and the two recall measurements to design against.
- **CR-001 (ornamentation) is a hard dependency** for any piece with agréments:
  until a trill can be matched as an ornament on a note, the alignment of real
  baroque repertoire will be wrong in the ornamented bars and right everywhere
  else, which is the worst kind of wrong.
- CR-003 (warm-up) and CR-006 (weakest notes first) both want a session plan;
  a piece being memorised is another thing competing for the same ten minutes,
  and the three should not each invent their own scheduler.
- The project rule applies here more than anywhere: **measure it on
  recordings.** `node docs/tests/score.js recordings/<take>.wav <score>.midi`
  already exists and already produced both numbers in this document. Any
  claim about what this tool can follow should come from that command, not
  from reasoning about the aligner.
