import { useEffect } from 'react';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { Avatar, Spinner } from '@/components';

interface Props {
  onSelectSpace: (spaceId: string) => void;
}

export function SpacesScreen({ onSelectSpace }: Props) {
  const { spaces, loading, loadSpaces } = useChat();
  const { profile } = useSession();

  useEffect(() => {
    if (profile) void loadSpaces(profile.id);
  }, [profile]);

  if (loading) return <Spinner />;

  return (
    <div className="screen">
      <header className="screen-header">
        <h2>Mes espaces</h2>
      </header>

      <div className="space-list">
        {spaces.length === 0 && (
          <p className="empty-state">Tu n'appartiens à aucun espace pour l'instant.</p>
        )}
        {spaces.map((space) => (
          <button
            key={space.id}
            className="space-item"
            onClick={() => onSelectSpace(space.id)}
          >
            <div className="space-icon">
              {space.icon_url ? (
                <img src={space.icon_url} alt="" width={48} height={48} />
              ) : (
                <Avatar url={null} name={space.name} size={48} />
              )}
            </div>
            <div className="space-info">
              <span className="space-name">{space.name}</span>
              {space.description && (
                <span className="space-desc">{space.description}</span>
              )}
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="chevron">
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
