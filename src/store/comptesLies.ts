import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { journal } from '@/lib/journal';
import { estFraiche } from '@/features/profile/ecoute';
import type { UUID } from '@/types/db';

/**
 * Les comptes lies, et ce qu'on ecoute ou diffuse.
 *
 * Deux notions voisines et volontairement separees.
 *
 * Un **compte lie** dure des annees : c'est « voici ou me trouver ailleurs ».
 * Une **activite** dure quelques minutes : c'est « voici ce que j'ecoute en ce
 * moment ». Les ranger ensemble obligerait a reecrire une ligne durable a
 * chaque changement de morceau, et l'on perdrait le compte lie le jour ou la
 * musique s'arrete.
 *
 * Lier et afficher sont aussi deux gestes differents. On peut vouloir la
 * synchronisation sans la vitrine — d'ou `visible`, decide service par service.
 */

export type Service = 'spotify' | 'twitch' | 'youtube' | 'roblox' | 'steam' | 'github';

export interface CompteLie {
  service: Service;
  identifiant: string;
  nom_affiche: string;
  visible: boolean;
}

export interface Activite {
  profil_id: UUID;
  genre: 'ecoute' | 'direct' | 'jeu';
  service: string;
  titre: string;
  detail: string | null;
  image_url: string | null;
  lien_url: string | null;
  debut_le: string | null;
  duree_ms: number | null;

  /**
   * Quand l'annonce a ete posee ou rafraichie.
   *
   * Sert a ecarter celles que personne n'a effacees : voir `FRAICHEUR`.
   * Facultatif parce qu'une base d'avant cette lecture n'en donnait pas, et
   * qu'une annonce sans date vaut mieux que pas d'annonce.
   */
  vu_le?: string;

  /**
   * Faux quand la base a refuse l'annonce. N'existe que chez soi.
   *
   * Ce champ repare une erreur que j'ai commise en corrigeant la precedente.
   * L'ecriture n'aboutissait pas — une contrainte de longueur — et l'interface
   * posait quand meme l'activite dans son etat local : on voyait donc sa
   * propre fiche a jour pendant que personne d'autre ne voyait rien.
   *
   * J'ai d'abord conditionne l'affichage a la reussite de l'ecriture. C'etait
   * pire : on ne voyait plus rien du tout, y compris ce qu'on ecoutait
   * VRAIMENT, et l'echec restait tout aussi muet.
   *
   * Les deux moities sont vraies separement : ce morceau joue bien — donc on
   * le montre — et il n'a atteint personne — donc on le dit. Les confondre
   * oblige a choisir entre mentir et se taire.
   */
  partagee?: boolean;
}

/**
 * Ce qu'on sait de chaque service : son nom, sa couleur, et ou mene un profil.
 *
 * L'adresse est un gabarit plutot qu'un lien enregistre : le service la change
 * parfois, et une adresse rangee en base vieillirait sans qu'on s'en apercoive.
 */
export const SERVICES: Record<
  Service,
  { nom: string; teinte: string; profil: (identifiant: string) => string }
> = {
  spotify: {
    nom: 'Spotify',
    teinte: '#1db954',
    profil: (id) => `https://open.spotify.com/user/${encodeURIComponent(id)}`,
  },
  twitch: {
    nom: 'Twitch',
    teinte: '#9146ff',
    profil: (id) => `https://twitch.tv/${encodeURIComponent(id)}`,
  },
  youtube: {
    nom: 'YouTube',
    teinte: '#ff0000',
    profil: (id) => `https://youtube.com/@${encodeURIComponent(id)}`,
  },
  roblox: {
    nom: 'Roblox',
    teinte: '#00a2ff',
    profil: (id) => `https://roblox.com/users/${encodeURIComponent(id)}/profile`,
  },
  steam: {
    nom: 'Steam',
    teinte: '#66c0f4',
    profil: (id) => `https://steamcommunity.com/id/${encodeURIComponent(id)}`,
  },
  github: {
    nom: 'GitHub',
    teinte: '#8b949e',
    profil: (id) => `https://github.com/${encodeURIComponent(id)}`,
  },
};

interface EtatComptes {
  /** Les comptes lies, par profil. Ne contient que ce qu'on a le droit de voir. */
  parProfil: Record<UUID, CompteLie[]>;
  /** L'activite du moment, par profil. */
  activites: Record<UUID, Activite>;

  charger: (profils: UUID[]) => Promise<void>;

  /**
   * Relit la seule activite de ces profils.
   *
   * `charger` lit aussi les comptes lies, qui ne changent pas d'une minute a
   * l'autre : les redemander a chaque tour ferait payer une deuxieme requete
   * pour une reponse toujours identique. Une fiche ouverte tourne en boucle,
   * et c'est la seule difference qui compte a ce rythme-la.
   */
  rafraichirActivites: (profils: UUID[]) => Promise<void>;
  lier: (service: Service, identifiant: string, nomAffiche: string) => Promise<boolean>;
  delier: (service: Service) => Promise<void>;
  basculerVisibilite: (service: Service, visible: boolean) => Promise<void>;
  /** Annonce ce qu'on ecoute ou diffuse, ou efface l'annonce. */
  annoncer: (activite: Omit<Activite, 'profil_id'> | null) => Promise<void>;
}

export const useComptesLies = create<EtatComptes>((set, get) => ({
  parProfil: {},
  activites: {},

  charger: async (profils) => {
    if (profils.length === 0) return;

    const [comptes, activites] = await Promise.all([
      supabase.from('comptes_lies').select('*').in('profil_id', profils),
      supabase.from('activites').select('*').in('profil_id', profils),
    ]);

    /*
     * L'absence de table n'est pas une erreur a montrer.
     *
     * La migration peut ne pas etre appliquee : l'application se comporte alors
     * comme si personne n'avait rien lie, ce qui est vrai.
     */
    if (comptes.error) return;

    const parProfil: Record<UUID, CompteLie[]> = { ...get().parProfil };
    for (const id of profils) parProfil[id] = [];

    for (const ligne of comptes.data ?? []) {
      (parProfil[ligne.profil_id as UUID] ??= []).push({
        service: ligne.service,
        identifiant: ligne.identifiant,
        nom_affiche: ligne.nom_affiche,
        visible: ligne.visible,
      });
    }

    /*
     * Les annonces oubliees sont ecartees a la LECTURE.
     *
     * Plutot qu'a l'ecriture : personne ne peut effacer la ligne de quelqu'un
     * d'autre — la politique ne le permet pas, et c'est bien ainsi — et celui
     * qui l'a laissee ne reviendra peut-etre pas de sitot. Le seul endroit ou
     * l'on puisse decider de ne pas y croire, c'est ici.
     */
    const suite: Record<UUID, Activite> = { ...get().activites };

    /*
     * On efface avant de reposer, pour que ce qui a disparu disparaisse.
     *
     * Fusionner sans effacer gardait une annonce arretee jusqu'a la fin de la
     * session. Une exception : ce qu'on a annonce SANS que la base le prenne.
     * Le serveur ne le rendra jamais — il ne l'a pas — et l'effacer reviendrait
     * a cacher a quelqu'un le morceau qu'il est en train d'ecouter.
     */
    for (const id of profils) {
      if (suite[id]?.partagee === false) continue;
      delete suite[id];
    }

    for (const ligne of activites.data ?? []) {
      const activite = ligne as Activite;
      if (estFraiche(activite.vu_le)) suite[activite.profil_id] = activite;
    }

    set({ parProfil, activites: suite });
  },

  lier: async (service, identifiant, nomAffiche) => {
    const moi = (await supabase.auth.getUser()).data.user?.id;
    if (!moi) return false;

    const { error } = await supabase.from('comptes_lies').upsert({
      profil_id: moi,
      service,
      identifiant: identifiant.trim(),
      nom_affiche: nomAffiche.trim() || identifiant.trim(),
      visible: true,
    });

    if (error) return false;
    await get().charger([moi as UUID]);
    return true;
  },

  delier: async (service) => {
    const moi = (await supabase.auth.getUser()).data.user?.id;
    if (!moi) return;

    await supabase.from('comptes_lies').delete().eq('profil_id', moi).eq('service', service);
    await get().charger([moi as UUID]);
  },

  basculerVisibilite: async (service, visible) => {
    const moi = (await supabase.auth.getUser()).data.user?.id;
    if (!moi) return;

    /*
     * L'affichage change tout de suite, la base suit.
     *
     * Un interrupteur qui attend un aller-retour parait casse : on le clique
     * deux fois, et l'on obtient l'inverse de ce qu'on voulait.
     */
    set((etat) => ({
      parProfil: {
        ...etat.parProfil,
        [moi as UUID]: (etat.parProfil[moi as UUID] ?? []).map((entree) =>
          entree.service === service ? { ...entree, visible } : entree,
        ),
      },
    }));

    await supabase
      .from('comptes_lies')
      .update({ visible })
      .eq('profil_id', moi)
      .eq('service', service);
  },

  rafraichirActivites: async (profils) => {
    if (profils.length === 0) return;

    const { data, error } = await supabase
      .from('activites')
      .select('*')
      .in('profil_id', profils);

    // Un tour rate n'efface rien : la fiche garde ce qu'elle montrait, et le
    // tour suivant corrigera. Vider sur une erreur reseau ferait clignoter la
    // carte a chaque hoquet.
    if (error) return;

    set((etat) => {
      const suite = { ...etat.activites };

      for (const id of profils) {
        if (suite[id]?.partagee === false) continue;
        delete suite[id];
      }

      for (const ligne of data ?? []) {
        const trouvee = ligne as Activite;
        if (estFraiche(trouvee.vu_le)) suite[trouvee.profil_id] = trouvee;
      }

      return { activites: suite };
    });
  },

  annoncer: async (activite) => {
    const moi = (await supabase.auth.getUser()).data.user?.id;
    if (!moi) return;

    if (!activite) {
      await supabase.from('activites').delete().eq('profil_id', moi);
      set((etat) => {
        const suite = { ...etat.activites };
        delete suite[moi as UUID];
        return { activites: suite };
      });
      return;
    }

    /*
     * Le resultat de l'ecriture est LU, et c'est tout le sujet.
     *
     * Il ne l'etait pas, et l'etat local etait pose juste apres, sans
     * condition. Une ecriture refusee par la base donnait donc exactement ce
     * qu'on voit quand elle reussit : sa propre fiche a jour. « Il n'y a que
     * moi qui vois le mien » — et c'etait litteralement vrai, la ligne
     * n'existait nulle part ailleurs que dans cette memoire-ci.
     *
     * La cause etait une contrainte de longueur sur `image_url` : cinq cents
     * caracteres pour une pochette qui en fait trois mille. Elle est corrigee.
     * Mais ce n'est pas la contrainte qui a rendu le defaut introuvable, c'est
     * ce `await` sans `error` — et celui-la se serait reproduit a la prochaine
     * colonne trop courte.
     */
    const { error } = await supabase
      .from('activites')
      .upsert({ ...activite, profil_id: moi, vu_le: new Date().toISOString() });

    if (error) {
      journal.erreur('interface', 'Activite refusee par la base', {
        code: error.code,
        message: error.message,
        // Ce qui pese, et donc ce qu'on soupconne en premier.
        pochette: activite.image_url?.length ?? 0,
      });
    }

    /*
     * On montre le morceau meme quand l'ecriture a echoue.
     *
     * Il joue : c'est vrai, et le cacher ne rend service a personne. Ce qui
     * n'est pas vrai, c'est que quelqu'un d'autre le voie — et cela, le
     * drapeau le dit. Voir `partagee`.
     */
    set((etat) => ({
      activites: {
        ...etat.activites,
        [moi as UUID]: { ...activite, profil_id: moi as UUID, partagee: !error },
      },
    }));
  },
}));

/**
 * Les comptes qu'on peut montrer de quelqu'un.
 *
 * La base filtre deja ce qu'on a le droit de lire ; ce filtre-ci porte sur
 * l'affichage de SON PROPRE profil, ou l'on voit aussi ce qu'on a choisi de
 * cacher — il ne faudrait pas le montrer aux autres par cette porte.
 */
export function comptesVisibles(comptes: CompteLie[] | undefined, soi: boolean): CompteLie[] {
  return (comptes ?? []).filter((entree) => soi || entree.visible);
}

/**
 * Ou en est le morceau, de zero a un, ou `null` si la question n'a pas de sens.
 *
 * Un direct n'a pas de duree : afficher une barre de progression pour un flux
 * en cours reviendrait a promettre une fin qu'on ne connait pas.
 */
export function avancement(activite: Activite, maintenant = Date.now()): number | null {
  if (!activite.debut_le || !activite.duree_ms) return null;

  const debut = Date.parse(activite.debut_le);
  if (Number.isNaN(debut)) return null;

  return Math.min(1, Math.max(0, (maintenant - debut) / activite.duree_ms));
}
