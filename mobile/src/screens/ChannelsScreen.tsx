import { useEffect } from 'react';
import { useChat } from '@/store/chat';
import { Spinner } from '@/components';
import type { Channel } from '@/types/db';

interface Props {
  spaceId: string;
  onBack: () => void;
  onSelectChannel: (channel: Channel) => void;
  onSelectVoice: (channel: Channel) => void;
}

export function ChannelsScreen({ spaceId, onBack, onSelectChannel, onSelectVoice }: Props) {
  const { channels, spaces, loading, selectSpace } = useChat();

  const space = spaces.find((s) => s.id === spaceId);
  const textChannels = channels.filter((c) => c.kind === 'text');
  const voiceChannels = channels.filter((c) => c.kind === 'voice');

  useEffect(() => {
    void selectSpace(spaceId);
  }, [spaceId]);

  if (loading) return <Spinner />;

  return (
    <div className="screen">
      <header className="screen-header screen-header--back">
        <button className="back-btn" onClick={onBack}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <h2>{space?.name ?? 'Espace'}</h2>
      </header>

      <div className="channel-list">
        {textChannels.length > 0 && (
          <>
            <div className="channel-category">💬 Salons texte</div>
            {textChannels.map((ch) => (
              <button key={ch.id} className="channel-item" onClick={() => onSelectChannel(ch)}>
                <span className="channel-hash">#</span>
                <span className="channel-name">{ch.name}</span>
              </button>
            ))}
          </>
        )}

        {voiceChannels.length > 0 && (
          <>
            <div className="channel-category">🎙️ Salons vocaux</div>
            {voiceChannels.map((ch) => (
              <button key={ch.id} className="channel-item channel-item--voice" onClick={() => onSelectVoice(ch)}>
                <span className="channel-voice-icon">🔊</span>
                <span className="channel-name">{ch.name}</span>
                <span className="channel-join-label">Rejoindre</span>
              </button>
            ))}
          </>
        )}

        {channels.length === 0 && (
          <p className="empty-state">Aucun salon dans cet espace.</p>
        )}
      </div>
    </div>
  );
}
