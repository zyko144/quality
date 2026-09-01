/**
 * Le son de l'ordinateur, capture par la partie native.
 *
 * Deux impasses ont precede celle-ci, et il vaut la peine de les nommer pour
 * qu'on n'y revienne pas.
 *
 * **Rendre la fenetre de selection de Windows.** `getDisplayMedia` n'accorde le
 * son que si la case « partager aussi l'audio » a ete cochee, et cette case vit
 * dans la fenetre qu'on supprime justement pour afficher la notre. Un reglage
 * avait ete propose pour choisir entre les deux : c'etait reprendre ce qu'on
 * avait entrepris de retirer, titre « http://tauri.localhost » compris.
 *
 * **Les contraintes heritees de Chromium.** `mandatory.chromeMediaSource` rend
 * la sortie du systeme sans rien afficher — mais seulement avec un identifiant
 * de source obtenu par `desktopCapturer`, propre a Electron. Sans lui, WebView2
 * tient l'appel pour un message malforme et tue le processus de rendu :
 * `RESULT_CODE_KILLED_BAD_MESSAGE`, application a relancer, a chaque partage.
 *
 * Ce chemin-ci ne demande rien au moteur web. `son.rs` parle directement a
 * WASAPI et envoie les echantillons par un canal Tauri ; un `AudioWorklet` les
 * rejoue et en refait une piste, qui rejoint le partage comme si elle en venait.
 */

import sonWorkletUrl from './son-worklet.js?url';
import { journal } from '@/lib/journal';

const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface SonSysteme {
  /** Flux d'une piste, a joindre au partage. */
  flux: MediaStream;
  /** Arrete la capture et rend les ressources. */
  arreter: () => void;
}

/**
 * Ce que rend la capture : le son, ou la raison de son absence.
 *
 * La premiere version rendait `null` dans tous les cas d'echec. L'interface
 * affichait alors une phrase generale — « deux chemins ont ete essayes » —
 * quelle que soit la cause reelle, alors que la partie native produit des
 * raisons precises et differentes : peripherique introuvable, bouclage refuse,
 * format inconnu. On jetait exactement ce qu'il fallait lire.
 */
export type ResultatSon = { ok: true; son: SonSysteme } | { ok: false; raison: string };

interface FormatSon {
  frequence: number;
  canaux: number;
  /** Nom du peripherique dont on capture la sortie. */
  peripherique?: string;
}

/** Duree d'ecoute avant de dire si le bouclage porte quelque chose. */
const ECOUTE_MS = 4000;

/**
 * Nombre de paquets sur lesquels on releve le niveau a l'entree du canal.
 *
 * Deux cents paquets couvrent les quatre secondes d'ecoute a la cadence
 * d'envoi. Au-dela, la mesure ne dirait rien de plus et se paierait a chaque
 * paquet pendant tout le partage.
 */
const PAQUETS_MESURES = 200;

/**
 * Ecoute la capture quelques secondes et journalise son niveau.
 *
 * Le maximum plutot que la moyenne : un jeu a des passages calmes, et une
 * moyenne sur quatre secondes de menu silencieux dirait « rien » alors que
 * tout fonctionne. Ce qu'on cherche a distinguer, c'est « jamais rien » de
 * « quelque chose, parfois ».
 */
function mesurerNiveau(
  ctx: AudioContext,
  flux: MediaStream,
  nomPeripherique: string | null,
  prevenir?: (peripherique: string | null) => void,
) {
  try {
    const source = ctx.createMediaStreamSource(flux);
    const analyseur = ctx.createAnalyser();
    analyseur.fftSize = 2048;
    source.connect(analyseur);

    const echantillons = new Float32Array(analyseur.fftSize);
    let sommet = 0;

    const battement = window.setInterval(() => {
      analyseur.getFloatTimeDomainData(echantillons);
      for (const valeur of echantillons) sommet = Math.max(sommet, Math.abs(valeur));
    }, 200);

    window.setTimeout(() => {
      window.clearInterval(battement);
      source.disconnect();

      // En decibels par rapport a la pleine echelle : -60 dB est deja tres bas,
      // le silence numerique exact donnerait -Infinity.
      const dbfs = sommet > 0 ? Math.round(20 * Math.log10(sommet)) : -120;

      const muet = dbfs <= -60;

      journal.info('partage', 'Niveau du son capture', {
        dbfs,
        muet,
        peripherique: nomPeripherique,
      });

      // L'interface le dit a qui partage : voir `VoiceStage`. Le journal seul
      // ne sert qu'a moi, et le probleme se corrige de son cote a lui.
      if (muet) prevenir?.(nomPeripherique);
    }, ECOUTE_MS);
  } catch {
    // La mesure est un confort de diagnostic : son echec ne doit rien couper.
  }
}

/**
 * Ouvre la capture.
 *
 * Rend toujours quelque chose : le son, ou la raison de son absence. Les causes
 * sont nombreuses — hors application de bureau, systeme sans bouclage, refus de
 * Windows, format inconnu — et elles n'appellent pas la meme reponse de celui
 * qui partage. Lui dire laquelle est le seul moyen qu'il puisse y faire quoi
 * que ce soit.
 */
export async function capturerSonSysteme(
  peripherique?: string | null,
  surSilence?: (peripherique: string | null) => void,
): Promise<ResultatSon> {
  if (!DANS_TAURI) {
    return {
      ok: false,
      raison:
        'La capture du son du systeme n’existe que dans l’application de bureau.',
    };
  }

  let invoke: typeof import('@tauri-apps/api/core').invoke;
  let Channel: typeof import('@tauri-apps/api/core').Channel;

  try {
    const noyau = await import('@tauri-apps/api/core');
    invoke = noyau.invoke;
    Channel = noyau.Channel;
  } catch {
    return { ok: false, raison: 'Le pont vers l’application n’a pas repondu.' };
  }

  const Contexte =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Contexte) {
    return { ok: false, raison: 'Ce moteur n’expose pas de contexte audio.' };
  }

  const canal = new Channel<ArrayBuffer>();

  /*
   * Le format est demande AVANT d'ouvrir le contexte audio.
   *
   * Le peripherique impose sa frequence — 48 kHz le plus souvent, 44,1 parfois.
   * Ouvrir le contexte a une autre valeur ferait rejouer les echantillons trop
   * vite ou trop lentement : un son transpose, qu'on entend immediatement et
   * qu'on ne relie a rien.
   */
  let format: FormatSon;
  try {
    format = await invoke<FormatSon>('demarrer_son_systeme', {
      canal,
      peripherique: peripherique ?? null,
    });

    journal.info('partage', 'Bouclage ouvert', {
      peripherique: format.peripherique ?? null,
      frequence: format.frequence,
      canaux: format.canaux,
    });
  } catch (cause) {
    /*
     * La raison vient de la partie native, en francais et deja formulee.
     *
     * La reecrire ici la remplacerait par une phrase generique au moment
     * precis ou l'on tient enfin l'explication. Le repli ne sert qu'au cas ou
     * la commande n'existe pas — c'est-a-dire une version installee plus
     * ancienne que ce code, ce qui se produit pendant une mise a jour.
     */
    return {
      ok: false,
      raison:
        typeof cause === 'string'
          ? cause
          : 'La capture n’a pas demarre. Cette version de l’application ne la connait peut-etre pas encore : reinstallez-la.',
    };
  }

  const arreterNatif = () => {
    void invoke('arreter_son_systeme').catch(() => undefined);
  };

  let ctx: AudioContext;
  try {
    ctx = new Contexte({ sampleRate: format.frequence });
  } catch {
    arreterNatif();
    return {
      ok: false,
      raison: `Le moteur refuse d’ouvrir un contexte audio a ${format.frequence} Hz.`,
    };
  }

  const abandonner = (raison: string): ResultatSon => {
    arreterNatif();
    void ctx.close().catch(() => undefined);
    return { ok: false, raison };
  };

  if (!ctx.audioWorklet) return abandonner('Ce moteur n’a pas de fil audio dedie.');

  try {
    await ctx.audioWorklet.addModule(sonWorkletUrl);
  } catch {
    return abandonner('Le module de lecture du son n’a pas pu etre charge.');
  }

  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
  if (ctx.state !== 'running') {
    return abandonner('Le contexte audio est reste suspendu par le moteur.');
  }

  let lecture: AudioWorkletNode;
  let sortie: MediaStreamAudioDestinationNode;

  try {
    lecture = new AudioWorkletNode(ctx, 'son-systeme', {
      numberOfInputs: 0,
      outputChannelCount: [Math.min(2, Math.max(1, format.canaux))],
      processorOptions: { canaux: format.canaux },
    });

    sortie = ctx.createMediaStreamDestination();
    lecture.connect(sortie);
  } catch {
    return abandonner('Le graphe audio n’a pas pu etre monte.');
  }

  /*
   * Les paquets vont directement au worklet.
   *
   * Ils ne passent pas par l'etat de React : ils arrivent des centaines de fois
   * par seconde, et chacun declencherait un rendu pour un tableau d'octets que
   * personne n'affiche.
   */
  /*
   * Ce qui traverse le canal est compte avant d'etre transmis.
   *
   * Trois maillons peuvent rompre entre WASAPI et les oreilles d'en face :
   * Windows peut ne rien donner, le canal peut ne rien livrer, le fil audio
   * peut ne rien jouer. Le premier se mesure cote natif, le troisieme se
   * mesure sur le flux resultant — et sans ce compteur-ci, on ne pouvait pas
   * distinguer les deux premiers.
   *
   * Le sommet est releve un echantillon sur seize : on cherche a savoir s'il y
   * a du son, pas a le mesurer, et lire quarante-quatre mille flottants par
   * seconde pour une reponse binaire serait payer cher.
   */
  let paquetsRecus = 0;
  let octetsRecus = 0;
  let sommetRecu = 0;

  canal.onmessage = (paquet) => {
    paquetsRecus += 1;
    octetsRecus += paquet.byteLength;

    // La mesure s'arrete avec la fenetre d'ecoute : au-dela, elle ne dirait
    // rien de plus et couterait a chaque paquet, pendant tout le partage.
    if (paquetsRecus <= PAQUETS_MESURES) {
      const vue = new Float32Array(paquet);
      for (let i = 0; i < vue.length; i += 16) {
        const amplitude = Math.abs(vue[i]!);
        if (amplitude > sommetRecu && Number.isFinite(amplitude)) sommetRecu = amplitude;
      }
    }

    // Le transfert detache le tampon : toute lecture doit preceder cette ligne.
    lecture.port.postMessage(paquet, [paquet]);
  };

  /*
   * Le releve part une fois, quand la fenetre d'ecoute se referme.
   *
   * Il rassemble les trois maillons dans une seule ligne, ce qui est le point :
   * lus separement, ils demandent de recouper trois horodatages ; lus ensemble,
   * ils designent le maillon rompu sans qu'on ait a reflechir.
   */
  window.setTimeout(() => {
    void (async () => {
      let natif: Record<string, number> | null = null;

      try {
        natif = await invoke<Record<string, number>>('diagnostic_son');
      } catch {
        // Version plus ancienne du binaire : on journalise ce qu'on a.
      }

      journal.info('partage', 'Trajet du son', {
        // Ce que Windows a donne.
        natifPaquets: natif?.paquets ?? -1,
        natifTrames: natif?.trames ?? -1,
        natifSommet: natif?.sommet ?? -1,
        natifSilencieux: natif?.silencieux ?? -1,
        // Ce que le canal a livre.
        canalPaquets: paquetsRecus,
        canalOctets: octetsRecus,
        canalSommet: Math.round(sommetRecu * 1000),
      });
    })();
  }, ECOUTE_MS);

  /*
   * On mesure ce que le bouclage porte vraiment.
   *
   * « La capture s'est ouverte » ne veut pas dire « il y a du son dedans ».
   * WASAPI ouvre volontiers un bouclage sur le peripherique de sortie par
   * defaut ; si le jeu, lui, joue sur un AUTRE peripherique — un casque choisi
   * dans ses options quand le defaut reste les haut-parleurs — la capture
   * fonctionne parfaitement et ne porte que du silence.
   *
   * Rien ne distingue ce cas d'un partage muet vu de l'exterieur, et il ne se
   * corrige pas dans le code : il se corrige en changeant le peripherique par
   * defaut de Windows. Encore faut-il savoir que c'est ca. D'ou cette mesure.
   */
  mesurerNiveau(ctx, sortie.stream, format.peripherique ?? null, surSilence);

  return {
    ok: true,
    son: {
      flux: sortie.stream,
      arreter: () => {
        arreterNatif();
        try {
          lecture.port.postMessage('stop');
          lecture.disconnect();
        } catch {
          // Deja detache : rien a defaire.
        }
        void ctx.close().catch(() => undefined);
      },
    },
  };
}
