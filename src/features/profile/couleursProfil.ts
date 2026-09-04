import type { CSSProperties } from 'react';

/**
 * Les couleurs d'une fiche de profil.
 *
 * Ce qui existait : huit teintes proposees, posees en `--hue-primary` sur la
 * carte — et AUCUNE regle ne lisait cette variable. On choisissait donc parmi
 * huit couleurs qui ne changeaient rien, ce qui se remarque surtout quand on
 * les essaie toutes. Le reglage existait, l'effet non.
 *
 * Trois facons de colorer, et pourquoi trois
 * ------------------------------------------
 * **unique** — une seule couleur sur toute la carte. C'est le cas courant, et
 * le seul qu'on puisse choisir sans y penser.
 *
 * **duo** — le haut d'une couleur, le bas d'une autre, franchement separes. La
 * coupure tombe la ou la fiche en a deja une : sous la banniere, entre ce qui
 * se regarde et ce qui se lit.
 *
 * **degrade** — les deux memes couleurs, mais fondues. Ce n'est pas une
 * quatrieme couleur a choisir : c'est le meme couple, presente autrement, ce
 * qui evite d'avoir a refaire son choix pour changer d'avis sur la forme.
 *
 * Inverser n'est pas un quatrieme style : c'est echanger `a` et `b`. Un style
 * de plus aurait double la liste pour dire la meme chose a l'envers.
 */

export type StyleProfil = 'unique' | 'duo' | 'degrade';

export interface CouleursProfil {
  /** Couleur principale. La seule qui serve en « unique ». */
  a: string;
  /**
   * Couleur secondaire.
   *
   * Conservee meme en « unique », ou elle ne s'affiche pas : revenir au duo
   * retrouve alors le couple d'avant plutot qu'une valeur inventee.
   */
  b: string;
  style: StyleProfil;
}

/** Ce que vaut une fiche dont personne n'a touche aux couleurs. */
export const COULEURS_PAR_DEFAUT: CouleursProfil = {
  a: '#5865f2',
  b: '#8b5cf6',
  style: 'unique',
};

const HEXA = /^#[0-9a-f]{6}$/i;
const STYLES: readonly StyleProfil[] = ['unique', 'duo', 'degrade'];

/**
 * Lit ce que porte la colonne, et rend toujours quelque chose d'affichable.
 *
 * La colonne est du `jsonb` libre du point de vue de TypeScript : elle arrive
 * en `unknown`, elle peut etre nulle, et elle peut contenir ce qu'une version
 * plus recente y aura mis. Rendre le defaut plutot que de lever est le bon
 * comportement — une fiche mal coloree se regarde, une fiche qui ne s'ouvre
 * pas ne se repare pas toute seule.
 */
export function lireCouleurs(brut: unknown): CouleursProfil {
  if (brut === null || typeof brut !== 'object') return COULEURS_PAR_DEFAUT;

  const objet = brut as Record<string, unknown>;
  const { a, b, style } = objet;

  if (typeof a !== 'string' || !HEXA.test(a)) return COULEURS_PAR_DEFAUT;

  return {
    a,
    b: typeof b === 'string' && HEXA.test(b) ? b : COULEURS_PAR_DEFAUT.b,
    style: STYLES.includes(style as StyleProfil) ? (style as StyleProfil) : 'unique',
  };
}

/** Vrai si ces couleurs ne disent rien de plus que le defaut. */
export function estLeDefaut(couleurs: CouleursProfil): boolean {
  return (
    couleurs.a.toLowerCase() === COULEURS_PAR_DEFAUT.a &&
    couleurs.b.toLowerCase() === COULEURS_PAR_DEFAUT.b &&
    couleurs.style === COULEURS_PAR_DEFAUT.style
  );
}

/** Echange les deux couleurs. C'est ce que veut dire « inverser ». */
export function inverser(couleurs: CouleursProfil): CouleursProfil {
  return { ...couleurs, a: couleurs.b, b: couleurs.a };
}

/**
 * Les variables a poser sur la carte.
 *
 * Deux couleurs et un style, jamais un fond tout fait : c'est la feuille de
 * style qui decide COMMENT les employer — un fond ici, une bordure la, un
 * accent sur les boutons. Fabriquer le degrade dans le code obligerait a le
 * refaire a chaque endroit qui en a besoin, et les endroits divergeraient.
 *
 * En « unique », `b` vaut `a` : les regles qui melangent les deux n'ont alors
 * pas a connaitre le style, et une couleur melangee a elle-meme reste
 * elle-meme. C'est ce qui evite un jeu de regles par style.
 */
export function styleDesCouleurs(couleurs: CouleursProfil): CSSProperties {
  return {
    '--profil-a': couleurs.a,
    '--profil-b': couleurs.style === 'unique' ? couleurs.a : couleurs.b,
  } as CSSProperties;
}
