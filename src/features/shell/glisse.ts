/**
 * Le geste qui ouvre et ferme le tiroir de navigation.
 *
 * Sur un telephone, atteindre la liste des espaces demandait de viser un bouton
 * de trente-huit pixels dans un coin. Le glissement depuis le bord est le geste
 * que tout le monde connait — c'est celui de la messagerie, du navigateur, du
 * systeme lui-meme — et il ne demande pas de viser.
 *
 * La decision vit ici, seule et sans effet, pour une raison qui se verifie a
 * l'usage : un geste mal regle ne tombe pas en panne, il devient penible. Trop
 * sensible, le tiroir s'ouvre en defilant ; trop exigeant, il ne repond pas et
 * l'on croit l'application figee. Ces seuils ne se corrigent pas au jugé.
 */

/**
 * Largeur de la zone de depart, en pixels.
 *
 * Depuis le bord seulement, tiroir ferme : ailleurs, le geste appartient a ce
 * qu'on touche — faire defiler la conversation, glisser sur un message.
 * Vingt-huit pixels, c'est ce que couvre un pouce pose au bord sans viser.
 */
export const BORD = 28;

/**
 * Part du tiroir a franchir pour que le geste compte.
 *
 * En proportion, non en pixels : le tiroir fait `min(340px, 88vw)`, et un seuil
 * fixe serait genereux sur un grand telephone et exigeant sur un petit.
 */
export const SEUIL = 0.4;

/**
 * Rapport horizontal / vertical au-dela duquel le geste est horizontal.
 *
 * Un doigt ne trace jamais une ligne droite. Sans cette pente, le moindre
 * ecart lateral pendant qu'on fait defiler ouvrirait le tiroir — et l'on ne
 * pourrait plus lire une conversation sans le voir surgir.
 */
export const PENTE = 1.4;

/** Distance apres laquelle on tranche entre horizontal et vertical. */
export const DECISION = 10;

export type Sens = 'inconnu' | 'horizontal' | 'vertical';

export interface Glisse {
  readonly x0: number;
  readonly y0: number;
  /** Le tiroir etait-il ouvert quand le doigt s'est pose. */
  readonly ouvertAuDepart: boolean;
  /** Largeur du tiroir, qui donne l'echelle du geste. */
  readonly largeur: number;
  sens: Sens;
}

/**
 * Commence a suivre un doigt, ou refuse.
 *
 * Rend `null` quand le geste ne peut pas concerner le tiroir : ni depuis le
 * bord, ni sur un tiroir deja ouvert.
 */
export function commencer(
  x: number,
  y: number,
  ouvert: boolean,
  largeur: number,
): Glisse | null {
  // Tiroir ouvert : le geste part de n'importe ou, puisqu'il ne peut que le
  // refermer et qu'il n'y a rien d'autre a faire glisser par-dessus.
  if (!ouvert && x > BORD) return null;
  if (largeur <= 0) return null;

  return { x0: x, y0: y, ouvertAuDepart: ouvert, largeur, sens: 'inconnu' };
}

/**
 * Ou en est le tiroir, de zero (ferme) a un (ouvert).
 *
 * Rend `null` tant que le sens n'est pas tranche, et une fois pour toutes quand
 * le geste s'avere vertical : changer d'avis en cours de route ferait sauter le
 * tiroir au milieu d'un defilement.
 */
export function progression(etat: Glisse, x: number, y: number): number | null {
  const dx = x - etat.x0;
  const dy = y - etat.y0;

  if (etat.sens === 'vertical') return null;

  if (etat.sens === 'inconnu') {
    const parcouru = Math.max(Math.abs(dx), Math.abs(dy));
    if (parcouru < DECISION) return null;

    etat.sens = Math.abs(dx) > Math.abs(dy) * PENTE ? 'horizontal' : 'vertical';
    if (etat.sens === 'vertical') return null;
  }

  const depart = etat.ouvertAuDepart ? etat.largeur : 0;
  return borner((depart + dx) / etat.largeur);
}

/**
 * Le tiroir doit-il finir ouvert.
 *
 * Le seuil porte sur le chemin PARCOURU depuis la position de depart, non sur
 * la position atteinte. Sans cela, refermer un tiroir ouvert demanderait de
 * traverser plus de la moitie de l'ecran, alors qu'ouvrir depuis le bord ne
 * demanderait que la meme moitie — deux exigences opposees pour un meme geste.
 */
export function conclure(etat: Glisse, x: number): boolean {
  if (etat.sens !== 'horizontal') return etat.ouvertAuDepart;

  const parcouru = (x - etat.x0) / etat.largeur;

  if (etat.ouvertAuDepart) return parcouru > -SEUIL;
  return parcouru > SEUIL;
}

function borner(valeur: number): number {
  return Math.min(1, Math.max(0, valeur));
}
