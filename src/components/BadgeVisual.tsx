import React from 'react';
import { dessinDe } from './dessinsBadges';

export type BadgeCategory = 'pionnier' | 'premiere-heure' | 'equipe' | 'rapporteur' | 'espace' | 'messages' | 'vocal' | 'anciennete';

interface BadgeVisualProps {
  badgeCle: string;
  nom: string;
  teinte?: string;
  size?: number;
  className?: string;
  showGlow?: boolean;
  /**
   * Le badge est-il possede ?
   *
   * Un badge non obtenu garde son dessin et sa teinte, mais pas son eclat : un
   * halo identique sur ce qu'on a et sur ce qu'on n'a pas retire au premier
   * la seule chose qui le distinguait. Voir `badges.css`, section « eteint ».
   */
  allume?: boolean;
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

export function BadgeVisual({ badgeCle, nom, teinte = '#6366f1', size = 24, className = '', showGlow = true, allume = true }: BadgeVisualProps) {
  const { tier, glowClass, isMythic } = getBadgeTier(badgeCle);

  /*
   * Le dessin livre remplace le trace vectoriel, quand il existe.
   *
   * Il ne s'ajoute pas : une image deja ornee — cadre, lauriers, degrade — dans
   * une tuile qui porte elle-meme un fond, une bordure et un halo, ce sont deux
   * cadres l'un dans l'autre. La tuile s'efface donc (voir la classe
   * `--dessin` dans `badges.css`) et l'eclat passe sur l'image elle-meme.
   */
  const dessin = dessinDe(badgeCle);

  // Choix de l'icone SVG en fonction de la famille ou de la cle
  const renderIcon = () => {
    // 1. Top 100 Pionnier (Boussole Quantique & Coeur d'Or Solaire)
    if (badgeCle === 'pionnier') {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          {/* Hexagone ciselé */}
          <polygon points="12 2 21 7.2 21 16.8 12 22 3 16.8 3 7.2" fill="currentColor" fillOpacity="0.2" strokeWidth="2" />
          {/* Boussole cardinale dorée */}
          <polygon points="12 5 14.5 11 20 12 14.5 13 12 19 9.5 13 4 12 9.5 11" fill="currentColor" fillOpacity="0.5" stroke="#fff" strokeWidth="1.2" />
          <circle cx="12" cy="12" r="2.5" fill="#fff" />
        </svg>
      );
    }

    // 2. Premiere Heure / Jour 1 (Fusee Spatiale en Decollage - "Day One Launch")
    if (badgeCle === 'premiere-heure') {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {/* Corps de la fusee */}
          <path d="M12 2.5c2.5 2 4.5 5.5 4.5 9.5 0 2-.5 4-1.5 5.5L12 16l-3 1.5c-1-1.5-1.5-3.5-1.5-5.5 0-4 2-7.5 4.5-9.5z" fill="currentColor" fillOpacity="0.3" strokeWidth="1.8" />
          {/* Hublot lumineux */}
          <circle cx="12" cy="9" r="1.8" fill="#fff" />
          {/* Ailerons lateraux */}
          <path d="M7.5 14l-3.5 2.5v2.5l3.5-1 M16.5 14l3.5 2.5v2.5l-3.5-1" stroke="currentColor" strokeWidth="1.6" />
          {/* Flamme de propulsion neons */}
          <path d="M10 17.5l2 4.5 2-4.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    }

    // 3. Equipe Echow (Marteau de Forge & Cle de Dev Croises)
    if (badgeCle === 'equipe') {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {/* Marteau de forgeron staff */}
          <path d="M15 4l5 5-2 2-5-5 2-2z" fill="currentColor" fillOpacity="0.4" strokeWidth="2" />
          <line x1="14" y1="8" x2="4" y2="18" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          {/* Cle mecanique croisee */}
          <path d="M6 6l3 3 M4.5 7.5l3-3 M19 19l-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="19" cy="19" r="1.5" fill="#fff" />
        </svg>
      );
    }

    // 4. Bug Hunter (scarabee de circuits)
    if (badgeCle === 'rapporteur') {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="8" height="12" x="8" y="7" rx="4" fill="currentColor" fillOpacity="0.2" />
          <path d="m19 7-3 2M5 7l3 2M19 17l-3-2M5 17l3 2M20 12h-4M4 12h4M10 3a2 2 0 0 0-2 2M14 3a2 2 0 0 1 2 2" />
        </svg>
      );
    }

    // 5. Batisseur d'Espace (Systeme Planetaire & Sphere d'Energie Orbitale - GARDE TEL QUEL)
    if (badgeCle.startsWith('espace-')) {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {/* Anneau orbital principal */}
          <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-25 12 12)" stroke="currentColor" strokeWidth={tier >= 3 ? "2" : "1.5"} />
          {/* Sphere planetaire centrale */}
          <circle cx="12" cy="12" r={tier >= 4 ? "6.5" : "5"} fill="currentColor" fillOpacity="0.25" strokeWidth="2" />
          {/* Satellites et lueurs selon le palier */}
          {tier >= 2 && <circle cx="19" cy="8" r="1.5" fill="#fff" />}
          {tier >= 3 && <circle cx="5" cy="16" r="1.2" fill="#fff" />}
          {tier >= 4 && (
            <>
              <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(35 12 12)" stroke="#fff" strokeWidth="1.5" strokeDasharray="2 2" />
              <circle cx="12" cy="12" r="2.5" fill="#fff" />
            </>
          )}
        </svg>
      );
    }

    // 6. Messagerie / Plume (Cyber Plume & Encre Digitale - GARDE TEL QUEL)
    if (badgeCle.startsWith('messages-')) {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L3 12.5V21h8.5z" fill="currentColor" fillOpacity="0.25" />
          <line x1="16" y1="8" x2="2" y2="22" stroke="#fff" strokeWidth="1.5" />
          <line x1="17.5" y1="15" x2="9" y2="15" />
        </svg>
      );
    }

    // 7. Salon Vocal (Microphone de Studio Professionnel & Ondes Vocales)
    if (badgeCle.startsWith('vocal-')) {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {/* Capsule de micro de studio */}
          <rect x="8.5" y="2.5" width="7" height="11" rx="3.5" fill="currentColor" fillOpacity="0.3" strokeWidth="2" />
          {/* Grille du micro */}
          <line x1="8.5" y1="6" x2="15.5" y2="6" stroke="#fff" strokeWidth="1.2" />
          <line x1="8.5" y1="9" x2="15.5" y2="9" stroke="#fff" strokeWidth="1.2" />
          {/* Arceau et suspension */}
          <path d="M5.5 9.5v1.5a6.5 6.5 0 0 0 13 0V9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="17.5" x2="12" y2="21.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="8" y1="21.5" x2="16" y2="21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          {/* Ondes de diffusion sonores laterales selon le tier */}
          {tier >= 3 && (
            <>
              <path d="M2.5 10a10 10 0 0 1 0 3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M21.5 10a10 10 0 0 0 0 3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
            </>
          )}
        </svg>
      );
    }

    // 8. Anciennete (Medaille Militaire d'Honneur avec Ruban & Chevrons de Veteran)
    if (badgeCle.startsWith('anciennete-') || badgeCle === 'fidele') {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {/* Ruban superieur militaire */}
          <polygon points="6 2 18 2 16 9 8 9" fill="currentColor" fillOpacity="0.4" strokeWidth="1.8" />
          <line x1="12" y1="2" x2="12" y2="9" stroke="#fff" strokeWidth="1.6" />
          {/* Medaillon rond inferieur */}
          <circle cx="12" cy="16" r="5.5" fill="currentColor" fillOpacity="0.25" strokeWidth="2" />
          {/* Chevrons d'honneur de veteran au centre */}
          <path d="M9.5 15l2.5 2.5 2.5-2.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {tier >= 3 && (
            <path d="M9.5 13l2.5 2.5 2.5-2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {tier >= 4 && <circle cx="12" cy="16" r="1.5" fill="#fff" />}
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
      className={`echow-badge-icon ${showGlow ? glowClass : ''} ${isMythic ? 'is-mythic' : ''} ${dessin ? 'echow-badge-icon--dessin' : ''} ${allume ? '' : 'echow-badge-icon--eteint'} ${className}`}
      style={{
        '--badge-color': teinte,
        width: `${size}px`,
        height: `${size}px`,
      } as React.CSSProperties}
      title={nom}
      aria-label={nom}
    >
      <div className="echow-badge-icon__halo" aria-hidden="true" />

      {dessin ? (
        /*
         * `alt` vide, et non le nom du badge : le conteneur porte deja
         * `aria-label`, et le repeter ferait annoncer le badge deux fois de
         * suite par un lecteur d'ecran.
         */
        <img className="echow-badge-icon__dessin" src={dessin} alt="" draggable={false} />
      ) : (
        <div className="echow-badge-icon__svg-wrap">{renderIcon()}</div>
      )}

      {isMythic && !dessin && <div className="echow-badge-icon__shimmer" aria-hidden="true" />}
    </div>
  );
}
