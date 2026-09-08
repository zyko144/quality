/**
 * Ce qu'on retient d'un compte Discord, et sous quelle forme.
 *
 * A part, et sans rien importer. Le module qui appelle Discord passe par le
 * client Supabase, lequel lit `import.meta.env` — une variable que le lanceur
 * de tests ne fournit pas. La regle serait donc restee inverifiable, alors que
 * c'est elle qui porte tous les cas qui abiment un profil : une banniere
 * absente, une image animee, un nom d'affichage separe du pseudo.
 */

/** Ce que `GET /users/@me` rend, reduit a ce dont on se sert. */
export interface CompteDiscord {
  id?: unknown;
  username?: unknown;
  global_name?: unknown;
  avatar?: unknown;
  banner?: unknown;
}

/**
 * L'adresse d'une image du reseau de diffusion de Discord.
 *
 * Une empreinte qui commence par `a_` designe une image animee, et Discord ne
 * la sert en mouvement qu'en `.gif` : demander `.png` rendrait une vignette
 * figee, ce qui donne l'impression que l'animation a ete perdue.
 */
function imageDiscord(genre: 'avatars' | 'banners', id: string, empreinte: string, taille: number): string {
  const extension = empreinte.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/${genre}/${id}/${empreinte}.${extension}?size=${taille}`;
}

/**
 * Ce qu'on veut ecrire dans le profil, d'apres la reponse de Discord.
 *
 * Rendu a part et sans effet de bord : c'est la seule partie qui decide, et
 * elle s'eprouve sans reseau ni session.
 */
export function profilDepuisDiscord(compte: CompteDiscord): {
  display_name?: string;
  avatar_url?: string;
  banner_url?: string;
} {
  const id = typeof compte.id === 'string' ? compte.id : null;
  if (!id) return {};

  const retour: { display_name?: string; avatar_url?: string; banner_url?: string } = {};

  /*
   * Le nom affiche : `global_name` d'abord.
   *
   * C'est le nom que Discord montre partout depuis qu'il a separe les deux —
   * « Noam », quand `username` vaut « noam_4412 ». Prendre `username` donnerait
   * un identifiant technique la ou l'on attend un nom.
   */
  const nom = typeof compte.global_name === 'string' && compte.global_name.trim()
    ? compte.global_name.trim()
    : typeof compte.username === 'string' && compte.username.trim()
      ? compte.username.trim()
      : null;
  if (nom) retour.display_name = nom.slice(0, 32);

  if (typeof compte.avatar === 'string' && compte.avatar) {
    retour.avatar_url = imageDiscord('avatars', id, compte.avatar, 256);
  }

  /*
   * La banniere n'existe que pour les comptes qui en ont posee une.
   *
   * `banner` vaut `null` pour tous les autres, et l'absence doit rester une
   * absence : ecrire une adresse vide effacerait la banniere que quelqu'un
   * aurait choisie dans Echow avant de relier son compte Discord.
   */
  if (typeof compte.banner === 'string' && compte.banner) {
    retour.banner_url = imageDiscord('banners', id, compte.banner, 1024);
  }

  return retour;
}
