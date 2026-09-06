/**
 * L'image d'une fenetre ou d'un ecran, capturee par la partie native.
 *
 * Ce que cela remplace
 * --------------------
 * Le moteur web ne sait capturer qu'apres avoir ouvert sa propre fenetre de
 * selection — celle que nous supprimons pour afficher la notre. On lui
 * demandait donc l'ecran entier, toujours le premier, et l'on decoupait
 * l'image pour isoler la fenetre choisie. Trois defauts en decoulaient :
 *
 *  - ce qui recouvrait la fenetre partait avec elle ;
 *  - le second ecran etait hors d'atteinte ;
 *  - une fenetre reduite n'avait plus rien a decouper.
 *
 * Windows sait capturer la source elle-meme. Les images arrivent ici par la
 * meme connexion locale que le son, et deviennent une piste video ordinaire.
 *
 * Pourquoi aucun codec
 * --------------------
 * On a d'abord prevu d'encoder cote natif, ce qui aurait demande un encodeur
 * materiel, un decodeur cote page, et un encodage de plus quand WebRTC reprend
 * la piste. Mesure faite, c'est inutile : fabriquer une image 1080p a partir
 * d'octets bruts coute 0,28 ms, soit trois mille images par seconde la ou il en
 * faut soixante. Les octets traversent donc tels quels, et le seul encodage est
 * celui que WebRTC faisait deja.
 */

import { journal } from '@/lib/journal';
import { assembleur } from './assemblage';

/*
 * `MediaStreamTrackGenerator` n'est pas dans les types du moteur.
 *
 * Il existe pourtant — verifie a l'execution avant d'ecrire ce fichier — mais
 * la specification a bouge : la version en cours de normalisation le remplace
 * par `VideoTrackGenerator`, qui ne vit que dans un worker et que ce moteur
 * n'expose pas. On declare donc ce qu'on utilise, et `captureNativeDisponible`
 * verifie sa presence plutot que de la supposer.
 */
declare class MediaStreamTrackGenerator extends MediaStreamTrack {
  constructor(options: { kind: 'video' | 'audio' });
  readonly writable: WritableStream<VideoFrame>;
}

const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface ImageSysteme {
  /** Flux d'une piste video, a joindre au partage. */
  flux: MediaStream;
  /** Arrete la capture et rend les ressources. */
  arreter: () => void;
}

export type ResultatImage =
  | { ok: true; image: ImageSysteme }
  | { ok: false; raison: string };

interface FluxImage {
  port: number;
  jeton: string;
  largeur: number;
  hauteur: number;
}

/**
 * Vrai quand le moteur sait fabriquer une piste a partir d'images brutes.
 *
 * Verifie plutot que suppose : sans `MediaStreamTrackGenerator`, tout ce
 * fichier n'a pas lieu d'etre et l'appelant doit reprendre l'ancien chemin.
 */
export function captureNativeDisponible(): boolean {
  return (
    DANS_TAURI &&
    typeof MediaStreamTrackGenerator !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  );
}

/**
 * Ouvre la capture d'une source et rend sa piste video.
 *
 * `source` est l'identifiant du selecteur : `fenetre:N` ou `ecran:N`.
 */
export async function capturerSource(
  source: string,
  images: number,
): Promise<ResultatImage> {
  if (!captureNativeDisponible()) {
    return { ok: false, raison: 'La capture native n’est pas disponible ici.' };
  }

  let invoke: typeof import('@tauri-apps/api/core').invoke;

  try {
    invoke = (await import('@tauri-apps/api/core')).invoke;
  } catch {
    return { ok: false, raison: 'Le pont vers l’application n’a pas repondu.' };
  }

  let flux: FluxImage;
  try {
    flux = await invoke<FluxImage>('demarrer_image', { source, images });
  } catch (cause) {
    return {
      ok: false,
      raison: typeof cause === 'string' ? cause : 'La capture n’a pas demarre.',
    };
  }

  const arreterNatif = () => {
    void invoke('arreter_image').catch(() => undefined);
  };

  const lecteur = await ouvrirFlux(flux);
  if (!lecteur) {
    arreterNatif();
    return { ok: false, raison: 'Le passage de l’image n’a pas pu s’ouvrir.' };
  }

  const generateur = new MediaStreamTrackGenerator({ kind: 'video' });
  const ecrivain = generateur.writable.getWriter();

  /** Images effectivement reçues, pour le releve. */
  let recues = 0;
  const depart = performance.now();

  void (async () => {
    // Le recollage vit dans `assemblage.ts` : c'est un automate a etats, et
    // ceux-la se verifient par des essais, pas en les lisant.
    const recollage = assembleur();

    try {
      for (;;) {
        const { value, done } = await lecteur.read();
        if (done) break;
        if (!value) continue;

        const pretes = recollage.avaler(value);

        // Le flux ne veut plus rien dire : on ferme plutot que de fabriquer du
        // bruit a partir d'octets decales.
        if (pretes === null) {
          journal.alerte('partage', 'Flux d’images incoherent : lecture arretee', { source });
          return;
        }

        for (const image of pretes) {
          /*
           * L'horodatage est celui de l'arrivee, pas un compteur d'images.
           *
           * La capture ne produit rien quand rien ne bouge : compter les
           * images ferait avancer le temps moins vite que la realite, et le
           * son — qui, lui, coule sans interruption — deriverait de plus en
           * plus loin de l'image.
           */
          await ecrivain.write(
            new VideoFrame(image.pixels, {
              format: 'BGRA',
              codedWidth: image.largeur,
              codedHeight: image.hauteur,
              timestamp: Math.round((performance.now() - depart) * 1000),
            }),
          );

          recues += 1;
        }
      }
    } catch {
      // Connexion fermee : c'est ainsi que se termine un partage.
    }
  })();

  /*
   * Un releve unique, le temps que la cadence se stabilise.
   *
   * `parSeconde` se calculait sur `images` — la cadence DEMANDEE, un parametre
   * de cette fonction — et non sur `recues`, le compteur ecrit juste au-dessus
   * pour cela. Soixante divise par cinq secondes donne douze, toujours : la
   * ligne rendait la meme valeur dans toutes les traces, sur quatre versions et
   * deux machines, sans jamais rien mesurer.
   *
   * C'est le seul chiffre qui dise si les images manquantes se perdent a la
   * CAPTURE ou a l'ENCODAGE — les deux se decrivent « ca rame » et se corrigent
   * a l'oppose l'un de l'autre. On garde donc les deux nombres cote a cote :
   * ce qu'on a demande, et ce qui est arrive.
   */
  window.setTimeout(() => {
    void (async () => {
      let natif: { arrivees?: number; gardees?: number; abandonnees?: number } | null = null;

      try {
        natif = await invoke<{ arrivees: number; gardees: number; abandonnees: number }>(
          'diagnostic_image',
        );
      } catch {
        // Version installee plus ancienne que ce code : on journalise ce qu'on a.
      }

      journal.info('partage', 'Capture native', {
        source,
        definition: `${flux.largeur}x${flux.hauteur}`,
        demandees: images,
        recues,
        parSeconde: Math.round(recues / ((performance.now() - depart) / 1000)),

        /*
         * Ou les images se perdent, dans l'ordre de la chaine.
         *
         * `arrivees` est ce que Windows produit — il suit le rafraichissement
         * de l'ecran, pas notre cadence. `gardees` est ce qu'on retient et
         * rapatrie. `abandonnees` est ce qu'on a rapatrie pour rien, faute de
         * place dans la file. `recues`, juste au-dessus, est ce qui atteint la
         * piste.
         *
         * Les quatre cote a cote referment la chaine : sans eux, « il manque
         * des images » designe trois defauts qui se corrigent a l'oppose les
         * uns des autres, et rien ne dit lequel on regarde.
         */
        arrivees: natif?.arrivees ?? -1,
        gardees: natif?.gardees ?? -1,
        abandonnees: natif?.abandonnees ?? -1,
      });
    })();
  }, 5000);

  return {
    ok: true,
    image: {
      flux: new MediaStream([generateur]),
      arreter: () => {
        arreterNatif();
        void lecteur.cancel().catch(() => undefined);
        void ecrivain.close().catch(() => undefined);
      },
    },
  };
}

/**
 * Ouvre la connexion locale et rend de quoi la lire.
 *
 * On reessaie brievement : la connexion s'ouvre en meme temps que la capture,
 * et l'interface peut arriver la premiere. Abandonner sur une course perdue de
 * quelques millisecondes serait dommage.
 */
async function ouvrirFlux(
  flux: FluxImage,
): Promise<ReadableStreamDefaultReader<Uint8Array> | null> {
  const adresse = `http://127.0.0.1:${flux.port}/${flux.jeton}`;

  for (const attente of [0, 60, 200, 500]) {
    if (attente > 0) await new Promise((resoudre) => setTimeout(resoudre, attente));

    try {
      const reponse = await fetch(adresse, { cache: 'no-store' });
      if (reponse.ok && reponse.body) return reponse.body.getReader();
    } catch {
      // Pas encore en ecoute : on retente.
    }
  }

  return null;
}

/**
 * Change la cadence de capture sans rouvrir la source.
 *
 * Ce qui se joue ici est une depense inutile, pas une question d'image.
 * Rapatrier une image depuis la carte graphique coute environ deux
 * millisecondes en 1080p — mesure sur cette machine : 1,1 ms pour la copie et
 * l'attente de la carte, 0,8 ms pour la recopie en memoire — et le moteur y
 * ajoute ensuite la conversion vers ce que l'encodeur sait lire.
 *
 * Capturer soixante images par seconde quand l'encodeur n'en sort que
 * vingt-cinq revient a payer ce prix trente-cinq fois par seconde pour des
 * images que personne ne verra. C'est cela qui rend un partage couteux pour
 * celui qui partage — pas la definition, qui, elle, ne change rien au nombre
 * d'images.
 *
 * L'appel est sans effet hors de l'application de bureau, et sans effet aussi
 * quand aucune capture ne tourne : la valeur sera simplement celle de la
 * prochaine.
 */
export async function reglerCadence(images: number): Promise<void> {
  if (!DANS_TAURI) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('cadence_image', { images });
  } catch {
    // Une version de l'application sans cette commande : la cadence reste
    // celle du depart, ce qui marche, simplement sans l'economie.
  }
}
