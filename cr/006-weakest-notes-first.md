# CR-006 — Weakest notes first: let free playing choose the exercises

Status: **proposed**, not started. Raised 9 September 2026.

## Why

Every exercise in the app today is chosen by the player from a menu, and the
menu offers keys, not problems. So the notes you practise are the notes you
already think about, which are rarely the notes costing you the most.

The app is in an unusual position to fix that, because it already measures the
thing that should decide. Play scales and Listen to me both produce per-note
statistics over free playing — how far each note sat from target, how far its
repeats spread, how much it wandered within a single note. Nothing currently
carries that forward. The session report says *F♯ +1.5, unreliable* and then
the next session starts from the same menu as if nothing had been learned.

The player's framing, which is the right one:

> First get the user to play a lot freely, identify a trend in some notes
> being either the worst in tune or the most unstable, then carrying that info
> into some exercises, around the least in-tune notes. A kind of low-hanging
> fruit strategy.

And the worked example, which is real and well known: a beginner's F natural
is almost always far too sharp, and stays that way for years. That is a note
worth an exercise. Nobody chooses it from a menu.

## The constraint that shapes the whole thing

**The baroque flute is not a chromatic instrument, and an exercise generator
that forgets this will produce nonsense.**

The one-keyed flute plays D major from its six open holes. Everything else is
cross-fingered, and cross-fingered notes are weaker, more veiled and less
flexible — that is the instrument, not a fault in it. The consequence for this
CR is direct:

- **A weak note is not automatically a note to drill.** F natural sits sharp
  partly because of the player and partly because of the fingering. The
  exercise must be able to say which, or it will ask for something the
  instrument will not give. See the existing finding on note-bend asymmetry:
  some notes will not move in some directions at all.
- **Notes must be practised in the keys they occur in.** Drilling F natural
  and F♯ side by side is a chromatic exercise, and mixing them is advanced
  repertoire — the Badinerie, not a first year. An exercise built around F
  natural should live in F major, B♭ major, D minor, G minor: the keys where
  that fingering is the normal one and the ear has a tonal reason to expect
  it.
- **So the unit of the exercise is the note *in a key*, never the pitch
  class.** This is the same distinction `entry.tonic` already forces
  elsewhere: a letter is not a sounding pitch, and a pitch class is not a
  scale degree.

## Sketch

**1. Accumulate across sessions, not within one.** `history.js` already stores
every session with per-note figures. What is missing is a view over all of
them: for each spelled pitch, in each key it was played in, the mean deviation,
the spread of repeats, the within-note steadiness, and how many notes back
each figure. One session is an anecdote; the point of this CR is the trend.

**2. Rank by what is actually fixable.** Three different weaknesses, which
want three different exercises and must not be averaged together:

| what the numbers say | what it is | what to practise |
|---|---|---|
| consistently sharp or flat, tight spread | placement — the note lives in the wrong place | a drone exercise on that note, in a key that uses it |
| large spread across repeats | control — you find it sometimes | repetition, same note, same key, many attempts |
| poor within-note steadiness | support — you cannot hold it | long tones, and the settling time is the score |

The existing session score already separates accuracy, repeatability and
steadiness. This is the same split, carried forward and acted on.

**3. Subtract what belongs to the instrument.** The flute profile (`bend.js`)
already measures how far each note bends each way and what it costs. A note
that is rigid upward and sits flat is not the same problem as a note that
bends freely and still sits flat. Before offering an exercise, check the
profile; where there is no profile, say so rather than pretending.

**4. Offer, never impose.** A home-page card — *the three notes worth your
next ten minutes* — with the evidence attached: how many sessions, how many
notes, what the figure is. Not an assignment. The player should be able to
disagree with it and see why the app thought otherwise.

## Open questions for the player

- **How many sessions before a note is worth naming?** Repeatability already
  refuses to judge a note played once, and standouts mark a note *unreliable*
  when repeats spread more than 10 cents. The same reticence applies here, but
  the threshold across sessions is not the same number as within one and
  should be measured, not guessed.
- **Should a bad room or a cold flute be excluded?** A session played flat
  throughout is already handled by the offset, but a session where everything
  was unstable is evidence about the day, not about the note.
- **F natural specifically: one exercise or a family?** F natural in F major
  (as tonic), in B♭ (as the fifth), in D minor (as the third) are three
  different intonation targets in pure mode. That may be the whole exercise —
  the same fingering, asked for three different pitches — or it may be too much
  at once.

## Relation to existing work

- Feeds on `core/stats.js` (session score, standouts) and `history.js`; needs
  a cross-session aggregate that does not exist yet.
- The scoring rule this depends on landed in phase 7: a note is scored where it
  settled, and the settling time is reported. That second figure is what makes
  the *steadiness* row above measurable rather than a feeling — a note right
  because it was corrected and a note right from the first instant read the
  same in cents and differently in settling time.
- Overlaps CR-003 (warm-up routine) at the edges: a warm-up that knows your
  weakest notes is most of this CR's value with none of its analysis. Worth
  checking whether that is the cheaper first step.
