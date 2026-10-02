# CR-010 — Follow me out of tune

Status: **phases 2–4 built for the first two rungs** (8.7): exercise A at
unison and octave, the core for every level, the synthesised timbres and the
headphones fallback. Fifth and thirds are in `core/follow.js` but not on the
list yet; exercise B and the sample pack are not started. Not yet played on a
real flute. Raised 2 October 2026 by the player; long tones first and blocks
of four confirmed the same day.

As built, two details differ from the design below. The headphones setting is
the existing one in Settings, not a new one on the check page. A finished
block waits for the player to move on (button or forward pedal) instead of
moving on by itself.

**8.7.1, after the first real take** (`recordings/follow-unison-follow.wav`,
unison, speakers, 2 October 2026). The partner read exactly where the app put
it in every lead-in, so the audio path is sound. Three findings:

- **The follow ratio was measured from the wrong place.** The player sat
  20-55 ¢ sharp of the tuning on nearly every note whatever the partner did.
  Measured from the tuning, that read as ≈200% following a sharp partner and
  as following a flat one the wrong way. It is now measured from the player's
  own in-tune playing of the same notes: a session plays one set of four
  notes in every block, block 1 (always in tune) is the reference, and later
  in-tune blocks refresh it. On that take this gives ≈44% up and ≈3% down
  (pinned in `tests/follow.test.js`). The run summary used to say a flute
  sitting sharp "cancels"; that was copied from Adjust, was false here, and
  is gone.
- **At unison the partner was turned down for the whole note, lead-in
  included.** It now plays alone at full level and drops 0.4 s before the
  player's entry, on speakers only; with headphones it never drops and there
  is no calibration. The player reports having heard it clearly anyway.
- **The speaker gate held, with a thin margin.** Partner bleed ≈ −30 dB,
  gate ≈ −20 dB, and the quiet low notes (F♯4, G4, E4) and B5 only 2-4 dB
  above it. One B5 dipped below and split. Watch this on the iPad.

**8.7.2, after the player's first session.** "I was pretty lost at the
beginning and saw no visual cue." The cue was a few words at the end of the
status line above the buttons, away from the panel the eyes are on; it is
now a line in the panel under the note name. The opening explains itself
(stay quiet, then the partner plays first, then a warm-up). The first block
is now a **warm-up** at the player's suggestion: partner in tune, played
until every note is within the "a little off" line (10 ¢) in one attempt,
with each note's direction shown after every attempt. A **Move on anyway**
button (not the pedal) leaves it with the last attempt as the reference, and
three attempts all off the same way suggest checking the reference pitch or
the headjoint. Only the kept attempt is scored; the count goes in the
record. The green box at the end of every exercise is the finished panel; it
now says "Finished — your results are below".

**8.8, exercise B and the octave fix.** On speakers the unison level worked
but the octave did not: the partner alone started the note, then the
player's entry restarted the bar. At the octave the partner's second partial
*is* the note, and the gate only looked at its fundamental. The gate and the
duck now apply wherever any partial the partner sounds lands on the note.
(The older drone exercises still guard only the fundamental; Calibration's
octave note has the same exposure and has not been reported.)

Exercise B, the cadence, is built as designed. Two changes from the design
text above: the top voice's line follows the approach (1–7–1 over IV,
2–7–1 over ii6, 3–2–1 over VI) so every note is a chord tone, and the follow
is measured on the arrival note alone, which every cadence shares, against
the player's own in-tune arrivals. The first cadence is the warm-up, as in
A. Approach and dominant voices are pure over their own bass; the whole
final chord moves. Headphones are asked for and the reason given; without
them it plays plain chords and warns.

The Practice list now shows Follow me as one card opening its own page
(`group` on the exercise spec), so further levels do not lengthen the list.

Found on the way and **not fixed**: the Practice page passes a flat key as
its name ("Bb"), and the older exercise builders expect a letter, so
Calibration, Interval in context and the like throw on B♭, E♭ and A♭
major. Follow me and the cadence accept the name.

**8.8.1.** The player could not tell whether the cadence's flat / in tune /
sharp question was about their landing or the chord's. It is about the
chord, and now says so on the buttons ("Chord arrived flat") and in the
question; the long tones' buttons name the partner the same way. The middle
answer had read "Didn't move", which was wrong: what is checked is whether
the partner was in tune, and after a flat block an in-tune one is a move.
Also reported: the cadence on speakers, without headphones, heard the
flute cleanly (MacBook, quiet room). "Needs headphones" became "headphones
recommended", with that one setup named.

**8.8.2.** "When I select different partner sounds, I hear no change." Two
causes. Without headphones every sound fell back to plain, as designed in
8.7 -- and said only in small print. And the flute partner was within a few
per cent of plain anyway. Since the player's speaker sessions read cleanly,
every sound now plays through speakers; the level gate and duck are applied
wherever a strong partial (≥ 0.1 of the fundamental) of the sound actually
chosen lands on the note, generalising the 8.8 octave fix. The flute partner
now has a strong octave and twelfth, more breath and a slow 0.3 Hz swell in
level (about 2 dB), never in pitch.

## Why

> Idea for a new exercise: "Follow me out of tune". This is supposed to
> represent a really important part of baroque flute playing, especially flute
> duos. […] The drone starts in tune, then goes flat or sharp. […] it isn't
> realistic to play in tune with someone else that keeps on changing tuning.

Every exercise so far tunes against a reference that never moves. That
teaches where a note belongs, but it is not what playing with someone else
asks for. In a duo the other flute warms up and drifts sharp, or tires and
sags; a band of strings arrives on the final chord a shade flat together. In
those moments being "in tune" by a tuner is being out of tune with the music.
What is wanted is to hear where the partner is and to go there.

Kopiez (2003, `research/pedagogy.md:48`) found that two professional
trumpeters played essentially the same intonation whether the accompaniment
was in just intonation or equal temperament: they did not adapt, and did not
know it. The habit of not following is real even in experts, and nothing in
the app can currently show it to a player. Quantz (X §15, `:88`) asks for the
ear to be kept on those playing with you, "especially the bass".

Two exercises come out of the request:

- **A. Follow me.** One partner voice, at a unison or an interval, which moves
  flat or sharp now and then.
- **B. The cadence lands out of tune.** A chordal approach → V(7) → I where
  the first two chords are in tune and the arrival is not.

## What it measures, and what it does not

The app already refuses to measure distance from a tuner where the music asks
for something else (`docs/help/intervals.en.md:33-37`). This CR extends that:
the target is **the partner**, wherever the partner is. The figure that
matters is a difference — how far you moved when the partner moved — and it
is new: the **follow ratio**.

    follow = (your pitch − in-tune pitch) / (partner's offset)

100% means you went all the way with the partner; 0% means you stayed where a
tuner would have put you; over 100% means you overshot. It is computed only
when the partner moved by 8 ¢ or more, because below that the ratio is a
quotient of noise, and a figure made from noise would be acted on
(`README.md:292-294`).

The note's own figure still comes from `analyseNote()` / `scoredWindow()`,
unchanged. Only the target moves, so no scoring rule changes and no abscore
run is owed. The follow ratio *is* new arithmetic on top, and gets its own
known-answer check (see Verification).

## Exercise A — Follow me

### One note: the partner enters first

1. The partner sounds alone for about 1.5 s, already at its current offset.
2. You enter at the interval and hold. Duration is the only route to done, as
   everywhere (`NoteSegmenter`).
3. The partner stops; a short gap; the next note.

This is a duo entry, not a held drone being steered. It gives the ear time to
hear the partner before committing (pedagogy "could add" #4 audiation and #9
thinking time), and it tests where the attack lands, which is where a duo
partner's drift is usually first met. It also keeps to the runner's existing
note-by-note shape.

A held note with a partner that sags under you is the other real case. It
needs mid-note retuning and a different measure (how long it took you to
follow), and is left for later — the audio below is built so it can be added
without a rewrite.

### A run: blocks, not drift

- Notes come in **blocks of 4**. The partner's offset is fixed inside a block
  and can change only between blocks. A partner who moved every note would
  give the ear nothing to hold on to — the same reason the practice key is
  drawn per pass, not per note (`README.md:212-214`).
- Offsets follow a seeded sequence that behaves like a person: 0, then −20,
  stays, returns, later +20… — not a coin flip every block.
- About **one block in four is a catch**: the partner does not move. Without
  catches the lesson learned is "always move", not "listen".
- Direction respects the instrument (`note-bend-asymmetry`): the generator
  never asks low C to follow sharp or F to follow flat. If the player's
  measured bend ranges are available (bend view) they decide; otherwise a
  short built-in list, named as such in the help.

### The ladder

One card per level, offered in this order:

1. Unison
2. Octave (partner below)
3. Fifth
4. Major third, then minor third — pure targets from `DEFAULT_RATIOS`

The offset defaults to **20 ¢**, beyond the app's own "off" line at 15 ¢, so
the first level is plainly audible. 12 ¢ and 8 ¢ are offered as the ear
sharpens. These are starting points, not perceptual thresholds — the research
here has no JND figure for this task.

### Cue or ears only

A **Show the partner's direction** toggle (`followCue`, in `ui/controls.js`,
`bind:`; inside a run it reads `run.settings`).

- On: while the partner sounds alone, an arrow says "partner ↓ flat". That is
  a cue about the task, not feedback about the playing. No needle, ever.
- Off: nothing. Ears only.

Optionally, at the end of each block the player calls the partner sharp, flat
or unchanged before seeing anything — the predict pattern, on the pedals
(CR-009). Estimating before the reveal is pedagogy "could add" #1.

### Feedback

**Per block, not per note.** Summary feedback after a block beat every-trial
feedback for retention (`research/pedagogy.md:29`, `:111`). A block card
reads, for example:

> Partner went 20 ¢ flat. You followed 14 ¢ (70%) and sat 6 ¢ above them.

A catch block reads "The partner didn't move; you moved 9 ¢ sharp." Per-note
rows appear only in the end-of-run report. The report names a pattern ("you
follow flat more readily than sharp") only when the sample supports one. No
points, no streaks.

## Exercise B — The cadence lands out of tune

- **Progression:** approach → V or V7 → I. The approach chord is drawn each
  time from **IV, ii6 and VI**, so no single shape is memorised.
- **Tuning:** approach and V are in just intonation on the temperament bass
  (`PureIntervalTuning`, `HarmonicContext`). **The whole I chord** arrives
  shifted, ±20 ¢ by default. One cadence in four is a catch and arrives in
  tune.
- **Sound: strings or organ, not harpsichord.** A keyboard cannot land out of
  tune; a string band arriving flat together is exactly the real case.
- **The flute's part**, chosen by a toggle:
  - **Top voice:** a small set of soprano lines (8–7–8, 3–2–1, 1–7–1). The
    leading note is scored as a pure major third over V.
  - **Bass:** 4 / 2 / 6 – 5 – 1, with the chord voiced above.
- **Pacing:** the same entry pattern as A. Each chord sounds, you join and
  hold, and the next chord comes when your note is done. The runner sets the
  pace, not a metronome, so the segmenter's rules stand.
- **Scoring:** every note against its own chord's just target; the headline
  is the arrival — did you follow the I chord? — as a follow ratio. A summary
  per cadence.

A new pure module, `docs/core/cadence.js`, spells the chords and voicing for a
key, quality and role. Pitches are spelled, never MIDI. Golden tests first.

## Sounds

The current drone is three sine partials. The request asks for something more
like the real world, and B needs chords.

- **Several voices.** `audio/engine.js` gains a voice that can be one of
  several, each with a timbre and a `setHz(hz, glide)`. Today's drone becomes
  the timbre **plain**, and every existing view keeps its behaviour.
- **Synthesised timbres**, in `audio/timbres.js`, with `createPeriodicWave`
  and a noise buffer:
  - **plain** — today's drone;
  - **flute partner** — weak 2nd and 3rd partials, filtered breath noise;
    flattement available, off by default;
  - **strings** — richer spectrum, two slightly detuned copies;
  - **organ** — steady, many partials.

  A few kilobytes of code; no assets; load time unchanged.
- **A sample pack is designed, not built.** If the synthesised voices prove
  unconvincing in use: an optional "Download realistic sounds (x MB)" in
  Settings, into a separate cache (`bongout-sounds`) that the service worker's
  `activate` keeps — today it deletes every cache but the current one
  (`sw.js:106`). Hosted outside `docs/`, so the PRECACHE parity test is
  untouched. Never downloaded by default; the synth is always the fallback.

### Headphones

A rich timbre or a chord puts many partials into the room, and the speaker
path can notch out only three (`audio/engine.js:263-274`). So:

- The **plain** timbre keeps working on speakers, with the existing notch and
  unison-duck path. The notch exclusion is computed against the *shifted*
  target, which is what the flute will actually play.
- **Other timbres and the whole of exercise B ask for headphones**, and say
  why. A `headphones` setting, confirmed on the hardware check page; with it
  on, the notches are bypassed.
- Unison with a shifted partner on speakers is the risky case. It is to be
  measured on real takes, not reasoned about.

## Open questions for the player

- **Is 4 notes the right block?** Short enough to be several blocks in a few
  minutes, long enough that a block is a situation rather than a note. Easy to
  change; worth a week of use.
- **Which notes?** A follows a short line in the key (scale fragments), or
  long tones on chosen degrees? Lines are more like a duo; long tones isolate
  the skill.
- **The partner's lead-in.** 1.5 s alone is a guess. Too short and the attack
  is a guess; too long and it stops being a duo.
- **Bend data.** Is the bend view's per-note range stored anywhere the
  generator can read? If not, the built-in list stands until it is.

## What this CR may not claim

Checked against `research/pedagogy.md:123-138`.

- Not that it **improves ensemble intonation**. No study we have tests
  training against a drifting partner. The exercise shows whether you
  followed; whether practising that transfers to a duo is untested.
- Not that **drones improve intonation** — the partner is a drone in its first
  levels, and the research on drones is null for short-term accuracy.
- Not that 20 ¢, 12 ¢ or 8 ¢ correspond to any perceptual threshold.
- Not Tromlitz on not following the keyboard (`docs/help/intervals.en.md:74`)
  until the source is read.

## Rules it keeps

- `core/follow.js` (shifted target, follow ratio, offset sequence) and
  `core/cadence.js` import nothing from `audio/` or `ui/`.
- No `==` on frequencies, cents or durations.
- New toggles in `ui/controls.js` with `bind:`; inside a run, `source:`.
- Subscriptions on `owner()`.
- Registered in `EXERCISES` (`views/run.js`), strings under `practice.ex.follow*`
  and `practice.ex.cadence*`, help in `docs/help/follow.en.md`.
- No hidden constants: block length, offset, catch rate and lead-in are
  settings or spec fields.

## Phases

1. This document, read by the player.
2. Core: `follow.js`, the offset generator, `cadence.js`, with golden tests.
3. Audio: voices, timbres, headphones gate; existing views unchanged.
4. Exercise A, unison and octave first. A week of use before the fifth and
   thirds.
5. Exercise B.
6. The sample pack, only if needed.

## Verification

- `cd docs && npm test` and `python -m pytest flutetrainer/tests -q`.
- New takes against a shifted partner (`python -m flutetrainer.tools.record`),
  run through `node docs/tests/wavpipe.js` and added as skip-if-absent cases
  in `recordings.test.js`.
- Follow ratio against known answers: probe tones at 0%, 50% and 100% follow
  (`make_probe_tones`), played device to device, within a stated tolerance.
- By hand: iPad with headphones across every timbre, cue on and off, pedals;
  speakers with the plain timbre, to show Listen, Tuner and Practice behave as
  before.

## Relation to existing work

- Extends the "measure the difference" stance of *Adjust to the drone* and
  `docs/help/intervals.en.md`.
- Builds the multi-voice audio that CR-008 (a moving bass, `cr/008:191-196`)
  and CR-007 ("does the app need a voice?", `cr/007:184-187`) both said they
  would need.
- Uses CR-009's pedals for the block estimate and for "again".
