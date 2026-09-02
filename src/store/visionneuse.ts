import { create } from 'zustand';

/**
 * L'image regardee en grand.
 *
 * Cliquer une image ouvrait un onglet, ce qui a deux defauts : dans
 * l'application de bureau il n'y a pas d'onglet ou aller, et meme dans un
 * navigateur, on quitte la conversation pour voir une image qu'on voulait
 * seulement agrandir.
 *
 * Un magasin plutot qu'un etat local : la visionneuse est montee une seule fois,
 * au-dessus de tout, et n'importe quelle image de n'importe quel fil doit
 * pouvoir l'ouvrir sans que le composant qui la porte ait a la connaitre.
 */

export interface ImageOuverte {
  url: string;
  nom: string;
  /** Dimensions d'origine, quand on les connait : elles evitent un saut. */
  largeur?: number | null;
  hauteur?: number | null;
}

interface EtatVisionneuse {
  image: ImageOuverte | null;
  /** Facteur d'agrandissement, de 1 a 6. */
  echelle: number;

  ouvrir: (image: ImageOuverte) => void;
  fermer: () => void;
  zoomer: (delta: number) => void;
  /** Revient a la taille d'origine. */
  reinitialiser: () => void;
}

/**
 * Bornes de l'agrandissement.
 *
 * En dessous de un, l'image serait plus petite que dans la conversation, ce qui
 * n'a pas de sens dans une visionneuse. Au-dela de six, on ne voit plus que des
 * pixels — et l'on a perdu de vue ce qu'on regardait.
 */
const MIN = 1;
const MAX = 6;

export const useVisionneuse = create<EtatVisionneuse>((set, get) => ({
  image: null,
  echelle: 1,

  // Chaque ouverture repart a la taille d'origine : garder l'agrandissement de
  // l'image precedente ferait arriver sur un detail, sans savoir de quoi.
  ouvrir: (image) => set({ image, echelle: 1 }),
  fermer: () => set({ image: null, echelle: 1 }),

  zoomer: (delta) =>
    set({ echelle: Math.min(MAX, Math.max(MIN, Number((get().echelle + delta).toFixed(2)))) }),

  reinitialiser: () => set({ echelle: 1 }),
}));
