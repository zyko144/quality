import type { IconName } from '@/components/Icon';

/**
 * Lecture des notes de version.
 *
 * Elles arrivent en markdown, telles qu'elles sont ecrites dans
 * `NOUVEAUTES.md`. Ce module les range en categories pour que le message
 * affiche au premier lancement dise ce qui est repare, ce qui est nouveau et
 * ce qui a change — trois choses qu'on ne lit pas de la meme facon.
 *
 * Une liste plate obligeait a lire chaque ligne pour savoir si elle concernait
 * un defaut qu'on avait rencontre ou une fonctionnalite qu'on ne connaissait
 * pas. La categorie repond avant la lecture.
 */

export type Genre = 'corrige' | 'nouveau' | 'ameliore';

export interface Categorie {
  genre: Genre;
  titre: string;
  icone: IconName;
  lignes: string[];
}

/**
 * Ce qu'on reconnait comme titre de categorie.
 *
 * Les sous-titres de `NOUVEAUTES.md` sont ecrits en francais et pour des
 * lecteurs ; cette table les ramene aux trois genres que l'affichage sait
 * distinguer, sans imposer une orthographe exacte a qui redige.
 */
const GENRES: { motif: RegExp; genre: Genre; titre: string; icone: IconName }[] = [
  { motif: /corrig|repar|defaut|bug/i, genre: 'corrige', titre: 'Corrige', icone: 'check-circle' },
  { motif: /nouveau|nouveaut|ajout/i, genre: 'nouveau', titre: 'Nouveau', icone: 'sparkles' },
  { motif: /amelior|change|mieux/i, genre: 'ameliore', titre: 'Ameliore', icone: 'arrow-down' },
];

/**
 * Retire les marqueurs de liste et le gras, que l'affichage ne rend pas.
 *
 * L'ORDRE COMPTE, et l'inverser laissait une trace visible dans la fenetre que
 * tout le monde voit a chaque mise a jour.
 *
 * La puce etait retiree en premier, par une expression qui mangeait aussi les
 * asterisques : sur `- **Ce qui change.** Le reste`, elle emportait la puce ET
 * les deux asterisques ouvrants. Le gras n'avait donc plus de paire a
 * reconnaitre, et les deux asterisques fermants restaient au milieu de la
 * phrase — « Ce qui change.** Le reste ».
 *
 * On retire donc l'emphase d'abord, la puce ensuite, et la puce n'est plus
 * qu'un seul caractere suivi d'une espace : c'est ce qu'est une puce, et non
 * une suite quelconque de tirets et d'asterisques.
 */
export function nettoyer(ligne: string): string {
  return ligne
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^\s*[-*]\s+/, '')
    .trim();
}

/**
 * Decoupe les notes en categories.
 *
 * Sans sous-titre — le cas des versions anterieures, dont les notes viennent
 * du serveur de publication — tout retombe dans une categorie unique plutot
 * que d'etre devine ligne a ligne. Classer au jugé serait pire que ne pas
 * classer : on croirait une categorie fiable alors qu'elle serait fabriquee.
 */
export function lireLesNotes(brut: string): Categorie[] {
  const lignes = brut.split('\n');

  const categories: Categorie[] = [];
  let courante: Categorie | null = null;

  for (const ligne of lignes) {
    const titre = /^###\s+(.*)$/.exec(ligne.trim());

    if (titre) {
      const nom = titre[1]!.trim();
      const connu = GENRES.find((entree) => entree.motif.test(nom));

      courante = {
        genre: connu?.genre ?? 'ameliore',
        titre: connu?.titre ?? nom,
        icone: connu?.icone ?? 'sparkles',
        lignes: [],
      };
      categories.push(courante);
      continue;
    }

    const texte = nettoyer(ligne);
    if (!texte) continue;

    if (!courante) {
      courante = { genre: 'ameliore', titre: 'Cette version', icone: 'sparkles', lignes: [] };
      categories.push(courante);
    }

    courante.lignes.push(texte);
  }

  // Un sous-titre sans rien dessous n'apprend rien.
  return categories.filter((categorie) => categorie.lignes.length > 0);
}
