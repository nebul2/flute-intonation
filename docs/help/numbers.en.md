# Reading the numbers

Every figure in this app is a distance in **cents** — hundredths of a
semitone. 100 cents is one semitone; 5 cents is about the smallest difference
a careful ear notices on a held note. The app calls a note **in tune** within
5 cents of its target, **close** within 15, and **out** beyond that.
Positive is sharp, negative is flat.

## Two ways to average, and why both are shown

After an exercise you see a line like *mean absolute deviation: 4.6 cents*
and then *per note: F♯ +1.5*. These are the same notes averaged two ways.

- **Absolute** ignores direction: a note 3 cents flat and one 6 cents sharp
  are both just *distance*. It answers "how close was I, overall?"
- **Signed** keeps direction: the same two notes average to +1.5. It answers
  "which way does this note lean?"

When the two disagree, that is the finding. A note that is consistently
sharp shows the same figure on both lines. A note that is 4.6 away but only
+1.5 signed was missing on *both sides* — sometimes flat, sometimes sharp —
which is a control problem, not a placement problem, and no amount of pushing
the headjoint will fix it.

## The session score, after Listen to me

- **Accuracy** — mean absolute distance from target, every note equally.
- **Offset** — the signed mean: where the whole session sat. This part
  belongs to the headjoint, or to a reference pitch set wrong, and correcting
  it costs nothing musical. Sharp overall means *pull the headjoint out*; flat
  means *push it in*.
- **Internal** (or *corrected*) — accuracy *after* the offset is removed:
  how far you were from yourself. This is the ear's part, and it is not the
  first figure minus the second — removing a uniform shift changes each note's
  distance differently.
- **Repeatability** — for notes played more than once, how far apart the
  repeats were. Only notes played twice or more count.
- **Steadiness** — how much the pitch wandered *within* a single held note,
  after the attack is skipped.

## Adjust to the drone

The same written note over two basses is measured as a **difference between
your two soundings**, never a distance from a tuner — so a reference set
wrong or a flute sitting sharp cancels out.

- **The harmony asked for** — how far the note had to move between a pure
  third and a pure fifth in your temperament.
- **You moved it** — how far it actually moved between your two soundings.

Verdicts: *the same pitch both times* (under 3 cents of movement — where
everyone starts); *moved* (between about half and nearly twice the amount
asked); *not far enough*; *too far* (more than 1.8 times); *the wrong way*.

Both soundings can each read "in tune" against a tuner while the move is
double what was asked: a third 3 cents low and a fifth 6 cents high are small
errors on opposite sides, and the *difference* between them adds them up.

## Notes that stand out

A note is listed when its average sits **15 cents** or more from target. It
is marked *once* if it was played only once, and *unreliable* if its repeats
spread more than 10 cents — a single reading of either kind is not a verdict.

## The flute profile

- **Bends down / up** — how far a note moves from where it naturally sits,
  each way. Under **5 cents** in a direction, the note is *rigid* there.
- **Forced** — a bend that cost more than **6 dB** of sound. The pitch was
  reached; whether you would use it in music is your call, which is why it is
  reported and never subtracted.
- **Sits at / out with itself** — where the flute is overall, and how
  consistent it is once that is removed: the same split as the session score.

## Which target a note is judged against

In **tempered** mode every note has one fixed pitch from the temperament.
In **pure** mode a note is judged as a pure interval above the tonic — so the
same written F♯ has a *different* target over D than over B. That is why
Listen to me works better when it knows the key: without a tonic there is no
pure target, and without a key it cannot tell D♯ from E♭.

## When the reference pitch is wrong

Every note shifts by the same amount, so the *offset* absorbs it and the
internal figures are unaffected — that is what they are for. But a reference
a whole semitone out renames every note by its neighbour, and nothing can
detect that from the notes alone. If a whole session reads oddly sharp or
flat, check the reference pitch before anything else.

## Sources and where the arithmetic lives

- [Cent (music)](https://en.wikipedia.org/wiki/Cent_(music)) and
  [just intonation](https://en.wikipedia.org/wiki/Just_intonation), Wikipedia
- [Equal temperament](https://en.wikipedia.org/wiki/Equal_temperament), for
  what "tempered" is measured against
- The scoring code: [core/scoring.js](https://github.com/nebul2/flute-intonation/blob/main/docs/core/scoring.js)
  (bands, mean absolute, per note) and
  [core/stats.js](https://github.com/nebul2/flute-intonation/blob/main/docs/core/stats.js)
  (the session score, standouts, offset advice)
- [core/adjust.js](https://github.com/nebul2/flute-intonation/blob/main/docs/core/adjust.js)
  for the drone exercise's verdicts, and
  [core/bend.js](https://github.com/nebul2/flute-intonation/blob/main/docs/core/bend.js)
  for the profile
- Why feedback is shown after the note and not during:
  [research/pedagogy.md](https://github.com/nebul2/flute-intonation/blob/main/research/pedagogy.md)
