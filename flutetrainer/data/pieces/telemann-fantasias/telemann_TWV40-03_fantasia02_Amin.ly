\version "2.12.3"

fantasiados = \relative c'' {
\clef treble
\time 3/4
\key a \minor

a4 ^"Grave" c e | f, r16 e' d cis d f a d | g,,4 b d | e, r16 d' c b c e g c | f,,4 a c | d,16 c' b a c a gis a gis a gis a | e a gis a c a gis a gis a gis a | f a d f, a d f a, d f a d, | f a d f, a d, f a, d4 | 
 
r8 d, a'4.-+ gis16 a | gis dis' e b gis a b gis e4 \bar "||"

r8 ^"Vivace" c'16 d e8 gis, a f' | gis, f' e fis, g e' | fis, e' d e, f d' | e,16 d' c b c8 a e gis' | a, a'16 gis a8 e a c | 
b, b' cis, a' dis, fis | e, g'16 a b8 dis, e c' | dis, c' b cis, d b' | cis, b' a b, c a' | b,16 a' g fis g8 e b dis |
e, e'16 dis e8 b e g | a, a' b, g' cis, g' | d, d'16 cis d8 a d f | g, g' a, f' b, d' | c, e16 g c8 c, c' c, | r e16\p g c8 c, c' c, |
r e16\f g c8 c, c' c, | a'16 bes a g f g f e d e d c | b8 d16 c b c b a g a g f | e8 g' f, a' g, b | c  e16 f g8 b, c e, | 
f f'16 g a8 cis, d bes'| cis, bes' a b, c a' | b, a' g a, bes g' | a,16 g' f e f8 d a cis' | d,, f'16 a d8 d, d' d, |
r f16\p a d8 d, d' d, | c\f fis b, g' a, a' | g, b' fis, a' g, b' | d, gis c, a' b, b' | a, c' gis, b' a, c' |
d,, bes''16 a bes8 d, e, gis' | f, a'16 gis a8 c, e, a' | d,, bes''16\p a bes8 d, e, gis' | f, a'16 gis a8 c, e, a |
d, f'16\f e f8 a, d f | e, e' fis, d' gis, b' | 
a, c16 d e8 gis, a f' | gis, f' e fis, g e' | fis, e' d e, f d' | e,16 d' c b c8 a e gis' |
a, c16 e a8 a, a' a, | r8 c16\p e a8 a, a' a, |  r8 c16\f e a8 a, a' a, | 
f'16 g f e d e d c b c b a | f'\p g f e d e d c b c b a | 
gis'8 e a c, e, gis' | a e a,4 \bar "||" 

\set Timing.measurePosition = #(ly:make-moment 3 3)

\time 4/4
c4 ^"Adagio" ~ \times 4/6 { c16 g' f e d c } d16.[ fis,32 g8] ~ \times 4/6 { g16 d' c b a g } | e'16.[ b32 c8] ~ \times 4/6 { c16 g' f e d c } d16.[ fis,32 g8] r d'16. e32 | f16 a, g-+ f f' b, a-+ g f'16.[ d32 e8] r e16. fis32 | g16 b, a-+ g g' cis, b-+ a g'16.[ e32 f!8] r16 g g-+ f32 g |
a8 f,16. a'32 f,16 f' f-+ e32 f g8 e,16. g'32 e,16 e' e-+ d32 e | f8 d,16. f'32 d,16 d' d-+ c32 d e16 d32 c f16 e32 d g16 e, a' f, |
b-+ a32 g c16 f d8.-+ c16 c16.[ g32 ees'8] \times 4/6 { r16 fis, g a g fis } | 
c'16.[ a32 ees'8] \times 4/6 { r16 fis, g a g fis } ees'16.[ c32 a'8] r16 ees d c | b32[ g' a b c16. c,32] g16 d'8.-+ c4 \bar "||"

\set Timing.measurePosition = #(ly:make-moment 4 4)

\time 2/4
\partial 8 e8 ^"Allegro" | a b16 c b8 a gis a r e | d16 c b a  e'8 a, | gis a r e |
a16 b c a b c d b | c b a c e, gis b8 | a16 b c a b c d b | c b a c e, gis b8 | c[ cis d dis] | e16 dis e8 r fis |
g[ gis a ais] | b16 ais b8 r b | a16 g fis e g fis e dis | e b g e e' b g e |
e'8[ dis d cis] | c b r a | g[ e' fis, dis'] | e,4. \bar ":|:"

b'8 | e g16 f! e8 d | cis a' r g | f e16 d f e d cis | d8 a d,16 d' c! b | c8 e, fis16 c' b a | b8 g16 fis g a b cis |
d8 fis, gis16 d' c b | c8 a16 gis a8 e' | f, f'16 e d c b a | gis4 r8 e' |
a b16 c b8 a gis a r e | d16 c b a  e'8 a, | gis a r a | bes[ b c cis] | d16 cis d8 f e | a g16 f e d c b | a c b a e' c b a |
f'8 e g fis | a[ gis b e,] | c b16 a e8 gis | a4. \bar ":|:"

}

