import { create } from 'zustand';

/**
 * Raccourcis vocaux, choisis par chacun.
 *
 * Les combinaisons etaient fixees dans le code. Cela suffit tant qu'elles ne
 * genent personne — mais `Ctrl+Maj+M` est deja pris par plusieurs jeux, et
 * quelqu'un qui parle en jouant n'a aucun moyen de contourner le conflit.
 *
 * S'y ajoute une action qui n'existait pas et qui ne peut pas etre une bascule :
 * parler en maintenant une touche. Elle demande de suivre l'enfoncement et le
 * relachement, la ou tout le reste se contente d'une pression.
 */

export type ActionVocale =
  | 'micro'
  | 'sourdine'
  | 'camera'
  | 'partage'
  | 'quitter'
  | 'pousser-pour-parler'
  | 'pousser-pour-couper';

/**
 * Une combinaison, decrite par ce que le navigateur nous donne.
 *
 * `code` plutot que `key` : il designe la touche physique et ne change pas
 * avec la disposition du clavier. Quelqu'un qui choisit la touche a cote du
 * A en AZERTY doit retrouver la meme touche, pas la lettre qu'elle produit
 * ailleurs.
 */
export interface Combinaison {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface Raccourci {
  action: ActionVocale;
  libelle: string;
  detail?: string;
  combinaison: Combinaison | null;
}

const K = (code: string, ctrl = false, shift = false, alt = false): Combinaison => ({
  code,
  ctrl,
  shift,
  alt,
});

/** Ce qui vaut tant que personne n'a rien change. */
const DEFAUTS: Raccourci[] = [
  {
    action: 'micro',
    libelle: 'Couper ou reactiver le micro',
    combinaison: K('KeyM', true, true),
  },
  {
    action: 'sourdine',
    libelle: 'Couper ou reactiver le son',
    combinaison: K('KeyD', true, true),
  },
  {
    action: 'pousser-pour-parler',
    // Le nom usuel plutot qu'une paraphrase : c'est celui que les gens
    // emploient entre eux, et celui qu'ils cherchent dans une liste.
    libelle: 'Push-to-talk — parler en maintenant',
    detail:
      'Le micro s’ouvre tant que la touche est enfoncee, et se referme des qu’on la lache. Aucun raccourci par defaut : la touche depend trop de ce qu’on fait a cote.',
    combinaison: null,
  },
  {
    action: 'pousser-pour-couper',
    libelle: 'Push-to-mute — se taire en maintenant',
    detail:
      'L’inverse du precedent : le micro se ferme tant que la touche est enfoncee. Utile quand on parle la plupart du temps et qu’on veut se taire un instant — tousser, repondre a cote. Aucun raccourci par defaut.',
    combinaison: null,
  },
  {
    action: 'camera',
    libelle: 'Allumer ou eteindre la camera',
    combinaison: K('KeyV', true, true),
  },
  {
    action: 'partage',
    libelle: 'Partager ou arreter l’ecran',
    combinaison: K('KeyS', true, true),
  },
  {
    action: 'quitter',
    libelle: 'Quitter le salon vocal',
    combinaison: K('KeyH', true, true),
  },
];

const CLE = 'quality:raccourcis';

function charger(): Raccourci[] {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return DEFAUTS;

    const ranges = JSON.parse(brut) as Partial<Record<ActionVocale, Combinaison | null>>;

    // On repart des defauts et l'on n'applique que ce qui a ete change : une
    // action ajoutee plus tard apparait alors avec son raccourci, au lieu de
    // manquer parce qu'elle n'etait pas dans le fichier enregistre.
    return DEFAUTS.map((entree) =>
      entree.action in ranges
        ? { ...entree, combinaison: ranges[entree.action] ?? null }
        : entree,
    );
  } catch {
    return DEFAUTS;
  }
}

/** Le texte qu'on lit sur une touche. */
export function ecrire(combinaison: Combinaison | null): string {
  if (!combinaison) return 'Aucun';

  const parts: string[] = [];
  if (combinaison.ctrl) parts.push('Ctrl');
  if (combinaison.shift) parts.push('Maj');
  if (combinaison.alt) parts.push('Alt');

  parts.push(nommer(combinaison.code));
  return parts.join(' + ');
}

/**
 * Le nom lisible d'une touche physique.
 *
 * `KeyM` ne veut rien dire pour qui lit un reglage, et `Space` non plus. Les
 * cas non prevus tombent sur le code brut : mieux vaut un nom technique qu'une
 * case vide devant une touche qui fonctionne.
 */
function nommer(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Pave ${code.slice(6)}`;

  const noms: Record<string, string> = {
    // Les boutons de souris portent le nom qu'on leur donne dans les jeux :
    // « molette » et « pouce », pas « bouton 4 ».
    Souris3: 'Clic molette',
    Souris4: 'Souris pouce 1',
    Souris5: 'Souris pouce 2',
    Space: 'Espace',
    Enter: 'Entree',
    Tab: 'Tab',
    Backquote: '²',
    ArrowUp: 'Haut',
    ArrowDown: 'Bas',
    ArrowLeft: 'Gauche',
    ArrowRight: 'Droite',
    ControlLeft: 'Ctrl gauche',
    ControlRight: 'Ctrl droit',
    ShiftLeft: 'Maj gauche',
    ShiftRight: 'Maj droit',
    AltLeft: 'Alt',
    AltRight: 'Alt Gr',
  };

  return noms[code] ?? code;
}

/** Vrai si l'evenement correspond a la combinaison. */
export function correspond(event: KeyboardEvent, combinaison: Combinaison | null): boolean {
  if (!combinaison) return false;

  return (
    event.code === combinaison.code &&
    event.ctrlKey === combinaison.ctrl &&
    event.shiftKey === combinaison.shift &&
    event.altKey === combinaison.alt
  );
}

/**
 * Le code d'un bouton de souris, ou `null` si on ne l'accepte pas.
 *
 * Le navigateur numerote ses boutons autrement que Windows : 1 pour la molette,
 * 3 et 4 pour le pouce. On les ramene a des noms qui parlent — ceux que les
 * jeux emploient — et l'on refuse gauche et droit, qu'on ne doit jamais
 * pouvoir poser sur une action.
 */
export function codeSouris(bouton: number): string | null {
  if (bouton === 1) return 'Souris3';
  if (bouton === 3) return 'Souris4';
  if (bouton === 4) return 'Souris5';
  return null;
}

/** Vrai si la combinaison porte sur un bouton de souris. */
export function estSouris(combinaison: Combinaison | null): boolean {
  return combinaison !== null && combinaison.code.startsWith('Souris');
}

interface EtatRaccourcis {
  liste: Raccourci[];
  pour: (action: ActionVocale) => Combinaison | null;
  definir: (action: ActionVocale, combinaison: Combinaison | null) => void;
  reinitialiser: () => void;
  /** L'action deja prise par cette combinaison, s'il y en a une. */
  conflit: (action: ActionVocale, combinaison: Combinaison) => Raccourci | null;
}

export const useRaccourcis = create<EtatRaccourcis>((set, get) => ({
  liste: charger(),

  pour: (action) => get().liste.find((entree) => entree.action === action)?.combinaison ?? null,

  conflit: (action, combinaison) =>
    get().liste.find(
      (entree) =>
        entree.action !== action &&
        entree.combinaison !== null &&
        entree.combinaison.code === combinaison.code &&
        entree.combinaison.ctrl === combinaison.ctrl &&
        entree.combinaison.shift === combinaison.shift &&
        entree.combinaison.alt === combinaison.alt,
    ) ?? null,

  definir: (action, combinaison) => {
    /*
     * Poser une combinaison libere celle qu'elle occupait.
     *
     * Deux actions sur la meme touche donneraient les deux a chaque pression,
     * ou l'une des deux selon l'ordre du parcours — un comportement qu'on ne
     * peut ni prevoir ni expliquer. Mieux vaut retirer l'ancienne et le dire.
     */
    const liste = get().liste.map((entree) => {
      if (entree.action === action) return { ...entree, combinaison };

      const prise =
        combinaison !== null &&
        entree.combinaison !== null &&
        entree.combinaison.code === combinaison.code &&
        entree.combinaison.ctrl === combinaison.ctrl &&
        entree.combinaison.shift === combinaison.shift &&
        entree.combinaison.alt === combinaison.alt;

      return prise ? { ...entree, combinaison: null } : entree;
    });

    set({ liste });
    enregistrer(liste);
  },

  reinitialiser: () => {
    set({ liste: DEFAUTS });
    try {
      localStorage.removeItem(CLE);
    } catch {
      // Navigation privee : les defauts valent pour la session.
    }
  },
}));

function enregistrer(liste: Raccourci[]): void {
  try {
    const ranges: Partial<Record<ActionVocale, Combinaison | null>> = {};
    for (const entree of liste) ranges[entree.action] = entree.combinaison;
    localStorage.setItem(CLE, JSON.stringify(ranges));
  } catch {
    // Idem : le reglage vaut pour la session en cours.
  }
}
