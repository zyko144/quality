export type UUID = string;
export type ISODate = string;
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type ChannelKind = 'text' | 'voice' | 'dm' | 'group';

export interface Profile {
  id: UUID;
  username: string;
  display_name: string;
  avatar_url: string | null;
  status: PresenceStatus;
  custom_status: string | null;
  accent: string;
}

export interface Space {
  id: UUID;
  name: string;
  slug: string;
  description: string | null;
  icon_url: string | null;
  invite_code: string;
}

export interface Channel {
  id: UUID;
  space_id: UUID | null;
  kind: ChannelKind;
  name: string;
  topic: string | null;
  position: number;
}

export interface Message {
  id: UUID;
  channel_id: UUID;
  author_id: UUID;
  content: string;
  created_at: ISODate;
  edited_at: ISODate | null;
  reply_to_id: UUID | null;
  author?: Profile;
}

export interface VoiceParticipant {
  user_id: UUID;
  channel_id: UUID;
  muted: boolean;
  deafened: boolean;
  profile?: Profile;
}

export interface VoiceSignal {
  kind: 'offer' | 'answer' | 'ice';
  from: UUID;
  to: UUID;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}
