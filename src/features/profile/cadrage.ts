import type { CSSProperties } from 'react';

/**
 * Ou regarder dans une banniere, et de combien grossir.
 *
 * Le probleme, en une phrase : une banniere est posee en `object-fit: cover`,
 * ce qui la centre et rogne le reste. Une image dont le sujet n'est pas au
 * milieu — un visage a gauche, un titre en haut, un paysage dont on veut le
 * ciel — se retrouve coupee, et la seule issue etait de recadrer le fichier
 * ailleurs avant de l'envoyer. Sur telephone, ou l'on choisit une photo prise a
 * l'instant, cela revenait a ne pas pouvoir se servir de la fonction.
 *
 * Pourquoi ce calcul vit seul
 * ---------------------------
 * La banniere paraît a quatre endroits : la fiche de profil, le voile flou
 * derriere elle, la page des reglages, et l'apercu de l'editeur. Un cadrage
 * recopie a quatre endroits diverge a la premiere retouche, et le defaut est
 * particulierement sournois : l'apercu montre alors autre chose que ce que
 * verront les autres, si bien qu'on cadre soigneusement une image pour un
 * resultat qu'on ne voit jamais.
 */

/** Le cadrage tel qu'il est range en base. */
export interface Cadrage {
  /** Position horizontale du regard, en pourcentage de la largeur. */
  x: number;
  /** Position verticale du regard, en pourcentage de la hauteur. */
  y: number;
  /** Grossissement, de 1 (l'image entiere) a 3. */
  zoom: number;
}

/** Centre, sans grossissement : ce que valaient toutes les bannieres. */
export const CADRAGE_PAR_DEFAUT: Cadrage = { x: 50, y: 50, zoom: 1 };

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;

function borner(valeur: number, bas: number, haut: number): number {
  if (!Number.isFinite(valeur)) return bas;
  return Math.min(haut, Math.max(bas, valeur));
}

/**
 * Lit un cadrage venu de la base, et rend toujours quelque chose d'affichable.
 *
 * La colonne est du `jsonb` libre du point de vue de TypeScript : elle arrive
 * en `unknown`, elle peut etre nulle, et elle peut contenir ce qu'une version
 * plus recente de l'application y aura mis. Rendre le cadrage par defaut plutot
 * que de lever est le bon comportement — une banniere mal cadree se regarde,
 * une fiche de profil qui ne s'ouvre pas ne se repare pas toute seule.
 */
export function lireCadrage(brut: unknown): Cadrage {
  if (brut === null || typeof brut !== 'object') return CADRAGE_PAR_DEFAUT;

  const objet = brut as Record<string, unknown>;
  const { x, y, zoom } = objet;

  if (typeof x !== 'number' || typeof y !== 'number' || typeof zoom !== 'number') {
    return CADRAGE_PAR_DEFAUT;
  }

  return {
    x: borner(x, 0, 100),
    y: borner(y, 0, 100),
    zoom: borner(zoom, ZOOM_MIN, ZOOM_MAX),
  };
}

/** Vrai si ce cadrage ne dit rien de plus que le defaut. */
export function estLeCadrageParDefaut(cadrage: Cadrage): boolean {
  return (
    Math.round(cadrage.x) === CADRAGE_PAR_DEFAUT.x &&
    Math.round(cadrage.y) === CADRAGE_PAR_DEFAUT.y &&
    Math.abs(cadrage.zoom - CADRAGE_PAR_DEFAUT.zoom) < 0.01
  );
}

/**
 * Le style a poser sur l'image de la banniere.
 *
 * `object-position` choisit ce qu'on garde du rognage, `scale` grossit ce qui
 * reste. Les deux se cumulent dans le bon ordre sans qu'on ait a y penser :
 * le navigateur rogne d'abord, puis met a l'echelle.
 *
 * `transform-origin` suit le point vise plutot que le centre. Sans cela, un
 * grossissement rejette hors du cadre ce qu'on venait justement d'y amener :
 * on cadre un visage a gauche, on grossit, le visage part. En faisant grossir
 * DEPUIS le point vise, ce point ne bouge pas — c'est le comportement de
 * n'importe quelle loupe, et le seul qui se pilote sans y reflechir.
 */
export function styleDeCadrage(cadrage: Cadrage): CSSProperties {
  return {
    objectPosition: `${cadrage.x}% ${cadrage.y}%`,
    transform: cadrage.zoom === 1 ? undefined : `scale(${cadrage.zoom})`,
    transformOrigin: `${cadrage.x}% ${cadrage.y}%`,
  };
}

/**
 * Applique un deplacement a la souris ou au doigt, en pourcentage du cadre.
 *
 * Le geste est INVERSE du deplacement de l'image : on saisit l'image et on la
 * tire, comme une carte. Tirer vers la droite doit donc montrer ce qui etait a
 * gauche, c'est-a-dire faire DIMINUER `x`. L'avoir dans l'autre sens donne une
 * impression immediate de commande cassee, sans qu'on sache dire pourquoi.
 *
 * Le deplacement est divise par le grossissement : a fort grossissement, un
 * meme geste doit parcourir moins d'image, sinon le sujet traverse le cadre au
 * moindre mouvement.
 */
export function deplacer(
  cadrage: Cadrage,
  dxEnPourcent: number,
  dyEnPourcent: number,
): Cadrage {
  return {
    ...cadrage,
    x: borner(cadrage.x - dxEnPourcent / cadrage.zoom, 0, 100),
    y: borner(cadrage.y - dyEnPourcent / cadrage.zoom, 0, 100),
  };
}
