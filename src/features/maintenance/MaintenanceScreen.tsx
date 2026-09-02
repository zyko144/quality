import { useEffect } from 'react';
import { WindowControls } from '@/components/WindowControls';
import { MiseAJour } from '@/features/shell/MiseAJour';
import { navigate } from '@/lib/router';
import '@/styles/maintenance.css';

export function MaintenanceScreen() {
  useEffect(() => {
    // Retirer le splash screen natif s'il est present
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('is-leaving');
      setTimeout(() => splash.remove(), 400);
    }
  }, []);

  return (
    <div className="maintenance-page">
      {/* Arriere-plan avec flous rouges atmospheriques */}
      <div className="maintenance-glow-container" aria-hidden="true">
        <div className="maintenance-glow-orb maintenance-glow-orb--1" />
        <div className="maintenance-glow-orb maintenance-glow-orb--2" />
        <div className="maintenance-glow-orb maintenance-glow-orb--3" />
        <div className="maintenance-glow-orb maintenance-glow-orb--center" />
        <div className="maintenance-grid-overlay" />
      </div>

      {/* Barre d'en-tete avec commandes de fenetre */}
      <header className="maintenance-header" data-tauri-drag-region>
        <div className="maintenance-header__brand">
          <svg className="maintenance-header__logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12c3-4 6-6 10-6s7 2 10 6c-3 4-6 6-10 6s-7-2-10-6Z" />
            <circle cx="12" cy="12" r="3" fill="#ef4444" />
          </svg>
          <span className="maintenance-header__brand-name">Echow</span>
          <span className="maintenance-header__version">v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.7.8'}</span>
        </div>

        <WindowControls />
      </header>

      {/* Contenu central */}
      <main className="maintenance-main">
        <div className="maintenance-card" role="alert" aria-live="polite">
          {/* Badge Icone d'outils de maintenance */}
          <div className="maintenance-icon-badge">
            <svg
              className="maintenance-icon-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* Cle a molette & Tournevis croises */}
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              <path d="m4.5 19.5 3-3" />
              <path d="m15 15 4.5 4.5" />
              <path d="M18.5 21a2.5 2.5 0 0 0 2.5-2.5l-3-3-2 2 2.5 3.5z" />
            </svg>
          </div>

          {/* Pastille de statut */}
          <div className="maintenance-status-pill">
            <span className="maintenance-status-dot" />
            <span>Maintenance en cours</span>
          </div>

          {/* Titre Principal */}
          <h1 className="maintenance-title">Application en Maintenance</h1>

          {/* Message descriptif */}
          <p className="maintenance-text">
            Echow fait actuellement l&apos;objet d&apos;une maintenance technique générale et d&apos;une mise à niveau de l&apos;infrastructure.
            L&apos;ensemble des services (connexions, salons vocaux, messages et créations de compte) est temporairement suspendu pour tous les utilisateurs.
            Nos équipes interviennent activement afin de rétablir les services dans les plus brefs délais.
          </p>

          {/* Grille d'information */}
          <div className="maintenance-grid">
            <div className="maintenance-stat-box">
              <span className="maintenance-stat-box__label">Services</span>
              <span className="maintenance-stat-box__value">Interrompus</span>
            </div>
            <div className="maintenance-stat-box">
              <span className="maintenance-stat-box__label">Accès & Comptes</span>
              <span className="maintenance-stat-box__value">Verrouillés</span>
            </div>
            <div className="maintenance-stat-box">
              <span className="maintenance-stat-box__label">Infrastructure</span>
              <span className="maintenance-stat-box__value">Mise à jour</span>
            </div>
          </div>

          {/* Ligne de balayage dynamique */}
          <div className="maintenance-pulse-bar">
            <div className="maintenance-pulse-bar__indicator" />
          </div>

          {/*
            L'acces de l'equipe, discret mais present.

            Sans lui, la maintenance se ferait a l'aveugle : on ne decouvrirait
            qu'a sa levee que ce qu'on croyait repare ne l'est pas. Il ne donne
            rien a personne d'autre — s'identifier avec un compte ordinaire
            ramene ici, et ouvrir un compte pendant la maintenance ne donne
            acces a rien.
          */}
          <button
            type="button"
            className="maintenance-equipe"
            onClick={() => navigate('/connexion')}
          >
            Acces equipe
          </button>
        </div>
      </main>

      {/* Module de mise a jour automatique pour appliquer les futures releases des disponibilite */}
      <MiseAJour />
    </div>
  );
}
