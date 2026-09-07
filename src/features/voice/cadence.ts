/**
 * Combien d'images capturer, au vu de ce que l'encodeur arrive a sortir.
 *
 * Le probleme, en une phrase : rapatrier une image depuis la carte graphique
 * coute environ deux millisecondes en 1080p, et le moteur y ajoute la
 * conversion vers ce que l'encodeur sait lire. Capturer soixante images par
 * seconde quand l'encodeur n'en sort que vingt-cinq, c'est payer ce prix
 * trente-cinq fois par seconde pour des images que personne ne verra jamais.
 *
 * Ce n'est pas un reglage de qualite. Les images qui partent gardent leur
 * definition et leur debit ; on cesse seulement de fabriquer celles qui
 * seraient jetees. C'est exactement ce qu'on cherche : moins couter a celui qui
 * partage sans rien retirer a ceux qui regardent.
 *
 * Pourquoi cette decision vit seule
 * ---------------------------------
 * C'est une boucle de contre-reaction : ce qu'elle decide change la mesure sur
 * laquelle elle decidera ensuite. Une regle mal posee ne se trompe pas d'un
 * cran, elle s'effondre — on capture moins, donc l'encodeur sort moins, donc on
 * capture moins encore, jusqu'au diaporama. Ce genre de derive ne se voit pas
 * en lisant le code, seulement en la faisant tourner.
 */

/** Plancher absolu. En dessous, ce n'est plus un partage mais un diaporama. */
export const PLANCHER = 12;

/**
 * Plancher quand c'est la LIAISON qui coince, et non le processeur.
 *
 * Plus haut que le plancher absolu, et pour une raison de fond : une machine
 * qui n'encode pas assez vite ne peut rien y faire, tandis qu'une liaison
 * etroite se supporte tres bien a vingt-quatre images — c'est la cadence du
 * cinema. Descendre plus bas donnerait une saccade qu'on ne compenserait par
 * aucune nettete.
 */
export const PLANCHER_LIAISON = 24;

/**
 * Ce qu'il faut de bits a une image pour qu'on y lise quelque chose.
 *
 * Cent vingt kilobits, en ordre de grandeur pour du 1080p qui bouge. Ce n'est
 * pas un seuil de qualite fine, c'est la frontiere entre « une image » et
 * « des blocs » : en dessous, l'encodeur ne peut plus decrire les contours, et
 * le texte est la premiere chose qui disparait.
 *
 * C'est ce chiffre-la qu'il faut regarder, et non la cadence. Sous contrainte,
 * le moteur TIENT les soixante images — c'est ce qu'on lui demande avec
 * `maintain-framerate` — et retire des bits a chacune. La cadence emise reste
 * donc a soixante pendant que l'image devient illisible : elle ne dit rien du
 * probleme, et s'y fier n'aurait rien declenche.
 */
export const BITS_PAR_IMAGE = 120_000;

/**
 * Marge gardee au-dessus de ce que l'encodeur sort.
 *
 * Superieure a un, et c'est ce qui empeche l'effondrement : la cible reste
 * toujours au-dessus du constat, si bien qu'une baisse ne peut pas s'auto
 * entretenir. Elle laisse aussi de quoi remonter des que la machine respire.
 */
export const MARGE = 1.2;

/** De combien on remonte a chaque releve quand plus rien ne freine. */
export const PAS_DE_REMONTEE = 6;

export interface Constat {
  /** Images par seconde effectivement emises, telles que le moteur les compte. */
  images: number;
  /**
   * Ce qui retient le moteur : `cpu` s'il n'encode pas assez vite, `bandwidth`
   * si la liaison ne suit pas, `none` s'il ne se retient pas.
   */
  limite: string;

  /** Debit reellement emis, en kilobits par seconde. */
  kbps: number;
}

/**
 * La cadence a demander, ou `null` s'il n'y a rien a changer.
 *
 * `voulu` est le reglage de la personne : on ne le depasse jamais, il exprime
 * un choix et non une limite technique.
 */
export function ajuster(courante: number, voulu: number, constat: Constat): number | null {
  const cible = viser(courante, voulu, constat);

  /*
   * On ne bouge que pour un ecart qui compte.
   *
   * Chaque changement traverse le pont vers le systeme. Suivre le bruit de
   * mesure a une image pres coeterait plus que ce qu'on economise, et ferait
   * osciller la cadence sans que rien ne le justifie.
   */
  return Math.abs(cible - courante) >= 3 ? cible : null;
}

function viser(courante: number, voulu: number, constat: Constat): number {
  const borne = (valeur: number) => Math.min(voulu, Math.max(PLANCHER, Math.round(valeur)));

  /*
   * Une liaison etroite justifie aussi de capturer moins — et c'est nouveau.
   *
   * Le raisonnement precedent tenait en une phrase : « le moteur baisse deja
   * le debit de son cote, lui retirer des images n'economise rien la ou ca
   * coince ». La premiere moitie est vraie, la conclusion ne l'est pas.
   *
   * Sous contrainte, ce que fait le moteur depend de `degradationPreference`,
   * et nous lui demandons `maintain-framerate` pour les jeux : il TIENT les
   * soixante images et retire des bits a chacune. Les traces le montrent —
   * `limite: bandwidth` a 95, 134, 480 kilobits par seconde. Quatre-vingt-quinze
   * kilobits repartis sur soixante images font mille six cents bits par image :
   * il n'y a plus d'image, seulement des blocs. C'est exactement « quand ya
   * trop de moov la qual baisse de ouf ».
   *
   * On ne regarde donc PAS la cadence emise — elle reste a soixante, c'est tout
   * le probleme — mais ce que recoit chaque image. La cadence visee est celle
   * qui rendrait aux images de quoi etre lisibles, au debit qu'on a vraiment.
   *
   * On ne perd pas de la qualite, on la deplace : moins d'images, mais des
   * images ou l'ecriture se lit.
   */
  if (constat.limite === 'bandwidth') {
    if (constat.kbps <= 0) return courante;

    const tenables = (constat.kbps * 1000) / BITS_PAR_IMAGE;

    // Le plancher est plus haut que pour le processeur : une machine trop
    // lente ne peut rien y faire, tandis qu'une liaison etroite se supporte
    // tres bien a vingt-quatre images — c'est la cadence du cinema.
    return borne(Math.max(tenables, PLANCHER_LIAISON));
  }

  if (constat.limite !== 'cpu') {
    // Rien ne freine : on remonte vers ce qui a ete demande, par paliers.
    // D'un coup, on retomberait aussitot dans le meme mur.
    return borne(courante + PAS_DE_REMONTEE);
  }

  /*
   * Un constat a zero ne veut rien dire.
   *
   * C'est ce que rend le premier releve, avant qu'une seule image soit sortie.
   * S'y fier ramenerait la capture au plancher des la premiere seconde d'un
   * partage qui se porte tres bien.
   */
  if (constat.images <= 0) return courante;

  return borne(constat.images * MARGE);
}
