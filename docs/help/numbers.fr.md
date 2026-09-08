# Lire les chiffres

Chaque valeur de cette application est une distance en **cents** — des
centièmes de demi-ton. 100 cents font un demi-ton ; 5 cents, c'est à peu près
la plus petite différence qu'une oreille attentive remarque sur une note
tenue. L'application dit qu'une note est **juste** à moins de 5 cents de sa
cible, **proche** à moins de 15, et **fausse** au-delà. Positif veut dire
haut, négatif bas.

## Deux façons de faire la moyenne, et pourquoi les deux sont affichées

Après un exercice tu lis une ligne comme *écart absolu moyen : 4,6 cents*,
puis *par note : fa♯ +1,5*. Ce sont les mêmes notes, moyennées de deux façons.

- **Absolu** ignore le sens : une note 3 cents trop basse et une autre 6
  cents trop haute ne sont que des *distances*. Il répond à « à quelle
  distance étais-je, en tout ? »
- **Signé** garde le sens : les deux mêmes notes donnent +1,5. Il répond à
  « de quel côté penche cette note ? »

Quand les deux ne concordent pas, c'est là l'information. Une note toujours
haute affiche le même chiffre sur les deux lignes. Une note à 4,6 d'écart mais
seulement +1,5 signé a raté *des deux côtés* — tantôt bas, tantôt haut — ce
qui est une affaire de contrôle, pas de placement, et aucun coup de tête de
flûte n'y changera rien.

## Le score de séance, après Écoute-moi

- **Précision** — distance absolue moyenne à la cible, chaque note comptant
  autant.
- **Décalage** — la moyenne signée : où la séance entière s'est placée. Cette
  part revient à la tête de flûte, ou à un diapason mal réglé, et la corriger
  ne coûte rien musicalement. Trop haut en moyenne : *tire la tête* ; trop
  bas : *enfonce-la*.
- **Interne** (ou *corrigé*) — la précision *une fois le décalage retiré* : à
  quelle distance tu étais de toi-même. C'est la part de l'oreille, et ce
  n'est pas le premier chiffre moins le second — retirer un décalage uniforme
  change la distance de chaque note différemment.
- **Régularité** — pour les notes jouées plus d'une fois, l'écart entre les
  reprises. Seules les notes jouées au moins deux fois comptent.
- **Stabilité** — combien la hauteur a bougé *à l'intérieur* d'une note
  tenue, une fois l'attaque écartée.

## Ajuster au bourdon

La même note écrite sur deux basses se mesure comme un **écart entre tes deux
émissions**, jamais comme une distance à un accordeur — un diapason mal réglé
ou une flûte qui sonne haut s'annulent donc.

- **L'harmonie demandait** — de combien la note devait bouger entre une
  tierce pure et une quinte pure dans ton tempérament.
- **Tu l'as bougée de** — de combien elle a bougé entre tes deux émissions.

Verdicts : *la même hauteur les deux fois* (moins de 3 cents de mouvement — là
où tout le monde commence) ; *bougée* (entre la moitié et presque le double
de ce qui était demandé) ; *pas assez* ; *trop loin* (plus de 1,8 fois) ;
*dans l'autre sens*.

Les deux émissions peuvent chacune se lire « juste » face à un accordeur alors
que le mouvement est le double du demandé : une tierce 3 cents basse et une
quinte 6 cents haute sont deux petites erreurs de côtés opposés, et l'*écart*
entre elles les additionne.

## Les notes qui ressortent

Une note est citée quand sa moyenne se tient à **15 cents** ou plus de la
cible. Elle est marquée *une seule fois* si elle n'a été jouée qu'une fois, et
*peu fiable* si ses reprises s'étalent sur plus de 10 cents — dans les deux
cas, ce n'est pas un verdict.

## Le profil de la flûte

- **Descend de / monte de** — de combien une note bouge depuis sa place
  naturelle, dans chaque sens. Sous **5 cents** dans un sens, la note y est
  *rigide*.
- **Forcé** — un pliage qui a coûté plus de **6 dB** de son. La hauteur est
  atteinte ; à toi de dire si tu l'emploierais en musique, et c'est pourquoi
  c'est signalé et jamais soustrait.
- **Se place à / écart interne** — où la flûte est dans l'ensemble, et sa
  cohérence une fois cela retiré : la même séparation que le score de séance.

## Contre quelle cible une note est jugée

En mode **tempéré**, chaque note a une hauteur fixe donnée par le
tempérament. En mode **pur**, une note est jugée comme intervalle pur
au-dessus de la tonique — le même fa♯ écrit a donc une cible *différente* sur
ré et sur si. C'est pourquoi Écoute-moi marche mieux quand il connaît la
tonalité : sans tonique, pas de cible pure ; sans tonalité, impossible de
distinguer ré♯ de mi♭.

## Quand le diapason est faux

Chaque note se décale de la même quantité : le *décalage* l'absorbe et les
chiffres internes n'en souffrent pas — c'est leur raison d'être. Mais un
diapason à un demi-ton entier renomme chaque note par sa voisine, et rien ne
peut le détecter à partir des seules notes. Si toute une séance se lit
curieusement haute ou basse, vérifie le diapason avant toute autre chose.

## Sources, et où vit le calcul

- [Cent (musique)](https://en.wikipedia.org/wiki/Cent_(music)) et
  [intonation juste](https://en.wikipedia.org/wiki/Just_intonation), Wikipédia
- [Tempérament égal](https://en.wikipedia.org/wiki/Equal_temperament), la
  référence de ce qui est mesuré « tempéré »
- Le code : [core/scoring.js](https://github.com/nebul2/flute-intonation/blob/main/docs/core/scoring.js)
  (bandes, écart absolu, par note) et
  [core/stats.js](https://github.com/nebul2/flute-intonation/blob/main/docs/core/stats.js)
  (score de séance, notes qui ressortent, conseil de tête)
- [core/adjust.js](https://github.com/nebul2/flute-intonation/blob/main/docs/core/adjust.js)
  pour les verdicts sur bourdon, et
  [core/bend.js](https://github.com/nebul2/flute-intonation/blob/main/docs/core/bend.js)
  pour le profil
- Pourquoi la lecture vient après la note et non pendant :
  [research/pedagogy.md](https://github.com/nebul2/flute-intonation/blob/main/research/pedagogy.md)
