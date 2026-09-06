/**
 * Quand redemander une offre pour un partage qui n'arrive pas.
 *
 * Le defaut, tel qu'il a ete rapporte : « des fois connexion au partage a
 * l'infini ». On clique « Regarder », la vignette s'installe, le voile dit
 * « Connexion au partage… », et il ne se passe plus rien. Jamais.
 *
 * Ce qui manquait
 * ---------------
 * Le role d'un flux voyage par le canal de signalisation, la piste par la
 * connexion media. Les deux chemins peuvent se perdre, et le code savait
 * rattraper le premier — une piste arrivee sans son annonce est reclassee a
 * partir de la presence, plusieurs fois, jusqu'a ce que ca tombe juste.
 *
 * Mais rien ne rattrapait le second. Si l'offre qui porte la piste se perd —
 * le canal Realtime se ferme et se rebatit, un envoi part pendant qu'on se
 * reabonne — le pair d'en face n'a RIEN a reclasser : aucune piste n'est
 * arrivee. `onnegotiationneeded` avait deja fait son travail de son cote et ne
 * se redeclenchera pas ; son commentaire l'admet a demi-mot, « une negociation
 * avortee sera relancee par le prochain changement », mais il n'y a pas
 * forcement de prochain changement. Quelqu'un qui partage un jeu pendant deux
 * heures n'en produit aucun.
 *
 * Vu de celui qui partage, tout va bien : il partage, sa piste est posee sur la
 * connexion. Vu de l'autre, c'est un voile qui tourne pour toujours. Aucun des
 * deux ne peut le corriger, et ni l'un ni l'autre ne peut meme le decrire.
 *
 * Ce que fait cette regle
 * -----------------------
 * Elle decide quand celui qui ATTEND redemande une offre. C'est le bon cote :
 * lui seul sait qu'il n'a rien recu.
 *
 * Trois bornes, et chacune paie quelque chose :
 *
 *  - attendre d'abord, parce qu'une negociation ordinaire prend un instant et
 *    que relancer pendant qu'elle aboutit ne ferait que la deranger ;
 *  - espacer, parce qu'une relance ne se juge pas avant d'avoir eu le temps
 *    d'echouer ;
 *  - s'arreter, parce qu'au-dela l'echec n'est plus un envoi perdu. Marteler
 *    un pair qui refuse ne le rendra pas plus disposé, et l'on veut une trace
 *    plutot qu'un bruit de fond.
 */

/**
 * Temps laisse a une negociation ordinaire avant de la croire perdue.
 *
 * Six secondes : bien au-dela d'un aller-retour de signalisation et d'une
 * poignee de main ICE sur une liaison domestique, et bien en deca de ce qu'on
 * supporte devant un voile qui tourne.
 */
export const ATTENTE_AVANT_RELANCE = 6_000;

/** Repos entre deux relances vers le meme pair. */
export const INTERVALLE_RELANCE = 5_000;

/**
 * Nombre de relances avant de renoncer.
 *
 * Trois : de quoi couvrir une reconstruction de canal, qui est la cause
 * attendue. Au-dela, le probleme n'est pas un envoi perdu, et insister ne
 * ferait qu'ajouter du trafic a une liaison qui va deja mal.
 */
export const RELANCES_MAX = 3;

/**
 * Repos impose a celui qui RECOIT une relance.
 *
 * La demande est peu couteuse a emettre et fait renegocier celui qui la
 * recoit. Un client modifie pourrait l'envoyer en boucle ; la borne est ici
 * plutot que chez l'emetteur, parce que c'est le seul endroit qui protege
 * vraiment.
 */
export const REPOS_REOFFRE = 2_000;

/** Ce qu'on retient d'une attente, d'un battement a l'autre. */
export interface AttentePartage {
  /** Depuis quand ce partage est attendu sans qu'aucune piste soit arrivee. */
  depuis: number;
  /** Nombre de relances deja envoyees. */
  relances: number;
  /** Date de la derniere. */
  derniereRelance: number;
}

/**
 * Ce qu'il y a a faire pour une attente donnee.
 *
 * `renoncer` ne veut pas dire « fermer » : la vignette continue d'attendre, et
 * une piste qui finirait par arriver serait affichee normalement. Cela veut
 * dire qu'on cesse de demander, et qu'on l'ecrit dans le journal.
 */
export type DecisionRelance = 'attendre' | 'relancer' | 'renoncer';

export function decideRelance(attente: AttentePartage, maintenant: number): DecisionRelance {
  // Une negociation en cours a le droit d'aboutir.
  if (maintenant - attente.depuis < ATTENTE_AVANT_RELANCE) return 'attendre';

  if (attente.relances >= RELANCES_MAX) return 'renoncer';

  // La premiere relance part des l'attente ecoulee ; les suivantes s'espacent.
  if (attente.relances > 0 && maintenant - attente.derniereRelance < INTERVALLE_RELANCE) {
    return 'attendre';
  }

  return 'relancer';
}

/** Vrai si l'on peut honorer une relance venue de ce pair. */
export function peutReoffrir(derniere: number | undefined, maintenant: number): boolean {
  return derniere === undefined || maintenant - derniere >= REPOS_REOFFRE;
}
