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
  /** Port local ou le son coule. */
  port: number;
  /** Jeton exige a la connexion, tire a chaque partage. */
  jeton: string;
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
 * Ouvre la connexion locale et rend de quoi la lire.
 *
 * Rend `null` si elle ne repond pas. Le cas n'est pas theorique : la connexion
 * s'ouvre en meme temps que la capture, et l'interface peut arriver la premiere.
 * On reessaie donc brievement plutot que d'abandonner sur une course perdue de
 * quelques millisecondes.
 */
async function ouvrirFlux(
  format: FormatSon,
  arreterNatif: () => void,
): Promise<ReadableStreamDefaultReader<Uint8Array> | null> {
  const adresse = `http://127.0.0.1:${format.port}/${format.jeton}`;

  for (const attente of [0, 60, 200, 500]) {
    if (attente > 0) await new Promise((resoudre) => setTimeout(resoudre, attente));

    try {
      const reponse = await fetch(adresse, { cache: 'no-store' });
      if (reponse.ok && reponse.body) return reponse.body.getReader();
    } catch {
      // Pas encore en ecoute : on retente.
    }
  }

  arreterNatif();
  return null;
}

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

  try {
    invoke = (await import('@tauri-apps/api/core')).invoke;
  } catch {
    return { ok: false, raison: 'Le pont vers l’application n’a pas repondu.' };
  }

  const Contexte =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Contexte) {
    return { ok: false, raison: 'Ce moteur n’expose pas de contexte audio.' };
  }

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
   * Le son arrive par une connexion HTTP locale, pas par le canal Tauri.
   *
   * Le canal a ete essaye, et mesure : sur quatre cents paquets produits par
   * Windows, UN SEUL atteignait cette fonction. Au-dela d'un kilo-octet, il ne
   * transmet pas la donnee directement — il fait executer a la page un script
   * qui va la rechercher par une commande interne — et cinquante allers-retours
   * par seconde de ce genre ne passent pas. Rien n'echouait pour autant : la
   * capture s'ouvrait, les paquets partaient, et le silence arrivait au bout.
   *
   * Une seule connexion est ouverte ici pour toute la duree du partage, et les
   * echantillons y coulent sans etre annonces ni reassembles.
   */
  const lecteur = await ouvrirFlux(format, arreterNatif);

  if (!lecteur) {
    return abandonner('Le passage du son n’a pas pu s’ouvrir.');
  }

  let paquetsRecus = 0;
  let octetsRecus = 0;
  let sommetRecu = 0;

  /*
   * Le reste d'une trame incomplete est reporte sur la lecture suivante.
   *
   * Une connexion ne rend pas les octets par paquets : elle les rend par
   * morceaux quelconques, qui coupent volontiers un echantillon en deux. Les
   * transmettre tels quels decalerait les canaux d'un demi-flottant et
   * transformerait la musique en bruit — un defaut qui s'entend tout de suite
   * mais ne se rattache a rien.
   */
  const octetsParTrame = format.canaux * 4;
  let reste = new Uint8Array(0);

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await lecteur.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        const complet =
          reste.byteLength === 0
            ? value
            : (() => {
                const joint = new Uint8Array(reste.byteLength + value.byteLength);
                joint.set(reste, 0);
                joint.set(value, reste.byteLength);
                return joint;
              })();

        const utilisable = complet.byteLength - (complet.byteLength % octetsParTrame);

        if (utilisable > 0) {
          // La copie est necessaire : le tampon rendu par la lecture est
          // reutilise, et le transferer au fil audio le detacherait sous les
          // pieds de la lecture suivante.
          const bloc = complet.slice(0, utilisable);

          paquetsRecus += 1;
          octetsRecus += utilisable;

          if (paquetsRecus <= PAQUETS_MESURES) {
            const vue = new Float32Array(bloc.buffer, bloc.byteOffset, utilisable / 4);
            for (let k = 0; k < vue.length; k += 16) {
              const amplitude = Math.abs(vue[k]!);
              if (amplitude > sommetRecu && Number.isFinite(amplitude)) sommetRecu = amplitude;
            }
          }

          lecture.port.postMessage(bloc.buffer, [bloc.buffer]);
        }

        reste = complet.slice(utilisable);
      }
    } catch {
      // Connexion fermee : c'est ainsi que se termine un partage.
    }
  })();

  window.setTimeout(() => {
    void (async () => {
      let natif: Record<string, number> | null = null;

      try {
        natif = await invoke<Record<string, number>>('diagnostic_son');
      } catch {
        // Version plus ancienne du binaire : on journalise ce qu'on a.
      }

      journal.info('partage', 'Trajet du son', {
        natifPaquets: natif?.paquets ?? -1,
        natifTrames: natif?.trames ?? -1,
        natifSommet: natif?.sommet ?? -1,
        natifSilencieux: natif?.silencieux ?? -1,
        // Vrai quand la capture laisse nos propres voix de cote : les deux
        // routes se ressemblent du dehors, et seule celle-ci evite l'echo.
        sansNosVoix: (natif as unknown as { exclusion?: boolean } | null)?.exclusion ?? null,
        fluxBlocs: paquetsRecus,
        fluxOctets: octetsRecus,
        fluxSommet: Math.round(sommetRecu * 1000),
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

        /*
         * La connexion est fermee de notre cote aussi.
         *
         * Couper la capture suffirait a la longue — le serveur voit sa
         * generation changer et referme — mais laisser une lecture en attente
         * garde le contexte audio et le fil de lecture en vie jusque-la. Deux
         * partages a la suite en laisseraient deux.
         */
        void lecteur.cancel().catch(() => undefined);

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
