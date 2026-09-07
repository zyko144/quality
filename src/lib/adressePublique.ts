/**
 * L'adresse a mettre dans un lien qu'on donne a quelqu'un d'autre.
 *
 * Le defaut, tel qu'il a ete rapporte : « les liens d'invite marchent pas ».
 * Il avait deux causes, et il fallait les deux pour que rien ne marche.
 *
 * L'adresse etait celle de la fenetre
 * -----------------------------------
 * Les trois liens que l'application fabrique — inviter, pointer un salon,
 * pointer un message — etaient batis sur `window.location.origin`. Dans un
 * navigateur, c'est le bon. Dans l'application de bureau, la page est servie
 * par le moteur lui-meme : l'origine vaut `http://tauri.localhost`.
 *
 * Le bouton « Copier » rendait donc `http://tauri.localhost/invite/abc` — une
 * adresse qui ne mene nulle part ailleurs que sur la machine qui l'a produite,
 * et qui a pourtant l'air parfaitement normale. Celui qui l'envoyait ne voyait
 * rien ; celui qui la recevait tombait sur une page d'erreur de son navigateur.
 *
 * Le meme calcul existait deja pour la connexion Google, un peu plus bas dans
 * `session.ts`, avec la meme condition — mais pour lui seul. Il est ici
 * maintenant, et les quatre s'en servent.
 */

/**
 * Ou l'application vit sur le web.
 *
 * Le jour ou elle demenage, cette ligne change et les liens deja envoyes
 * cessent de fonctionner : c'est inevitable, et c'est la raison pour laquelle
 * elle est seule et nommee, plutot que recopiee a quatre endroits.
 *
 * A ne pas confondre avec `echows.vercel.app`, qui est le SITE de
 * presentation : il parle de l'application, il ne la sert pas. Une invitation
 * qui pointerait dessus ouvrirait une page de telechargement au lieu du
 * serveur qu'on voulait rejoindre.
 */
export const APPLICATION_WEB = 'https://echowebplayer.vercel.app';

/**
 * Vrai si cette origine peut etre donnee a quelqu'un d'autre.
 *
 * `tauri.localhost` est l'origine du moteur de l'application de bureau ;
 * `localhost` et `127.0.0.1` sont celles du developpement. Aucune des trois ne
 * mene quelque part depuis une autre machine.
 */
export function origineePartageable(origine: string): boolean {
  if (!origine.startsWith('http')) return false;

  return !/(^|\/\/|\.)(tauri\.localhost|localhost|127\.0\.0\.1)(:|\/|$)/.test(origine);
}

/** L'origine a utiliser dans un lien destine a autrui. */
export function origineePublique(): string {
  if (typeof window === 'undefined') return APPLICATION_WEB;

  const origine = window.location.origin;
  return origineePartageable(origine) ? origine.replace(/\/$/, '') : APPLICATION_WEB;
}

/** Le lien d'invitation d'un espace. */
export function lienDInvitation(code: string): string {
  return `${origineePublique()}/invite/${code}`;
}

/**
 * Le lien vers un salon ou un message.
 *
 * Le croisillon est voulu : ces deux-la vivent dans le fragment, pas dans le
 * chemin. Voir `lienDArrivee.ts`, qui lit les deux moities parce que c'est
 * ainsi qu'elles sont produites.
 */
export function lienInterne(genre: 'salon' | 'message', id: string): string {
  return `${origineePublique()}/#/${genre}/${id}`;
}
