import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { WindowControls } from './components/WindowControls';
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
import './styles/badges.css';
// En dernier : les regles mobiles surchargent celles des grands ecrans.
import './styles/mobile.css';
import { useSession } from '@/store/session';
import { suivreLesLiens } from './lib/liens';
import { installerJournal, journalAuteur } from './lib/journal';
import { useChat } from './store/chat';
import { supabase } from './lib/supabase';
import { adresseDeRetour, afficheLeSite, origineLocale } from './lib/retourBureau';

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

// Les liens sortants partent vers le navigateur du systeme : voir `liens.ts`.
suivreLesLiens();

/*
 * Le journal est installe avant le premier rendu.
 *
 * Une erreur au montage est precisement celle qu'on ne voit jamais : elle
 * arrive avant que quoi que ce soit puisse l'afficher, et la fenetre reste
 * blanche. L'installer plus tard reviendrait a n'attraper que les defauts
 * survenant dans une application deja debout — les moins mysterieux.
 */
installerJournal();

/*
 * Un morceau de l'application introuvable : on recharge, une fois.
 *
 * Les morceaux charges a la demande changent de nom a chaque version. Une page
 * ouverte avant un deploiement reclame ceux de la precedente, que le serveur
 * ne sert plus — « Failed to fetch dynamically imported module », a
 * l'ouverture du partage d'ecran, d'un reglage, de tout ce qui n'est pas
 * charge au demarrage. Recharger apporte les bons noms.
 *
 * Une fois par minute au plus : si le morceau manque vraiment, recharger en
 * boucle n'y changerait rien et rendrait la page inutilisable.
 */
window.addEventListener('vite:preloadError', (evenement) => {
  try {
    const derniere = Number(sessionStorage.getItem('echow:rechargement-module') ?? 0);
    if (Date.now() - derniere < 60_000) return;
    sessionStorage.setItem('echow:rechargement-module', String(Date.now()));
  } catch {
    return;
  }

  evenement.preventDefault();
  window.location.reload();
});

// On supprime les service workers s'ils existent (pour forcer la mise a jour de l'app bureau)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  });
}

/*
 * Les lignes suivantes portent le nom de qui est connecte.
 *
 * Sans cela, la console montrerait un journal sans auteur : on saurait qu'une
 * erreur a eu lieu, jamais chez qui, et l'on ne pourrait pas relier une plainte
 * a sa trace — ce qui est tout l'interet.
 */
useSession.subscribe((etat) => journalAuteur(etat.profile?.id ?? null));

/*
 * La fenetre de bureau ne tourne jamais depuis le site.
 *
 * Apres Google ou Discord, Supabase pouvait la renvoyer sur
 * `echowebplayer.vercel.app` : la version web, chargee depuis Internet, dans
 * la fenetre de bureau. Tauri y refuse tout ce qui depend du bureau — les
 * boutons de la fenetre, le partage d'ecran, la touche du micro, la recherche
 * de mise a jour. Voir `retourBureau.ts`.
 *
 * On ne rend donc rien : on renvoie la fenetre a l'application locale en lui
 * passant la session, et le voile de chargement tient pendant ce temps.
 * Rendre d'abord montrerait une interface dont la moitie refuse de marcher, le
 * temps d'une seconde qui suffit a cliquer dedans.
 *
 * `getSession` attend que le client ait lu le retour du fournisseur dans
 * l'adresse : la session existe donc deja quand on la transmet.
 */
const surLeSite = afficheLeSite(window.location.protocol, '__TAURI_INTERNALS__' in window);

if (surLeSite) {
  const origine = origineLocale(navigator.userAgent);

  void supabase.auth
    .getSession()
    .then(({ data }) => window.location.replace(adresseDeRetour(origine, data.session)))
    .catch(() => window.location.replace(adresseDeRetour(origine, null)));
}

if (!surLeSite) void root().then((screen) => {
  createRoot(container).render(
    <StrictMode>
      {screen}
      {/*
        Hors de l'ecran, et non dedans : chaque ecran qui les oubliait laissait
        une fenetre sans bouton pour la fermer. Voir `WindowControls`.
      */}
      <WindowControls />
    </StrictMode>,
  );

  /*
   * Le voile tient jusqu'a ce que la session soit connue.
   *
   * Le retirer des le premier rendu decouvrait une application qui ne savait
   * pas encore qui la regardait, et qui affichait donc son propre ecran
   * d'attente — deux chargements a la suite pour une seule attente.
   *
   * Le garde-fou de huit secondes existe pour le cas ou la session ne se
   * resoudrait jamais : mieux vaut une page vide qu'un voile eternel, car on
   * peut recharger la premiere.
   */
  /*
   * Le voile tient jusqu'a ce qu'il y ait quelque chose a montrer.
   *
   * Deux conditions, pas une : la session doit etre connue, et si elle existe,
   * les espaces doivent etre arrives. Ne tenir que la premiere decouvrait une
   * application qui affichait alors son propre ecran d'attente — deux
   * chargements a la suite pour une seule attente.
   *
   * Sans session, il n'y a rien a charger : on decouvre la page de connexion
   * tout de suite.
   */
  const pret = () => {
    const session = useSession.getState();
    if (session.loading) return false;
    if (!session.session) return true;
    return useChat.getState().ready;
  };

  if (pret()) {
    dismissSplash();
  } else {
    const arrets: (() => void)[] = [];

    const verifier = () => {
      if (!pret()) return;
      for (const arret of arrets) arret();
      dismissSplash();
    };

    arrets.push(useSession.subscribe(verifier), useChat.subscribe(verifier));

    /*
     * Huit secondes, et l'on decouvre quoi qu'il arrive.
     *
     * Si le chargement n'aboutit jamais — reseau coupe, base injoignable —
     * mieux vaut une application vide qu'un voile eternel : la premiere se
     * recharge, la seconde ne dit rien et ne mene nulle part.
     */
    window.setTimeout(() => {
      for (const arret of arrets) arret();
      dismissSplash();
    }, 8000);
  }
});
