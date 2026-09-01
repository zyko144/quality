import { create } from 'zustand';
import { supabase, errorMessage } from '@/lib/supabase';
import type { UUID } from '@/types/db';

/**
 * Suggestions pour Quality, et leurs votes.
 *
 * Volontairement a part du magasin de discussion : une suggestion n'est pas un
 * message. Elle n'appartient a aucun salon, ne se repond pas, et vit aussi
 * longtemps que l'idee. Les meler obligerait a traiter partout un cas qui n'en
 * est pas un.
 */

export interface Suggestion {
  id: UUID;
  author_id: UUID;
  contenu: string;
  created_at: string;
  pour: number;
  contre: number;
  /** `true` pour, `false` contre, `null` si l'on n'a pas vote. */
  mon_vote: boolean | null;
}

interface EtatSuggestions {
  liste: Suggestion[];
  chargement: boolean;
  erreur: string | null;

  charger: () => Promise<void>;
  proposer: (contenu: string) => Promise<boolean>;
  voter: (id: UUID, pour: boolean) => Promise<void>;
  retirer: (id: UUID) => Promise<void>;
}

/** Bornes reprises de la contrainte de la table : refuser ici evite l'aller-retour. */
export const SUGGESTION_MIN = 8;
export const SUGGESTION_MAX = 600;

/**
 * La commande, ecrite une seule fois.
 *
 * Deux endroits la reconnaissent, et pour des raisons opposees : l'espace des
 * suggestions la retire quand on l'ecrit par habitude, le composeur des salons
 * la refuse en disant ou aller. Deux expressions regulieres se seraient
 * separees le jour ou l'une aurait accepte une majuscule que l'autre refuse.
 */
export const COMMANDE = /^\/suggestions?\b\s*/i;

export const useSuggestions = create<EtatSuggestions>((set, get) => ({
  liste: [],
  chargement: false,
  erreur: null,

  charger: async () => {
    set({ chargement: true, erreur: null });

    const { data, error } = await supabase.rpc('liste_suggestions');

    if (error) {
      set({ chargement: false, erreur: errorMessage(error) });
      return;
    }

    set({
      liste: (data ?? []) as Suggestion[],
      chargement: false,
    });
  },

  proposer: async (contenu) => {
    const propre = contenu.trim();
    if (propre.length < SUGGESTION_MIN || propre.length > SUGGESTION_MAX) return false;

    const { data: session } = await supabase.auth.getUser();
    const me = session.user?.id;
    if (!me) return false;

    const { error } = await supabase
      .from('suggestions')
      .insert({ author_id: me, contenu: propre });

    if (error) {
      set({ erreur: errorMessage(error) });
      return false;
    }

    await get().charger();
    return true;
  },

  voter: async (id, pour) => {
    const avant = get().liste;
    const courante = avant.find((entree) => entree.id === id);
    if (!courante) return;

    /*
     * Recliquer sur son propre vote le retire.
     *
     * C'est le geste qu'on tente pour annuler, et il n'y a pas de troisieme
     * bouton a chercher. `null` transmet cette intention a la base.
     */
    const suivant = courante.mon_vote === pour ? null : pour;

    // Applique tout de suite : un vote doit repondre au clic, et l'aller-retour
    // se voit sur une liste de vingt entrees.
    set({
      liste: avant.map((entree) => {
        if (entree.id !== id) return entree;

        const retirePour = entree.mon_vote === true ? 1 : 0;
        const retireContre = entree.mon_vote === false ? 1 : 0;

        return {
          ...entree,
          mon_vote: suivant,
          pour: entree.pour - retirePour + (suivant === true ? 1 : 0),
          contre: entree.contre - retireContre + (suivant === false ? 1 : 0),
        };
      }),
    });

    const { error } = await supabase.rpc('voter_suggestion', {
      p_suggestion: id,
      p_pour: suivant,
    });

    // La base a refuse : on remet ce qui etait affiche plutot que de laisser un
    // compte qui ne correspond a rien.
    if (error) set({ liste: avant, erreur: errorMessage(error) });
  },

  retirer: async (id) => {
    const avant = get().liste;
    set({ liste: avant.filter((entree) => entree.id !== id) });

    const { error } = await supabase.from('suggestions').delete().eq('id', id);
    if (error) set({ liste: avant, erreur: errorMessage(error) });
  },
}));
