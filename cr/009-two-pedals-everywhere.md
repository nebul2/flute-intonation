# CR-009 — Two pedals, everywhere: a standard forward / again

Status: **working in daily use** for the case it was raised for; the rest of
the surface is still proposed. Built over 8.4.5 (the practice runner), 8.4.6
(the hardware check) and 8.4.7 (the bug below). Raised 26 September 2026, by
the player, relaying a regular user.

## Why

The first feature this app has ever been asked for by someone other than the
player who built it:

> She said within an exercise she often wants to go again on the thing she
> just played and it's disconcerting to have to go back through restarting the
> whole exercise. She asked if the foot pedal could be used for that. So maybe
> rethink the UI with a standardised move forward / go again system. The foot
> pedal has 2 buttons (forward and back) so that should be taken into account
> everywhere.

Two separate findings are buried in that, and the second is the larger one.

**A missing verb.** "Again" had no name anywhere in the app. Every exercise
ran forwards only, and the sole way back was Redo, which restarts the whole
thing. So the price of one fluffed note was the whole exercise — and the
reason that price was being paid is that nobody had thought to offer any
other. A player mid-exercise does not want to restart; they want another go at
the bar they just missed, which is what practice *is*.

**A flute takes both hands and the mouth.** A foot control is not a
convenience on this instrument, it is the only free limb. Everything this app
asks a player to do mid-exercise — carry on, try again, call a note sharp or
flat — currently needs a hand on a screen, which means putting the flute down
or taking a hand off it. That is not an accessibility nicety; it is the
central ergonomic fact of the instrument, and the app has been ignoring it.

## What shipped in 8.4.5

Only the practice runner, and deliberately: it is where the request came from
and where "again" has the clearest meaning.

- `docs/ui/pedal.js` — the shared two-button vocabulary. `FORWARD` and `BACK`,
  a key table, and a subscription that registers on an `owner()` like every
  other. It is a module rather than a handler in `run.js` precisely so the
  rest of the app can adopt it without inventing a second convention.
- `runNav({ onAgain })` — an optional **That again** button, rendered only
  where a caller supplies the handler.
- `run.again()` — take back the note just played and play it again;
  `run.skip()` — abandon it and move on.
- `SessionSummary.dropLast()`.

**The retake replaces the attempt before it** rather than joining it, and that
is a correctness decision, not a kindness. Several reports index results
positionally against the exercise's notes: `adjustReport` reads the first two
as its two basses, the stopper check pairs them by octave. An appended retake
would have the adjust exercise comparing two goes at the *same* bass and
announcing confidently that the note had not moved. Verified after the change:
fluff the third, take it back, keep the second attempt, and the comparison
still reads the kept third against the fifth. The count of retakes is shown in
the summary, so the figures are attributed rather than hidden.

## The hardware is an unknown, and that is the main risk

These pedals present themselves as keyboards, and **there is no standard for
what they send**. Page-turner mode is usually PageDown/PageUp; "media" mode
sends arrow keys; some send space or enter; a few are configurable in their
own app. 8.4.5 accepts every plausible key and maps them all onto the two
intentions, which spares the player having to find out which they own — but it
is a guess made without the hardware in the room.

**Settled in 8.4.6**, on the player's suggestion that a pedal is hardware and
belongs on the hardware-check page beside the microphone and the speakers.
That page now reports the raw key before it reports any verdict — which is the
useful output when the key is one nobody predicted — and offers to assign an
unrecognised key to either intention. Assignments live in `pedalForward` /
`pedalBack` and beat the built-in table, so a pedal sending ArrowLeft can be
pointed forwards if that is which way round it sits under the foot.

So the question "what does her pedal send?" can now be answered by her, in the
app, without a round trip through a release. It is still worth asking: if it
is a key the table should have had, the table should get it, so the next
player never has to assign anything.

Note the standing project lesson applies to hardware as much as to audio: the
table was reasoned out, not measured, and is exactly the sort of thing that
turns out to be wrong in a room with the real device. The check page is how
the room answers back.

**Confirmed on real hardware, 26 September 2026.** Both of her pedals are
recognised, in both directions, on a Mac and an iPad. Her message does not say
whether that was the built-in table or an assignment made on the check page,
so the open question below stands — but the mechanism as a whole has now met
two real devices on two platforms and works.

## The bug in between

Worth recording because it cost her two testing sessions and because the shape
of it will recur. 8.4.5's "again" could only reach the note still on screen,
and a note is followed 900 ms later by the next one. That was the whole window
in which a player could decide they had fluffed something — while holding a
flute. Later presses landed on the note already showing, so nothing visibly
happened, and a stale `pendingResult` meant the press also deleted the
*previous* note's reading from the summary.

She reported it as "the left pedal does nothing", tested two pedals and two
machines to rule out her own hardware, and apologised for having explained
herself badly. She had explained it exactly right. The lesson is the one
CR-004 is built on: the failure was invisible from the inside, because the
person who wrote it tests by pressing the key immediately, and a player
reaching for a pedal mid-phrase does not.

8.4.7 made `takeBackTarget()` a pure exported function so the decision is
pinned by tests rather than by a browser session.

## The three-way problem, unresolved

The player's own reservation, and it is the right one to have:

> Not sure about using the pedal to give feedback on whether I was high, low
> or in tune as that's 3 choices.

Two buttons cannot express three calls. The options, none of them free:

| option | how | what it costs |
|---|---|---|
| leave it on screen | pedal navigates, the call stays a tap | the one moment the player must touch the screen is the one where they are holding the flute |
| two pedals, third by omission | back = flat, forward = sharp, no press = in tune | a timeout, and "I did not decide" becomes "in tune" |
| chord or long press | both pedals, or a held one | pedals differ in whether they can send either; unlearnable without a diagram |
| cycle and confirm | back cycles a highlighted call, forward commits | two presses per note, and the eyes go back to the screen — which is what the exercise exists to avoid |
| drop to two calls | "sharp or flat?" only when the note is outside the band | changes the exercise, and "in tune" is the answer worth being able to give |

**Recommendation: leave the call on screen for now**, and treat this as the
one place the two-button model genuinely does not reach. The alternative
designs all trade a clear ergonomic problem for a murky cognitive one. Worth
asking the user directly — she is the one with a pedal under her foot and the
only person who can say whether reaching for the screen once per note is
actually the annoyance it looks like from here.

## The rest of the surface

Sixteen views; three carry a run that could have a forward and a back
(`run.js`, done; `listen.js`, `scales.js`). The question each raises is what
the two words *mean* there, and the answer is not obvious:

- **Listen to me** is free playing with no note the app chose, so there is no
  "that" to do again. Forward might mean "finish and show me", back might mean
  "forget the last note I played" — which is a genuinely useful thing to have
  after a cough, and does not exist today in any form.
- **Play scales** ends on a timer. Back could drop the last scale from the
  reckoning; forward could end the session.
- **The tuner and the tools** have nothing sequential in them.

The rule to hold everywhere, and the reason to write it down before building
any of it: **forward never destroys anything, back never skips anything.**
A player working by feel, with their eyes on the music rather than the screen,
has to be able to press either one without wondering what it will cost.

## Open questions for the player

- **What does her pedal actually send?** No longer blocking — the hardware
  check will tell her, and she can assign it herself — but still worth
  knowing, because a key the table should have had should go in the table.
- **Should "again" also exist in free play**, as "forget that last note"? It is
  a different verb wearing the same coat, and giving them the same button may
  be worse than giving the second one no button at all.
- **Is the on-screen button worth keeping** now that the pedal works, or does
  it clutter a page whose whole design is about not looking at the screen?
- **Does she want the retake counted or discarded?** 8.4.5 discards the
  abandoned attempt and says how many there were. The opposite — every attempt
  scored, the spread reported — is defensible and is what the repeatability
  figure elsewhere in the app is built on.

## Relation to existing work

- `docs/ui/pedal.js` is the shared layer; anything added here uses it rather
  than its own keydown, and registers on the view's `owner()`.
- The letter keys for the predict call (s / f / t) stay as they are, and stay
  in `run.js`: they are a keyboard affordance, not a pedal one.
- **CR-004 (join the team)** is the one this touches most. The app's largest
  known weakness is that it was built, calibrated and tested on one player,
  one set of flutes, one room — and this CR exists because a second player
  used it and found something the first never would, since he does not
  practise with a pedal. That is the argument of CR-004 arriving on its own,
  and worth noticing: the feedback route paid for itself before it was built.
