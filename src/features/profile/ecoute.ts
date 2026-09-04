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
 * meme source. Rien a lier, rien a autoriser — et cela vaut aussi pour YouTube
 * dans un onglet ou un fichier local, pas seulement pour Spotify.
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
 * Le nom du lecteur, tel qu'on l'ecrit.
 *
 * Windows rend un identifiant d'application — `Spotify.exe`, `msedge` — qui
 * n'est pas fait pour etre lu. La table est courte a dessein : ce qui n'y est
 * pas s'affiche « Musique », ce qui reste vrai et n'invente rien.
 */
const LECTEURS: [RegExp, string][] = [
  [/spotify/i, 'Spotify'],
  [/deezer/i, 'Deezer'],
  [/apple\s*music|itunes/i, 'Apple Music'],
  [/tidal/i, 'Tidal'],
  [/soundcloud/i, 'SoundCloud'],
  [/chrome|msedge|firefox|brave|opera/i, 'le navigateur'],
  [/vlc|foobar|winamp|aimp|musicbee/i, 'un lecteur local'],
];

export function nomDuLecteur(source: string): string {
  for (const [motif, nom] of LECTEURS) if (motif.test(source)) return nom;
  return 'Musique';
}

/**
 * Ou mene le morceau, quand on clique.
 *
 * Windows ne donne AUCUN lien : il connait un titre et un artiste, pas une
 * adresse. On construit donc une recherche, ce qui tombe juste dans la quasi
 * totalite des cas et ne pretend rien savoir de plus.
 *
 * Vers Spotify quand c'est Spotify qui joue, parce que celui qui regarde a
 * toutes les chances de l'avoir aussi. Sinon on ne devine pas : une recherche
 * Spotify pour un morceau joue depuis un fichier local menerait souvent a
 * autre chose.
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
    return toile.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}
