# Pourquoi les tempéraments diffèrent, et où le mésotonique casse

## Le problème auquel tout tempérament répond

Empile douze quintes pures et tu arrives presque, mais pas tout à fait, sept
octaves plus haut — environ un quart de demi-ton trop haut. Cet excédent est
le comma pythagoricien, à peu près 23,5 cents, et on ne peut pas le faire
disparaître. Chaque tempérament de cette application est une réponse à la même
question : **où met-on le comma ?**

Le tempérament égal le répartit uniformément : chaque quinte est étroite de 2
cents, chaque tierce majeure large de 14 cents — rien n'est pur, rien n'est
inutilisable. Les tempéraments historiques refusent ce marché. Ils rendent
certains tons splendides en rendant les autres rugueux, et c'est bien le but :
les tonalités avaient un caractère, et les compositeurs les choisissaient.

## Le mésotonique au quart de comma, et son loup

Le mésotonique au quart de comma achète des **tierces majeures pures** —
l'intervalle que l'oreille remarque le plus — en rétrécissant chaque quinte
d'un quart de comma syntonique. Onze quintes sortent à 696,6 cents au lieu de
702 : à peine basses, parfaitement musicales.

La douzième quinte doit absorber ce que les onze autres ont refusé. La chaîne
mi♭–si♭–fa–do–sol–ré–la–mi–si–fa♯–do♯–sol♯ laisse l'écart entre **sol♯ et
mi♭**, et cet écart vaut **737,6 cents — 35,7 cents de plus qu'une quinte
pure**. Elle hurle : c'est le loup.

Le gain est réel : huit tierces majeures sortent à 386,3 cents, soit un 5:4
*exactement* pur, sans battement. Les quatre bâties sur do♯, fa♯, sol♯ et si
sortent à 427 cents — 41 cents trop larges, franchement inutilisables.

Un clavecin en mésotonique n'est donc pas mal accordé dans quatre tons. Il est
magnifiquement accordé dans huit et refuse les quatre autres, et la musique de
l'époque le sait : elle reste là où l'instrument est beau.

## Ce que cela change à la flûte

Un clavier n'a qu'une touche entre sol et la, et son accordeur doit décider si
cette touche est un sol♯ ou un la♭. Le mésotonique les sépare de 41 cents : le
choix est brutal et définitif.

**Tu n'as pas ce problème.** La flûte choisit note par note, phrase par phrase.
C'est pourquoi cette application nomme les hauteurs au lieu de les numéroter,
et pourquoi ré♯ et mi♭ sont deux notes distinctes dans l'exercice
d'enharmonie : sur un traverso elles le sont vraiment, et les jouer pareil est
un choix — celui de sonner comme un piano.

C'est aussi pourquoi le tableau *Comparer les tempéraments* mérite d'être lu
avant d'être joué. Les notes naturelles bougent à peine d'un tempérament à
l'autre — le ré varie de moins de 4 cents sur les cinq, moins que ce que tu
peux jouer de façon fiable. Mais mi♭, sol♯ et si♭ varient d'une vingtaine de
cents, et ce sont exactement les notes des extrémités de la chaîne
mésotonique. **Les notes qui diffèrent sont les notes voisines du loup.** Ce
sont elles qui donnent son caractère à un tempérament, et les seules où ton
oreille et tes doigts ont vraiment quelque chose à décider.

## Les tempéraments bien tempérés

Vallotti, Werckmeister III et Kirnberger III sont des compromis nés de la
lassitude du loup. Ils répartissent le comma inégalement mais *complètement* :
tous les tons sont jouables, et les tons familiers restent plus doux que les
tons éloignés. Ils se tiennent à environ deux cents les uns des autres, note
par note — moins que ce qu'un clavecin bien accordé conserve de son propre
accord — et c'est pourquoi cette application te dira que tu es dans un
tempérament bien tempéré en refusant de dire lequel.

## D'où viennent ces chiffres

Chaque valeur ci-dessus est calculée à partir des fichiers Scala que cette
application embarque et selon lesquels elle accorde — pas recopiée d'un
livre — donc tu peux les vérifier : lance
`python -m flutetrainer.tools.temperament_separation` dans le dépôt. Le loup à
737,6 cents, les onze quintes à 696,6, les huit tierces pures à 386,3 et les
quatre à 427 sortent directement de `meantone_quarter.scl`.

## Sources

- Pietro Aron, *Toscanello in musica* (Venise, 1523) — première description
  pratique de ce qu'on appelle aujourd'hui le mésotonique au quart de comma
  ([Aron](https://en.wikipedia.org/wiki/Pietro_Aron))
- Andreas Werckmeister, *Musicalische Temperatur* (Quedlinbourg, 1691)
  ([Werckmeister](https://en.wikipedia.org/wiki/Andreas_Werckmeister))
- Johann Philipp Kirnberger, *Die Kunst des reinen Satzes in der Musik*
  (Berlin, 1771–79)
  ([Kirnberger](https://en.wikipedia.org/wiki/Johann_Philipp_Kirnberger))
- Francesco Antonio Vallotti, *Trattato della scienza teorica e pratica della
  moderna musica* (Padoue, 1779)
- Johann Joachim Quantz, *Versuch einer Anweisung die Flöte traversiere zu
  spielen* (Berlin, 1752) — sur la liberté de la flûte à distinguer les
  enharmonies ([Quantz](https://en.wikipedia.org/wiki/Johann_Joachim_Quantz))
- J. Murray Barbour, *Tuning and Temperament: A Historical Survey* (Michigan
  State College Press, 1951 ; réimpr. Dover, 2004) — la synthèse de référence
- Owen Jorgensen, *Tuning* (Michigan State University Press, 1991)
- Ross W. Duffin, *How Equal Temperament Ruined Harmony (and Why You Should
  Care)* (W. W. Norton, 2007) — l'argumentaire moderne accessible
- Mark Lindley, « Temperaments », *Grove Music Online* (Oxford University Press)
- Sur les intervalles eux-mêmes :
  [le mésotonique au quart de comma](https://en.wikipedia.org/wiki/Quarter-comma_meantone),
  [la quinte du loup](https://en.wikipedia.org/wiki/Wolf_interval),
  [le comma syntonique](https://en.wikipedia.org/wiki/Syntonic_comma) et
  [le comma pythagoricien](https://en.wikipedia.org/wiki/Pythagorean_comma)
- [Archive d'échelles Scala](https://www.huygens-fokker.org/scala/),
  fondation Huygens-Fokker — origine des fichiers de tempérament de cette app
