import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useDevices } from './store/devices';
import { setCueVolume } from './lib/sounds';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
// La coquille reprend les metriques de Discord ; elle vient apres app.css,
// dont elle remplace les regles de mise en page.
import './styles/shell.css';
import './styles/surfaces.css';
import './styles/features.css';
import './styles/dm.css';
import './styles/friends.css';
import './styles/settings.css';
import './styles/landing.css';
// La matiere vient apres les feuilles de structure : elle ne change que les
// surfaces, les ombres et les reponses au survol, jamais les metriques.
import './styles/voice.css';
import './styles/depth.css';
// En dernier : les regles mobiles surchargent celles des grands ecrans.
import './styles/mobile.css';

// Le volume des signaux est lu au demarrage : sans cela, le reglage
// enregistre ne prendrait effet qu'apres avoir rouvert les parametres.
setCueVolume(useDevices.getState().media.cueVolume);

/*
 * Le menu du navigateur ne s'ouvre plus dans le vide.
 *
 * « Enregistrer sous », « Afficher le code source », « Recharger » : rien de
 * tout cela n'a de sens dans une application, et l'on tombe dessus des qu'on
 * vise a cote d'un message ou d'un salon. Les menus de l'application, eux,
 * appellent deja `preventDefault` sur l'element vise ; ce garde-fou ne
 * s'applique donc qu'a ce qu'ils n'ont pas couvert.
 *
 * Deux exceptions gardees : les champs de saisie, ou l'on veut couper, copier
 * et coller, et le texte selectionne, ou l'on veut copier. Les supprimer
 * couterait plus que le menu ne gene.
 */
document.addEventListener('contextmenu', (event) => {
  const cible = event.target as HTMLElement | null;
  if (!cible) return;

  if (cible.closest('input, textarea, [contenteditable="true"]')) return;
  if ((window.getSelection()?.toString() ?? '').trim().length > 0) return;

  event.preventDefault();
});

const container = document.getElementById('root');
if (!container) throw new Error('Element racine introuvable.');

/**
 * Apercu d'un ecran isole pendant le developpement.
 *
 * `import.meta.env.DEV` est remplace par `false` a la compilation : le bloc et
 * le module qu'il importe disparaissent du paquet livre.
 */
async function root() {
  if (import.meta.env.DEV) {
    const wanted = new URLSearchParams(window.location.search).get('preview');
    if (wanted) {
      const { devPreview } = await import('./devPreview');
      const screen = devPreview(wanted);
      if (screen) return screen;
    }
  }
  return <App />;
}

/**
 * Retire l'ecran de chargement une fois la premiere image peinte.
 *
 * Deux images d'attente plutot qu'un retrait immediat : React rend son arbre
 * de maniere synchrone, mais le navigateur n'a pas encore peint. Retirer le
 * voile a cet instant laisse voir une fraction de seconde de page nue.
 */
function dismissSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      splash.classList.add('is-leaving');
      splash.addEventListener('transitionend', () => splash.remove(), { once: true });
      // Filet de securite : si la transition ne se declenche pas — animations
      // coupees, onglet en arriere-plan — le voile resterait pour toujours.
      window.setTimeout(() => splash.remove(), 600);
    }),
  );
}

void root().then((screen) => {
  createRoot(container).render(<StrictMode>{screen}</StrictMode>);
  dismissSplash();
});
