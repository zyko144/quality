import { create } from 'zustand';
import { useDevices, type MediaPreferences } from '@/store/devices';
import { useSession, type Preferences } from '@/store/session';
import { useRaccourcis, type Raccourci } from '@/store/raccourcis';

/**
 * Ce que les reglages valaient en s'ouvrant, et ce qu'ils valent maintenant.
 *
 * Les reglages s'appliquent toujours sur-le-champ, et ce n'est pas negociable :
 * on regle un micro en s'ecoutant, un theme en le voyant. Un formulaire qui
 * n'agirait qu'a l'enregistrement rendrait la moitie d'entre eux impossibles a
 * regler — on choisirait a l'aveugle, puis on verifierait.
 *
 * Ce qui manquait n'est donc pas le report des changements, mais leur RETOUR :
 * rien ne disait qu'on avait touche a quelque chose, et rien ne permettait de
 * revenir en arriere autrement qu'en se souvenant de ce qu'on avait change.
 * D'ou l'instantane pris a l'ouverture : il rend « annuler » possible, et
 * permet de dire, a tout moment, si l'on a modifie quoi que ce soit.
 *
 * Et l'on ne referme pas sans avoir tranche. C'est le seul moment ou insister a
 * du sens : partir en laissant des changements qu'on n'a pas vus, c'est
 * exactement ce qui fait dire « je n'ai rien change » quand quelque chose a
 * change.
 */

interface Instantane {
  media: MediaPreferences;
  preferences: Preferences;
  raccourcis: Raccourci[];
}

function prendre(): Instantane {
  return {
    media: { ...useDevices.getState().media },
    preferences: { ...useSession.getState().preferences },
    raccourcis: useRaccourcis.getState().liste.map((entree) => ({ ...entree })),
  };
}

/**
 * Compare deux instantanes.
 *
 * Par leur ecriture en texte, ce qui est grossier et suffit : ces trois objets
 * ne portent que des valeurs simples et des tableaux d'ordre stable. Une
 * comparaison champ a champ serait plus fine et devrait etre tenue a jour a
 * chaque reglage ajoute — c'est-a-dire oubliee un jour, et le bouton
 * « enregistrer » cesserait alors d'apparaitre pour ce reglage-la, sans bruit.
 */
function differe(a: Instantane, b: Instantane): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

interface EtatBrouillon {
  /** L'etat d'origine, ou `null` quand les reglages sont fermes. */
  depart: Instantane | null;
  /** Vrai des qu'un reglage a change depuis l'ouverture. */
  modifie: boolean;
  /**
   * Compteur d'appels d'attention.
   *
   * Il ne sert qu'a rejouer une animation : une valeur qui change est le seul
   * moyen sur de redeclencher la meme animation deux fois de suite.
   */
  insistance: number;

  ouvrir: () => void;
  fermer: () => void;
  verifier: () => void;
  enregistrer: () => void;
  annuler: () => void;
  /** Vrai si la fermeture doit etre retenue parce qu'il reste a trancher. */
  retientLaFermeture: () => boolean;
}

export const useBrouillon = create<EtatBrouillon>((set, get) => ({
  depart: null,
  modifie: false,
  insistance: 0,

  ouvrir: () => set({ depart: prendre(), modifie: false }),
  fermer: () => set({ depart: null, modifie: false }),

  verifier: () => {
    const { depart, modifie } = get();
    if (!depart) return;

    const maintenant = differe(depart, prendre());
    if (maintenant !== modifie) set({ modifie: maintenant });
  },

  enregistrer: () => {
    // Les valeurs sont deja posees et deja ecrites sur le disque : enregistrer
    // ne fait qu'accepter l'etat courant comme nouveau point de retour.
    set({ depart: prendre(), modifie: false });
  },

  annuler: () => {
    const depart = get().depart;
    if (!depart) return;

    /*
     * On repasse par les fonctions publiques, cle par cle.
     *
     * Reposer les objets d'un bloc serait plus court et ferait deux degats
     * silencieux : rien ne serait ecrit sur le disque, et les effets qui
     * accompagnent certains reglages — le volume des signaux sonores, le theme
     * applique a la racine du document — ne partiraient pas. On reviendrait a
     * l'ancien affichage avec les nouvelles couleurs.
     */
    const media = useDevices.getState().setMedia;
    for (const cle of Object.keys(depart.media) as (keyof MediaPreferences)[]) {
      media(cle, depart.media[cle]);
    }

    const preference = useSession.getState().setPreference;
    for (const cle of Object.keys(depart.preferences) as (keyof Preferences)[]) {
      preference(cle, depart.preferences[cle]);
    }

    const definir = useRaccourcis.getState().definir;
    for (const entree of depart.raccourcis) definir(entree.action, entree.combinaison);

    set({ modifie: false });
  },

  retientLaFermeture: () => {
    if (!get().modifie) return false;

    set((etat) => ({ insistance: etat.insistance + 1 }));
    return true;
  },
}));
