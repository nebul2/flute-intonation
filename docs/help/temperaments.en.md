# Why the temperaments differ, and where meantone breaks

## The problem every temperament answers

Stack twelve pure fifths and you land almost, but not quite, seven octaves
higher — about a quarter of a semitone sharp. That excess is the Pythagorean
comma, roughly 23.5 cents, and it cannot be wished away. Every temperament in
this app is one answer to the same question: **where do you put the comma?**

Equal temperament spreads it evenly, so every fifth is 2 cents narrow and
every major third is 14 cents wide — nothing is pure and nothing is unusable.
The historical temperaments refuse that bargain. They make some keys beautiful
by making others rough, which is the point: keys had characters, and composers
chose them.

## Quarter-comma meantone, and its wolf

Quarter-comma meantone buys **pure major thirds** — the interval the ear
notices most — by narrowing each fifth by a quarter of the syntonic comma.
Eleven fifths come out at 696.6 cents instead of 702, which is a shade flat but
perfectly musical.

The twelfth fifth has to absorb what the other eleven refused. Running the
chain E♭–B♭–F–C–G–D–A–E–B–F♯–C♯–G♯ leaves the gap between **G♯ and E♭**, and
that gap is **737.6 cents — 35.7 cents wider than a pure fifth**. It howls,
and it is called the wolf.

The payoff is real: eight major thirds come out at 386.3 cents, which is a
*perfectly* pure 5:4, beatless. The four built on C♯, F♯, G♯ and B come out at
427 cents — 41 cents wide, and genuinely unusable.

So a harpsichord in meantone is not tuned badly in four keys. It is tuned
gloriously in eight and refuses the other four, and the music of the period
knows this and stays where the instrument is beautiful.

## What this means on the flute

A keyboard has one key between G and A, and its tuner must decide whether that
key is a G♯ or an A♭. Meantone makes them 41 cents apart, so the choice is
brutal and permanent.

**You do not have that problem.** The flute chooses per note, per phrase. That
is why this app spells pitches rather than numbering them, and why D♯ and E♭
are different notes in the enharmonic exercise: on a traverso they genuinely
are, and playing them the same is a choice to sound like a piano.

This is also why the *Compare temperaments* table is worth reading before
playing it. The naturals barely move between temperaments — D shifts under 4
cents across all five, which is less than you can reliably play. But E♭, G♯ and
B♭ swing about 20 cents, and those are exactly the notes at the ends of the
meantone chain. **The notes that differ are the notes near the wolf.** They
are where a temperament has a character at all, and where your ear and your
fingers actually have something to decide.

## The well temperaments

Vallotti, Werckmeister III and Kirnberger III are compromises made after
players got tired of the wolf. They distribute the comma unevenly but
*completely*, so every key is playable while the home keys stay sweeter than
the remote ones. They sit within about two cents of each other note for note —
closer than a well-tuned harpsichord holds its own tuning — which is why this
app will tell you that you are in a well temperament and decline to tell you
which one.

## Where the numbers here come from

Every figure above is computed from the Scala files this app ships and tunes
by, not quoted from a book, so you can check them: run
`python -m flutetrainer.tools.temperament_separation` in the repository. The
wolf at 737.6 cents, the eleven fifths at 696.6, the eight pure thirds at
386.3 and the four at 427 all come out of `meantone_quarter.scl` directly.

## Sources

- Pietro Aron, *Toscanello in musica* (Venice, 1523) — the first practical
  description of what is now called quarter-comma meantone
  ([Aron](https://en.wikipedia.org/wiki/Pietro_Aron))
- Andreas Werckmeister, *Musicalische Temperatur* (Quedlinburg, 1691)
  ([Werckmeister](https://en.wikipedia.org/wiki/Andreas_Werckmeister))
- Johann Philipp Kirnberger, *Die Kunst des reinen Satzes in der Musik*
  (Berlin, 1771–79)
  ([Kirnberger](https://en.wikipedia.org/wiki/Johann_Philipp_Kirnberger))
- Francesco Antonio Vallotti, *Trattato della scienza teorica e pratica della
  moderna musica* (Padua, 1779)
- Johann Joachim Quantz, *Versuch einer Anweisung die Flöte traversiere zu
  spielen* (Berlin, 1752) — on the flute's freedom to distinguish enharmonics
  ([Quantz](https://en.wikipedia.org/wiki/Johann_Joachim_Quantz))
- J. Murray Barbour, *Tuning and Temperament: A Historical Survey* (Michigan
  State College Press, 1951; Dover reprint, 2004) — the standard survey
- Owen Jorgensen, *Tuning* (Michigan State University Press, 1991)
- Ross W. Duffin, *How Equal Temperament Ruined Harmony (and Why You Should
  Care)* (W. W. Norton, 2007) — the accessible modern argument
- Mark Lindley, "Temperaments", *Grove Music Online* (Oxford University Press)
- Background on the intervals themselves:
  [quarter-comma meantone](https://en.wikipedia.org/wiki/Quarter-comma_meantone),
  [the wolf interval](https://en.wikipedia.org/wiki/Wolf_interval),
  [the syntonic comma](https://en.wikipedia.org/wiki/Syntonic_comma) and
  [the Pythagorean comma](https://en.wikipedia.org/wiki/Pythagorean_comma)
- [The Scala scale archive](https://www.huygens-fokker.org/scala/),
  Huygens-Fokker Foundation — the source of this app's temperament files
