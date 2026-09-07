/**
 * Que faire d'un debit qui ne suffit pas.
 *
 * « Quand ya trop de moov la qual baisse de ouf », puis, une version plus
 * tard : « le pb est tjr la ».
 *
 * Pourquoi la premiere correction ne suffisait pas
 * ------------------------------------------------
 * Elle ne touchait qu'a la CADENCE : moins d'images, plus de bits pour
 * chacune. Le raisonnement etait bon et la portee trop courte. Passe sur les
 * debits releves chez ceux qui se plaignaient :
 *
 * ```text
 *   95 kbps -> il faudrait 0,8 image/s, le plancher en impose 24 ->   3 958 bits/image
 *  480 kbps ->              4,0                                 ->  20 000
 * 1346 kbps ->             11,2                                 ->  56 083
 * ```
 *
 * Pour un seuil vise a cent vingt mille. Le plancher de vingt-quatre images —
 * pose pour qu'un partage reste fluide — annulait la correction sur toute la
 * plage ou elle servait.
 *
 * Et meme sans plancher, il manquait l'essentiel : a cent vingt mille bits par
 * image en 1080p, on a deux millions de pixels a decrire. C'est mince. Les
 * memes bits sur du 720p en decrivent quatre fois moins, donc quatre fois
 * mieux.
 *
 * Ce qui compte vraiment
 * ----------------------
 * Le nombre de BITS PAR PIXEL. Ni la cadence seule, ni la definition seule :
 * leur produit. Un partage lisible en mouvement demande environ huit
 * centiemes de bit par pixel — en dessous, l'encodeur ne decrit plus les
 * contours, et le texte est la premiere chose a disparaitre.
 *
 * On cherche donc, pour le debit qu'on a VRAIMENT, la plus grande definition
 * et la plus haute cadence qui tiennent dans ce budget.
 *
 * L'ordre de preference
 * ---------------------
 * La definition d'abord, la cadence ensuite. C'est ce qui a ete demande — « on
 * voit bien l'ecriture meme les mouvement fast » — et c'est le bon arbitrage
 * pour du texte : une image nette a vingt images se lit, une image floue a
 * soixante non.
 *
 * On ne descend jamais sous quinze images : en dessous ce n'est plus un
 * partage, c'est une suite de photographies, et l'on ne suit plus le geste de
 * celui qui montre quelque chose.
 */

/**
 * Bits par pixel vises, pour une image qui bouge.
 *
 * Huit centiemes : l'ordre de grandeur d'un encodage H.264 correct sur du
 * contenu anime. Ce n'est pas un seuil de finesse, c'est la frontiere entre
 * « une image » et « des blocs ».
 */
export const BITS_PAR_PIXEL = 0.08;

/** En dessous, ce n'est plus un partage mais un diaporama. */
export const IMAGES_PLANCHER = 15;

/**
 * Les reductions de definition envisagees, de la meilleure a la pire.
 *
 * Trois valeurs, pas davantage : chacune doit se faire sentir. Une echelle
 * fine changerait la definition sans cesse pour des gains qu'on ne voit pas,
 * et chaque changement, lui, se voit.
 */
export const REDUCTIONS = [1, 1.5, 2, 3] as const;

/** Les cadences envisagees, de la meilleure a la pire. */
export const CADENCES = [60, 48, 36, 30, 24, 20, IMAGES_PLANCHER] as const;

export interface Reglage {
  /** Facteur de reduction de la definition. `1` la laisse intacte. */
  reduction: number;
  /** Images par seconde a capturer et a emettre. */
  images: number;
}

/**
 * Le meilleur reglage qui tienne dans le debit disponible.
 *
 * `largeur` et `hauteur` sont celles qu'on emet aujourd'hui ; `imagesVoulues`
 * est le choix de la personne, qu'on ne depasse jamais — c'est un plafond, pas
 * une cible.
 *
 * Rend toujours quelque chose : quand meme le dernier cran ne tient pas, on le
 * rend quand meme. Un partage degrade vaut mieux qu'un partage arrete, et la
 * couche de congestion fera le reste de son cote.
 */
export function reglagePourDebit(
  kbps: number,
  largeur: number,
  hauteur: number,
  imagesVoulues: number,
): Reglage {
  const plein: Reglage = { reduction: 1, images: imagesVoulues };

  /*
   * Sans mesure, on ne touche a rien.
   *
   * C'est le cas du premier releve, avant qu'un octet ne soit parti. S'y fier
   * ramenerait le partage au dernier cran des la premiere seconde.
   */
  if (kbps <= 0 || largeur <= 0 || hauteur <= 0) return plein;

  // Pixels par seconde que le debit peut decrire correctement.
  const budget = (kbps * 1000) / BITS_PAR_PIXEL;

  for (const reduction of REDUCTIONS) {
    const pixels = (largeur / reduction) * (hauteur / reduction);

    for (const images of CADENCES) {
      if (images > imagesVoulues) continue;
      if (pixels * images <= budget) return { reduction, images };
    }
  }

  /*
   * Rien ne tient : on rend le cran le plus bas.
   *
   * Cela arrive sur une liaison vraiment mauvaise — sous deux cents kilobits,
   * ou aucun reglage ne donne une image lisible. On envoie alors le moins
   * possible, et c'est deja mieux que d'envoyer du 1080p a soixante images
   * dont personne ne verra rien.
   */
  return {
    reduction: REDUCTIONS[REDUCTIONS.length - 1]!,
    images: Math.min(imagesVoulues, IMAGES_PLANCHER),
  };
}

/**
 * Vrai si le changement vaut la peine d'etre applique.
 *
 * Chaque changement se voit — la definition saute, la cadence aussi — et
 * suivre le bruit de mesure ferait osciller le partage en permanence. On ne
 * bouge que pour un ecart franc.
 */
export function vautLeChangement(courant: Reglage, suivant: Reglage): boolean {
  if (courant.reduction !== suivant.reduction) return true;

  return Math.abs(courant.images - suivant.images) >= 6;
}
