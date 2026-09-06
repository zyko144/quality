/**
 * Alleger un partage pour la machine qui n'arrive pas a le suivre — et pour
 * elle seule.
 *
 * Le probleme, tel qu'il a ete rapporte : « le stream bug et fais bug pour les
 * gens qui ont un vieux pc sur gmod ». Deux phrases en une, et la seconde est
 * la plus importante : ce n'est pas celui qui partage qui rame, ce sont ceux
 * qui regardent.
 *
 * Pourquoi baisser la qualite ne serait pas une reponse
 * -----------------------------------------------------
 * On pourrait envoyer moins a tout le monde. Ce serait punir six personnes
 * pour une, et rendre le partage mediocre chez ceux dont la machine tient
 * parfaitement — ce qui a ete demande explicitement de ne pas faire.
 *
 * En maillage, chacun ouvre une connexion vers chacun : l'emetteur a donc un
 * `RTCRtpSender` DISTINCT par personne, et peut envoyer une image differente a
 * chacune. C'est la propriete qui rend cette adaptation possible, et elle est
 * gratuite — elle existe deja, on ne s'en servait pas.
 *
 * Qui decide
 * ----------
 * Celui qui REGARDE, parce que lui seul sait ce que sa machine encaisse.
 * L'emetteur ne peut pas le deviner : de son cote, un partage que personne
 * n'arrive a decoder ressemble trait pour trait a un partage qui se passe
 * bien — les paquets partent, l'encodeur suit, rien ne remonte. C'est le meme
 * aveuglement qui a rendu le partage « en connexion a l'infini » introuvable.
 *
 * Ce qu'on reduit, et dans quel ordre
 * -----------------------------------
 * Le cout du decodage suit le nombre de pixels par seconde : la definition
 * multipliee par la cadence. Reduire la definition de moitie divise le travail
 * par QUATRE ; reduire la cadence de moitie ne le divise que par deux.
 *
 * On commence donc par la definition, et l'on ne touche a la cadence qu'apres.
 * C'est aussi le bon ordre pour ce qu'on regarde : dans un jeu, une image
 * fluide un peu douce se suit sans peine, une image nette qui saccade non.
 */

/** Ce qu'une machine constate de son propre decodage. */
export interface Constat {
  /** Millisecondes de decodage par image. */
  msParImage: number;
  /** Images par seconde effectivement recues. */
  imagesParSeconde: number;
  /** Part des images que le moteur n'a pas pu afficher, de 0 a 1. */
  perdues: number;
}

/** Un cran de la reduction, applique par l'emetteur pour ce spectateur seul. */
export interface Palier {
  /**
   * Reduction supplementaire de la definition.
   *
   * Multipliee a celle que le partage applique deja : elle ne la remplace pas.
   * Sans quoi un partage 1440p ramene a 1080p repasserait en 1440p au premier
   * allegement, ce qui est exactement l'inverse du but.
   */
  reduction: number;
  /** Plafond d'images par seconde, ou `null` pour ne rien imposer. */
  images: number | null;
}

/**
 * L'echelle, du confort au dernier recours.
 *
 * Cinq crans, pas davantage : chacun doit se faire sentir, sinon on en
 * descend trois avant que quoi que ce soit ne change, et l'image s'effondre
 * pendant qu'on cherche le bon.
 */
export const PALIERS: Palier[] = [
  { reduction: 1, images: null },
  { reduction: 1.5, images: null },
  { reduction: 2, images: null },
  { reduction: 2, images: 30 },
  { reduction: 3, images: 30 },
];

/**
 * Au-dela de cette part du temps reel passee a decoder, la machine ne suit pas.
 *
 * Le decodage n'est pas seul sur le processeur : il y a le reste de
 * l'application, le systeme, et souvent le jeu de celui qui regarde. Attendre
 * cent pour cent reviendrait a n'agir qu'une fois l'image deja saccadee.
 */
export const CHARGE_HAUTE = 0.7;

/**
 * En dessous, la machine a de la marge et l'on peut lui rendre de la qualite.
 *
 * L'ecart avec `CHARGE_HAUTE` n'est pas de la prudence : c'est ce qui empeche
 * l'oscillation. Deux seuils confondus feraient monter et descendre d'un cran
 * a chaque mesure, et changer de definition se voit a chaque fois.
 */
export const CHARGE_BASSE = 0.35;

/** Part d'images perdues au-dela de laquelle on considere que ca decroche. */
export const PERTES_HAUTES = 0.05;

/**
 * Le travail que represente un cran, pour une source a `imagesSource`.
 *
 * Le decodage suit le nombre de PIXELS PAR SECONDE : la surface multipliee par
 * la cadence. La surface varie comme le carre de la reduction — reduire chaque
 * cote de moitie divise le travail par quatre, pas par deux — et c'est ce qui
 * justifie de toucher a la definition avant la cadence.
 *
 * Sert a repondre, avant de remonter, a la seule question qui compte :
 * « est-ce que le cran du dessus tiendrait ? »
 */
export function poids(palier: Palier, imagesSource: number): number {
  const images =
    palier.images === null ? imagesSource : Math.min(palier.images, imagesSource);

  return images / (palier.reduction * palier.reduction);
}

/**
 * Mesures consecutives au calme avant de remonter d'un cran.
 *
 * On descend vite et l'on remonte lentement, volontairement. Une descente
 * repare quelque chose qu'on voit ; une remontee ne fait que reprendre un
 * risque, et si elle se trompe on redescend — donc on change deux fois l'image
 * pour rien.
 */
export const CALMES_AVANT_REMONTEE = 3;

/**
 * Le cran a viser, et le compteur de calme mis a jour.
 *
 * `calmes` doit etre conserve par l'appelant d'une mesure a l'autre : c'est
 * lui qui porte l'hysteresis.
 */
export function prochainPalier(
  courant: number,
  calmes: number,
  constat: Constat,
): { palier: number; calmes: number } {
  /*
   * Une mesure sans image ne dit rien.
   *
   * C'est ce que rend le premier releve, et aussi celui d'un partage qu'on
   * vient de fermer. S'y fier ferait descendre l'echelle entiere pendant les
   * deux premieres secondes de chaque partage.
   */
  if (constat.imagesParSeconde <= 0 || !Number.isFinite(constat.msParImage)) {
    return { palier: courant, calmes };
  }

  const budget = 1000 / constat.imagesParSeconde;
  const charge = constat.msParImage / budget;

  const peine = charge > CHARGE_HAUTE || constat.perdues > PERTES_HAUTES;

  if (peine) {
    // On redescend d'un seul cran a la fois, et le compteur de calme repart.
    return { palier: Math.min(courant + 1, PALIERS.length - 1), calmes: 0 };
  }

  if (charge >= CHARGE_BASSE) {
    // Entre les deux seuils : ni assez mal pour agir, ni assez bien pour
    // rendre ce qu'on a retire. On ne bouge pas, et l'on n'accumule pas non
    // plus de calme — sans quoi on finirait par remonter par lassitude.
    return { palier: courant, calmes: 0 };
  }

  const suite = calmes + 1;
  if (suite < CALMES_AVANT_REMONTEE || courant === 0) {
    return { palier: courant, calmes: suite };
  }

  /*
   * On ne remonte que si le cran du dessus tiendrait AUSSI.
   *
   * C'est le coeur de la regle, et sans lui elle oscille — non pas dans un cas
   * tordu, mais dans toute une bande de machines ordinaires. Simule sur
   * soixante mesures : trente changements de definition, un toutes les quatre
   * secondes, indefiniment.
   *
   * Le mecanisme est celui d'une boucle qui se mord la queue. Une machine
   * peine, on l'allege, elle va alors tres bien — parce qu'on l'a allegee. Le
   * calme constate lui rend son cran, ce qui la fait repeiner aussitot, ce qui
   * la fait redescendre. Deux seuils ecartes n'y suffisent pas : ils
   * ralentissent le va-et-vient, ils ne l'empechent pas.
   *
   * La question n'est donc pas « va-t-elle bien ? » mais « irait-elle encore
   * bien avec ce qu'on s'apprete a lui rendre ? ». La charge se projette :
   * elle suit le travail, et le travail se calcule. Avec cette projection, les
   * memes soixante mesures donnent un a trois changements, puis plus rien.
   */
  const source = constat.imagesParSeconde;
  const ici = poids(PALIERS[courant]!, source);
  const dessus = poids(PALIERS[courant - 1]!, source);

  // Une division par zero n'arrive pas — `source` est deja verifie non nul —
  // mais un poids nul rendrait `Infinity`, qui refuserait toujours de remonter.
  const prevue = ici > 0 ? charge * (dessus / ici) : Number.POSITIVE_INFINITY;

  if (prevue >= CHARGE_BASSE) {
    // Le cran du dessus ne tiendrait pas : on reste, et l'on garde le calme
    // accumule plutot que de le remettre a zero — la machine va bien, ce n'est
    // pas elle qu'on met en cause, c'est la remontee.
    return { palier: courant, calmes: suite };
  }

  return { palier: courant - 1, calmes: 0 };
}
