import { create } from 'zustand';

const STORAGE_KEY = 'quality:user-audio';

interface UserAudioState {
  volumes: Record<string, number>; // 0 a 200 (pourcentage)
  /**
   * Volume du partage d'ecran, par personne.
   *
   * Separe de la voix : on baisse un jeu bruyant sans baisser celui qui le
   * commente, et c'est meme le seul reglage qu'on cherche a ce moment-la.
   */
  streamVolumes: Record<string, number>;
  muted: Record<string, boolean>;

  getVolume: (userId: string) => number;
  getStreamVolume: (userId: string) => number;
  isMuted: (userId: string) => boolean;
  setVolume: (userId: string, volume: number) => void;
  setStreamVolume: (userId: string, volume: number) => void;
  toggleMute: (userId: string) => void;
}

interface Range {
  volumes: Record<string, number>;
  streamVolumes: Record<string, number>;
  muted: Record<string, boolean>;
}

function loadStorage(): Range {
  const vide: Range = { volumes: {}, streamVolumes: {}, muted: {} };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return vide;
    const parsed = JSON.parse(raw);
    const objet = (valeur: unknown) =>
      typeof valeur === 'object' && valeur !== null ? (valeur as Record<string, never>) : {};

    return {
      volumes: objet(parsed.volumes),
      // Absent des reglages enregistres avant l'existence de ce volume : le
      // defaut s'applique alors, comme pour quelqu'un qu'on n'a jamais regle.
      streamVolumes: objet(parsed.streamVolumes),
      muted: objet(parsed.muted),
    };
  } catch {
    return vide;
  }
}

function saveStorage(state: Range) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export const useUserAudio = create<UserAudioState>((set, get) => {
  const initial = loadStorage();

  return {
    volumes: initial.volumes,
    streamVolumes: initial.streamVolumes,
    muted: initial.muted,

    getVolume: (userId: string) => get().volumes[userId] ?? 100,

    /*
     * Le partage demarre a soixante-quinze plutot qu'a cent.
     *
     * Un jeu ou une video sont mixes bien plus fort qu'une voix au micro : a
     * volume egal, le partage couvre la personne qui le commente, et le premier
     * geste de tout le monde est de le baisser. Autant partir la ou l'on
     * arrive.
     */
    getStreamVolume: (userId: string) => get().streamVolumes[userId] ?? 75,

    isMuted: (userId: string) => get().muted[userId] ?? false,

    setVolume: (userId: string, volume: number) => {
      const clamped = Math.max(0, Math.min(200, Math.round(volume)));
      set((state) => {
        const nextVolumes = { ...state.volumes, [userId]: clamped };
        saveStorage({ ...state, volumes: nextVolumes });
        return { volumes: nextVolumes };
      });
    },

    setStreamVolume: (userId: string, volume: number) => {
      const clamped = Math.max(0, Math.min(200, Math.round(volume)));
      set((state) => {
        const nextStreamVolumes = { ...state.streamVolumes, [userId]: clamped };
        saveStorage({ ...state, streamVolumes: nextStreamVolumes });
        return { streamVolumes: nextStreamVolumes };
      });
    },

    toggleMute: (userId: string) => {
      set((state) => {
        const nextMuted = { ...state.muted, [userId]: !state.muted[userId] };
        saveStorage({ ...state, muted: nextMuted });
        return { muted: nextMuted };
      });
    },
  };
});


/**
 * Traduit une position de curseur en gain.
 *
 * Deux defauts se cachaient derriere « a un pour cent on entend fort ».
 *
 * Le premier etait arithmetique : le pourcentage etait multiplie tel quel par
 * le volume general, puis borne a un. `1 * 100` valant cent, borne a un, le
 * curseur ne faisait rien du tout sur toute sa course — sauf en dessous de
 * un pour cent, ou il tombait d'un coup. C'est exactement ce qui se
 * constatait.
 *
 * Le second est perceptif, et il aurait subsiste une fois le premier corrige.
 * L'oreille entend le volume de facon logarithmique : une echelle lineaire
 * donne un curseur ou les quatre-vingts pour cent du haut s'entendent a peine
 * et ou tout se joue dans les vingt du bas. La courbe ci-dessous repartit
 * l'effet sur toute la course.
 *
 * Le carre est le compromis usuel des tables de mixage : a mi-course on obtient
 * le quart de la puissance, soit environ douze decibels de moins — une baisse
 * franche, mais qui laisse de la place en dessous.
 *
 * Au-dela de cent, on amplifie, et l'amplification reste lineaire : doubler
 * doit doubler, sans quoi le haut de la course deviendrait inutilisable.
 */
export function gainDepuisPosition(position: number): number {
  const p = Math.max(0, Math.min(200, position));
  if (p <= 100) return (p / 100) ** 2;
  return 1 + (p - 100) / 100;
}
