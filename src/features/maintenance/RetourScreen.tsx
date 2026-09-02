import { useEffect } from 'react';
import { WindowControls } from '@/components/WindowControls';
import { MiseAJour } from '@/features/shell/MiseAJour';
import '@/styles/maintenance.css';

/**
 * L'ecran de retour, quand la maintenance est levee.
 *
 * Il reprend exactement les formes de l'ecran de maintenance et en change la
 * couleur. C'est voulu : la derniere chose que ces gens ont vue est un ecran
 * rouge qui disait « suspendu ». Le meme ecran en vert qui dit « retabli » se
 * lit comme la suite de celui-la, sans qu'il faille l'expliquer — la
 * ressemblance porte le message plus surement qu'une phrase.
 *
 * Les deux partagent donc une seule feuille de style, ou la teinte tient dans
 * cinq variables. Deux feuilles auraient fait deux copies, et la seconde aurait
 * cesse de suivre la premiere des la premiere retouche.
 *
 * Ce qui a ete fait est resume, pas detaille : quelqu'un qui revient veut
 * savoir que ca valait la peine d'attendre, pas lire un journal de bord. Le
 * detail existe dans les notes de version, ou il est a sa place.
 */
export function RetourScreen({ onEntrer }: { onEntrer: () => void }) {
  useEffect(() => {
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('is-leaving');
      setTimeout(() => splash.remove(), 400);
    }
  }, []);

  return (
    <div className="maintenance-page maintenance-page--retour">
      <div className="maintenance-glow-container" aria-hidden="true">
        <div className="maintenance-glow-orb maintenance-glow-orb--1" />
        <div className="maintenance-glow-orb maintenance-glow-orb--2" />
        <div className="maintenance-glow-orb maintenance-glow-orb--3" />
        <div className="maintenance-glow-orb maintenance-glow-orb--center" />
        <div className="maintenance-grid-overlay" />
      </div>

      <header className="maintenance-header" data-tauri-drag-region>
        <div className="maintenance-header__brand">
          <svg
            className="maintenance-header__logo-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12c3-4 6-6 10-6s7 2 10 6c-3 4-6 6-10 6s-7-2-10-6Z" />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
          <span className="maintenance-header__brand-name">Echow</span>
          <span className="maintenance-header__version">
            v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.9.1'}
          </span>
        </div>

        <WindowControls />
      </header>

      <main className="maintenance-main">
        <div className="maintenance-card" role="status" aria-live="polite">
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
              {/* Un bouclier coche : ce qui etait en travaux est verifie. */}
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
              <path d="m8.5 11.5 2.5 2.5 4.5-4.5" />
            </svg>
          </div>

          <div className="maintenance-status-pill">
            <span className="maintenance-status-dot" />
            <span>Maintenance terminée</span>
          </div>

          <h1 className="maintenance-title">Echow est de retour</h1>

          <p className="maintenance-text">
            Les services sont rétablis. Les salons vocaux, les messages, les
            connexions et les créations de compte fonctionnent à nouveau
            normalement. Merci de votre patience pendant ces travaux.
          </p>

          {/*
            Ce qui a change, en six lignes.

            Sans detail : une liste qui deroule tout se saute, et sauter la liste
            revient a ne pas savoir que ces choses existent. Six titres se
            parcourent d'un regard, et chacun se decouvre ensuite dans
            l'application.
          */}
          <ul className="retour-liste">
            <li>Des badges à gagner, avec leurs dessins</li>
            <li>Echow AI, pour répondre à vos questions</li>
            <li>Une fiche de profil refaite</li>
            <li>Les salons vocaux réparés</li>
            <li>Les réglages réorganisés</li>
            <li>De nouveaux emojis</li>
          </ul>

          <div className="maintenance-grid">
            <div className="maintenance-stat-box">
              <span className="maintenance-stat-box__label">Services</span>
              <span className="maintenance-stat-box__value">Rétablis</span>
            </div>
            <div className="maintenance-stat-box">
              <span className="maintenance-stat-box__label">Accès &amp; Comptes</span>
              <span className="maintenance-stat-box__value">Ouverts</span>
            </div>
            <div className="maintenance-stat-box">
              <span className="maintenance-stat-box__label">Infrastructure</span>
              <span className="maintenance-stat-box__value">À jour</span>
            </div>
          </div>

          <button type="button" className="retour-entrer" onClick={onEntrer}>
            Entrer dans Echow
          </button>
        </div>
      </main>

      <MiseAJour />
    </div>
  );
}
