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
   * Seul le manque de puissance justifie de capturer moins.
   *
   * Une liaison etroite — `bandwidth` — se traite en baissant le debit, pas la
   * capture : le moteur le fait deja de son cote, et lui retirer des images en
   * plus abimerait le partage sans rien economiser la ou ca coince.
   */
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
