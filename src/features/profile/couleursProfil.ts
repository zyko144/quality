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

/**
 * Le fond du panneau de droite : noir, gris ou blanc, et rien d'autre.
 *
 * C'est la colonne qui se LIT — bio, comptes, espaces communs. Une couleur y
 * dispute la lisibilite du texte a longueur de fiche, la ou a gauche elle
 * habille un visage et un nom. D'ou trois valeurs neutres au lieu d'un
 * nuancier : on regle le contraste, pas la decoration.
 */
export type FondPanneau = 'noir' | 'gris' | 'blanc';

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
  /** Fond du panneau de droite. `gris` est ce que la fiche a toujours eu. */
  panneau: FondPanneau;
}

/** Ce que vaut une fiche dont personne n'a touche aux couleurs. */
export const COULEURS_PAR_DEFAUT: CouleursProfil = {
  a: '#5865f2',
  b: '#8b5cf6',
  style: 'unique',
  panneau: 'gris',
};

const HEXA = /^#[0-9a-f]{6}$/i;
const STYLES: readonly StyleProfil[] = ['unique', 'duo', 'degrade'];
const FONDS: readonly FondPanneau[] = ['noir', 'gris', 'blanc'];

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
    panneau: FONDS.includes(objet.panneau as FondPanneau)
      ? (objet.panneau as FondPanneau)
      : 'gris',
  };
}

/** Vrai si ces couleurs ne disent rien de plus que le defaut. */
export function estLeDefaut(couleurs: CouleursProfil): boolean {
  return (
    couleurs.a.toLowerCase() === COULEURS_PAR_DEFAUT.a &&
    couleurs.b.toLowerCase() === COULEURS_PAR_DEFAUT.b &&
    couleurs.style === COULEURS_PAR_DEFAUT.style &&
    couleurs.panneau === COULEURS_PAR_DEFAUT.panneau
  );
}

/** Echange les deux couleurs. C'est ce que veut dire « inverser ». */
export function inverser(couleurs: CouleursProfil): CouleursProfil {
  return { ...couleurs, a: couleurs.b, b: couleurs.a };
}

/**
 * Vrai si cette couleur est claire, au sens de la perception.
 *
 * La formule pese le vert bien plus que le bleu, parce que l'oeil en fait
 * autant : un bleu pur et un jaune pur ont la meme « valeur » en pourcentage
 * et rien a voir en luminosite. Sans cela, un fond jaune recevrait du texte
 * blanc.
 */
function estClaire(hexa: string): boolean {
  const n = Number.parseInt(hexa.slice(1), 16);
  const r = (n >> 16) & 255;
  const v = (n >> 8) & 255;
  const b = n & 255;

  return (0.299 * r + 0.587 * v + 0.114 * b) / 255 > 0.6;
}

/** Les trois fonds possibles du panneau, en valeurs reelles. */
const FONDS_PANNEAU: Record<FondPanneau, { fond: string; texte: string }> = {
  noir: { fond: '#000000', texte: '#f2f3f5' },
  gris: { fond: 'var(--bg-raised)', texte: 'var(--text-primary)' },
  blanc: { fond: '#ffffff', texte: '#111214' },
};

/**
 * Les variables a poser sur la carte.
 *
 * La couleur est la SURFACE, plus un voile pose dessus
 * ----------------------------------------------------
 * Elle etait melangee au fond sombre a trente pour cent. Consequence : choisir
 * du blanc donnait du gris tres sombre, et choisir du noir donnait le meme gris
 * — trente pour cent de n'importe quoi dans du presque-noir reste du
 * presque-noir. On reglait une teinte, jamais une couleur, et « le noir fait
 * plus gris que noir » decrit exactement cela.
 *
 * Les couleurs sont donc posees telles quelles. Un vrai noir est alors un vrai
 * noir, et un vrai blanc un vrai blanc.
 *
 * Ce que cela oblige a faire
 * --------------------------
 * Le texte ne peut plus etre clair par principe : il doit repondre au fond
 * choisi. `--profil-texte` porte cette reponse, calculee sur la MOYENNE des
 * deux couleurs — c'est ce que l'oeil voit sur un degrade, et un texte qui
 * changerait de couleur au milieu de la carte serait pire que le probleme.
 */
export function styleDesCouleurs(couleurs: CouleursProfil): CSSProperties {
  const a = couleurs.a;
  const b = couleurs.style === 'unique' ? couleurs.a : couleurs.b;

  const moyenne = moyenneDe(a, b);
  const panneau = FONDS_PANNEAU[couleurs.panneau];

  return {
    '--profil-a': a,
    '--profil-b': b,
    '--profil-texte': estClaire(moyenne) ? '#111214' : '#f2f3f5',
    /* Les traits et voiles poses SUR la couleur suivent le meme sens. */
    '--profil-voile': estClaire(moyenne) ? 'rgb(0 0 0 / 12%)' : 'rgb(255 255 255 / 12%)',
    '--profil-panneau': panneau.fond,
    '--profil-panneau-texte': panneau.texte,
  } as CSSProperties;
}

/** La couleur a mi-chemin entre deux, composante par composante. */
function moyenneDe(a: string, b: string): string {
  const lire = (h: string) => Number.parseInt(h.slice(1), 16);
  const x = lire(a);
  const y = lire(b);

  const melange = (decalage: number) =>
    Math.round((((x >> decalage) & 255) + ((y >> decalage) & 255)) / 2);

  const composantes = [melange(16), melange(8), melange(0)];
  return `#${composantes.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
