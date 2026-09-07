/**
 * Ce qui figure au catalogue des badges, et ce qui n'y figure pas.
 *
 * Une seule regle, dans son propre fichier, pour deux raisons.
 *
 * Elle se perd autrement. C'est une ligne au milieu d'un `filter`, et le jour
 * ou quelqu'un ajoute un tri par famille ou par palier, rien ne rappellera
 * qu'un badge donne a la main doit rester en dehors — le defaut ne se verrait
 * que sur la page de quelqu'un d'autre.
 *
 * Et elle s'eprouve. Le magasin des badges parle a Supabase des son
 * chargement ; une regle posee la-dedans ne se verifie qu'en ouvrant un
 * navigateur avec une session. Ici, elle ne connait que deux booleens.
 */

/** Le strict necessaire pour trancher. */
export interface Catalogable {
  /** Ne peut pas etre obtenu : il se donne, par la cle de service. */
  reserve?: boolean;
  /** Ne figure pas au catalogue, meme s'il peut etre obtenu. */
  cache?: boolean;
}

/**
 * Vrai si ce badge a sa place dans la page « Badges ».
 *
 * On vient y voir ce qui existe ET ce qu'il reste a faire. Un badge qu'on ne
 * peut pas obtenir y pose une question dont la seule reponse honnete —
 * « celui-la, on ne peut pas l'avoir » — ne vaut pas d'etre affichee a tout le
 * monde.
 *
 * `reserve` porte l'essentiel, et c'est delibere : la colonne existe deja en
 * base, donc la regle vaut sans attendre aucune migration. `cache` couvre ce
 * que `reserve` ne couvre pas — un badge qu'on PEUT gagner mais qu'on prefere
 * ne pas annoncer.
 *
 * Une valeur absente vaut « non ». `cache` n'existe pas encore en base, et
 * `reserve` n'existait pas avant le C.E.O : traiter `undefined` comme « oui »
 * viderait le catalogue d'un coup, au premier lancement suivant une mise a
 * jour.
 *
 * Cela ne retire rien a personne : la rangee de trophees, en haut de la page,
 * montre a chacun ce qu'il porte — reserve ou non.
 */
export function auCatalogue(badge: Catalogable): boolean {
  return badge.cache !== true && badge.reserve !== true;
}
