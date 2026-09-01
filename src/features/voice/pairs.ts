/**
 * Qui garder, qui retirer, qui rebatir.
 *
 * Cette decision vivait au milieu de la synchronisation des pairs, melee aux
 * effets — creer une connexion, jouer un signal, ecrire dans l'etat. Elle est
 * ici seule et sans effet, pour une raison precise : c'est elle qui portait le
 * defaut le plus couteux du vocal, et un defaut de ce genre ne se corrige pas
 * de facon credible sans qu'on puisse l'eprouver.
 *
 * Le defaut, tel qu'il se manifestait
 * -----------------------------------
 * La presence de Realtime n'est pas un etat : c'est une suite d'instantanes, et
 * l'un d'eux peut omettre quelqu'un qui n'est parti nulle part — un battement
 * manque, une reconnexion de socket. On detruisait alors toute la connexion.
 *
 * Le pire venait ensuite. Un seul des deux cotes amorce une connexion, celui
 * dont l'identifiant est le plus petit ; l'autre attend l'offre. Quand c'est le
 * cote qui attend qui a coupe, l'offre ne vient jamais — la connexion d'en face
 * n'a pas bouge, et rien ne lui demande de renegocier. La voix disparait alors
 * dans UN SEUL SENS, definitivement, jusqu'a ce que quelqu'un quitte le salon.
 */

import type { UUID } from '@/types/db';

/**
 * Delai avant de retirer un pair absent de la presence, en millisecondes.
 *
 * Assez pour couvrir un battement manque ou une reconnexion, assez peu pour
 * qu'un vrai depart ne laisse pas une tuile fantome a l'ecran.
 */
export const GRACE_ABSENCE = 5000;

/**
 * Delai au-dela duquel on amorce soi-meme, sans attendre l'offre d'en face.
 *
 * Une negociation aboutit en moins d'une seconde sur une liaison ordinaire.
 * Au-dela de six, ce n'est plus de la lenteur : l'offre ne viendra pas.
 */
export const ATTENTE_OFFRE = 6000;

export interface EtatPairs {
  /** Depuis quand un pair connecte a disparu de la presence. */
  absences: Map<UUID, number>;
  /** Depuis quand un participant est annonce sans qu'on ait de connexion. */
  attentes: Map<UUID, number>;
}

export interface Decision {
  /** Pairs dont l'absence est confirmee : la connexion peut tomber. */
  retirer: UUID[];
  /** Pairs a joindre pour la premiere fois. */
  ouvrir: UUID[];
  /** Pairs presents depuis trop longtemps sans connexion : on amorce nous-meme. */
  rebatir: UUID[];
}

/** Cree un etat vide. */
export function etatPairsVide(): EtatPairs {
  return { absences: new Map(), attentes: new Map() };
}

/**
 * Decide quoi faire, et met l'etat a jour au passage.
 *
 * `moi` sert d'arbitre : celui dont l'identifiant est le plus petit amorce, et
 * l'autre attend. C'est ce qui evite que les deux cotes negocient en meme
 * temps a chaque arrivee — pas une impossibilite de le faire, ce dont le
 * rattrapage tire parti.
 */
export function decider(
  moi: UUID,
  presents: readonly UUID[],
  connectes: readonly UUID[],
  etat: EtatPairs,
  maintenant: number,
): Decision {
  const ensemblePresents = new Set(presents.filter((id) => id !== moi));
  const decision: Decision = { retirer: [], ouvrir: [], rebatir: [] };

  for (const pair of connectes) {
    if (ensemblePresents.has(pair)) {
      etat.absences.delete(pair);
      continue;
    }

    const depuis = etat.absences.get(pair);
    if (depuis === undefined) {
      etat.absences.set(pair, maintenant);
      continue;
    }

    if (maintenant - depuis < GRACE_ABSENCE) continue;

    etat.absences.delete(pair);
    decision.retirer.push(pair);
  }

  const ensembleConnectes = new Set(connectes);

  for (const pair of ensemblePresents) {
    if (ensembleConnectes.has(pair)) {
      etat.attentes.delete(pair);
      continue;
    }

    const vuDepuis = etat.attentes.get(pair);

    if (vuDepuis === undefined) {
      etat.attentes.set(pair, maintenant);
      if (moi < pair) decision.ouvrir.push(pair);
      continue;
    }

    if (maintenant - vuDepuis < ATTENTE_OFFRE) continue;

    // Le compteur repart : sans cela, chaque synchronisation suivante
    // relancerait une construction sur une negociation deja en cours.
    etat.attentes.set(pair, maintenant);
    decision.rebatir.push(pair);
  }

  return decision;
}
