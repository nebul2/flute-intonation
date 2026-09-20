# CR-008 — Learning to prelude, with Hotteterre

Status: **proposed**, not started. Raised 20 September 2026, by the player.

## Why

> A tool to help learn to prelude. For this we could use L'Art de Préluder
> from Hotteterre.

Preluding is the skill of playing a short unwritten piece before the piece:
to find the key, to warm the instrument and the hand, to tell the room what is
coming. It was an ordinary professional competence in 1719 and it is a rarity
now, and the source that taught it was written for **this instrument, by a
player of this instrument**, and is in the public domain.

It is also the one thing in the app's neighbourhood that is purely musical.
Every other exercise here ends in a number. This one cannot, and that changes
what the app is allowed to do — see the constraint below.

## The source

*L'Art de Préluder sur la flûte traversière, sur la flûte à bec, sur le
haubois et autres instrumens de dessus*, Jacques-Martin Hotteterre le Romain,
Œuvre VII, Paris, 1719.

The title page is the table of contents, and it describes a graded course
rather than an anthology:

- **preludes ready-made in every key** (*des préludes tous faits sur tous les
  tons*), in different movements and different characters;
- **with their ornaments**, and with difficulties *propres à exercer et à
  fortifier* — the preludes are technical studies as well as models;
- **principles of modulation and transposition**;
- **a "dissertation instructive" on all the different species of meter**,
  illustrated with getting on for seventy examples drawn from named composers.

Sources and status:

- Original 1719 print, digitised complete by the BnF:
  `gallica.bnf.fr/ark:/12148/btv1b8538436m` — **public domain**.
- IMSLP carries three facsimiles of the same print plus a 1978 Minkoff
  reprint. The modern Peters urtext (ed. Mirjam Nastasi, 1991) and the
  typeset individual preludes carry their own rights and are **not** usable.
- English translation and commentary: Margareth Anne Boyer, *Jacques
  Hotteterre's L'Art de Préluder: A Translation and Commentary*, University of
  Missouri (thesis; year and availability not verified — the repository page
  refused fetching this session). There is also a German translation in print.
- The Scroll Ensemble's improvisation-resources database lists it under
  *Modulation, Prelude, Schemata*, tagged **Beginner** — i.e. it is treated as
  an entry point into improvisation, not as an advanced study.

This matters for scope: the app can rest on a complete, free, primary source
written for the traverso, and does not have to invent a curriculum.

## The constraint that shapes the whole thing

**The app cannot judge an improvisation, and must not pretend to.**

Everything the app scores today has a target: a note against a temperament, a
note against a pure interval over a bass, one sounding against another. A
prelude has no target. There is no correct note, so there is nothing to be
right or wrong about, and any attempt to grade invention would be both wrong
and discouraging — which for the one exercise whose subject is confidence is
the worst possible failure.

What the app *can* do is **describe, and measure only what is measurable**:

- which key you were in, and when it changed — `core/scales.js` and the key
  recogniser already answer "was that a scale, and in what key";
- whether you arrived where you meant to arrive, when you set out to arrive
  somewhere;
- how long you played, over what range, how much you paused;
- and the thing nobody else's improvisation teaching can give you: **how in
  tune the notes you chose actually were**, against the bass and in the
  temperament you chose.

That last one is the whole reason this belongs in this app rather than in a
book. Preluding over a drone in Vallotti and preluding over a drone in equal
temperament are different musical experiences, and the app is already the
instrument that can show the difference.

## Why the app is unusually well placed

Four things are already built and point straight at this:

1. **A drone on any tonic**, and as of phase 8.4 one that survives free
   playing — the background is measured with it sounding, so bleed is told
   from playing by level. A prelude over a bass is the historical shape of the
   exercise and the app can now hold that bass for as long as you play.
2. **Key recognition from free playing.** The scale recogniser names a key
   from a stream of notes, and `scaleKeyFor` / `spellInKey` already turn a key
   into correct spelling. "Start in D, arrive in A" is checkable.
3. **Temperament as a first-class setting.** Hotteterre's *caractères* of the
   keys and unequal temperament are the same subject seen from two sides. An
   app that already sounds E♭ differently from D is the right place to feel
   why a prelude in one is not a prelude in the other.
4. **The "predict, then see" pattern**, which is how an exercise here asks the
   player to commit before being told — the natural shape for "where do you
   think that cadence landed".

## Sketch

**1. A ladder of constraint, not a blank page.** The failure mode of "now
improvise" is silence. Each rung removes one support, and each is something
the app can actually hold up:

| rung | what you play | what the app does |
|---|---|---|
| 1 | tonic, fifth, octave over the drone, free rhythm | sounds the bass; reports intonation only |
| 2 | the scale up and down, any rhythm, any order | names the key it heard |
| 3 | free, but arrive on a given cadence formula | checks the arrival |
| 4 | start in one key, arrive in another | checks the modulation |
| 5 | free, in a named character and meter | describes what it heard |

Rungs 1–2 are almost entirely existing machinery pointed at a new page.

**2. Key by key, in the source's own order.** Hotteterre goes through the
keys; the app can too, one at a time, with his prelude for that key to read
first (from the facsimile, linked not copied) and then your own over the same
bass. This also gives the ladder a natural length — it ends when the keys do.

**3. Teach the principles in the app's words, point to the source for the
music.** The meters, the characters, the modulation rules are Hotteterre's
subject and they are short enough to state. Reproducing his engraved preludes
is neither necessary nor wise: the facsimiles are a click away, and the app is
not a score library.

**4. Afterwards, a description — never a mark.**

> You stayed in D for 40 seconds and touched A twice. You cadenced on D.
> Your F♯ sat 8 cents sharp of the pure third over the bass; everything
> else was within 5.

**5. Record it as a session** like any other, so a prelude in D in March and
one in March next year can be compared on the only axis that is comparable —
the tuning of the notes, not the invention.

## Open questions for the player

- **Is a static drone the right bass?** Almost certainly not, past rung 2. A
  *moving* bass — a cadence formula, a rule-of-the-octave descent — is what
  the partimento tradition actually used, and what makes an arrival feel like
  an arrival. That is real new audio work: the app has one oscillator voice
  built for drones, and a bass line needs timing, voicing and a way to be
  followed. It may be the single biggest decision in this CR.
- **How far into theory should the app go?** Sanguinetti's *The Art of
  Partimento*, Gjerdingen's *Monuments of Partimenti* and the schema
  literature are an enormous and very good adjacent field. The temptation to
  build a theory course inside a flute intonation trainer should be resisted;
  the question is where the line falls.
- **Is key recognition reliable on free melody?** It was built for scales, and
  a prelude is not a scale — arpeggios, leaps, chromatic passing notes, long
  held notes. The project's own rule applies and is not negotiable here:
  **measure it on recordings of actual preluding before building anything on
  top of it**, exactly as `core/scales.js` was built from `recordings/scales.wav`
  and not from reasoning.
- **Which order of keys?** Hotteterre's, the app's `PRACTICE_KEYS`, or by what
  the one-keyed flute finds easy? These give three quite different courses.
- **Ornaments.** Hotteterre's preludes come *with* their agréments, and the
  app cannot yet tell one ornament from another. How much of this CR can
  proceed before CR-001 is a question worth answering early.

## What this CR may not claim

Per the discipline in `research/pedagogy.md`:

- There is **no evidence** that learning to improvise improves intonation,
  memory, or anything else this app measures. It is a musical goal, worth
  doing for itself, and the copy should say so rather than borrowing authority
  from the pedagogy literature.
- The same caution already recorded for drones applies here: players believe
  in them, three short experiments found no immediate accuracy effect, and
  there is no long-term trial.
- Historical authority is not evidence of learning outcomes. Hotteterre is
  worth following because he taught this instrument and the music is his, not
  because 1719 makes a method work.

## Relation to existing work

- Builds directly on the phase 8.4 drone in free play, and on
  `audio/calibration.js` — a prelude is a long session over a sounding bass,
  which is exactly what the level floor was added for.
- `core/scales.js` (key recognition) and `core/naming.js` (`spellInKey`) are
  the existing pieces; both need measuring against preluding rather than
  scales before being trusted with it.
- CR-001 (ornamentation) gates the parts of the source that are about
  agréments.
- CR-007 (learning by heart) is the sibling: that one is about playing
  someone else's notes without the page, this one about playing your own. They
  want opposite things from the same machinery — one needs a score to align
  against, the other must never align against anything — and keeping that
  distinction clean is probably what keeps both honest.
