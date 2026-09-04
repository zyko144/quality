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
 * Les services qui repondent d'eux-memes, et sous quel nom chez Supabase.
 *
 * Deux seulement, et c'est un choix assume plutot qu'un debut de liste.
 *
 * Chaque fournisseur ajoute ici coute une application a declarer chez lui, une
 * adresse de retour, un secret a poser dans le tableau de bord, et une chose de
 * plus a maintenir le jour ou il change ses regles. Un compte lie a la main
 * marche deja pour dire « voici ou me trouver » ; l'authentification n'ajoute
 * qu'une chose, la certitude que le compte est bien le sien.
 *
 * Cette certitude vaut le detour pour ces deux-la, parce qu'ils portent une
 * identite qu'on montre — un pseudo de chaine, un profil d'ecoute — et non une
 * simple adresse. Spotify a de plus une seconde raison : sa liaison permettra
 * de lire ce qu'on ecoute depuis le NAVIGATEUR, la ou `musique.rs` ne va pas —
 * Windows ne parle qu'a l'application de bureau.
 *
 * **YouTube** reste absent malgre les apparences : il passe par Google, qui
 * rend un nom et une adresse mais AUCUN identifiant de chaine. On saurait qui
 * est la personne sans savoir ou mene sa chaine, ce qui est exactement ce
 * qu'on cherchait. **Steam** et **Roblox** n'existent pas comme fournisseurs.
 *
 * Pour ceux-la, la saisie a la main reste proposee, et l'ecran le dit.
 */
export const FOURNISSEURS: Partial<Record<Service, 'spotify' | 'twitch'>> = {
  spotify: 'spotify',
  twitch: 'twitch',
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
    // Le pseudo Twitch EST l'adresse : `twitch.tv/<pseudo>`. Rien a separer.
    const pseudo = premier('nickname', 'preferred_username', 'user_name', 'name');
    return pseudo ? { identifiant: pseudo, nom: pseudo } : null;
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
