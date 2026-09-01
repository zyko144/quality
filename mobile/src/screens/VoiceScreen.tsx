import { useEffect } from 'react';
import { useVoice } from '@/store/voice';
import { useSession } from '@/store/session';
import { Avatar, VideoStream, AudioStream } from '@/components';
import type { Channel } from '@/types/db';

interface Props {
  channel: Channel;
  onBack: () => void;
}

export function VoiceScreen({ channel, onBack }: Props) {
  const { profile } = useSession();
  const {
    channelId, connecting, error,
    muted, deafened, cameraOn,
    localStream, localCamera,
    peers, participants,
    join, leave, toggleMute, toggleDeafen, toggleCamera,
  } = useVoice();

  const inChannel = channelId === channel.id;

  const handleJoin = async () => {
    if (!profile) return;
    await join(channel.id, profile.id);
  };

  const handleLeave = async () => {
    await leave();
    onBack();
  };

  useEffect(() => {
    return () => { /* ne quitte pas automatiquement au démontage */ };
  }, []);

  return (
    <div className="screen screen--voice">
      <header className="screen-header screen-header--back">
        <button className="back-btn" onClick={onBack}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <h2>🔊 {channel.name}</h2>
        {inChannel && <span className="live-badge">EN DIRECT</span>}
      </header>

      {error && <div className="voice-error">{error}</div>}

      {/* Grille vidéo */}
      <div className={`video-grid video-grid--${Math.max(1, Object.keys(peers).length + (cameraOn ? 1 : 0))}`}>
        {/* Ma propre caméra */}
        {cameraOn && localCamera && (
          <div className="video-tile video-tile--self">
            <VideoStream srcObject={localCamera} muted className="video-el" />
            <span className="video-label">{profile?.display_name ?? 'Moi'} (moi)</span>
          </div>
        )}

        {/* Pairs */}
        {Object.entries(peers).map(([userId, peer]) => {
          const participant = participants.find((p) => p.user_id === userId);
          return (
            <div key={userId} className="video-tile">
              {peer.cameraStream ? (
                <VideoStream srcObject={peer.cameraStream} className="video-el" />
              ) : (
                <div className="video-placeholder">
                  <Avatar
                    url={participant?.profile?.avatar_url ?? null}
                    name={participant?.profile?.display_name ?? participant?.profile?.username ?? '?'}
                    size={64}
                  />
                </div>
              )}
              {peer.audioStream && <AudioStream srcObject={peer.audioStream} muted={deafened} />}
              <span className="video-label">
                {participant?.profile?.display_name ?? participant?.profile?.username ?? 'Utilisateur'}
              </span>
            </div>
          );
        })}

        {/* Placeholder si salon vide */}
        {inChannel && Object.keys(peers).length === 0 && !cameraOn && (
          <div className="voice-waiting">
            <span>🎙️</span>
            <p>Personne d'autre dans le salon</p>
          </div>
        )}
      </div>

      {/* Mon micro local en audio (pour entendre) */}
      {localStream && <AudioStream srcObject={localStream} muted />}

      {/* Participants présents */}
      {participants.length > 0 && (
        <div className="participants-bar">
          {participants.map((p) => (
            <div key={p.user_id} className="participant-chip">
              <Avatar
                url={p.profile?.avatar_url ?? null}
                name={p.profile?.display_name ?? p.profile?.username ?? '?'}
                size={28}
              />
              <span>{p.profile?.display_name ?? p.profile?.username ?? '…'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Contrôles */}
      <div className="voice-controls">
        {!inChannel ? (
          <button className="btn btn--primary btn--join" onClick={handleJoin} disabled={connecting}>
            {connecting ? 'Connexion…' : '🎙️ Rejoindre le salon'}
          </button>
        ) : (
          <>
            <button
              className={`voice-btn ${muted ? 'voice-btn--off' : ''}`}
              onClick={toggleMute}
              title={muted ? 'Activer le micro' : 'Couper le micro'}
            >
              {muted ? '🔇' : '🎙️'}
              <span>{muted ? 'Muet' : 'Micro'}</span>
            </button>

            <button
              className={`voice-btn ${deafened ? 'voice-btn--off' : ''}`}
              onClick={toggleDeafen}
              title={deafened ? 'Réactiver le son' : 'Couper le son'}
            >
              {deafened ? '🔕' : '🔊'}
              <span>{deafened ? 'Sourd' : 'Son'}</span>
            </button>

            <button
              className={`voice-btn ${cameraOn ? 'voice-btn--on' : ''}`}
              onClick={() => void toggleCamera()}
              title={cameraOn ? 'Couper la caméra' : 'Activer la caméra'}
            >
              {cameraOn ? '📹' : '📷'}
              <span>Caméra</span>
            </button>

            <button
              className="voice-btn voice-btn--leave"
              onClick={handleLeave}
              title="Quitter"
            >
              📵
              <span>Quitter</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
