import { create } from 'zustand';

/**
 * Reglages d'un serveur, propres a la personne.
 *
 * Ils ne sont pas dans la base, et c'est deliberé : couper les notifications
 * d'un serveur ou lui donner une teinte est un choix personnel, qui n'a aucune
 * raison de suivre le compte sur une autre machine ni d'etre visible des
 * autres. Un reglage partage aurait aussi demande une migration, une politique
 * d'ecriture et une colonne par idee.
 *
 * Le revers est assume : changer de machine les remet a zero. C'est le bon
 * compromis pour des preferences d'affichage — pas pour un role.
 */

export interface SpacePreferences {
  /** Aucune notification, aucun son, pour ce serveur. */
  muet: boolean;
  /** Ignore `@everyone` et `@here` sans couper les mentions nominatives. */
  ignorerGlobales: boolean;
  /** Ce qui compte comme non-lu dans la liste des serveurs. */
  notifications: 'tout' | 'mentions' | 'rien';
  /** Teinte de la pastille et des accents, ou `null` pour celle de l'application. */
  couleur: string | null;
  /** Replie les categories vides plutot que d'afficher un titre seul. */
  masquerCategoriesVides: boolean;
  /** Affiche les salons ou l'on n'a pas le droit d'ecrire. */
  masquerSalonsMuets: boolean;
  /** Joue un son quand quelqu'un entre en vocal dans ce serveur. */
  sonVocal: boolean;
  /** Montre les photos des personnes en vocal sous chaque salon. */
  apercuVocal: boolean;
}

export const DEFAUTS: SpacePreferences = {
  muet: false,
  ignorerGlobales: false,
  notifications: 'tout',
  couleur: null,
  masquerCategoriesVides: false,
  masquerSalonsMuets: false,
  sonVocal: true,
  apercuVocal: true,
};

const CLE = 'quality:espaces';

function charger(): Record<string, SpacePreferences> {
  try {
    const brut = localStorage.getItem(CLE);
    return brut ? (JSON.parse(brut) as Record<string, SpacePreferences>) : {};
  } catch {
    return {};
  }
}

interface Etat {
  parEspace: Record<string, SpacePreferences>;
  pour: (spaceId: string) => SpacePreferences;
  regler: <K extends keyof SpacePreferences>(
    spaceId: string,
    cle: K,
    valeur: SpacePreferences[K],
  ) => void;
  reinitialiser: (spaceId: string) => void;
}

export const useSpacePrefs = create<Etat>((set, get) => ({
  parEspace: charger(),

  pour: (spaceId) => ({ ...DEFAUTS, ...(get().parEspace[spaceId] ?? {}) }),

  regler: (spaceId, cle, valeur) => {
    const parEspace = {
      ...get().parEspace,
      [spaceId]: { ...DEFAUTS, ...(get().parEspace[spaceId] ?? {}), [cle]: valeur },
    };

    set({ parEspace });

    try {
      localStorage.setItem(CLE, JSON.stringify(parEspace));
    } catch {
      // Navigation privee : les reglages valent pour la session.
    }
  },

  reinitialiser: (spaceId) => {
    const parEspace = { ...get().parEspace };
    delete parEspace[spaceId];
    set({ parEspace });

    try {
      localStorage.setItem(CLE, JSON.stringify(parEspace));
    } catch {
      // Idem.
    }
  },
}));
