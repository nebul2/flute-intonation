# CR-004 — Join the team: volunteers sharing their sessions and recordings

Status: **proposed**, not started. Raised 5 September 2026, by the player.

## Why

Everything in this app was built, calibrated and tested on **one player, one
set of flutes, one room**. That sentence is on the feedback page because it is
the app's largest known weakness, and it is one the player cannot fix alone:
the failures worth having are on *other* instruments in *other* rooms, and
those can only come from other people.

The evidence is already in. The scale recogniser was wrong twice before the
player's own recording corrected it; the octave-error repair, the flat-key
bug, the spelling trap — every one was found by a recording, none by
reasoning. A volunteer who sends thirty seconds of a scale the app refused to
count is worth more than a page of description, and the feedback page already
says so. This CR makes that a route rather than a request.

## A promise that must not be broken quietly

The footer says, in both languages: **"Your playing never leaves this
device."** Settings says nothing about playing, settings or history is ever
sent. That is a stated commitment, not a default, and it is part of why anyone
should trust the temperament of this app with their instrument.

So "join the team" cannot be a switch that turns on background sharing. It
must be **one deliberate action, taken by the player, sending a bundle they
have looked at**, after which the promise is still true of everything they did
not choose to send. The footer wording should change to say exactly that:
*your playing never leaves this device unless you choose to send it*. Softening
the sentence is the honest cost of the feature, and it should be paid
visibly.

## What would actually help, ranked

1. **A short recording of something the app got wrong** — the single most
   valuable thing, and the thing it has never had from anyone but the player.
   Twenty seconds. Its value is in the failure, not the playing.
2. **The session record** it produced for that recording, so the two can be
   lined up: what the detector heard against what was played.
3. **The flute profile** (`profiles.js`) — how far each note bends on *that*
   instrument. Different flutes are the whole point, and this is small and
   contains nothing personal beyond the instrument's name.
4. **Session history** more broadly — useful for the statistics, far less
   than a recording, and the part most likely to contain something the
   volunteer did not mean to send (see labels, below).
5. **The setup line** the feedback page already assembles: version, tuning,
   sample rate, whether the browser was applying gain control or noise
   suppression. Reports without it are usually unactionable.

Identity is not on the list. Nothing here needs a name.

## Design

**No backend.** The app is a static site, and a backend would make the player
a data controller with hosting, storage, a privacy policy, a retention
schedule and a deletion process to maintain. The feedback address already
exists and already carries recordings as attachments. A **bundle sent by
mail** keeps the whole legal footprint at "a mailbox", and — more important —
the volunteer sees every byte before it goes, in their own mail client, and
can delete any of it.

**One page, reached from the feedback page**, with four checkboxes, all off:

- a recording (opens the capture below)
- the session that goes with it
- my flute profile
- my whole history

Then a **review screen** listing what is in the bundle in plain terms — *"3
sessions, 2 named 'Palanca', 41 notes; one recording, 24 s; one flute
profile"* — and a button that assembles it and opens the mail. Nothing sends
itself.

**Labels are the trap.** A session label is free text, and *"Flûte de Marie"*
or *"leçon avec Jean"* is a name. The review screen must show every label
that will be sent and offer to blank them in the bundle. The same for the
flute profile's name.

**Recording in the app** is the one piece of new machinery. `record.py` is
desktop-only. The browser has `MediaRecorder`, but it produces compressed
Opus in most browsers, and a detector bug is exactly the kind of thing lossy
compression can hide or invent. The app already has raw PCM flowing through
its AudioWorklet; a short capture should be written from *that* path as
16-bit WAV, the same format the fixtures use, so what the volunteer sends is
what the detector actually saw. Cap it at thirty seconds; the failure is in
the first ten.

**Consent, in the GDPR sense**: specific (per item, not one blanket box),
informed (the review screen), freely given (all boxes off, no nudging,
nothing gated behind it), and withdrawable — the page says how to ask for
deletion, which with a mail-based flow is a mailbox search, and the player
commits to doing it.

**What is never collected**: no name, no address, no device identifier, no
location, no analytics of the sharing itself, nothing from the microphone
except the clip the volunteer chose to make and reviewed.

**Credit**, if wanted: a `CONTRIBUTORS` file in the repository listing
volunteers who *ask* to be listed, by whatever name they give. Opt-in, like
everything else here.

## What the player commits to, in return

Written on the page, because a volunteer should know what happens next:

- recordings are kept only as long as they are useful, and deleted on request
- they are used to improve the app and for nothing else — not published, not
  committed to the public repository (the fixtures are excerpts of the
  player's own playing, and stay that way)
- if a recording leads to a fix, the volunteer is told what it was

## Sequencing

1. Change the footer promise first. It costs nothing and it must precede any
   sharing feature by design.
2. The bundle and review screen over what already exists: history export,
   profiles, the diagnostics line. Mail it.
3. In-app WAV capture from the worklet path, with the cap.
4. The contributors file.

Step 2 alone is useful: it turns the feedback page's request for a recording
made in Voice Memos into something that carries the matching session too.

## Open questions

- **Retention.** "As long as useful" needs a number a volunteer can read.
  Twelve months, then deleted unless it has become a fixture — which would
  require asking again, explicitly?
- **Anonymous contributions.** A mail bundle arrives from an address. Should
  the page offer a copy-to-clipboard route for someone who wants to send it
  some other way, as the feedback page does?
- **Whether to ask at all** in the invitation the app already shows after the
  third session, or only from the feedback page. The invitation was designed
  to ask once and never nag; adding a second ask there would be a change in
  its character.
