# CR-003 — A daily warm-up, and listening to it day by day

Status: **proposed**, not started. Raised 5 September 2026, by the player.

## Why

The player already has a warm-up and does it by habit rather than by plan:

> Create embouchure gradually (20s), play some long easy notes gradually
> focussing the sound (40s) finishing on low G, take that sound gradually up
> to high G one step at a time on a G major scale to middle G, play a slow D
> major scale (30s), play a B minor scale, …

Five minutes by default, adjustable. The app would guide it, listen, and — the
part that does not exist anywhere yet — **keep the days side by side**, so a
month of warm-ups becomes a line rather than thirty separate sessions.

That last is the real feature. Everything the app measures today is a session
in isolation; the one thing a warm-up is *for* is the comparison across days.

## What the sources actually say

Researched against the treatises rather than against received wisdom, and the
verification status is carried through honestly below. Anything marked
**unverified** should be checked before it is quoted in the app itself.

### The period treatises

- **Quantz X §23** treats daily practice as a *budget*, not a programme — how
  long and how often, rather than a fixed order of exercises.
- **Quantz X §5** and **Tromlitz VI §18** each give a **graded difficulty
  order** for working through keys. This is the sourced version of "start in
  D, then G, then A" — the ordering principle is period, even if the exact
  list in Play Scales is ours.
- **Tromlitz II §20**: *"nicht alle Tage, ja, nicht alle Stunden guten
  Ansatz"* — not every day, indeed not every hour, a good embouchure. Worth
  putting in front of the player on a bad morning, and an argument against any
  design that treats a poor warm-up as a failure.
- **Quantz IV §22** and **Tromlitz VI §9** tie tone work to keeping the
  cross-fingerings in tune at low blowing pressure.

### Messa di voce, and a modern voice that converges with them

Barthold Kuijken, interviewed in *Flute Talk*, April 2015 (verified verbatim):

> "Then I would work on getting the forked fingerings like F natural or A flat
> in the first octave to sound well and in tune. **The forked fingerings will
> not work when you blow too strongly.** … I would not try to achieve volume
> in the beginning, but rather care for a very well-focused sound… **I would
> forget about vibrato** (except the occasional finger vibrato). … If we
> replace the shape that vibrato gives to a note by another conscious shape,
> such as a **crescendo-diminuendo messa di voce**, we easily forget vibrato."

> "**Let the flute sound; don't make it sound.**"

The convergence matters: Kuijken independently makes the messa di voce a
*substitute for vibrato* and couples tone work to cross-fingering intonation
at low pressure — the same pairing as Quantz IV §22 and Tromlitz VI §9. That
is the strongest single justification for putting long notes with a swell at
the front of the routine.

**Do not cite Kuijken's *The Notation Is Not the Music* for practice routine.**
Its author says plainly it "is not an Early Music method book". Use the
interview.

### Duration and sequencing, from named modern players

Where they are concrete the order is consistent: **physical warm-up → single
long notes with messa di voce → intervals → articulation syllables → scales
and arpeggios by key, for resonance and tuning rather than speed →
repertoire.**

Stated durations run from 10–15 minutes (Kate Clark, Yu-Wei Hu) to 20–30
(Kaiser, Treupel-Franck) to an hour (Pontecorvo). Stephen Preston: "three
hours plus or a mere ten minutes."

**But most of them explicitly reject a fixed routine.** The honest reading is
a stable *menu* in a variable order — which is also what Quantz X §23 and
Tromlitz II §20 describe, and it should shape the feature: offer a sequence,
never enforce one.

## Design

- **A routine is a list of steps**, each with a kind, a duration and a target.
  The player's own example is the default; the whole thing is editable, and
  five minutes is the default budget with the steps scaled to fit.
- **Step kinds map onto machinery that already exists**: long tones and the
  messa di voce onto the level-and-pitch frame data; scales onto
  `core/scales.js`; intervals onto the existing drills.
- **The day-by-day record is the point.** One row per morning: which steps
  were done, and the two numbers the app already separates everywhere else —
  where the flute sat, and how consistent it was with itself. Thirty of those
  is the deliverable.
- **Never score a warm-up.** Tromlitz's remark is the design rule: a bad
  embouchure day is information, not a failure, and the display should let the
  player see a bad day without being told off for it. This is the benevolent
  rule in CLAUDE.md doing real work.

## Three findings that touch code already written

**1. Flattement is downward-only, and this affects how it is measured.**
Michael Lynn, *American Recorder*, Spring 2021: flattement "only goes down
from the main note, less than a half-step variation in pitch. **The main note
is intended to stay perfectly in tune.**" So the pitch centre of a flattement
is the **top** of the modulation, not its mean. CR-001 proposes measuring
flattement's depth and rate from the frame data; taking the mean would report
every ornamented note as flat. Testable against `recordings/`.

**2. The spelled-pitch rule is now sourced, not merely assumed.** Rick Wilson
(oldflutes.com): "flats were played sharper than sharps… B flat and A sharp
were different pitches, with the B flat being sharper by a comma". The same
comma Quantz gives in Ch. III. CLAUDE.md's "pitches are spelled, never MIDI
numbers" has a period citation behind it.

**3. The stopper direction rule is independently confirmed.** Wilson: "if it
is too close to the embouchure, then the octaves are wide; if it is too far,
the octaves are narrow" — which is what the stopper check already says.

## Two tensions worth stating rather than hiding

**Evenness is contested, and this app has already taken a side.** Tromlitz VI
§22 says diligent practice makes the instrument's unevenness almost
imperceptible. Against that, Matejová (Royal Conservatoire The Hague, 2020),
citing Boland: "the goal of 18th century flute playing was to find variety in
colour… therefore this 'uneven' colour of single tones was not seen as a
handicap." Both are period-defensible. **A trainer that scores evenness is
siding with Tromlitz**, and should say so somewhere the player can read it
rather than presenting it as neutral fact.

**Modern practitioners contest tuner-matching itself.** Folkers (1998) on
matching notes to a tuner: "what a fruitless endeavor that is." Kaiser refuses
a tuner outright; Clark uses one minimally. What they do instead is drone and
interval work — which this app also does, and does well. Worth weighing: the
drone-and-interval side of the app is well supported by the people who teach
this instrument; the bare cents readout is the part they argue against.

## Out of scope, and one blocker

The player's example ends with a **B minor** scale. `core/scales.js` handles
major only, and `MINOR_RELATIVE` covers just seven natural minor tonics — B
minor among them, via D major's signature. Minor scale recognition is a
prerequisite for the routine as described, and is cheap once major works.

Not proposed here: articulation syllables (*tu/ru*, *did'll*) — the app
measures pitch and level and has no view of the tongue, exactly as CR-001's
group E concluded.

## Verification

The routine cannot be verified the way the recogniser was, because its subject
is change across days rather than a signal. So:

1. The player runs it every morning for a fortnight, and the day-by-day view
   is judged on whether it shows anything they did not already know.
2. Every quotation above is checked against the source before it appears in
   the app. Several claims that circulate widely could not be traced at all —
   in particular "the weak and veiled sound of F and B♭ above the staff",
   which is **dropped as untraceable** — and no 18th-century enumeration of
   "practicable keys" on the traverso was found, so the graded practice orders
   of Quantz X §5 and Tromlitz VI §18 are what may be cited, and nothing more.
3. Boland's practice-routine section (~p. 185) is **reported but unread**;
   obtain the book before citing it. Rachel Brown's own baroque flute practice
   manual is **in preparation, not published** — there is no Brown routine to
   cite today.
