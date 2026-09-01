import { useEffect, useRef } from 'react';

interface Props {
  srcObject: MediaStream | null;
  muted?: boolean;
  className?: string;
}

export function VideoStream({ srcObject, muted = false, className }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = srcObject;
    }
  }, [srcObject]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={className}
    />
  );
}

interface AudioProps {
  srcObject: MediaStream | null;
  muted?: boolean;
}

export function AudioStream({ srcObject, muted = false }: AudioProps) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = srcObject;
  }, [srcObject]);

  return <audio ref={ref} autoPlay muted={muted} style={{ display: 'none' }} />;
}

export function Avatar({ url, name, size = 40, accent }: { url: string | null; name: string; size?: number; accent?: string }) {
  const initials = name.slice(0, 2).toUpperCase();
  const bg = accent ? `hsl(${accent}, 60%, 45%)` : '#5b6af0';

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.38,
        fontWeight: 700,
        color: '#fff',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {initials}
    </div>
  );
}

type Tab = 'servers' | 'voice' | 'dms' | 'profile';

export function BottomNav({
  active,
  onSelect,
  voiceActive,
}: {
  active: Tab;
  onSelect: (tab: Tab) => void;
  voiceActive: boolean;
}) {
  return (
    <nav className="bottom-nav">
      <button className={`nav-btn ${active === 'servers' ? 'nav-btn--active' : ''}`} onClick={() => onSelect('servers')}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points="9 22 9 12 15 12 15 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>Espaces</span>
      </button>

      <button className={`nav-btn ${active === 'voice' ? 'nav-btn--active' : ''} ${voiceActive ? 'nav-btn--live' : ''}`} onClick={() => onSelect('voice')}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <span>Vocal{voiceActive ? ' 🔴' : ''}</span>
      </button>

      <button className={`nav-btn ${active === 'dms' ? 'nav-btn--active' : ''}`} onClick={() => onSelect('dms')}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>Messages</span>
      </button>

      <button className={`nav-btn ${active === 'profile' ? 'nav-btn--active' : ''}`} onClick={() => onSelect('profile')}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
        </svg>
        <span>Profil</span>
      </button>
    </nav>
  );
}

export function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div className="spinner" />
    </div>
  );
}

export function EchowLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <rect width="100" height="100" rx="22" fill="#08080a"/>
      <circle cx="50" cy="46" r="28" stroke="white" strokeWidth="7" fill="none"/>
      <line x1="36" y1="40" x2="64" y2="40" stroke="white" strokeWidth="5.5" strokeLinecap="round"/>
      <line x1="36" y1="50" x2="64" y2="50" stroke="white" strokeWidth="5.5" strokeLinecap="round"/>
      <line x1="36" y1="60" x2="58" y2="60" stroke="white" strokeWidth="5.5" strokeLinecap="round"/>
      <polygon points="34,70 24,80 44,76" fill="white"/>
    </svg>
  );
}
