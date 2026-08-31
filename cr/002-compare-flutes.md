# CR-002 — Comparing two flutes, profile against profile

Status: **proposed**, not started. Raised 31 August 2026, by the player, who
also asked that it stay a change request rather than becoming this evening's
work: *"maybe a CR to avoid going down a rabbit hole now."*

## Why

Profiles are already kept per instrument and are already the right shape for
this. `profileStats` gives each flute a centre, an internal scatter, and its
bend capability each way; `bestOffset` gives each one its own best headjoint
placement. Two profiles side by side would answer the question a player with
two flutes actually asks, which is not "which is better" but **"what is each
one for"**.

## What it would say

- **Where each sits, and how consistent each is.** The two numbers must stay
  apart, as everywhere else in this app: a flute sitting 12 cents sharp is one
  push of the headjoint from right, while a flute 12 cents out with itself is
  not fixable at all. Reporting a single "accuracy" would hide exactly the
  distinction that matters.
- **Which notes disagree between them**, after removing each flute's own
  centre — the same offset correction `core/compare.js` already does for two
  sessions. A note that is awkward on both is the fingering; a note awkward on
  one only is that instrument.
- **Where each is flexible.** A flute with a rigid low register and a free top
  is a different proposition from the reverse, and neither is worse. This is
  the part a summary score would destroy, and the reason not to compute one.
- **Which repertoire suits which**, if it can be said honestly: a flute whose
  rigid notes sit in the sharp keys is telling you something about what to
  play on it.

## What it must not do

Produce a single number ranking the two. The existing two-session comparison
had the same temptation and resisted it, and this has more reason to: an
instrument is not better or worse than another, it is different, and the
useful output is the difference itself.

## Shape

- `core/bend.js`: `compareProfiles(a, b)` → per-note differences after
  centring, plus each side's stats and the notes only one of them has measured.
- Reuse: `profileStats`, `bestOffset`, and the significance idea from
  `core/compare.js` — with two or three readings a few cents is noise, and the
  table must say so rather than imply a difference is real.
- A comparison section on the profile page, since the flute picker is already
  there; no new route.

## Preconditions

Two profiles with enough overlap to compare, taken under the same temperament,
root and reference pitch. `profiles.staleFor` already detects the mismatch;
the comparison should refuse rather than compare across tunings, exactly as
the session comparison refuses.

## Verification

Against two real profiles of two real flutes, once the player has measured
them. Nothing here should be believed from synthetic entries alone — the point
of the whole feature is what real instruments turn out to do, and this project
has been wrong three times about what real audio would show.
