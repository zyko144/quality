import React from 'react';

export type BadgeCategory = 'pionnier' | 'premiere-heure' | 'equipe' | 'rapporteur' | 'espace' | 'messages' | 'vocal' | 'anciennete';

interface BadgeVisualProps {
  badgeCle: string;
  nom: string;
  teinte?: string;
  size?: number;
  className?: string;
  showGlow?: boolean;
}

/**
 * Determine le niveau/tier visuel d'un badge selon sa cle pour appliquer
 * les effets de rarete (Neon, Holographique, Chrome, etc.)
 */
export function getBadgeTier(cle: string): { tier: 1 | 2 | 3 | 4 | 5; glowClass: string; isMythic: boolean } {
  if (cle === 'pionnier' || cle === 'espace-1m' || cle === 'messages-1m' || cle === 'vocal-5000' || cle === 'anciennete-10ans') {
    return { tier: 5, glowClass: 'badge-glow--mythic', isMythic: true };
  }
  if (cle === 'premiere-heure' || cle === 'equipe' || cle === 'messages-500k' || cle === 'vocal-3000' || cle === 'vocal-1000' || cle === 'espace-100k' || cle === 'anciennete-7ans') {
    return { tier: 4, glowClass: 'badge-glow--legendary', isMythic: false };
  }
  if (cle === 'espace-10k' || cle === 'messages-100k' || cle === 'vocal-500' || cle === 'vocal-150' || cle === 'anciennete-5ans') {
    return { tier: 3, glowClass: 'badge-glow--epic', isMythic: false };
  }
  if (cle === 'messages-50k' || cle === 'vocal-50' || cle === 'anciennete-3ans' || cle === 'rapporteur') {
    return { tier: 2, glowClass: 'badge-glow--rare', isMythic: false };
  }
  return { tier: 1, glowClass: 'badge-glow--common', isMythic: false };
}

export function BadgeVisual({ badgeCle, nom, teinte = '#6366f1', size = 24, className = '', showGlow = true }: BadgeVisualProps) {
  const { tier, glowClass, isMythic } = getBadgeTier(badgeCle);

  // Choix de l'icone SVG en fonction de la famille ou de la cle
  const renderIcon = () => {
    // 1. Top 100 Pionnier (Couronne d'or Royale)
    if (badgeCle === 'pionnier') {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14v2H5z" fill="currentColor" fillOpacity="0.2" />
          <circle cx="12" cy="11" r="1.5" fill="#fff" />
        </svg>
      );
    }

    // 2. Premiere Heure / Jour 1 (Etoile Cosmique / Supernova)
    if (badgeCle === 'premiere-heure') {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 2 2.8 5.6 6.2.9-4.5 4.4 1.1 6.1L12 16l-5.6 3 1.1-6.1-4.5-4.4 6.2-.9L12 2z" fill="currentColor" fillOpacity="0.25" />
          <circle cx="12" cy="11" r="2.5" fill="#fff" fillOpacity="0.8" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="#fff" strokeWidth="1.5" />
        </svg>
      );
    }

    // 3. Equipe Echow (Bouclier Dev Officiel)
    if (badgeCle === 'equipe') {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" fill="currentColor" fillOpacity="0.2" />
          <path d="M12 7v6 M9 10l3 3 3-3" stroke="#fff" strokeWidth="2" />
          <circle cx="12" cy="17" r="1" fill="#fff" />
        </svg>
      );
    }

    // 4. Chasseur de bogues (Scarabee Cybernetique)
    if (badgeCle === 'rapporteur') {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="8" height="12" x="8" y="7" rx="4" fill="currentColor" fillOpacity="0.2" />
          <path d="m19 7-3 2M5 7l3 2M19 17l-3-2M5 17l3 2M20 12h-4M4 12h4M10 3a2 2 0 0 0-2 2M14 3a2 2 0 0 1 2 2" />
        </svg>
      );
    }

    // 5. Batisseur d'Espace (Tour / Chateau de Communaute)
    if (badgeCle.startsWith('espace-')) {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 21h16M5 21V7l3-3 3 3v14M13 21V7l3-3 3 3v14" fill="currentColor" fillOpacity="0.2" />
          <path d="M9 10h.01M9 14h.01M15 10h.01M15 14h.01" strokeWidth="2.5" />
          {tier >= 4 && <polygon points="12 2 15 5 9 5" fill="#fff" />}
        </svg>
      );
    }

    // 6. Messagerie / Plume (Cyber Plume & Encre Digitale)
    if (badgeCle.startsWith('messages-')) {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L3 12.5V21h8.5z" fill="currentColor" fillOpacity="0.25" />
          <line x1="16" y1="8" x2="2" y2="22" stroke="#fff" strokeWidth="1.5" />
          <line x1="17.5" y1="15" x2="9" y2="15" />
        </svg>
      );
    }

    // 7. Salon Vocal (Casque & Gemme d'Ondes Sonores)
    if (badgeCle.startsWith('vocal-')) {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
          <path d="M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM17 12h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1z" fill="currentColor" fillOpacity="0.3" />
          <path d="M10 10v4M12 8v8M14 11v2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    }

    // 8. Anciennete (Bouclier Stellaire / Etoile de Veteran)
    if (badgeCle.startsWith('anciennete-') || badgeCle === 'fidele') {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" fillOpacity="0.2" />
          <circle cx="12" cy="12" r="2.5" fill="#fff" />
        </svg>
      );
    }

    // Repli (Bouclier standard)
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" fill="currentColor" fillOpacity="0.2" />
      </svg>
    );
  };

  return (
    <div
      className={`echow-badge-icon ${showGlow ? glowClass : ''} ${isMythic ? 'is-mythic' : ''} ${className}`}
      style={{
        '--badge-color': teinte,
        width: `${size}px`,
        height: `${size}px`,
      } as React.CSSProperties}
      title={nom}
      aria-label={nom}
    >
      <div className="echow-badge-icon__halo" aria-hidden="true" />
      <div className="echow-badge-icon__svg-wrap">
        {renderIcon()}
      </div>
      {isMythic && <div className="echow-badge-icon__shimmer" aria-hidden="true" />}
    </div>
  );
}
