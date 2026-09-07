\version "2.12.3"

fantasiaset = \relative c'' {
\clef treble
\time 4/4
\key d \major

\repeat volta 2 {
d,4. ^"Alla Francese" d'16 e e4.-+ d16 e | d,4. fis'16 g g4.-+ fis16 g | d,4 a''8. fis,16 g'8. e,16 fis'8. d,16 | 
e'4 a, r32 a[ b cis d e fis g] a8. g16 | fis8. cis16 d4 r32 b[ cis d e fis g a] b8. a16 | gis8. dis16 e4 r8. b16[ cis8. gis16] |

\set Timing.measureLength = #(ly:make-moment 5 4) 
a8.[ a16 b cis] fis,8.[ fis16 g a] d,8.[ cis'16 d8. ais16] | b8.[ b16 cis d] gis,8.[ gis16 a b] e,8. dis'16 e8. b16 |

\set Timing.measureLength = #(ly:make-moment 4 4)
cis8. a16 fis'4 gis,8. b16 e8. e,16 | fis8. a16 d4 e,8.[ gis16 cis8. e,16] | d8.[ cis'16 b8. a16] dis,8. b'16 a8. fis'16 | 
e,8. gis16 b4 r8. d16[ cis8. b16] | a'8. gis32 fis e8. d16 b4.-+ a8 | }

\alternative{
{ a4. a8 a8. g16 fis8. e16 \bar ":|" }
{ \time 3/8 a4 a'8 \bar "|:"  }
}

b b fis | g g16 a b8 | e, a g | fis16 g fis e d e | fis a fis d cis e | d d, d' e fis d | b fis' e b' d, b' | cis, d cis b a fis' | 
b,[ g' b, g'] fis, a' | g,[ b'] g,[ a b fis'] | e,[ g'] a,[ fis' g, e'] | fis, g fis e d fis' | g, fis' e d cis b | ais4 d16 e |
fis d fis d g e | fis d fis d g e | fis d fis d e cis | d8[ b] d16\p e | fis d fis d g e | fis d fis d g e | fis d fis d e cis | d8 b fis'\f |
e, g'16 fis g e, | fis8 ais' fis, | g b'16 ais b8 | gis, b'16 cis d b | a,8 cis'16 b cis8 | ais, cis'16 d b cis | b,8 d'16 cis d8 | e, cis'16 ais b d, | e[ g] fis8 ais |
b,4 d8 | fis,16 a d a' d,8 | g,16 b d b' d,8 | a16 c g b fis a | g b a g b8 | 
dis,16 fis b fis' b,8 | e,16 g b g' b,8 | fis16 a e g dis fis | e g fis e e'8 | fis fis cis | d d16 e fis8 | b, e d | cis[ a] a'16 fis, |
b' g, b' g, fis' a, | g' b, g' a b g, | e' cis a' a, g' cis, | fis e d8 a' | b,16 a' g fis e d | a e' d cis fis, d' | g,[ b'] a,8 cis |
d4 fis16 g | a fis a fis b g | a fis a fis b g | a fis a fis g e | fis8[ d] fis16\p g |
a fis a fis b g | a fis a fis b g | a fis a fis g e | fis8 d fis,\f |
g16 b d b gis e' | a,8 fis' ais, | b16 d fis d b g' | cis,8 a' cis, | d16 fis a fis d fis | g,8 e'16 cis d fis, | g d' a8 cis |
d16 a fis' d a' fis | d' a fis d a' fis | d fis a, d fis, a | 

\time 4/4
\set Timing.measureLength = #(ly:make-moment 17 16)
d,4. fis'16 g g4.-+ fis16 g a |
\set Timing.measureLength = #(ly:make-moment 4 4)
dis,,4. c''8 b8.[ a16 g8. fis16] |
\set Timing.measureLength = #(ly:make-moment 17 16)
e,4. g'16 a a4.-+ g16 a b |
\set Timing.measureLength = #(ly:make-moment 4 4)
cis,4.-+ e8 a8.[ fis16 g8. e16] | fis8. d16 b'4 cis,8.[ e16 a8. a,16] | b8. d16 g4 a,8.[ cis16 fis8. fis,16] |
g8.[ fis'16 e8. d16] gis,8.[ e'16 d8. b'16] | a,8. cis16 e4 r8. g16[ fis8. e16] | d'8. cis32 b a8. g16 e4.-+ d8 | 

\set Score.repeatCommands = #'((volta "1"))
\time 3/8
d4 a'8 \bar ":|"
\set Score.repeatCommands = #'((volta #f))
\set Score.repeatCommands = #'((volta "2"))
\time 4/4
d,1 
\set Score.repeatCommands = #'((volta #f))

\repeat volta 2 {
\partial 4
d8 e16 fis | e4 d cis b8 a | d4 a d, d'8 e16 fis | e4 d cis b8 a | d2 d,4 
d'8 e16 fis | e4 d cis b8 a | d4 a d, d'8 e16 fis | e4 d cis b8 a | d2.^\fermata fis8 gis |
a4 a, a a | a2.-+ cis8 e | a,4 d8 fis a,4 cis8 e | a,4 e'8 a a,4 cis8 dis |
e4 e, e e | e2.-+ d'4 | cis b a b8 gis | a2. 
d8 e16 fis | e4 d cis b8 a | d4 a d, d'8 e16 fis | e4 d cis b8 a | d2 d,4 
d'8 e16 fis | e4 d cis b8 a | d4 a d, d'8 e16 fis | e4 d cis b8 a | d2.
d4 | g g8( b) g4 d | g2 g,4 a | b d a c | g2 b4 a8( b) | d( b a b) g( b a b) | c( b a b) g4 d' |
cis! d g fis | fis2-+ e4 }

}

