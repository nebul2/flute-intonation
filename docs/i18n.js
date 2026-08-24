/* Two languages. The testers this app is for are French flute teachers, so the
 * default follows the browser; the EN/FR toggle overrides it and the choice is
 * remembered. Every user-facing string lives here, and a headless test pins
 * key parity between the two languages so nothing falls back to English in
 * the French UI by accident.
 *
 * Note names are not here: Do Ré Mi is already the French convention and the
 * naming style is a setting, handled in ui/naming.js. */

export const STRINGS = {
  en: {
    "app.name": "Traverso",
    "app.tagline": "Intonation trainer for the baroque flute",
    "nav.back": "Back",
    "footer.source": "source",

    "home.soon": "coming",
    "home.card.tuner.title": "Tuner",
    "home.card.tuner.desc": "Play; it names the note in the chosen temperament.",
    "home.card.practice.title": "Practice",
    "home.card.practice.desc": "Guided exercises: calibration, intervals, enharmonics, stopper…",
    "home.card.tuning.title": "Mode & temperament",
    "home.card.tuning.desc": "Vallotti, meantone, pure intervals — with simple help.",
    "home.card.settings.title": "Settings",
    "home.card.settings.desc": "Reference pitch, note names, microphone, drone, language.",
    "home.card.check.title": "Hardware check",
    "home.card.check.desc": "Do your microphone and speakers work?",
    "home.card.listen.title": "Listen to me",
    "home.card.listen.desc": "Play freely; the app tells you what it can.",

    "status.headphones": "headphones",
    "status.speakers": "speakers?",
    "mode.temperament": "temperament",
    "mode.pure": "pure intervals",
    "temperament.vallotti": "Vallotti",
    "temperament.meantone_quarter": "Quarter-comma meantone",
    "temperament.werckmeister3": "Werckmeister III",
    "temperament.kirnberger3": "Kirnberger III",
    "temperament.equal": "Equal temperament",

    "audio.idle": "microphone: not started",
    "audio.starting": "microphone: asking…",
    "audio.listening": "microphone: listening",
    "audio.refused": "microphone refused — allow it in the browser and reload",
    "audio.error": (msg) => `audio error: ${msg}`,
    "audio.start": "Start the microphone",
    "audio.stop": "Stop",
    "audio.granted": (sr, agc, ns, ec) =>
      `${sr} Hz · AGC ${agc ? "ON (browser kept it)" : "off"} · noise-suppression ${ns ? "ON" : "off"} · echo-cancel ${ec ? "ON" : "off"}`,

    "check.title": "Hardware check",
    "check.intro": "Press Start, allow the microphone, play a note. Drone tests the speakers.",
    "check.pressStart": "press Start",
    "check.listening": "listening",
    "check.drone": "Drone",
    "check.droneStop": (hz) => `Stop drone (${hz} Hz)`,
    "check.note": "Note names here are equal temperament, for this check only — the real " +
      "engine is in the Tuner. The gold mark on the level bar is the −50 dBFS gate. With " +
      "the drone through speakers it re-enters the microphone: expected here.",

    "tuner.title": "Tuner",
    "tuner.intro": (temp, ref) => `Reads against ${temp} at A = ${ref} Hz — not equal temperament.`,
    "tuner.listening": "listening",
    "tuner.target": "target",
    "tuner.hold": "held note",
    "tuner.drone": "Drone",
    "tuner.droneOn": (name) => `Drone: ${name}`,
    "tuner.droneStop": "Stop drone",
    "tuner.changeTuning": "change mode or temperament",

    "tuning.title": "Mode & temperament",
    "tuning.modeQuestion": "Temperament, or pure intervals?",
    "tuning.mode.temperament.help": "Every note has one fixed frequency, as on a harpsichord " +
      "tuned to the chosen temperament. Simple, and right when you play with a keyboard.",
    "tuning.mode.pure.help": "Each note is tuned as a pure interval above the sounding bass, so " +
      "the same written note moves with its context. Right for playing with a drone or a " +
      "bass line, and the mode the exercises use. The bass itself is placed by the temperament.",
    "tuning.whichTemperament": "Which temperament?",
    "tuning.root": "rooted on",
    "tuning.example": "The same F♯ over a D bass, at the current settings:",
    "tuning.exampleLine": (tempered, pure, gap) =>
      `tempered ${tempered} Hz · pure ${pure} Hz · the pure third sits ${gap} cents away`,
    "tuning.enharmonic": "Temperament mode treats D♯ and E♭ as the same note; pure mode does not — " +
      "the flute of Quantz had a key for each.",

    "settings.title": "Settings",
    "settings.reference": "Reference pitch (A4)",
    "settings.custom": "custom",
    "settings.naming": "Note names",
    "settings.naming.solfege": "Do Ré Mi (fixed do)",
    "settings.naming.letters": "C D E",
    "settings.language": "Language",
    "settings.mic": "Microphone",
    "settings.micDefault": "system default",
    "settings.micNeedsStart": "start the microphone once to list devices by name",
    "settings.droneLevel": "Drone level",
    "settings.headphones": "I use headphones (hides the speaker-bleed warning)",
    "settings.history": "Practice history",
    "settings.export": "Export as file",
    "settings.clear": "Clear history",
    "settings.historySoon": "History arrives with the practice exercises.",

    "practice.title": "Practice",
    "practice.soon": "The guided exercises from the desktop version are being ported: " +
      "calibration over the drone, the same note tempered then pure, D♯ versus E♭, " +
      "predict-then-see, and the stopper (bouchon) check. No needle while you play; the " +
      "reading appears when the note ends.",
    "practice.intro": "Guided exercises. No needle while you play — only progress; the reading appears when the note ends.",
    "practice.needMic": "Start the microphone to enable the exercises.",
    "practice.tonic": "tonic",
    "practice.ex.calibration.title": "Calibration",
    "practice.ex.calibration.desc": "Long tones — tonic, fifth, octave over the drone; reading after each note.",
    "practice.ex.intervals.title": "Interval in context",
    "practice.ex.intervals.desc": "The same note twice: tempered, then pure over the drone. The centrepiece.",
    "practice.ex.enharmonic.title": "D♯ or E♭",
    "practice.ex.enharmonic.desc": "D♯ over B, then E♭ over C — one fingering, two targets, 39 cents apart.",
    "practice.ex.predict.title": "Predict, then see",
    "practice.ex.predict.desc": "Calibration notes, but you call sharp / flat / in tune before the number appears.",
    "practice.ex.stopper.title": "Stopper (bouchon)",
    "practice.ex.stopper.desc": "Three D's and two G's, set embouchure. Only the width of the octaves matters.",
    "practice.stop": "Stop the exercise",
    "practice.backToList": "Back to the exercises",
    "practice.calibrating": "Measuring the background with the drone sounding — stay quiet, don't play yet.",
    "practice.stayQuiet": (s) => `stay quiet… ${s} s`,
    "practice.calibrated": (bg, onset) => `background ${bg} dBFS; a note at the drone's pitch must exceed ${onset} dBFS to start`,
    "practice.calibratedWarn": "that is louder than typical playing: turn the drone down or use headphones",
    "practice.playNow": "Play the note shown and hold it.",
    "practice.tag.temp": "tempered",
    "practice.tag.pure": "pure",
    "practice.notPlayed": "not played",
    "practice.captured": (n) => `captured (${n} frames)`,
    "practice.yourCall": "Your call — before the number.",
    "practice.call.sharp": "sharp",
    "practice.call.flat": "flat",
    "practice.call.in tune": "in tune",
    "practice.youSaid": (call) => `you said ${call}`,
    "practice.agreed": "your ear agreed with the measurement",
    "practice.measured": (actual) => `the measurement says ${actual}`,
    "practice.done": "Done.",
    "practice.stopped": "Stopped early.",
    "practice.summary": "Summary",
    "practice.meanAbs": (c) => `mean absolute deviation: ${c} cents`,
    "practice.byNote": "by note:",
    "practice.judgement": (agreed, total) => `judgement: your ear agreed with the measurement on ${agreed} of ${total} notes`,
    "practice.pair": (note, tempered, pure, gap) => `${note}: tempered ${tempered} Hz, pure ${pure} Hz — the pure interval sits ${gap} cents away`,
    "practice.bleed": "Through speakers the drone re-enters the microphone. Headphones are strongly recommended.",
    "practice.saved": "saved to this device's history",
    "practice.stopper.protocol": "Set your embouchure and keep it — adapt for the octave, but make no pitch correction. Absolute tuning is ignored; only the width of the octaves matters. Move the stopper between runs and chase the smallest octave error.",
    "practice.stopper.title": "Octave widths (0 = a true octave):",
    "practice.stopper.wide": "wide",
    "practice.stopper.narrow": "narrow",
    "practice.stopper.error": (c) => `mean octave error: ${c} cents — the number to minimise`,
    "practice.stopper.offset": (c) => `(the whole flute sat ${c} cents of nominal — irrelevant here)`,
    "practice.stopper.previous": (when, last, verdict) => `previous run (${when}): ${last} cents → ${verdict}`,
    "practice.stopper.closer": "closer — keep going in the same direction",
    "practice.stopper.wider": "wider — the last move went the wrong way",
    "practice.stopper.noPairs": "not enough octaves captured to pair up",
    "band.inTune": "in tune",
    "band.close": "close",
    "band.sharp": "sharp",
    "band.flat": "flat",
    "settings.exported": (n) => `exported ${n} session(s)`,
    "settings.cleared": "history cleared",
    "settings.historyCount": (n) => `${n} session(s) on this device`,
    "settings.clearConfirm": "Delete all practice history on this device?",

    "listen.title": "Listen to me",
    "listen.soon": "Play freely — a phrase, a scale, whatever you like. The app will name the " +
      "notes it heard, mark the unstable ones, and summarise by pitch class: “your F♯ ran " +
      "12 cents sharp”. Coming after the practice exercises.",
  },

  fr: {
    "app.name": "Traverso",
    "app.tagline": "Entraîneur de justesse pour le traverso",
    "nav.back": "Retour",
    "footer.source": "code source",

    "home.soon": "à venir",
    "home.card.tuner.title": "Accordeur",
    "home.card.tuner.desc": "Joue ; il nomme la note dans le tempérament choisi.",
    "home.card.practice.title": "Exercices",
    "home.card.practice.desc": "Séances guidées : calibration, intervalles, enharmoniques, bouchon…",
    "home.card.tuning.title": "Mode & tempérament",
    "home.card.tuning.desc": "Vallotti, mésotonique, intervalles purs — avec une aide simple.",
    "home.card.settings.title": "Réglages",
    "home.card.settings.desc": "Diapason, noms de notes, micro, bourdon, langue.",
    "home.card.check.title": "Test matériel",
    "home.card.check.desc": "Micro et haut-parleurs fonctionnent-ils ?",
    "home.card.listen.title": "Écoute-moi",
    "home.card.listen.desc": "Joue librement ; le système dit ce qu'il peut.",

    "status.headphones": "casque",
    "status.speakers": "haut-parleurs ?",
    "mode.temperament": "tempérament",
    "mode.pure": "intervalles purs",
    "temperament.vallotti": "Vallotti",
    "temperament.meantone_quarter": "Mésotonique au quart de comma",
    "temperament.werckmeister3": "Werckmeister III",
    "temperament.kirnberger3": "Kirnberger III",
    "temperament.equal": "Tempérament égal",

    "audio.idle": "micro : non démarré",
    "audio.starting": "micro : demande d'accès…",
    "audio.listening": "micro : à l'écoute",
    "audio.refused": "micro refusé — autorisez-le dans le navigateur et rechargez",
    "audio.error": (msg) => `erreur audio : ${msg}`,
    "audio.start": "Démarrer le micro",
    "audio.stop": "Arrêter",
    "audio.granted": (sr, agc, ns, ec) =>
      `${sr} Hz · AGC ${agc ? "ACTIF (imposé par le navigateur)" : "coupé"} · réduction de bruit ${ns ? "ACTIVE" : "coupée"} · anti-écho ${ec ? "ACTIF" : "coupé"}`,

    "check.title": "Test matériel",
    "check.intro": "Appuyez sur Démarrer, autorisez le micro, jouez une note. Le bourdon teste les haut-parleurs.",
    "check.pressStart": "appuyez sur Démarrer",
    "check.listening": "à l'écoute",
    "check.drone": "Bourdon",
    "check.droneStop": (hz) => `Couper le bourdon (${hz} Hz)`,
    "check.note": "Ici les noms de notes sont en tempérament égal, pour ce test uniquement — le " +
      "vrai moteur est dans l'Accordeur. Le repère doré sur la barre de niveau est le seuil de " +
      "−50 dBFS. Avec le bourdon sur haut-parleurs, le son revient dans le micro : c'est attendu ici.",

    "tuner.title": "Accordeur",
    "tuner.intro": (temp, ref) => `Lit par rapport à ${temp} au diapason la = ${ref} Hz — pas le tempérament égal.`,
    "tuner.listening": "à l'écoute",
    "tuner.target": "cible",
    "tuner.hold": "note tenue",
    "tuner.drone": "Bourdon",
    "tuner.droneOn": (name) => `Bourdon : ${name}`,
    "tuner.droneStop": "Couper le bourdon",
    "tuner.changeTuning": "changer de mode ou de tempérament",

    "tuning.title": "Mode & tempérament",
    "tuning.modeQuestion": "Tempérament, ou intervalles purs ?",
    "tuning.mode.temperament.help": "Chaque note a une fréquence fixe, comme sur un clavecin " +
      "accordé dans le tempérament choisi. Simple, et juste quand on joue avec un clavier.",
    "tuning.mode.pure.help": "Chaque note est accordée comme un intervalle pur au-dessus de la " +
      "basse qui sonne : la même note écrite bouge avec son contexte. Juste pour jouer avec un " +
      "bourdon ou une basse, et c'est le mode des exercices. La basse elle-même est placée par " +
      "le tempérament.",
    "tuning.whichTemperament": "Quel tempérament ?",
    "tuning.root": "sur",
    "tuning.example": "Le même fa♯ sur une basse de ré, avec les réglages actuels :",
    "tuning.exampleLine": (tempered, pure, gap) =>
      `tempéré ${tempered} Hz · pur ${pure} Hz · la tierce pure est à ${gap} cents`,
    "tuning.enharmonic": "En mode tempérament, ré♯ et mi♭ sont la même note ; en mode pur, non — " +
      "la flûte de Quantz avait une clé pour chacun.",

    "settings.title": "Réglages",
    "settings.reference": "Diapason (la4)",
    "settings.custom": "autre",
    "settings.naming": "Noms de notes",
    "settings.naming.solfege": "Do Ré Mi (do fixe)",
    "settings.naming.letters": "C D E",
    "settings.language": "Langue",
    "settings.mic": "Micro",
    "settings.micDefault": "micro par défaut",
    "settings.micNeedsStart": "démarrez le micro une fois pour lister les appareils par nom",
    "settings.droneLevel": "Niveau du bourdon",
    "settings.headphones": "J'utilise un casque (masque l'avertissement sur les haut-parleurs)",
    "settings.history": "Historique des exercices",
    "settings.export": "Exporter en fichier",
    "settings.clear": "Effacer l'historique",
    "settings.historySoon": "L'historique arrive avec les exercices.",

    "practice.title": "Exercices",
    "practice.soon": "Les exercices guidés de la version de bureau sont en cours de portage : " +
      "calibration sur le bourdon, la même note tempérée puis pure, ré♯ contre mi♭, " +
      "« devine puis vois », et le réglage du bouchon. Pas d'aiguille pendant que tu joues ; " +
      "la mesure s'affiche quand la note se termine.",
    "practice.intro": "Exercices guidés. Pas d'aiguille pendant que tu joues — seulement la progression ; la mesure s'affiche quand la note se termine.",
    "practice.needMic": "Démarre le micro pour activer les exercices.",
    "practice.tonic": "tonique",
    "practice.ex.calibration.title": "Calibration",
    "practice.ex.calibration.desc": "Sons filés — tonique, quinte, octave sur le bourdon ; mesure après chaque note.",
    "practice.ex.intervals.title": "Intervalle en contexte",
    "practice.ex.intervals.desc": "La même note deux fois : tempérée, puis pure sur le bourdon. L'exercice central.",
    "practice.ex.enharmonic.title": "Ré♯ ou mi♭",
    "practice.ex.enharmonic.desc": "Ré♯ sur si, puis mi♭ sur do — un doigté, deux cibles, 39 cents d'écart.",
    "practice.ex.predict.title": "Devine, puis vois",
    "practice.ex.predict.desc": "Les notes de calibration, mais tu annonces haut / bas / juste avant de voir le chiffre.",
    "practice.ex.stopper.title": "Bouchon",
    "practice.ex.stopper.desc": "Trois ré et deux sol, embouchure fixe. Seule la largeur des octaves compte.",
    "practice.stop": "Arrêter l'exercice",
    "practice.backToList": "Retour aux exercices",
    "practice.calibrating": "Mesure du bruit de fond avec le bourdon — reste silencieux, ne joue pas encore.",
    "practice.stayQuiet": (s) => `silence… ${s} s`,
    "practice.calibrated": (bg, onset) => `fond ${bg} dBFS ; une note à la hauteur du bourdon doit dépasser ${onset} dBFS pour démarrer`,
    "practice.calibratedWarn": "c'est plus fort qu'un jeu normal : baisse le bourdon ou mets un casque",
    "practice.playNow": "Joue la note affichée et tiens-la.",
    "practice.tag.temp": "tempéré",
    "practice.tag.pure": "pur",
    "practice.notPlayed": "non jouée",
    "practice.captured": (n) => `capturée (${n} trames)`,
    "practice.yourCall": "À toi de dire — avant le chiffre.",
    "practice.call.sharp": "haut",
    "practice.call.flat": "bas",
    "practice.call.in tune": "juste",
    "practice.youSaid": (call) => `tu as dit ${call}`,
    "practice.agreed": "ton oreille est d'accord avec la mesure",
    "practice.measured": (actual) => `la mesure dit ${actual}`,
    "practice.done": "Terminé.",
    "practice.stopped": "Arrêté avant la fin.",
    "practice.summary": "Bilan",
    "practice.meanAbs": (c) => `écart absolu moyen : ${c} cents`,
    "practice.byNote": "par note :",
    "practice.judgement": (agreed, total) => `jugement : ton oreille était d'accord avec la mesure sur ${agreed} notes sur ${total}`,
    "practice.pair": (note, tempered, pure, gap) => `${note} : tempéré ${tempered} Hz, pur ${pure} Hz — l'intervalle pur est à ${gap} cents`,
    "practice.bleed": "Sur haut-parleurs, le bourdon revient dans le micro. Le casque est vivement recommandé.",
    "practice.saved": "enregistré dans l'historique de cet appareil",
    "practice.stopper.protocol": "Fixe ton embouchure et garde-la — adapte pour l'octave, mais sans corriger la hauteur. La justesse absolue est ignorée ; seule la largeur des octaves compte. Déplace le bouchon entre deux essais et cherche la plus petite erreur d'octave.",
    "practice.stopper.title": "Largeur des octaves (0 = octave juste) :",
    "practice.stopper.wide": "large",
    "practice.stopper.narrow": "étroite",
    "practice.stopper.error": (c) => `erreur d'octave moyenne : ${c} cents — le chiffre à minimiser`,
    "practice.stopper.offset": (c) => `(la flûte entière est à ${c} cents du nominal — sans importance ici)`,
    "practice.stopper.previous": (when, last, verdict) => `essai précédent (${when}) : ${last} cents → ${verdict}`,
    "practice.stopper.closer": "plus serré — continue dans le même sens",
    "practice.stopper.wider": "plus large — le dernier déplacement allait dans le mauvais sens",
    "practice.stopper.noPairs": "pas assez d'octaves capturées pour les apparier",
    "band.inTune": "juste",
    "band.close": "proche",
    "band.sharp": "haut",
    "band.flat": "bas",
    "settings.exported": (n) => `${n} séance(s) exportée(s)`,
    "settings.cleared": "historique effacé",
    "settings.historyCount": (n) => `${n} séance(s) sur cet appareil`,
    "settings.clearConfirm": "Effacer tout l'historique des exercices sur cet appareil ?",

    "listen.title": "Écoute-moi",
    "listen.soon": "Joue librement — une phrase, une gamme, ce que tu veux. Le système nommera " +
      "les notes entendues, signalera celles qui bougent, et résumera par note : « ton fa♯ " +
      "est 12 cents trop haut ». Arrive après les exercices.",
  },
};

let current = "en";
const listeners = new Set();

export function lang() { return current; }

export function t(key, ...args) {
  const entry = STRINGS[current][key] ?? STRINGS.en[key];
  if (entry === undefined) return key;
  return typeof entry === "function" ? entry(...args) : entry;
}

export function setLanguage(next) {
  current = next in STRINGS ? next : "en";
  if (typeof document !== "undefined") document.documentElement.lang = current;
  listeners.forEach((cb) => cb(current));
}

export function onLanguageChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

/* Browser default: French browsers get French. */
export function detectLanguage() {
  const nav = (typeof navigator !== "undefined" && navigator.language) || "";
  return nav.toLowerCase().startsWith("fr") ? "fr" : "en";
}
