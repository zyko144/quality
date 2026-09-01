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
export async function capturerSonSysteme(): Promise<ResultatSon> {
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
    format = await invoke<FormatSon>('demarrer_son_systeme', { canal });
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
  canal.onmessage = (paquet) => {
    lecture.port.postMessage(paquet, [paquet]);
  };

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
