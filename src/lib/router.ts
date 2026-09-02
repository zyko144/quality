import { useCallback, useSyncExternalStore } from 'react';

/**
 * Routeur minimal.
 *
 * L'application n'a que trois surfaces publiques : la presentation, la
 * connexion, et l'application elle-meme. Une bibliotheque de routage
 * apporterait ici un chargeur de routes, des routes imbriquees et un systeme de
 * parametres dont rien n'a besoin, pour une trentaine de kilo-octets.
 *
 * `useSyncExternalStore` s'abonne au moment ou React lit la valeur : aucune
 * fenetre ne subsiste entre le premier rendu et l'abonnement pendant laquelle
 * un retour arriere passerait inapercu.
 */

export type Route = '/' | '/connexion' | '/app';

const KNOWN: Route[] = ['/', '/connexion', '/app'];

function currentPath(): Route {
  const path = window.location.pathname;
  return (KNOWN.find((route) => route === path) ?? '/') as Route;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Sommes-nous dans l'application de bureau ?
 *
 * La vue web y sert ses fichiers par un protocole a elle, qui ne resout que
 * l'adresse de base. Ecrire `/connexion` dans l'historique n'y deplace donc pas
 * la page : cela declenche une VRAIE navigation, le protocole ne trouve rien, et
 * la fenetre repart sur l'adresse de base — ecran de chargement compris.
 *
 * Le bouton paraissait alors ne mener nulle part, alors qu'il rechargeait tout.
 * Garder la route en memoire n'y suffisait pas : le rechargement remet ce module
 * a zero, et la memoire avec.
 *
 * On n'y touche donc pas a l'historique. Ce qu'on y perd — le bouton
 * « precedent », une adresse qui dit ou l'on est — n'existe de toute facon pas
 * dans une fenetre sans barre d'adresse.
 */
const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * La route en cours, tenue en memoire.
 *
 * Elle etait lue dans `window.location.pathname` a chaque rendu, et l'adresse
 * faisait donc foi. Cela suppose que `pushState` aboutisse — vrai dans un
 * navigateur, pas garanti dans la vue web de l'application de bureau, qui sert
 * les fichiers par un protocole a elle. Quand l'appel n'aboutissait pas, le
 * chemin restait le meme, React relisait la meme valeur, et l'ecran ne bougeait
 * pas : « Acces equipe » ne faisait rien du tout, sans la moindre erreur.
 *
 * La memoire fait donc foi, et l'adresse la suit quand elle le peut. La
 * navigation ne depend plus d'une interface qui a le droit de refuser.
 */
let routeActuelle: Route =
  typeof window === 'undefined' || DANS_TAURI ? '/' : currentPath();

function lireRoute(): Route {
  return routeActuelle;
}

// `popstate` couvre les boutons precedent et suivant : c'est le seul cas ou
// l'adresse change sans passer par `navigate`, et la memoire doit s'y remettre.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    // Dans l'application de bureau, l'adresse ne suit pas la route : la relire
    // ramenerait a l'accueil au premier evenement venu.
    if (DANS_TAURI) return;
    routeActuelle = currentPath();
    notify();
  });
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  if (routeActuelle === route) return;

  routeActuelle = route;

  /*
   * L'adresse est mise a jour si elle veut bien l'etre.
   *
   * Elle n'est pas la source de verite : elle sert a ce que le bouton
   * « precedent » et un rechargement retombent au bon endroit. Un protocole qui
   * refuse l'ecriture prive de ces deux commodites, ce qui est supportable ;
   * empecher de changer d'ecran ne l'est pas.
   */
  if (!DANS_TAURI) {
    try {
      if (options.replace) window.history.replaceState(null, '', route);
      else window.history.pushState(null, '', route);
    } catch {
      // Volontairement muet : l'application vient de changer d'ecran, et le seul
      // effet est que l'adresse ne le dit pas.
    }
  }

  notify();
  window.scrollTo(0, 0);
}

export function useRoute(): { route: Route; go: (route: Route) => void } {
  const route = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    lireRoute,
    () => '/' as Route,
  );

  const go = useCallback((next: Route) => navigate(next), []);

  return { route, go };
}
