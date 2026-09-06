/**
 * Ce qu'on ecoute, annonce sur son profil.
 *
 * Pourquoi pas l'API de Spotify
 * -----------------------------
 * Elle demanderait une liaison OAuth : compte developpeur, adresse de retour
 * declaree, secret cote serveur, configuration a tenir chez l'hebergeur.
 * Beaucoup de plomberie pour un titre et une pochette — et cette voie a ete
 * essayee, puis abandonnee comme trop couteuse a mettre en place.
 *
 * Windows sait deja tout cela : chaque lecteur declare sa lecture au systeme,
 * pour que les touches multimedia du clavier fonctionnent. `musique.rs` lit la
 * meme source. Rien a lier, rien a autoriser.
 *
 * Seul SPOTIFY est retenu, et le filtre est pose cote natif — voir
 * `est_spotify`. Windows dirait aussi ce que joue un onglet de navigateur, un
 * jeu ou un appel en cours : « ce que j'ecoute » designe sa musique, pas le son
 * que fait son ordinateur. Une publicite ou un extrait de video n'ont rien a
 * faire sur une fiche, et diraient parfois quelque chose qu'on n'a pas choisi
 * de dire.
 *
 * Ce fichier ne DECIDE de rien
 * ----------------------------
 * Il ne lit que si le reglage est actif, et il ne publie que ce qui a change.
 * La regle vit ici, seule, parce qu'une annonce de trop est difficile a
 * reprendre : ce qu'on a dit aux autres a deja ete vu.
 */

import type { Activite } from '@/store/comptesLies';

/** Ce que la partie native rend. */
export interface Lecture {
  titre: string;
  artiste: string;
  album: string;
  source: string;
  joue: boolean;
  position_ms: number;
  duree_ms: number;
  /** Vrai si une pochette existe. Elle se demande a part, au changement. */
  a_une_pochette: boolean;
}

/**
 * Cadence de relecture, en millisecondes.
 *
 * Dix secondes. Assez rapide pour que le changement de morceau se voie pendant
 * qu'il passe, assez lent pour ne rien couter : la lecture est locale, c'est
 * l'ANNONCE qui coute, et elle ne part qu'au changement de titre.
 */
export const CADENCE_LECTURE = 10_000;

/**
 * Le nom du service, tel qu'on l'ecrit.
 *
 * Une seule valeur possible : la partie native ne rend que des seances Spotify.
 * La fonction reste plutot que d'ecrire « Spotify » en dur a l'affichage —
 * c'est ici qu'on regarderait le jour ou un second lecteur serait accepte, et
 * un litteral disperse dans l'interface ne se retrouve pas.
 */
export function nomDuLecteur(source: string): string {
  return /spotify/i.test(source) ? 'Spotify' : 'Musique';
}

/**
 * Ou mene le morceau, quand on clique.
 *
 * Windows ne donne AUCUN lien : il connait un titre et un artiste, pas une
 * adresse. On construit donc une recherche, ce qui tombe juste dans la quasi
 * totalite des cas et ne pretend rien savoir de plus.
 *
 * Vers Spotify, puisque c'est Spotify qui joue — et que celui qui regarde a
 * toutes les chances de l'avoir aussi. La verification du service reste : la
 * partie native pourrait un jour en accepter un autre, et une recherche
 * Spotify pour un morceau venu d'ailleurs menerait souvent a autre chose.
 */
export function lienDuMorceau(lecture: Lecture): string | null {
  const requete = `${lecture.artiste} ${lecture.titre}`.trim();
  if (!requete) return null;

  if (/spotify/i.test(lecture.source)) {
    return `https://open.spotify.com/search/${encodeURIComponent(requete)}`;
  }

  return null;
}

/**
 * Vrai si ces deux lectures parlent du meme morceau.
 *
 * La position ne compte PAS, et c'est tout l'interet : elle change a chaque
 * releve, et s'en servir ferait une ecriture toutes les dix secondes par
 * personne — exactement le genre de depense qui ne se voit que sur une facture.
 * Le titre et l'artiste suffisent a dire « c'est encore le meme ».
 */
export function memeMorceau(a: Lecture | null, b: Lecture | null): boolean {
  if (a === null || b === null) return a === b;
  return a.titre === b.titre && a.artiste === b.artiste && a.joue === b.joue;
}

/**
 * Ce qu'on publie, a partir de ce que Windows a rendu.
 *
 * `debut_le` est calcule plutot que releve : on connait la position dans le
 * morceau, donc l'instant ou il a commence. Cela permet a celui qui regarde de
 * voir la barre AVANCER, sans qu'on ait a republier quoi que ce soit — c'est
 * son horloge qui fait le travail, pas notre reseau.
 */
export function versActivite(
  lecture: Lecture,
  pochette: string | null,
): Omit<Activite, 'profil_id'> {
  return {
    genre: 'ecoute',
    service: nomDuLecteur(lecture.source),
    titre: lecture.titre,
    detail: lecture.artiste || lecture.album || null,
    image_url: pochette,
    lien_url: lienDuMorceau(lecture),
    debut_le: new Date(Date.now() - Math.max(0, lecture.position_ms)).toISOString(),
    duree_ms: lecture.duree_ms > 0 ? lecture.duree_ms : null,
  };
}

/**
 * Taille maximale d'une pochette, en caracteres.
 *
 * Tenue des DEUX cotes : ici, et par la contrainte `activites_image_url_check`
 * en base. Une seule des deux ne suffit pas — la base doit se defendre seule,
 * et le client doit savoir ce qu'elle refusera pour ne pas y perdre l'annonce
 * entiere. Les deux nombres n'avaient jamais ete confrontes, et c'est
 * precisement ce qui a rendu ce defaut invisible : cinq cents d'un cote, trois
 * mille de l'autre.
 */
export const POCHETTE_MAX = 12_000;

/**
 * Reduit la pochette avant de l'envoyer.
 *
 * Windows la rend telle que le lecteur l'a fournie : deux cent vingt-cinq
 * kilo-octets pour un morceau mesure. Rangee ainsi a chaque changement de
 * titre, elle partirait dans la base, dans le direct, et vers chaque personne
 * qui ouvre la fiche — pour une vignette affichee en quarante-huit pixels.
 *
 * Soixante-douze pixels et une qualite de 0,7 donnent quelques kilo-octets.
 * C'est le meme raisonnement que le cache d'un an pose sur les images
 * envoyees : ce qui n'est pas transmis ne coute rien a personne.
 *
 * Rend `null` plutot que l'original en cas d'echec : une pochette manquante est
 * un detail, une pochette de deux cents kilo-octets est une depense.
 *
 * Rend `null` AUSSI quand le resultat depasse `POCHETTE_MAX`. C'est le
 * garde-fou qui manquait : la colonne n'en acceptait que cinq cents, chaque
 * annonce portant une pochette etait rejetee sans un mot, et l'on perdait
 * l'annonce entiere pour une vignette de quarante-huit pixels.
 */
export async function reduirePochette(donnees: string, cote = 72): Promise<string | null> {
  if (!donnees.startsWith('data:image/')) return null;

  try {
    const image = new Image();
    image.src = donnees;
    await image.decode();

    const toile = document.createElement('canvas');
    toile.width = cote;
    toile.height = cote;

    const pinceau = toile.getContext('2d');
    if (!pinceau) return null;

    pinceau.drawImage(image, 0, 0, cote, cote);

    const reduite = toile.toDataURL('image/jpeg', 0.7);

    /*
     * Trop grosse : on la laisse tomber, on ne perd pas l'annonce.
     *
     * L'ordre des deux importe. Envoyer une pochette hors limite fait rejeter
     * la LIGNE, donc le titre, l'artiste et le lien avec elle — et c'est
     * exactement ce qui s'est passe. Le morceau vaut mieux que sa vignette.
     */
    return reduite.length <= POCHETTE_MAX ? reduite : null;
  } catch {
    return null;
  }
}

/**
 * Au-dela, une annonce n'est plus tenue pour vraie.
 *
 * L'effacement se fait au depart, par `beforeunload`. Il ne part pas toujours :
 * une application fermee net, une machine qui s'eteint, un onglet tue par le
 * systeme. La ligne reste alors telle quelle, et l'on apparait « en train
 * d'ecouter » pour toujours — le defaut miroir de celui ou personne ne voyait
 * rien, et tout aussi difficile a decrire.
 *
 * Une demi-heure, pas moins : l'annonce n'est rafraichie qu'au CHANGEMENT de
 * morceau, jamais pendant. Un morceau long, un album qu'on laisse tourner, une
 * pause de dix minutes — tout cela laisse `vu_le` vieillir sans que l'annonce
 * cesse d'etre vraie. Le seuil ecarte l'oubli, pas la lenteur.
 */
export const FRAICHEUR = 30 * 60 * 1000;

/**
 * Vrai si l'annonce est assez recente pour etre montree.
 *
 * Une date absente ou illisible passe : une base d'avant cette lecture n'en
 * donnait pas, et traiter son absence comme une peremption effacerait tout le
 * monde d'un coup au premier lancement suivant la mise a jour.
 */
export function estFraiche(vu_le: string | null | undefined, maintenant = Date.now()): boolean {
  if (!vu_le) return true;

  const vu = Date.parse(vu_le);
  if (Number.isNaN(vu)) return true;

  return maintenant - vu <= FRAICHEUR;
}
