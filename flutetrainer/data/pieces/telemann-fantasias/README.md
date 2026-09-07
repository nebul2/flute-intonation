# Telemann, Fantasias for solo flute (TWV 40:2–13) — note data

Machine-readable scores for testing the detector against real music: the
player records a movement, the app's pipeline names what it heard, and the
two are compared note for note.

**Source**: Llorenç Lledó's LilyPond edition, transcribed from the original
print — https://github.com/lluritu/scores (`Telemann_fantasias/`). Announced
at https://lluritu.blogspot.com/2011/11/telemanns-12-fantasias-for-flute.html.
A PDF of the same edition is on IMSLP for reading from.

**Licence**: Creative Commons Attribution-ShareAlike 4.0 International
(`LICENSE` in this directory, copied from the repository). The `.ly` files are
Lledó's; the `_absolute.ly` and `.midi` files are derived from them and carry
the same licence. Attribution: *Edited by Llorenç Lledó.*

| file | movement | notes | range |
|---|---|---|---|
| `telemann_TWV40-03_fantasia02_Amin_1-Grave` | No. 2 A minor, Grave | 83 | D4–D6 |
| `telemann_TWV40-09_fantasia08_Emin_1-Largo` | No. 8 E minor, Largo | 234 | D4–D6 |
| `telemann_TWV40-07_fantasia06_Dmin_1-Dolce` | No. 6 D minor, Dolce | 463 | D4–E6 |
| `telemann_TWV40-08_fantasia07_Dmaj_AllaFrancese` | No. 7 D major, whole | 679 | D4–D6 |

Note counts were checked two ways — from the MIDI note-ons and from the
absolute-pitch LilyPond — and agree. The `_absolute.ly` files keep the
spellings (`fis''` not a MIDI number), which the MIDI cannot; the pipeline
compares on chromatic index and re-derives spelling from the key, as the
scale recogniser does.

Movement files for Nos. 2, 6 and 8 were cut at the second tempo marking, so
only first movements are isolated; `*_all_repeats-unfolded.midi` is the whole
of No. 8 as played.

## A professional reference for the Grave

François Lazarevitch plays the A minor Grave in the first fifty seconds of
https://www.youtube.com/watch?v=qVQfkPMhfUw — slower, with a good deal of
rubato. **Not downloaded and not to be used until he has given permission**,
which the player is asking for; when it comes, this is the recording to line
up against `telemann2.wav`, since the alignment is by order and the rubato
will not count.

## Measured on the player's own recordings (A = 415)

`node docs/tests/score.js recordings/<take>.wav <movement>.midi --ref 415`

| take | movement | matched | wrong | missing | extra | recall |
|---|---|---|---|---|---|---|
| `telemann2.wav`, tempo free | No. 2 Grave, 83 notes | 61 | 4 | 18 | 0 | 73 % |
| `telemann8.wav`, played slowly | No. 8 Largo, 234 notes | 229 | 1 | 4 | 5 | **98 %** |

The Grave's failures were the flute, not the detector: its four wrong notes
were F naturals sitting 60-odd cents sharp and named F♯ (Lazarevitch's, on
the same movement, read +3 cents), and its missing notes were the G♯/A
semiquaver alternations, lost by both players for different reasons.

The Largo, played slowly so the semiquavers clear the short-note floor, was
heard almost note for note. Its ten divergences match the three or four
sight-reading fluffs the player reported -- a missing note beside an extra one
at four places, and a B♭ read as B natural. Both written trills came out as
exactly two ornament runs, at 80 s and 107 s, G5/F♯5, nine and eleven
alternations; all fourteen notated slurs were heard as two notes each, and
only one region in the whole take was set aside as a glide.
