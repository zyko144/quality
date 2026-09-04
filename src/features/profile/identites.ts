/**
 * Ce qu'un service repond quand on lui demande qui l'on est.
 *
 * Ce fichier ne touche a RIEN. Pas de reseau, pas de session, pas de Supabase —
 * seulement un type, qui disparait a la compilation. C'est ce qui permet de le
 * mettre a l'epreuve sans navigateur ni compte, et c'est la moitie du sujet :
 * le defaut qu'on cherche a eviter ici est silencieux, et ne se voit qu'en
 * cliquant sur le profil de quelqu'un d'autre, un jour ou personne ne le
 * signale.
 *
 * Les allers-retours avec le service vivent dans `liaisonOAuth.ts`.
 */

import type { Service } from '@/store/comptesLies';

/**
 * Les services qui savent repondre d'eux-memes, et sous quel nom.
 *
 * Trois seulement, et l'absence des autres est un choix, pas un oubli :
 *
 * - **YouTube** passe par Google, qui rend un nom et une adresse mais AUCUN
 *   identifiant de chaine. On saurait qui est la personne sans savoir ou mene
 *   sa chaine — ce qui est exactement ce qu'on cherchait.
 * - **Steam** et **Roblox** n'existent pas comme fournisseurs chez Supabase.
 *
 * Pour ceux-la, la saisie a la main reste la seule voie, et elle reste
 * proposee. Mieux vaut deux facons honnetes qu'une seule qui ment sur la
 * moitie des cas.
 */
export const FOURNISSEURS: Partial<Record<Service, 'twitch' | 'spotify' | 'github'>> = {
  twitch: 'twitch',
  spotify: 'spotify',
  github: 'github',
};

/** Vrai si ce service sait s'authentifier tout seul. */
export function seLiePaeLuiMeme(service: Service): boolean {
  return service in FOURNISSEURS;
}

/**
 * Ce qu'une identite rendue par un service apprend sur le compte.
 *
 * Deux champs distincts, et les confondre casse le lien : `identifiant` sert a
 * BATIR l'adresse du profil, `nom` sert a l'AFFICHER. Chez Spotify les deux
 * different toujours — l'adresse veut un identifiant opaque, la personne veut
 * lire son nom — et se tromper donne un lien qui mene a une page inexistante
 * sous un nom parfaitement correct.
 */
export interface Trouvaille {
  identifiant: string;
  nom: string;
}

/** Ce qu'une identite Supabase porte, du peu qu'on en utilise. */
export interface Identite {
  provider: string;
  id?: string;
  identity_data?: Record<string, unknown> | null;
}

function texte(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.trim().length > 0 ? valeur.trim() : null;
}

/**
 * Tire l'identifiant et le nom d'une identite, service par service.
 *
 * Chaque fournisseur range ces informations sous un nom different, et aucun ne
 * garantit un champ en particulier. D'ou les listes de repli : on prend le
 * premier champ present, et l'on rend `null` plutot que d'inventer si aucun ne
 * l'est — un compte lie faux est pire qu'un compte lie absent.
 */
export function lireIdentite(service: Service, identite: Identite): Trouvaille | null {
  const donnees = identite.identity_data ?? {};

  const premier = (...cles: string[]): string | null => {
    for (const cle of cles) {
      const valeur = texte(donnees[cle]);
      if (valeur) return valeur;
    }
    return null;
  };

  if (service === 'twitch') {
    // Le pseudo Twitch EST l'adresse : `twitch.tv/<pseudo>`.
    const pseudo = premier('nickname', 'preferred_username', 'user_name', 'name');
    return pseudo ? { identifiant: pseudo, nom: pseudo } : null;
  }

  if (service === 'github') {
    const pseudo = premier('user_name', 'preferred_username', 'nickname');
    return pseudo ? { identifiant: pseudo, nom: premier('name') ?? pseudo } : null;
  }

  if (service === 'spotify') {
    /*
     * Spotify separe les deux, et c'est le seul a le faire.
     *
     * L'adresse d'un profil veut l'identifiant opaque du compte ; la personne,
     * elle, veut lire son nom d'affichage. Prendre le nom pour l'adresse donne
     * un lien mort sous un libelle parfaitement juste — le genre de defaut
     * qu'on ne remarque qu'en cliquant.
     */
    const id = premier('provider_id', 'sub') ?? texte(identite.id);
    if (!id) return null;

    return { identifiant: id, nom: premier('name', 'full_name', 'display_name') ?? id };
  }

  return null;
}
