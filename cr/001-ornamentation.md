# CR-001 — Ornamentation: a guided trill exercise, and a guide to the agréments

Status: **proposed**, not started. Raised 29 August 2026.

## Why

The app can already tell an ornament from a note. It cannot tell one ornament
from another, and it cannot teach any of them. Everything it knows about
trills it inferred from the signal — that a run of contiguous regions
alternating between two pitches is not a series of notes — and that inference
was wrong twice before real recordings corrected it.

The way past that is to stop guessing. If the player says *what* they are
about to play, detection becomes verification: the app knows which two
frequencies to expect, can say whether each was in tune, and can measure the
ornament as a gesture rather than merely decline to measure it.

That is the whole idea behind this CR, and it comes from the player: *"the
user would specify which two notes so the code would know what to listen for
and be able to shorten the window."*

## Phase 1 — a trill exercise (buildable now)

The player chooses the main note and the auxiliary; everything follows.

**What it gains over the present free-play detection**

- **Both pitches judged.** With targets known, each pole is measured against
  the temperament or against the pure interval over the tonic. Today a trill
  is set aside entirely; here it becomes the thing being trained.
- **The substitution made visible.** A trill on B often starts C–B and
  continues with something between C and C♯. Measured on this player: the
  upper pole drifts up 16–60 cents and settles about 155 cents above the main
  note. The exercise can show that drift as it happens, which is worth
  knowing and currently invisible.
- **Speed and evenness.** Alternations per second, and how regular they are.
  A baroque trill is expected to accelerate; the exercise can show the curve
  rather than judge it against a fixed tempo.
- **A shorter window, which is the real prize.** General pitch detection needs
  a 2048-sample window (46 ms) because it must consider every frequency. With
  only two hypotheses, the question becomes "which of these two periods fits
  this fragment better", answerable by correlation over perhaps 512–1024
  samples. That would follow alternations two to four times faster than the
  present floor of roughly 60 ms per note — the regime where a real trill is
  currently a shower of too-short fragments.

**Sketch**

- `core/generator.js`: `trillDrill(main, auxiliary, {octaves, tempo})`.
- `audio/twoTone.js`: the two-hypothesis detector — correlate the incoming
  block against both expected periods, report which fits and how well. Pure,
  testable against the committed `trill.wav` and `trill_fingering.wav`
  fixtures, which is the only honest way to set its thresholds.
- `views/run.js`: a `trill` feedback policy — no needle during, a report after
  (speed curve, evenness, both pitches' tuning, whether the auxiliary moved).

**Open question for the player.** Should the auxiliary default to the scale
degree above the main note in the current key — so a trill on B in G major
offers C — with the option to override for a substituted fingering? That
matches how the ornament is written rather than how it is fingered.

## Phase 2 — the guide to the agréments

The French treatises name far more than the trill. Grouped by what the app
could actually do with them, rather than by the order they are usually taught:

**A. Two pitches alternating — the existing machinery reaches these**

*tremblement* / *cadence*, and its family: *tremblement appuyé* (*cadence
pleine*), *subit* (*jetée*), *feint* (*feinte*, *brisée*), *doublé* (*cadence
double*), *cadence molle*, *cadence à progression* · *pincé* / *pincement* ·
*martellement* · *tour de gosier* / *double*

These differ in how they begin, how long they dwell, whether they stop before
the end, and what they do at the close. All of that is timing over two known
pitches — measurable once the player declares which ornament they intend.
*Cadence à progression* is the accelerating trill already visible in the
recordings.

**B. One pitch travelling into or out of a note**

*port de voix* · *coulé* · *cheute* / *chute* · *accent* / *plainte*

The segmenter currently calls these slurs and sets them aside. That is the
right default, but with a declared intent the trajectory itself becomes the
subject: where it starts, how long it takes, whether it arrives.

**C. One note modulated**

*flatté* / *flattement* · *balancement*

Finger vibrato is a small oscillation around one pitch — within the ±60 cents
that the region tracker deliberately does not split on, so it survives as a
single note today and its depth and rate are already in the frame data,
unused. This may be the easiest of all to add: the numbers exist.

**D. Divisions and free passages**

*diminution* / *passage* · *coulade*, *trait* · *point d'orgue* / *cadenza*

Runs of ordinary notes, so nothing new is needed to hear them — but the
short-note floor bites: notes under about 100 ms cannot be measured, and a
brilliant *trait* is mostly such notes. Phase 1's shorter window would help
here too.

**E. What pitch cannot see, and the app should not pretend to teach**

*notes postiches* / *petits sons* · *hélan* · *sanglot*

These are matters of breath, attack and silence. The app measures pitch and
level; it has no view of articulation. The guide can explain them and the app
can stay quiet about whether they were done well. Saying so is better than
inventing a score.

## Naming — decided

The app is **Le Bon Goût**, tagline *le ton juste*: the French baroque ideal
the agréments serve, paired with the thing the app measures. Chosen by the
player, who proposed the pair; the two halves live in the name and the
subtitle rather than in an acronym, since the initials collide with LGBT
closely enough that every reader would see that first.

Applied in phase 4.4. The published URL is unaffected — it derives from the
repository name, not the app name — so links already shared keep working, and
the icon carries no wordmark.

## Sequencing

Phase 1 stands alone and is worth building on its own terms. Phase 2 should
wait on it: the trill exercise will show whether a declared intent really does
make measurement reliable, and if it does not, no amount of guide will help.
Group C is the cheap exception and could come at any time.

## Verification

Whatever is built here is checked against recorded playing before it is
believed. That is not a preference; it is what this project has learned three
times over — the detector crash on breath noise, the phantom F between E and
F♯, and a trill rule that never once fired on a real trill. The committed
fixtures in `docs/tests/fixtures/` exist for exactly this, and new material
gets a take in `flutetrainer/tools/record.py`.
