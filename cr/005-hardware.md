# CR-005 — A microphone and a drone speaker made for the job

Status: **proposed**, not started. Raised 7 September 2026, by the player.

## Why

Every hard problem this app has had with sound has been about the hardware
it was never designed for, not about the arithmetic:

- **The drone at the unison.** Pitch cannot separate a drone from a flute at
  the same pitch; only level can (`drone-unison-needs-level-not-pitch`). The
  player had to turn the speaker down for the app to hear the D over the
  drone at all, and a whole onset-level calibration exists to cope with the
  drone bleeding from the device's own speaker into its own microphone.
- **Phones process the microphone.** Automatic gain control, noise suppression
  and echo cancellation are all requested off, and the diagnostics line in
  every feedback mail reports whether the browser obeyed — because it does not
  always, and a gain-controlled microphone makes every level measurement in
  the app (the bend profile's "forced" verdict, the onset guard) meaningless.
- **48 kHz versus 44.1**, the other trap in the same memory.
- **Reverb.** A professional's recording in a resonant room fragmented into
  185 short regions and produced steady pitches below the flute's range —
  overlapping tails read as sub-harmonics. A close microphone hears the flute
  and very little of the room.

A microphone placed and voiced for a traverso, and a drone coming from a
speaker that is *not* next to the microphone, would remove three of these at
the root rather than compensating for them in software.

## What "for the flute" would actually mean

**The microphone**

- Clip-on, at the embouchure, so the distance is fixed — level then means
  something across sessions, which it does not when a phone lies wherever it
  was put down.
- Flat from about 200 Hz to 3 kHz: the traverso's fundamentals run D4–A6,
  roughly 280–1,700 Hz at 415, and the second partial is what the detector
  leans on for the low register.
- Low self-noise, so the silence gate is not the thing setting the floor.
- **No processing in the chain**: a plain condenser into a USB interface,
  which bypasses the phone's AGC entirely. That single property matters more
  than the frequency response.

**The speaker**

- Physically separate from the device, placed where a continuo player would
  sit: the bleed problem becomes a small one instead of a central one.
- Able to reproduce the drone's partials cleanly. The drone is a sine plus
  two partials at −12 dB/octave; a phone speaker rolls off the fundamental of
  a D4 drone almost entirely, so the player hears a thin thing and tunes to
  its harmonics. A bass-capable speaker makes the drone a bass line.

## Do the cheap version first

None of this needs a manufacturer to exist. Off the shelf:

- any clip-on instrument condenser (the kind sold for flute and clarinet) into
  a two-channel USB audio interface — the interface is what defeats the phone
  processing;
- any Bluetooth or wired speaker for the drone, set a metre or two away.

The app needs **no code** for this: `deviceId` in Settings already selects an
input, and the engine already disables AGC, suppression and cancellation
where the browser allows. What it needs is a **page that says so** — which
gear, why, and how to check the diagnostics line shows "AGC off" — because
nobody will guess that the fix for "it can't hear my low D over the drone" is
a €30 speaker across the room.

Measure with that first. If it does what this CR expects — the unison guard
becomes unnecessary, level readings stabilise, reverb fragmentation drops —
then there is a case to take to a maker; if it does not, there is not.

## Then, a maker

The pitch to a manufacturer is narrow and honest: a small, growing group of
baroque flute players with a free app that can *show* the difference a
proper microphone makes, in cents, on their own instrument, and a page that
recommends what to buy. Makers of clip-on woodwind microphones already sell
to flautists; the drone speaker is any small bass-capable unit.

What the app could offer in return: a diagnostics page that recognises the
device and confirms the signal path is clean, and the measured comparison —
phone microphone against the recommended one — published with the numbers.

## What must not happen

- The app must keep working with a phone and nothing else. Recommended gear
  is a recommendation, never a requirement, and no feature may be gated on it.
- No affiliate arrangement that would make the recommendation anything other
  than a measurement. If a maker's microphone is recommended it is because it
  was measured to be better, and the measurement is published.

## Verification

1. Buy or borrow the cheap version. Record the same passage three ways on the
   same day — phone microphone, clip-on into an interface, and each with the
   drone from the phone against the drone from a separate speaker.
2. Run all of it through `wavpipe.js` and the score comparison. The
   quantities to report: short regions per note, notes lost at the unison,
   level spread across a held note, and recall against the score.
3. Only then write the gear page, from the numbers.
