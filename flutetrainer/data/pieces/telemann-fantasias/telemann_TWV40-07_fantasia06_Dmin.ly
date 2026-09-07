\version "2.12.3"

fantasiasis = \relative c'' {
\clef treble
\time 3/4
\key d \minor

\repeat volta 2 {
\partial 4 a4 | d,8 d'( cis d f) d | bes d( cis d f) d | f,[ a' g, g'] a,16 g' f e | f32( e d8.) r4
a4 | d,8 d'( cis d f) d | g, f'( e d) d' f, | c16 d e f g8 f4( e8) | f, e'( d c) c' e, | b16 c d e f8 e4( d8) | e, d'( c b) b' d, | 
c32( b a8.) d32( c b8.) e32( d c8.) | a'4. g16 f e d c b | a8 dis, e4 b'-+ a2 }

\repeat volta 2 {
c4 | f,8 f'( e f a) f | d f( e f a) f | a, c' bes, bes' c,16 bes' a g | a32( g f8.) r4 
g | fis8 c4 ees16( d) ees( d) c8 | a' c,4 ees16( d) ees( d) c8 | g' bes,! c a' d, fis |
g, fis'4 g16( a bes8) d, | e[ bes( a g)] c' bes | a e4 f16( g a8) cis, | d[ a( g f)] bes' a | gis d4 d16( e32 f) e8 d |
cis32( b a8.) e'32( d cis8.) g'32( f e8.) | d'4. c16 bes a g f e | d8 gis, a4 e'-+ | d2
}

\time 4/4
\partial 1
r4 d4^"Allegro" cis e | a, d2 cis4 | d8 e16 f e8 d  gis( a) a, f' | gis,[ e' b dis] e, e' a,16 c b c | d b c d gis,8 e' a,16 c b c a'8 g |
d fis c a' bes, d' a, c' | g, bes'16 a g8 f c e bes g' | a, c' g, bes' f, a'16 g f8 b, | e c g' b, c bes f'16 a, g a |
bes g a bes e8 c f, f'16 e f8 f, |
r4 c' b d | g, c16 e d e f d e f b,8 g' | c, e a,16 c b c d b c d gis,8 e' | a, c f,16 a g a bes g a bes e,8 c' |
f,16 c' d ees fis, ees' d c g8 bes g'4 | fis a d, g,8 ees' | fis, d' a cis d, d' g,16 bes a bes | c a bes c fis,8 d' g, g'16 fis g8 g, |
r8 bes'( a g) f, a'( g f) | e, g'( f e) d, f'( e d) | a16 cis d e a, d e f a,8 e'16 d cis d e8 |
r8 bes'(\p a g) f, a'( g f) | e, g'( f e) d, f'( e d) | a16 cis d e a, d e f a,8 e'16 d cis d e8 |
d,4\f d'' cis e | a, d,8 bes' cis, a' e gis | a, a' d,16 f e f g e f g cis,8 a' |
d,16 f e f g b, a b c e d e f a, g a | bes d cis d e g, f g a cis b cis d8 f, | g e' a, cis d d'16 cis d8 f,, | g4 a d, r4 

\time 3/2
\repeat volta 2 {
a'4^"Spirituoso" d cis f e d | g2 f4 e a g | bes a g f e d | 
a d cis f e d | g2 f4 e a g | bes a a, cis d2^\fermata |

f4 c d a bes g | c2 a4 f f' d | b g d' g e c | f a g bes a g8 f | d'2 bes4 a8 g c4 e, | f g c, e f2 |

a,4 d cis f e d | g2 f4 e a g | bes a g f e d |
a d cis f e d | g2 f4 e a g | bes a a, cis d2 |

f4 e d c b a | e'2 e,4 d' c b | a' g8 f e4 c d b | c a a' e f d | b'2 gis4 fis8 e e'4 b | c a e gis a2 |

a,4 d cis f e d | g2 f4 e a g | bes a g f e d |
a d cis f e d | g2 f4 e a g | bes a a, cis d2 |

d'4 a bes fis g d | ees2 c4 bes8 a d4 fis, | g c a d bes g | g' bes d, f e d8 c | f2 g4 f8 e a4 a, | d e8 f e4 d cis2 |
}
}

