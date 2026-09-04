/**
 * Les liens sortants partent vers le navigateur du systeme.
 *
 * Dans un navigateur, `target="_blank"` ouvre un onglet et l'affaire est
 * entendue. Dans l'application de bureau, la vue web n'a pas de gestionnaire
 * de nouvelle fenetre : le clic ne faisait donc rien du tout. Selon la version
 * du moteur, il pouvait aussi faire pire — remplacer le contenu de la fenetre
 * par le site vise, sans barre d'adresse ni bouton de retour. On se retrouvait
 * sur un site tiers en croyant etre encore dans l'application, ce qui est
 * exactement la situation qu'une barre d'adresse existe pour eviter.
 *
 * L'interception est posee une fois, sur le document, plutot que sur chaque
 * lien : les messages en creent en permanence, et un gestionnaire par lien
 * serait a la fois oublie quelque part et paye mille fois.
 */

import { journal } from './journal';

const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Le lien mene-t-il hors de l'application ?
 *
 * Les adresses relatives et celles de notre propre origine restent internes :
 * les detourner vers le navigateur ferait sortir de l'application pour aller
 * a une page qu'elle sait afficher.
 */
function estExterne(href: string): boolean {
  try {
    const cible = new URL(href, window.location.href);
    if (cible.origin === window.location.origin) return false;
    // Seuls `http` et `https` passent. Un `javascript:` ou un `file:` n'a rien
    // a faire dans le navigateur du systeme, et rien a faire ici non plus.
    return cible.protocol === 'http:' || cible.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Pose l'interception. Rend une fonction qui la retire. */
export function suivreLesLiens(): () => void {
  if (!DANS_TAURI) return () => undefined;

  const surClic = (event: MouseEvent) => {
    // Un clic deja traite ailleurs, ou avec une touche de modification — le
    // milieu, Ctrl — appartient a qui l'a intercepte avant nous.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const lien = (event.target as Element | null)?.closest?.('a[href]');
    if (!(lien instanceof HTMLAnchorElement)) return;

    const href = lien.getAttribute('href');
    if (!href || !estExterne(href)) return;

    event.preventDefault();

    void import('@tauri-apps/plugin-opener')
      .then(({ openUrl }) => openUrl(lien.href))
      .catch((cause: unknown) => {
        /*
         * L'echec est journalise, et il l'a ete trop tard.
         *
         * Il ne l'etait pas : un `console.error` dans une vue web sans outils
         * de developpement ne se lit nulle part. Le clic ne faisait donc rien,
         * en silence, et l'application paraissait simplement cassee — c'est
         * exactement ainsi que le defaut a ete rapporte, sans qu'aucune trace
         * n'existe pour le nommer.
         *
         * La cause etait une permission : `opener:allow-open-url` autorise la
         * COMMANDE mais ne dit rien des adresses, et sa portee vide les
         * refusait toutes. Il y manquait `opener:allow-default-urls`. Une ligne
         * ici l'aurait dit tout de suite.
         *
         * On ne se rabat pas sur une navigation dans la fenetre : cela
         * remplacerait l'application par le site vise, sans barre d'adresse ni
         * retour possible.
         */
        journal.erreur('interface', 'Lien externe refuse par le systeme', {
          hote: (() => {
            try {
              return new URL(lien.href).host;
            } catch {
              return 'illisible';
            }
          })(),
          cause: String(cause),
        });
      });
  };

  document.addEventListener('click', surClic);
  return () => document.removeEventListener('click', surClic);
}
