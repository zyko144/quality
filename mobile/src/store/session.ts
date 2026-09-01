import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase, errorMessage } from '@/lib/supabase';
import type { Profile } from '@/types/db';

interface SessionState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, username: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const useSession = create<SessionState>((set, _get) => ({

  session: null,
  profile: null,
  loading: true,
  error: null,

  init: async () => {
    // Récupère la session existante
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const profile = await fetchProfile(session.user.id);
      set({ session, profile, loading: false });
    } else {
      set({ loading: false });
    }

    // Écoute les changements d'état d'auth
    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const profile = await fetchProfile(session.user.id);
        set({ session, profile });
      } else {
        set({ session: null, profile: null });
      }
    });
  },

  signIn: async (email, password) => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) set({ error: errorMessage(error) });
  },

  signUp: async (email, password, username) => {
    set({ error: null });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    if (error) set({ error: errorMessage(error) });
  },

  signInWithGoogle: async () => {
    set({ error: null });
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${origin}/` },
    });
    if (error) set({ error: errorMessage(error) });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, profile: null });
  },

  clearError: () => set({ error: null }),
}));

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, status, custom_status, accent')
    .eq('id', userId)
    .single();
  return data ?? null;
}
