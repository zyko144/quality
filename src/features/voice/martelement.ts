/**
 * Reconnait qu'on martele une commande, pour le dire plutot que le subir.
 *
 * Couper le micro, la sourdine, la camera : chacun de ces gestes annonce un
 * etat au salon. L'annonce est deja espacee — voir `useVoice` — mais enchainer
 * les bascules plus vite que cet intervalle a une consequence qu'on ne devine
 * pas depuis l'interface : les etats intermediaires ne partent jamais, et l'on
 * se retrouve a regarder un bouton qui dit une chose pendant que les autres en
 * voient une autre. Le reflexe est alors de recliquer, ce qui aggrave le cas.
 *
 * D'ou cet avertissement. Il ne bloque rien — on garde le droit de faire ce
 * qu'on veut de ses propres commandes — il explique seulement ce qui se passe,
 * une fois, au moment ou cela se passe.
 *
 * La mesure vit ici, seule et sans effet, pour la meme raison que la mecanique
 * des touches maintenues : elle a des seuils, et des seuils qu'on ne peut pas
 * eprouver sont des seuils qu'on ajuste au hasard.
 */

/** Duree observee. Assez courte pour ne compter qu'un vrai enchainement. */
export const FENETRE = 3000;

/**
 * Nombre de bascules au-dela duquel on previent.
 *
 * Huit en trois secondes, c'est plus de deux par seconde tenues sur la duree :
 * personne ne fait cela en reglant son micro. En revanche c'est exactement ce
 * qu'on obtient en martelant une touche pour voir si elle repond.
 */
export const SEUIL = 8;

/** On ne redit pas la meme chose avant ce delai. */
export const REPOS = 30_000;

export interface EtatMartelement {
  /** Les instants retenus, du plus ancien au plus recent. */
  instants: number[];
  /**
   * Quand l'avertissement a ete donne, ou `null` s'il ne l'a jamais ete.
   *
   * `null` plutot que zero, et ce n'est pas de la coquetterie : « jamais » et
   * « a l'instant zero » sont deux choses differentes, et les confondre rend le
   * premier avertissement dependant de l'origine des temps. Avec `Date.now()`
   * l'ecart est de cinquante-cinq ans et le calcul tombe juste par accident ;
   * avec une horloge qui part de zero — un banc de cas, une horloge de lecture
   * — le premier avertissement ne serait jamais donne.
   */
  dernierAvis: number | null;
}

export function etatMartelementVide(): EtatMartelement {
  return { instants: [], dernierAvis: null };
}

/**
 * Note une bascule et dit s'il faut avertir.
 *
 * Rend `true` au plus une fois par periode de repos : un avertissement qui se
 * repete a chaque pression serait lui-meme du martelement.
 */
export function noter(etat: EtatMartelement, maintenant: number): boolean {
  // Ce qui est sorti de la fenetre ne compte plus : le tableau ne peut donc
  // pas depasser ce qui tient dans trois secondes, quel que soit le temps
  // passe dans un salon.
  etat.instants = etat.instants.filter((instant) => maintenant - instant < FENETRE);
  etat.instants.push(maintenant);

  if (etat.instants.length < SEUIL) return false;
  if (etat.dernierAvis !== null && maintenant - etat.dernierAvis < REPOS) return false;

  etat.dernierAvis = maintenant;

  /*
   * Le compte repart apres l'avertissement.
   *
   * Sans cela, la fenetre resterait pleine et chaque pression suivante
   * declencherait a nouveau — des la fin du repos, sans qu'on ait rien fait de
   * neuf. On veut prevenir d'un enchainement, pas de ses consequences.
   */
  etat.instants = [];
  return true;
}
