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
      .catch(() => {
        // Greffon absent ou permission refusee : mieux vaut ne rien faire que
        // detourner la fenetre de l'application vers un site tiers.
        console.error('Impossible d’ouvrir le lien dans le navigateur :', lien.href);
      });
  };

  document.addEventListener('click', surClic);
  return () => document.removeEventListener('click', surClic);
}
