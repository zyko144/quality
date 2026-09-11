import { origineePublique } from './adressePublique';

/**
 * Ramener l'application de bureau chez elle.
 *
 * Le defaut
 * ---------
 * Se connecter par Google ou Discord dans l'application de bureau faisait
 * quitter la fenetre pour le SITE. Le fournisseur renvoie vers Supabase, qui
 * renvoie vers l'adresse de retour — et celle-ci etait l'adresse publique,
 * `echowebplayer.vercel.app`. La fenetre de bureau affichait donc la version
 * web, chargee depuis Internet.
 *
 * Tout y paraissait normal, et rien de ce qui depend du bureau ne marchait.
 * Tauri n'accorde ses commandes qu'a l'application locale, et refusait tout
 * au site — « not allowed by ACL » : les boutons de la fenetre, le partage
 * d'ecran (`sources_partageables`), la recherche de mise a jour. Cette
 * derniere etant refusee elle aussi, aucune correction ne pouvait arriver par
 * ce chemin.
 *
 * Et un deploiement du site suffisait a achever la seance : les morceaux du
 * paquet charges a la demande changent de nom a chaque version, et la fenetre
 * reclamait ceux de la precedente — « Failed to fetch dynamically imported
 * module ».
 *
 * Deux protections
 * ----------------
 * L'application locale demande a revenir chez elle (`retourApresFournisseur`).
 * Et si elle se retrouve malgre tout sur le site — Supabase renvoie a son
 * adresse principale, le site, toute adresse de retour qu'il n'autorise pas —
 * le site la renvoie a l'application locale, session comprise
 * (`adresseDeRetour`).
 *
 * Ce fichier n'importe rien qui touche au reseau : les regles s'eprouvent sans
 * session ni navigateur.
 */

/** Ou vit l'application locale, selon le systeme. */
export function origineLocale(agent: string): string {
  // Tauri sert son contenu par un protocole a lui, que le moteur de rendu de
  // Windows ne sait pas utiliser : il y passe par une adresse en `http`.
  return /Mac/.test(agent) ? 'tauri://localhost' : 'http://tauri.localhost';
}

/**
 * Vrai quand la fenetre de bureau affiche le site au lieu de l'application.
 *
 * `https` suffit a le reconnaitre : l'application locale n'est jamais servie
 * ainsi — `http://tauri.localhost` sous Windows, `tauri://localhost` sur Mac,
 * `http://localhost` en developpement. Ce qui arrive en `https` dans la
 * fenetre vient d'Internet.
 *
 * Hors du bureau, jamais : le site ouvert dans un navigateur est chez lui, et
 * le renvoyer vers `tauri.localhost` le jetterait sur une page d'erreur.
 */
export function afficheLeSite(protocole: string, dansTauri: boolean): boolean {
  return dansTauri && protocole === 'https:';
}

/** Ce qu'il faut d'une session pour la rouvrir ailleurs. */
export interface SessionTransportable {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  provider_token?: string | null;
  provider_refresh_token?: string | null;
}

/**
 * L'adresse de l'application locale, avec de quoi y rouvrir la session.
 *
 * La session est dans le stockage du SITE, que l'application locale ne voit
 * pas : chaque origine a le sien. On la lui passe dans le fragment, sous la
 * forme exacte que Supabase emploie lui-meme au retour d'un fournisseur — le
 * client la reconnait a l'ouverture (`detectSessionInUrl`), sans rien de plus.
 *
 * Le fragment et non les parametres : il ne part jamais vers un serveur.
 *
 * Pas de `type` : `type=recovery` ferait croire a une reprise de mot de passe,
 * et l'application demanderait d'en choisir un nouveau.
 *
 * `provider_token` suit s'il existe : c'est avec lui que l'application reprend
 * la banniere Discord, et il ne passe qu'une fois.
 */
export function adresseDeRetour(origine: string, session: SessionTransportable | null): string {
  if (!session) return `${origine}/`;

  const champs = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in),
    token_type: session.token_type,
  });

  if (session.expires_at) champs.set('expires_at', String(session.expires_at));
  if (session.provider_token) champs.set('provider_token', session.provider_token);
  if (session.provider_refresh_token) {
    champs.set('provider_refresh_token', session.provider_refresh_token);
  }

  return `${origine}/#${champs.toString()}`;
}

/**
 * Ou revenir apres Google ou Discord.
 *
 * Sur le bureau, chez soi : l'origine de la fenetre, et non l'adresse
 * publique. Celle-ci ne vaut que pour ce qu'on donne a quelqu'un d'autre — un
 * lien d'invitation doit mener quelque part depuis une autre machine. Un
 * retour de connexion, lui, doit revenir dans CETTE fenetre.
 *
 * Supabase n'accepte cette adresse que si elle figure dans ses adresses de
 * retour autorisees. Sinon il renvoie a son adresse principale, le site, et
 * c'est `afficheLeSite` qui ramene la fenetre : le chemin est plus long, il
 * aboutit au meme endroit.
 */
export function retourApresFournisseur(): string {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return `${window.location.origin}/`;
  }
  return `${origineePublique()}/app`;
}
