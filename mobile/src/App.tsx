import { useState } from 'react';
import { useSession } from '@/store/session';
import { useVoice } from '@/store/voice';
import { BottomNav, Spinner } from '@/components';
import { AuthScreen } from '@/screens/AuthScreen';
import { SpacesScreen } from '@/screens/SpacesScreen';
import { ChannelsScreen } from '@/screens/ChannelsScreen';
import { ChatScreen } from '@/screens/ChatScreen';
import { VoiceScreen } from '@/screens/VoiceScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import type { Channel } from '@/types/db';

type Tab = 'servers' | 'voice' | 'dms' | 'profile';

type Nav =
  | { view: 'spaces' }
  | { view: 'channels'; spaceId: string }
  | { view: 'chat'; channel: Channel }
  | { view: 'voice'; channel: Channel };

export function App() {
  const { session, loading } = useSession();
  const { channelId: activeVoiceChannelId } = useVoice();

  const [tab, setTab] = useState<Tab>('servers');
  const [nav, setNav] = useState<Nav>({ view: 'spaces' });

  if (loading) {
    return (
      <div className="app-loading">
        <Spinner />
      </div>
    );
  }

  if (!session) return <AuthScreen />;

  const handleTabSelect = (t: Tab) => {
    setTab(t);
    if (t === 'servers') setNav({ view: 'spaces' });
    else if (t === 'voice' && activeVoiceChannelId) {
      // reste sur l'écran vocal si déjà connecté
    } else if (t === 'profile') {
      // affiche profil
    }
  };

  const renderContent = () => {
    if (tab === 'profile') return <ProfileScreen />;

    if (tab === 'voice') {
      // Pas de salon vocal actif → retourne aux espaces
      if (!activeVoiceChannelId) {
        return (
          <div className="screen">
            <div className="empty-state-center">
              <p>🎙️ Rejoins un salon vocal<br />depuis la liste des espaces.</p>
            </div>
          </div>
        );
      }
      // L'écran vocal est géré par nav
    }

    if (nav.view === 'spaces') {
      return (
        <SpacesScreen
          onSelectSpace={(spaceId) => {
            setNav({ view: 'channels', spaceId });
          }}
        />
      );
    }

    if (nav.view === 'channels') {
      return (
        <ChannelsScreen
          spaceId={nav.spaceId}
          onBack={() => setNav({ view: 'spaces' })}
          onSelectChannel={(channel) => setNav({ view: 'chat', channel })}
          onSelectVoice={(channel) => {
            setNav({ view: 'voice', channel });
            setTab('voice');
          }}
        />
      );
    }

    if (nav.view === 'chat') {
      return (
        <ChatScreen
          channel={nav.channel}
          onBack={() => setNav({ view: 'channels', spaceId: nav.channel.space_id! })}
        />
      );
    }

    if (nav.view === 'voice') {
      return (
        <VoiceScreen
          channel={nav.channel}
          onBack={() => setNav({ view: 'channels', spaceId: nav.channel.space_id! })}
        />
      );
    }

    return null;
  };

  return (
    <div className="app">
      <main className="app-main">
        {renderContent()}
      </main>
      <BottomNav
        active={tab}
        onSelect={handleTabSelect}
        voiceActive={!!activeVoiceChannelId}
      />
    </div>
  );
}
