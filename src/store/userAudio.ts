import { create } from 'zustand';

const STORAGE_KEY = 'quality:user-audio';

interface UserAudioState {
  volumes: Record<string, number>; // 0 to 200 (percentage)
  muted: Record<string, boolean>;

  getVolume: (userId: string) => number;
  isMuted: (userId: string) => boolean;
  setVolume: (userId: string, volume: number) => void;
  toggleMute: (userId: string) => void;
}

function loadStorage(): { volumes: Record<string, number>; muted: Record<string, boolean> } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { volumes: {}, muted: {} };
    const parsed = JSON.parse(raw);
    return {
      volumes: typeof parsed.volumes === 'object' && parsed.volumes !== null ? parsed.volumes : {},
      muted: typeof parsed.muted === 'object' && parsed.muted !== null ? parsed.muted : {},
    };
  } catch {
    return { volumes: {}, muted: {} };
  }
}

function saveStorage(state: { volumes: Record<string, number>; muted: Record<string, boolean> }) {
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
    muted: initial.muted,

    getVolume: (userId: string) => get().volumes[userId] ?? 100,

    isMuted: (userId: string) => get().muted[userId] ?? false,

    setVolume: (userId: string, volume: number) => {
      const clamped = Math.max(0, Math.min(200, Math.round(volume)));
      set((state) => {
        const nextVolumes = { ...state.volumes, [userId]: clamped };
        saveStorage({ volumes: nextVolumes, muted: state.muted });
        return { volumes: nextVolumes };
      });
    },

    toggleMute: (userId: string) => {
      set((state) => {
        const nextMuted = { ...state.muted, [userId]: !state.muted[userId] };
        saveStorage({ volumes: state.volumes, muted: nextMuted });
        return { muted: nextMuted };
      });
    },
  };
});
