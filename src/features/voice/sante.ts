/**
 * Le canal du salon est-il encore vivant ?
 *
 * Le defaut que ce fichier corrige
 * --------------------------------
 * Le canal se rebatissait toutes les quarante-six secondes, en boucle, sur
 * toutes les machines et depuis plusieurs versions. Les traces d'un compte,
 * lues dans l'ordre des identifiants et non des dates — le journal ecrit par
 * lots, et tout un lot porte la meme heure :
 *
 * ```text
 * 02:29:01  SUBSCRIBED
 * 02:29:49  rebati (silence 46191)
 * 02:29:49  CLOSED
 * 02:29:49  perdu
 * 02:29:49  SUBSCRIBED
 * 02:30:37  rebati (silence 46176)
 * ```
 *
 * L'ordre dit tout : `rebati` arrive AVANT `CLOSED`. Le serveur ne fermait
 * donc rien — c'est notre propre `removeChannel` qui produisait ce `CLOSED`.
 * Le canal etait parfaitement sain, et on le demontait quarante-six secondes
 * apres l'avoir monte, indefiniment.
 *
 * Pourquoi la surveillance se trompait
 * ------------------------------------
 * Elle prenait pour signe de vie le fait de SE VOIR dans la presence, ce qui
 * n'arrive que dans le rappel `sync`. Or ce rappel ne se declenche que si
 * l'etat de presence CHANGE.
 *
 * On se re-annonce toutes les vingt-cinq secondes, avec exactement le meme
 * contenu. Rien ne change, donc aucun `sync`, donc aucun signe de vie — dans
 * un salon calme, ou personne ne coupe son micro ni ne partage, il ne se passe
 * plus rien du tout apres la premiere synchronisation.
 *
 * Le commentaire d'origine avait vu le risque et l'avait mal borne : « cette
 * borne doit rester bien au-dessus de la cadence a laquelle on se re-annonce,
 * sans quoi elle mesure notre propre retenue ». Quarante-cinq secondes pour
 * une republication toutes les vingt-cinq : le compte y est. Mais le
 * raisonnement supposait qu'une republication produise une synchronisation, et
 * elle n'en produit pas quand rien n'a change.
 *
 * Ce qui compte vraiment comme signe de vie
 * -----------------------------------------
 * Deux choses, et il faut les deux :
 *
 *  - **se voir dans la presence** : le serveur nous ENVOIE quelque chose ;
 *  - **une publication acquittee** : le serveur RECOIT quelque chose. `track`
 *    attend la reponse du serveur, avec trois secondes de patience. Qu'elle
 *    revienne prouve le canal aussi surement.
 *
 * La seconde manquait. C'est la plus fiable des deux, parce qu'elle ne depend
 * pas de ce que les autres font : elle a lieu toutes les vingt-cinq secondes,
 * qu'il se passe quelque chose ou non.
 *
 * La surveillance ne s'affaiblit pas pour autant : un canal mort fait echouer
 * `track` — ou expirer les trois secondes — et le silence recommence a courir.
 */

/**
 * Silence au-dela duquel on considere le canal perdu.
 *
 * Quarante-cinq secondes : bien plus que la republication de vingt-cinq, de
 * quoi laisser passer un envoi perdu et le suivant, et assez court pour qu'un
 * canal reellement mort soit repris avant qu'on ait fini de se demander
 * pourquoi plus personne ne repond.
 */
export const SILENCE_CANAL = 45_000;

/**
 * Plafond de l'attente, quelles que soient les reconstructions enchainees.
 *
 * L'attente double a chaque reconstruction infructueuse : sans plafond, une
 * demi-heure de reseau capricieux la porterait a plusieurs heures, et le canal
 * ne se reprendrait plus jamais.
 */
export const ATTENTE_MAX = 120_000;

/** Combien attendre avant de rebatir, apres `reconstructions` tentatives. */
export function attenteAvant(reconstructions: number): number {
  return Math.min(SILENCE_CANAL * 2 ** reconstructions, ATTENTE_MAX);
}

/**
 * Vrai si le canal n'a plus donne signe de vie depuis assez longtemps.
 *
 * `dernierSigneDeVie` est alimente par les DEUX preuves — une presence ou l'on
 * se voit, et une publication acquittee. C'est tout le correctif.
 */
export function presumeMort(
  dernierSigneDeVie: number,
  maintenant: number,
  reconstructions: number,
): boolean {
  return maintenant - dernierSigneDeVie > attenteAvant(reconstructions);
}
