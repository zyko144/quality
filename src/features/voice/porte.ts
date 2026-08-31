/**
 * Porte de bruit.
 *
 * La reduction de bruit du moteur web attenue les bruits stationnaires pendant
 * qu'on parle. Elle ne fait rien contre ce qui reste entre les phrases — et
 * c'est precisement ce que les autres entendent : le ventilateur, la rue, le
 * clavier, la television de la piece a cote, presents en continu dans un salon
 * ou personne ne parle.
 *
 * Une porte ferme le micro sous un certain niveau. Ce n'est pas un traitement
 * savant : c'est un interrupteur rapide, et c'est ce qui manquait. Le silence
 * devient vraiment silencieux, ce qui compte plus que d'assainir la voix
 * elle-meme.
 *
 * Deux precautions rendent la chose supportable :
 *
 *  - L'ouverture est immediate et la fermeture lente. L'inverse couperait le
 *    debut des mots — le defaut classique des portes mal reglees, ou l'on
 *    entend « ...onjour » au lieu de « bonjour ».
 *  - Une retenue apres la derniere syllabe evite que la porte batte pendant
 *    les pauses courtes d'une phrase.
 *
 * La mesure se fait sur le signal d'entree, jamais sur la sortie : lire apres
 * la porte donnerait un silence qui se referme sur lui-meme et ne rouvrirait
 * jamais.
 */

export interface Porte {
  /** Flux a emettre, en lieu et place du micro brut. */
  flux: MediaStream;
  /** Coupe la porte et rend les ressources. Le micro brut n'est pas ferme. */
  arreter: () => void;
}

/** Duree pendant laquelle la porte reste ouverte apres le dernier son utile. */
const RETENUE_MS = 320;

export function ouvrirPorte(source: MediaStream, seuilDb: number): Porte | null {
  const Contexte = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Contexte) return null;

  let ctx: AudioContext;
  try {
    ctx = new Contexte();
  } catch {
    return null;
  }

  const entree = ctx.createMediaStreamSource(source);
  const analyseur = ctx.createAnalyser();
  analyseur.fftSize = 512;
  analyseur.smoothingTimeConstant = 0.2;

  const porte = ctx.createGain();
  porte.gain.value = 0;

  const sortie = ctx.createMediaStreamDestination();

  entree.connect(analyseur);
  entree.connect(porte).connect(sortie);

  const echantillons = new Float32Array(analyseur.fftSize);
  let ouverteJusqua = 0;
  let vivante = true;

  const mesurer = () => {
    if (!vivante) return;

    analyseur.getFloatTimeDomainData(echantillons);

    let somme = 0;
    for (const valeur of echantillons) somme += valeur * valeur;
    const niveauDb = 20 * Math.log10(Math.sqrt(somme / echantillons.length) + 1e-8);

    const maintenant = performance.now();
    const now = ctx.currentTime;

    if (niveauDb > seuilDb) {
      ouverteJusqua = maintenant + RETENUE_MS;
      // Huit millisecondes : assez court pour ne pas manger l'attaque d'une
      // consonne, assez long pour ne pas claquer.
      porte.gain.cancelScheduledValues(now);
      porte.gain.setTargetAtTime(1, now, 0.008);
    } else if (maintenant > ouverteJusqua) {
      // La fermeture prend son temps : une coupure nette s'entend plus qu'un
      // fond continu.
      porte.gain.cancelScheduledValues(now);
      porte.gain.setTargetAtTime(0, now, 0.06);
    }
  };

  const minuterie = window.setInterval(mesurer, 25);

  return {
    flux: sortie.stream,
    arreter: () => {
      vivante = false;
      window.clearInterval(minuterie);
      try {
        entree.disconnect();
        porte.disconnect();
      } catch {
        // Deja detache : rien a defaire.
      }
      void ctx.close().catch(() => undefined);
    },
  };
}
