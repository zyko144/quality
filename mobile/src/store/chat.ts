import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Space, Channel, Message, Profile, UUID } from '@/types/db';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface ChatState {
  spaces: Space[];
  channels: Channel[];
  messages: Message[];
  profiles: Record<UUID, Profile>;

  activeSpaceId: UUID | null;
  activeChannelId: UUID | null;

  loading: boolean;
  sendingMessage: boolean;

  loadSpaces: (userId: UUID) => Promise<void>;
  selectSpace: (spaceId: UUID) => Promise<void>;
  selectChannel: (channelId: UUID) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  subscribeMessages: (channelId: UUID) => () => void;
}

let messagesSub: RealtimeChannel | null = null;

export const useChat = create<ChatState>((set, get) => ({
  spaces: [],
  channels: [],
  messages: [],
  profiles: {},
  activeSpaceId: null,
  activeChannelId: null,
  loading: false,
  sendingMessage: false,

  loadSpaces: async (userId) => {
    set({ loading: true });

    const { data: members } = await supabase
      .from('space_members')
      .select('space_id')
      .eq('user_id', userId);

    if (!members) { set({ loading: false }); return; }

    const spaceIds = members.map((m) => m.space_id as UUID);

    const { data: spaces } = await supabase
      .from('spaces')
      .select('id, name, slug, description, icon_url, invite_code')
      .in('id', spaceIds)
      .order('name');

    set({ spaces: spaces ?? [], loading: false });
  },

  selectSpace: async (spaceId) => {
    set({ activeSpaceId: spaceId, activeChannelId: null, channels: [], messages: [] });

    const { data: channels } = await supabase
      .from('channels')
      .select('id, space_id, kind, name, topic, position')
      .eq('space_id', spaceId)
      .order('position');

    set({ channels: channels ?? [] });
  },

  selectChannel: async (channelId) => {
    set({ activeChannelId: channelId, messages: [], loading: true });

    // Arrête l'ancienne subscription
    messagesSub?.unsubscribe();

    const { data: rows } = await supabase
      .from('messages')
      .select('id, channel_id, author_id, content, created_at, edited_at, reply_to_id')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(50);

    const messages = (rows ?? []).reverse() as Message[];

    // Charge les profils des auteurs
    const authorIds = [...new Set(messages.map((m) => m.author_id))];
    const profiles = await loadProfiles(authorIds, get().profiles);

    set({ messages, profiles, loading: false });

    // Abonnement temps réel
    get().subscribeMessages(channelId);
  },

  subscribeMessages: (channelId) => {
    messagesSub = supabase
      .channel(`messages:${channelId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `channel_id=eq.${channelId}`,
      }, async (payload) => {
        const row = payload.new as Message;
        const profiles = await loadProfiles([row.author_id], get().profiles);
        set((s) => ({
          messages: [...s.messages, row],
          profiles,
        }));
      })
      .subscribe();

    return () => { messagesSub?.unsubscribe(); };
  },

  sendMessage: async (content) => {
    const { activeChannelId } = get();
    if (!activeChannelId || !content.trim()) return;

    set({ sendingMessage: true });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { set({ sendingMessage: false }); return; }

    await supabase.from('messages').insert({
      channel_id: activeChannelId,
      author_id: user.id,
      content: content.trim(),
    });

    set({ sendingMessage: false });
  },
}));

async function loadProfiles(
  ids: UUID[],
  existing: Record<UUID, Profile>,
): Promise<Record<UUID, Profile>> {
  const missing = ids.filter((id) => !existing[id]);
  if (missing.length === 0) return existing;

  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, status, custom_status, accent')
    .in('id', missing);

  const updated = { ...existing };
  for (const p of data ?? []) updated[p.id] = p as Profile;
  return updated;
}
