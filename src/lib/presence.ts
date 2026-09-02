import type { PresenceStatus } from '@/types/db';

/**
 * Qui est vraiment en ligne.
 *
 * Le defaut repare : `status` etait pose a « en ligne » a la connexion et remis
 * a « hors ligne » par une requete envoyee pendant que la page disparait. Cela
 * marche quand on ferme proprement, et seulement dans ce cas. Une veille, un
 * processus tue, une coupure, un plantage : l'adieu ne part jamais, et le
 * compte reste affiche « en ligne » pour toujours. On voyait donc en ligne des
 * gens partis depuis des jours.
 *
 * Cela ne se corrige pas en soignant l'adieu, puisque dans ces cas-la il n'y a
 * pas d'adieu a soigner. On mesure donc au lieu de declarer : l'application dit
 * « je suis la » a intervalle regulier, et qui cesse de le dire cesse d'etre en
 * ligne. Un signal qui doit etre renouvele ne peut pas rester vrai par accident.
 *
 * La regle vit ici, seule et sans effet, parce qu'elle est appliquee a une
 * dizaine d'endroits — liste d'amis, membres d'un espace, barre laterale,
 * fiches de profil — et qu'une copie qui diverge se voit comme une incoherence
 * entre deux ecrans, pas comme un defaut.
 */

/**
 * Intervalle entre deux battements, en millisecondes.
 *
 * Une minute : assez rare pour ne rien couter — une ecriture par personne
 * connectee et par minute — assez frequent pour que l'oubli se voie vite.
 */
export const BATTEMENT = 60_000;

/**
 * Silence au-dela duquel on considere quelqu'un parti.
 *
 * Deux battements et demi. Un seul battement manque a la moindre hesitation du
 * reseau, et l'on verrait les gens clignoter ; au-dela de trois minutes, on
 * garde longtemps a l'ecran des gens qui ne sont plus la — ce qu'on repare
 * justement.
 */
export const EXPIRATION = 150_000;

/**
 * L'etat reellement affichable de quelqu'un.
 *
 * `dernierePresence` peut manquer : la colonne est recente, et les profils qui
 * n'ont pas encore battu une seule fois ne doivent pas tous basculer hors ligne
 * d'un coup. Sans mesure, on fait confiance a ce qui est declare — c'est le
 * comportement d'avant, et il vaut mieux que de mentir dans l'autre sens.
 */
export function etatReel(
  declare: PresenceStatus | null | undefined,
  dernierePresence: string | null | undefined,
  maintenant: number = Date.now(),
): PresenceStatus {
  const dit = declare ?? 'offline';

  // Qui se declare hors ligne l'est : la mesure ne sert qu'a rattraper les
  // absences non annoncees, jamais a contredire un choix.
  if (dit === 'offline') return dit;

  if (!dernierePresence) return dit;

  const vu = Date.parse(dernierePresence);
  if (Number.isNaN(vu)) return dit;

  /*
   * Une date dans l'avenir est acceptee telle quelle.
   *
   * L'horloge du poste peut avancer sur celle du serveur, et refuser ce cas
   * ferait passer hors ligne quelqu'un qui vient tout juste de battre. Un
   * decalage d'horloge n'est pas une absence.
   */
  return maintenant - vu > EXPIRATION ? 'offline' : dit;
}

/** Raccourci de lecture : la pastille doit-elle etre allumee. */
export function estEnLigne(
  declare: PresenceStatus | null | undefined,
  dernierePresence: string | null | undefined,
  maintenant: number = Date.now(),
): boolean {
  return etatReel(declare, dernierePresence, maintenant) !== 'offline';
}
