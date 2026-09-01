/**
 * La mecanique d'une touche qu'on maintient.
 *
 * Elle est ici seule et sans effet, pour la meme raison que la decision sur les
 * pairs : c'est de la logique a etats, elle se trompe silencieusement, et son
 * erreur ne se voit qu'a l'usage — un micro qui reste coupe apres qu'on a lache
 * la touche, ce que personne ne relie jamais a un raccourci.
 *
 * Les trois pieges, et ce qui les couvre
 * --------------------------------------
 * **La rafale.** Maintenir une touche emet une repetition automatique. Chaque
 * evenement relirait l'etat courant — deja change par le premier — et le
 * retiendrait comme etat a rendre. On ne reviendrait jamais a la position de
 * depart. Le second enfoncement est donc ignore tant qu'on n'a pas lache.
 *
 * **Le relachement avale.** Un alt-tab, une fenetre modale, et le `keyup` part
 * ailleurs. Sans un rendu sur la perte du focus, le micro resterait dans la
 * position de la pression, indefiniment.
 *
 * **Le relachement en trop.** Un `keyup` sans `keydown` — la touche etait
 * enfoncee avant que la fenetre prenne le focus — ne doit rien faire. Sans ce
 * garde-fou, il rendrait un etat qu'il n'a jamais pris.
 */

/** Ce qu'une touche maintenue retient entre deux evenements. */
export interface EtatTenue {
  /** Etat du micro avant l'appui, ou `null` si la touche n'est pas tenue. */
  avant: boolean | null;
}

export type Evenement = 'bas' | 'haut' | 'perdu';

export interface Suite {
  /**
   * Etat voulu du micro apres cet evenement, ou `null` s'il n'y a rien a faire.
   *
   * `true` veut dire coupe. C'est une VALEUR VOULUE, pas une bascule : ainsi
   * deux evenements identiques de suite ne peuvent pas se defaire l'un l'autre,
   * ce qui est precisement ce qui cassait en martelant.
   */
  micro: boolean | null;
  /** La touche est-elle tenue apres cet evenement. */
  tenue: boolean;
}

export function etatTenueVide(): EtatTenue {
  return { avant: null };
}

/**
 * Decide, et met l'etat a jour.
 *
 * `voulu` est ce que l'enfoncement doit produire : `true` pour la touche « se
 * taire », `false` pour « parler ». Tout le reste est commun aux deux.
 */
export function tenir(
  etat: EtatTenue,
  evenement: Evenement,
  microCoupe: boolean,
  voulu: boolean,
): Suite {
  if (evenement === 'bas') {
    // Deja tenue : la rafale de repetition n'a rien a dire de plus.
    if (etat.avant !== null) return { micro: null, tenue: true };

    etat.avant = microCoupe;
    return { micro: voulu, tenue: true };
  }

  // Relachement ou perte du focus sans avoir pris la touche : rien a rendre.
  if (etat.avant === null) return { micro: null, tenue: false };

  const aRendre = etat.avant;
  etat.avant = null;
  return { micro: aRendre, tenue: false };
}
