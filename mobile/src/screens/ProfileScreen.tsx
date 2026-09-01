import { useSession } from '@/store/session';
import { Avatar } from '@/components';

export function ProfileScreen() {
  const { profile, signOut } = useSession();

  if (!profile) return null;

  return (
    <div className="screen">
      <header className="screen-header">
        <h2>Mon profil</h2>
      </header>

      <div className="profile-card">
        <Avatar
          url={profile.avatar_url}
          name={profile.display_name || profile.username}
          size={80}
          accent={profile.accent}
        />
        <h3 className="profile-name">{profile.display_name || profile.username}</h3>
        <p className="profile-username">@{profile.username}</p>
        {profile.custom_status && (
          <p className="profile-status">{profile.custom_status}</p>
        )}
      </div>

      <div className="profile-actions">
        <button className="btn btn--danger btn--full" onClick={() => void signOut()}>
          Se déconnecter
        </button>
      </div>

      <div className="profile-info">
        <p>
          Echow Mobile Web Player<br />
          <a href="https://qualityy.vercel.app/" target="_blank" rel="noopener noreferrer">
            Site officiel Echow
          </a>
        </p>
      </div>
    </div>
  );
}
