import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';

/**
 * Nettoyage du micro : deux etages.
 *
 * 1. RNNoise retire le bruit PENDANT qu'on parle
 * -----------------------------------------------
 * C'est ce qui manquait, et c'est ce qu'on demandait sans le savoir en parlant
 * de « suppression du bruit ». Une porte, si bien reglee soit-elle, ne sait
 * faire qu'une chose : couper quand le niveau est bas. Elle ne peut rien contre
 * un clavier ou une chaise qui grince pendant une phrase, puisque a cet instant
 * le niveau est haut — c'est la voix qui le porte.
 *
 * RNNoise est un petit reseau recurrent entraine sur de la parole. Il travaille
 * par bandes de frequences et distingue ce qui ressemble a une voix de ce qui
 * n'y ressemble pas, y compris au milieu d'un mot. C'est la difference entre
 * « on entend moins de bruit entre les phrases » et « on n'entend plus le
 * clavier ».
 *
 * Une precision sur la qualite : il n'attenue pas le reste, il retire ce qu'il
 * a identifie comme bruit. La voix garde son niveau et sa bande passante.
 *
 * 2. La porte finit le travail
 * -----------------------------
 * Ce que RNNoise laisse passer entre deux phrases est deja tres bas, mais pas
 * nul. La porte ferme ce reste, et le silence devient un vrai silence.
 *
 * Ce qui a ete essaye avant, et pourquoi cela ne suffisait pas
 * ------------------------------------------------------------
 * La contrainte `voiceIsolation` du moteur web promet exactement cela. Elle est
 * annoncee comme supportee sur cette plateforme — `getSupportedConstraints` la
 * renvoie — mais la piste obtenue rapporte `voiceIsolation: false` : la demande
 * est acceptee puis ignoree. Le reglage correspondant etait donc sans effet,
 * tout en promettant de faire disparaitre « un clavier, un chien ou une
 * conversation a cote ».
 *
 * Tout echoue ouvert
 * ------------------
 * A chaque etape — worklet indisponible, WASM refuse, contexte suspendu — on
 * rend le flux tel quel plutot qu'un flux ferme. Un traitement qui echoue en
 * silence est indiagnosticable depuis l'autre bout de la ligne : l'autre ne dit
 * pas « ton traitement ne marche pas », il dit « je ne t'entends plus ».
 */

export interface Porte {
  /** Flux a emettre, en lieu et place du micro brut. */
  flux: MediaStream;
  /** Change le seuil de la porte sans refaire le graphe. */
  reglerSeuil: (db: number) => void;
  /** Neutralise ou reactive la porte, micro inchange. */
  activer: (actif: boolean) => void;
  /** Vrai si le retrait de bruit par reseau a pu etre installe. */
  reseauActif: boolean;
  /** Coupe le traitement et rend les ressources. Le micro brut n'est pas ferme. */
  arreter: () => void;
}

/**
 * Le binaire, charge une fois pour toutes.
 *
 * Une centaine de kilo-octets qu'il serait absurde de retelecharger a chaque
 * entree en salon. La promesse est mise en cache, pas son resultat : deux
 * entrees rapprochees ne lancent qu'un seul chargement.
 */
let binaireRnnoise: Promise<ArrayBuffer> | null = null;

function chargerRnnoise(): Promise<ArrayBuffer> {
  binaireRnnoise ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
  return binaireRnnoise;
}

export async function ouvrirPorte(source: MediaStream, seuilDb: number): Promise<Porte | null> {
  const Contexte =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Contexte) return null;

  let ctx: AudioContext;
  try {
    // 48 kHz est le taux natif de RNNoise. Le demander evite un
    // reechantillonnage de plus, et surtout evite qu'il travaille sur un signal
    // dont les frequences ne sont pas celles qu'il a apprises.
    ctx = new Contexte({ sampleRate: 48000 });
  } catch {
    return null;
  }

  const abandonner = () => {
    void ctx.close().catch(() => undefined);
    return null;
  };

  if (!ctx.audioWorklet) return abandonner();

  /*
   * Le contexte doit tourner.
   *
   * Suspendu, le graphe ne traite rien : le flux de sortie serait un silence
   * parfait, et l'on aurait un micro « ouvert » qui n'emet pas un son.
   */
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
  if (ctx.state !== 'running') return abandonner();

  // --- Etage 1 : le retrait de bruit ---------------------------------------

  let reseau: RnnoiseWorkletNode | null = null;

  try {
    const [binaire] = await Promise.all([
      chargerRnnoise(),
      ctx.audioWorklet.addModule(rnnoiseWorkletUrl),
    ]);

    reseau = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binaire });
  } catch {
    // Sans lui, la porte seule vaut mieux que rien : on continue.
    reseau = null;
  }

  // --- Etage 2 : la porte ---------------------------------------------------

  try {
    await ctx.audioWorklet.addModule(new URL('./porte-worklet.js', import.meta.url));
  } catch {
    // Si le reseau est en place, il porte l'essentiel : on peut se passer de la
    // porte. Si ni l'un ni l'autre, il n'y a plus rien a faire ici.
    if (!reseau) return abandonner();
  }

  let entree: MediaStreamAudioSourceNode;
  let porte: AudioWorkletNode | null = null;
  let sortie: MediaStreamAudioDestinationNode;

  try {
    entree = ctx.createMediaStreamSource(source);
    sortie = ctx.createMediaStreamDestination();

    try {
      porte = new AudioWorkletNode(ctx, 'porte-de-bruit');
    } catch {
      porte = null;
    }

    // La chaine se construit avec ce qui a pu etre installe.
    let dernier: AudioNode = entree;
    if (reseau) dernier = dernier.connect(reseau);
    if (porte) dernier = dernier.connect(porte);
    dernier.connect(sortie);
  } catch {
    reseau?.destroy();
    return abandonner();
  }

  const seuil = porte?.parameters.get('seuilDb');
  const actif = porte?.parameters.get('active');
  seuil?.setValueAtTime(seuilDb, ctx.currentTime);

  /*
   * Le contexte peut se suspendre en cours de route — mise en veille, reprise
   * du peripherique par le systeme. Le graphe cesse alors de traiter et le flux
   * emis devient muet sans que rien ne le signale.
   */
  const surEtat = () => {
    if (ctx.state !== 'suspended') return;
    void ctx.resume().catch(() => actif?.setValueAtTime(0, ctx.currentTime));
  };

  ctx.addEventListener('statechange', surEtat);

  return {
    flux: sortie.stream,
    reseauActif: reseau !== null,
    reglerSeuil: (db) => seuil?.setValueAtTime(db, ctx.currentTime),
    activer: (marche) => actif?.setValueAtTime(marche ? 1 : 0, ctx.currentTime),
    arreter: () => {
      ctx.removeEventListener('statechange', surEtat);
      try {
        entree.disconnect();
        porte?.disconnect();
        reseau?.destroy();
      } catch {
        // Deja detache : rien a defaire.
      }
      void ctx.close().catch(() => undefined);
    },
  };
}
