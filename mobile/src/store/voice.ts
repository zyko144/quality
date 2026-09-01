import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { UUID, VoiceParticipant, VoiceSignal } from '@/types/db';
import type { RealtimeChannel } from '@supabase/supabase-js';

/** Serveurs ICE publics de repli */
const STUN_PUBLICS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

async function getIceServers(): Promise<RTCIceServer[]> {
  try {
    const { data, error } = await supabase.rpc('ice_servers');
    if (!error && Array.isArray(data) && data.length > 0) return data as RTCIceServer[];
  } catch { /* repli */ }
  return STUN_PUBLICS;
}

interface Peer {
  pc: RTCPeerConnection;
  audioStream: MediaStream | null;
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
}

interface VoiceState {
  channelId: UUID | null;
  userId: UUID | null;
  connecting: boolean;
  error: string | null;

  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;

  localStream: MediaStream | null;
  localCamera: MediaStream | null;
  peers: Record<UUID, Peer>;
  speaking: Record<UUID, boolean>;

  participants: VoiceParticipant[];

  join: (channelId: UUID, userId: UUID) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleCamera: () => Promise<void>;
}

// Resources hors état React
let voiceChannel: RealtimeChannel | null = null;
let localMic: MediaStream | null = null;
let iceServers: RTCIceServer[] = STUN_PUBLICS;

// Connexions WebRTC actives
const peerConnections = new Map<UUID, RTCPeerConnection>();
const pendingCandidates = new Map<UUID, RTCIceCandidateInit[]>();

function createPC(userId: UUID, myId: UUID, set: (fn: (s: VoiceState) => Partial<VoiceState>) => void): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers });

  pc.onicecandidate = ({ candidate }) => {
    if (!candidate) return;
    voiceChannel?.send({
      type: 'broadcast',
      event: 'signal',
      payload: { kind: 'ice', from: myId, to: userId, candidate: candidate.toJSON() } satisfies VoiceSignal,
    });
  };

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (!stream) return;

    // Détecte si c'est audio ou vidéo par les tracks du stream
    const hasVideo = stream.getVideoTracks().length > 0;
    set((s) => ({
      peers: {
        ...s.peers,
        [userId]: {
          ...s.peers[userId],
          pc,
          [hasVideo ? 'cameraStream' : 'audioStream']: stream,
          audioStream: hasVideo ? (s.peers[userId]?.audioStream ?? null) : stream,
          cameraStream: hasVideo ? stream : (s.peers[userId]?.cameraStream ?? null),
          screenStream: s.peers[userId]?.screenStream ?? null,
        },
      },
    }));
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      set((s) => {
        const peers = { ...s.peers };
        delete peers[userId];
        return { peers };
      });
      peerConnections.delete(userId);
    }
  };

  peerConnections.set(userId, pc);
  return pc;
}

export const useVoice = create<VoiceState>((set, get) => ({
  channelId: null,
  userId: null,
  connecting: false,
  error: null,
  muted: false,
  deafened: false,
  cameraOn: false,
  localStream: null,
  localCamera: null,
  peers: {},
  speaking: {},
  participants: [],

  join: async (channelId, userId) => {
    const state = get();
    if (state.channelId) await state.leave();

    set({ connecting: true, error: null, channelId, userId });
    iceServers = await getIceServers();

    // Capture micro
    try {
      localMic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      set({ localStream: localMic });
    } catch {
      set({ connecting: false, error: 'Impossible d\'accéder au microphone.' });
      return;
    }

    // Rejoindre la présence Supabase
    voiceChannel = supabase.channel(`voice:${channelId}`, {
      config: { presence: { key: userId } },
    });

    voiceChannel
      .on('presence', { event: 'sync' }, () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = voiceChannel!.presenceState<any>();
        const participants: VoiceParticipant[] = Object.values(state)
          .flat()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((p: any) => typeof p?.user_id === 'string')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((p: any) => ({ user_id: p.user_id as UUID, channel_id: channelId, muted: false, deafened: false }));

        set({ participants });


        // Ouvre des connexions vers les nouveaux participants
        for (const p of participants) {
          if (p.user_id === userId) continue;
          if (peerConnections.has(p.user_id)) continue;

          if (userId < p.user_id) {
            // Je suis l'initiateur
            void initiateConnection(p.user_id, userId, set, get);
          }
        }
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const p of (leftPresences as unknown as { user_id: UUID }[])) {

          const pc = peerConnections.get(p.user_id);
          pc?.close();
          peerConnections.delete(p.user_id);
          set((s) => {
            const peers = { ...s.peers };
            delete peers[p.user_id];
            return { peers };
          });
        }
      })
      .on('broadcast', { event: 'signal' }, async ({ payload }) => {
        const signal = payload as VoiceSignal;
        if (signal.to !== userId) return;
        await handleSignal(signal, userId, set, get);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await voiceChannel!.track({ user_id: userId });
          set({ connecting: false });
        }
      });
  },

  leave: async () => {
    // Ferme toutes les connexions
    for (const pc of peerConnections.values()) pc.close();
    peerConnections.clear();
    pendingCandidates.clear();

    // Arrête le micro
    for (const track of localMic?.getTracks() ?? []) track.stop();
    localMic = null;

    // Arrête la caméra
    const { localCamera } = get();
    for (const track of localCamera?.getTracks() ?? []) track.stop();

    await voiceChannel?.untrack();
    await voiceChannel?.unsubscribe();
    voiceChannel = null;

    set({
      channelId: null,
      userId: null,
      localStream: null,
      localCamera: null,
      peers: {},
      speaking: {},
      participants: [],
      muted: false,
      deafened: false,
      cameraOn: false,
    });
  },

  toggleMute: () => {
    const { muted, localStream } = get();
    const newMuted = !muted;
    for (const track of localStream?.getAudioTracks() ?? []) track.enabled = newMuted ? false : true;
    set({ muted: newMuted });
  },

  toggleDeafen: () => {
    const { deafened, peers } = get();
    const newDeafened = !deafened;
    for (const peer of Object.values(peers)) {
      for (const track of peer.audioStream?.getAudioTracks() ?? []) track.enabled = !newDeafened;
    }
    set({ deafened: newDeafened });
  },

  toggleCamera: async () => {
    const { cameraOn, localCamera, userId } = get();

    if (cameraOn && localCamera) {
      for (const track of localCamera.getTracks()) track.stop();
      // Retire la piste vidéo de toutes les connexions
      for (const pc of peerConnections.values()) {
        for (const sender of pc.getSenders()) {
          if (sender.track?.kind === 'video') pc.removeTrack(sender);
        }
      }
      set({ cameraOn: false, localCamera: null });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      set({ cameraOn: true, localCamera: stream });

      // Ajoute la piste vidéo à toutes les connexions actives
      for (const pc of peerConnections.values()) {
        for (const track of stream.getVideoTracks()) pc.addTrack(track, stream);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        voiceChannel?.send({
          type: 'broadcast',
          event: 'signal',
          payload: { kind: 'offer', from: userId!, to: '', sdp: offer.sdp } satisfies VoiceSignal,
        });
      }
    } catch {
      set({ error: 'Impossible d\'accéder à la caméra.' });
    }
  },
}));

async function initiateConnection(
  peerId: UUID,
  myId: UUID,
  set: (fn: (s: VoiceState) => Partial<VoiceState>) => void,
  get: () => VoiceState,
) {
  const pc = createPC(peerId, myId, set);

  // Ajoute le micro local
  if (localMic) {
    for (const track of localMic.getTracks()) pc.addTrack(track, localMic);
  }

  // Ajoute la caméra si active
  const { localCamera } = get();
  if (localCamera) {
    for (const track of localCamera.getTracks()) pc.addTrack(track, localCamera);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  voiceChannel?.send({
    type: 'broadcast',
    event: 'signal',
    payload: { kind: 'offer', from: myId, to: peerId, sdp: offer.sdp } satisfies VoiceSignal,
  });
}

async function handleSignal(
  signal: VoiceSignal,
  myId: UUID,
  set: (fn: (s: VoiceState) => Partial<VoiceState>) => void,
  get: () => VoiceState,
) {
  const { from } = signal;

  if (signal.kind === 'offer') {
    let pc = peerConnections.get(from);
    if (!pc) {
      pc = createPC(from, myId, set);
      if (localMic) for (const t of localMic.getTracks()) pc.addTrack(t, localMic);
      const { localCamera } = get();
      if (localCamera) for (const t of localCamera.getTracks()) pc.addTrack(t, localCamera);
    }

    await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });

    // Applique les candidats en attente
    for (const c of pendingCandidates.get(from) ?? []) await pc.addIceCandidate(c);
    pendingCandidates.delete(from);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    voiceChannel?.send({
      type: 'broadcast',
      event: 'signal',
      payload: { kind: 'answer', from: myId, to: from, sdp: answer.sdp } satisfies VoiceSignal,
    });
  } else if (signal.kind === 'answer') {
    const pc = peerConnections.get(from);
    if (pc) await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
  } else if (signal.kind === 'ice' && signal.candidate) {
    const pc = peerConnections.get(from);
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(signal.candidate);
    } else {
      // Met en file d'attente jusqu'à la réception de l'offre
      const pending = pendingCandidates.get(from) ?? [];
      pending.push(signal.candidate);
      pendingCandidates.set(from, pending);
    }
  }
}
