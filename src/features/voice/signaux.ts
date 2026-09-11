import type { UUID } from '@/types/db';
import { GRACE_ABSENCE } from './pairs';

/**
 * Quand jouer les sons d'arrivee et de depart d'un salon vocal.
 *
 * Le defaut
 * ---------
 * Ces sons etaient accroches a la vie des CONNEXIONS, et non a celle des
 * personnes. Le depart ne se jouait qu'une fois l'absence confirmee — cinq
 * secondes apres que la tuile avait deja disparu. L'arrivee ne se jouait qu'au
 * moment d'ouvrir une connexion, ce que seul le cote au plus petit identifiant
 * fait : pour la moitie des paires, on n'entendait jamais l'autre arriver. Et
 * en entrant soi-meme, on entendait un son pour chaque personne deja la.
 *
 * La marge de cinq secondes reste ou elle sert — garder une connexion a travers
 * un hoquet de presence, voir `pairs.ts` — et quitte le son.
 *
 * Ce que ce module decide
 * -----------------------
 *  - une arrivee se signale au premier instantane qui montre la personne, des
 *    deux cotes ;
 *  - le premier instantane apres sa propre arrivee ne signale personne : on
 *    entre chez des gens deja la ;
 *  - quelqu'un qui disparait et revient avant la fin de la marge, sans avoir
 *    annonce de depart, n'a fait qu'un hoquet : aucun son ;
 *  - un depart se signale une seule fois, qu'il arrive par l'annonce de
 *    l'interesse ou, a defaut, par l'absence confirmee.
 *
 * Sans effet et sans minuterie, comme `pairs.ts` : ce sont des regles, et elles
 * s'eprouvent.
 */

export interface EtatSignaux {
  /** Les presents du dernier instantane, `null` avant le premier. */
  dernier: Set<UUID> | null;
  /** Depuis quand chacun a disparu d'un instantane sans avoir annonce son depart. */
  absentsDepuis: Map<UUID, number>;
  /** Ceux dont le depart a deja fait jouer un son. */
  departsSignales: Set<UUID>;
}

/** Un etat vide : a poser en entrant dans un salon, et en le quittant. */
export function etatSignauxVide(): EtatSignaux {
  return { dernier: null, absentsDepuis: new Map(), departsSignales: new Set() };
}

/**
 * Ceux qu'il faut saluer, d'apres le nouvel instantane. Met l'etat a jour.
 */
export function arriveesASignaler(
  moi: UUID,
  presents: readonly UUID[],
  etat: EtatSignaux,
  maintenant: number,
): UUID[] {
  const actuels = new Set(presents.filter((id) => id !== moi));
  const precedent = etat.dernier;
  etat.dernier = actuels;

  // Le premier instantane decrit le salon tel qu'on le trouve en entrant.
  if (precedent === null) return [];

  // Disparus sans rien annoncer : on note l'heure, sans jouer de son. Si c'est
  // un vrai depart, l'absence confirmee le dira ; si c'est un hoquet, la
  // personne sera revenue avant.
  for (const id of precedent) {
    if (actuels.has(id) || etat.departsSignales.has(id) || etat.absentsDepuis.has(id)) continue;
    etat.absentsDepuis.set(id, maintenant);
  }

  const arrivees: UUID[] = [];

  for (const id of actuels) {
    if (precedent.has(id)) continue;

    const disparuDepuis = etat.absentsDepuis.get(id);
    etat.absentsDepuis.delete(id);
    const departDejaSignale = etat.departsSignales.delete(id);

    const hoquet =
      !departDejaSignale &&
      disparuDepuis !== undefined &&
      maintenant - disparuDepuis < GRACE_ABSENCE;

    if (!hoquet) arrivees.push(id);
  }

  return arrivees;
}

/**
 * Un depart a signaler : vrai s'il ne l'a pas encore ete.
 *
 * Sert aux deux chemins — l'annonce de l'interesse, instantanee, et l'absence
 * confirmee, en secours quand personne n'a rien annonce : une fenetre fermee,
 * un plantage. Quel que soit celui qui passe le premier, l'autre se tait.
 */
export function departASignaler(etat: EtatSignaux, pair: UUID): boolean {
  etat.absentsDepuis.delete(pair);
  if (etat.departsSignales.has(pair)) return false;

  etat.departsSignales.add(pair);
  return true;
}
