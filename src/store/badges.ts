import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { UUID } from '@/types/db';

/**
 * Les badges, et qui les a.
 *
 * Ce qui fait la valeur d'un badge n'est pas son dessin, c'est de ne plus
 * pouvoir l'obtenir. « Parmi les cent premiers » ne veut rien dire tant que la
 * centieme place est libre, et tout dire une fois qu'elle est prise. La rarete
 * est donc portee par la base — `limite`, et un verrou qui empeche deux
 * personnes de prendre la meme place — et non par l'affichage.
 *
 * Le catalogue est public : un badge qu'on ne peut pas voir avant de l'obtenir
 * n'incite a rien, et c'est bien d'une course qu'il s'agit.
 */

export type FamilleBadge = 'soutien' | 'anciennete' | 'succes' | 'equipe' | 'evenement';

export interface Badge {
  cle: string;
  nom: string;
  description: string;
  famille: FamilleBadge;
  teinte: string;
  /** Nombre maximal d'attributions, ou `null` si illimite. */
  limite: number | null;
  rang: number;
}

export interface BadgeObtenu {
  badge_cle: string;
  /** Rang d'obtention : « 7e » vaut mieux que « parmi les cent premiers ». */
  position: number | null;
  obtenu_le: string;
}

/** Ce qu'on affiche pour chaque famille, et dans quel ordre. */
export const FAMILLES: { cle: FamilleBadge; titre: string; detail: string }[] = [
  {
    cle: 'soutien',
    titre: 'Soutien',
    detail:
      'Pour ceux qui etaient la avant les autres. Ces badges se ferment definitivement une fois la course terminee — personne ne pourra plus les obtenir.',
  },
  {
    cle: 'equipe',
    titre: 'Equipe',
    detail: 'Attribues a la main, a ceux qui construisent Echow.',
  },
  {
    cle: 'succes',
    titre: 'Succes',
    detail:
      'Obtenus en faisant quelque chose, et non en etant arrive tot. Ceux-la restent ouverts.',
  },
  {
    cle: 'anciennete',
    titre: 'Anciennete',
    detail: 'Le temps passe, simplement.',
  },
  {
    cle: 'evenement',
    titre: 'Evenements',
    detail: 'Lies a un moment precis. Ils ne reviennent pas.',
  },
];

interface EtatBadges {
  catalogue: Badge[];
  /** Ce que chacun possede, par identifiant de profil. */
  parProfil: Record<UUID, BadgeObtenu[]>;
  /** Combien de fois chaque badge a ete attribue. */
  compte: Record<string, number>;

  chargement: boolean;
  erreur: string | null;

  charger: () => Promise<void>;
  /** Tente d'obtenir un badge. Rend `true` si la course etait encore ouverte. */
  reclamer: (cle: string) => Promise<boolean>;
}

export const useBadges = create<EtatBadges>((set, get) => ({
  catalogue: [],
  parProfil: {},
  compte: {},
  chargement: false,
  erreur: null,

  charger: async () => {
    if (get().chargement) return;
    set({ chargement: true, erreur: null });

    const [cat, obtenus] = await Promise.all([
      supabase.from('badges').select('*').order('rang'),
      supabase.from('profil_badges').select('profil_id,badge_cle,position,obtenu_le'),
    ]);

    /*
     * L'absence de table n'est pas une erreur a montrer.
     *
     * La migration peut ne pas etre appliquee : l'application doit alors se
     * comporter comme si les badges n'existaient pas encore, plutot que
     * d'afficher un message que personne ne peut corriger.
     */
    if (cat.error) {
      set({ chargement: false, catalogue: [], erreur: null });
      return;
    }

    const parProfil: Record<UUID, BadgeObtenu[]> = {};
    const compte: Record<string, number> = {};

    for (const ligne of obtenus.data ?? []) {
      const liste = (parProfil[ligne.profil_id as UUID] ??= []);
      liste.push({
        badge_cle: ligne.badge_cle,
        position: ligne.position,
        obtenu_le: ligne.obtenu_le,
      });
      compte[ligne.badge_cle] = (compte[ligne.badge_cle] ?? 0) + 1;
    }

    set({
      catalogue: (cat.data ?? []) as Badge[],
      parProfil,
      compte,
      chargement: false,
    });
  },

  reclamer: async (cle) => {
    const { data, error } = await supabase.rpc('attribuer_badge', { cle_badge: cle });
    if (error) return false;

    // On recharge plutot que de deviner : la place obtenue vient de la base, et
    // c'est elle qui fait tout l'interet du badge.
    if (data === true) await get().charger();
    return data === true;
  },
}));

/**
 * Les badges de quelqu'un, du plus rare au plus commun.
 *
 * Le tri porte sur le rang du catalogue plutot que sur la date d'obtention :
 * une vitrine montre ce qu'on a de mieux, pas ce qu'on a eu en dernier.
 */
export function badgesDe(
  profilId: UUID | null | undefined,
  parProfil: Record<UUID, BadgeObtenu[]>,
  catalogue: Badge[],
): { badge: Badge; obtenu: BadgeObtenu }[] {
  if (!profilId) return [];

  const rang = new Map(catalogue.map((entree) => [entree.cle, entree]));

  return (parProfil[profilId] ?? [])
    .flatMap((obtenu) => {
      const badge = rang.get(obtenu.badge_cle);
      return badge ? [{ badge, obtenu }] : [];
    })
    .sort((a, b) => a.badge.rang - b.badge.rang);
}

/**
 * L'etat d'une course : combien de places, combien restent.
 *
 * `null` pour un badge sans limite — il n'y a pas de course, et afficher
 * « illimite » a cote d'une barre de progression serait un contresens.
 */
export function placesRestantes(badge: Badge, compte: Record<string, number>): number | null {
  if (badge.limite === null) return null;
  return Math.max(0, badge.limite - (compte[badge.cle] ?? 0));
}
