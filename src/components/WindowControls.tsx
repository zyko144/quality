import { useEffect, useState } from 'react';

/**
 * Commandes de fenetre integrees a l'application.
 *
 * La barre de titre du systeme est desactivee (`decorations: false`) : elle
 * imposait un bandeau gris au-dessus d'une interface sombre, avec ses propres
 * coins carres par-dessus les notres. On la redessine donc ici, dans l'en-tete,
 * avec le reste.
 *
 * En echange, deux choses reviennent a notre charge :
 *  - deplacer la fenetre, confie a `data-tauri-drag-region` sur l'en-tete ;
 *  - les boutons ci-dessous.
 *
 * Le composant ne rend rien hors du bureau : sur le web, la fenetre appartient
 * au navigateur.
 */

const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/*
 * macOS garde ses propres pastilles.
 *
 * Le systeme les dessine lui-meme, en haut a gauche, et la fenetre est
 * configuree pour qu'elles flottent sur le contenu — `titleBarStyle: Overlay`.
 * En redessiner trois autres a droite donnerait six boutons pour trois
 * actions, dont trois au mauvais endroit pour qui utilise un Mac.
 */
const SUR_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function WindowControls() {
  const [agrandie, setAgrandie] = useState(false);

  useEffect(() => {
    if (!DANS_TAURI || SUR_MAC) return;
    let annule = false;
    let detacher: (() => void) | undefined;

    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const fenetre = getCurrentWindow();

      setAgrandie(await fenetre.isMaximized());
      if (annule) return;

      // Le double-clic sur la zone de deplacement, et le glisser vers le haut,
      // agrandissent la fenetre sans passer par nos boutons : l'icone doit
      // suivre, sinon elle propose de restaurer une fenetre qui ne l'est pas.
      const arret = await fenetre.onResized(() => {
        void fenetre.isMaximized().then((valeur) => {
          if (!annule) setAgrandie(valeur);
        });
      });

      if (annule) arret();
      else detacher = arret;
    })();

    return () => {
      annule = true;
      detacher?.();
    };
  }, []);

  if (!DANS_TAURI || SUR_MAC) return null;

  const agir = (action: 'reduire' | 'basculer' | 'fermer') => {
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const fenetre = getCurrentWindow();

        if (action === 'reduire') await fenetre.minimize();
        else if (action === 'fermer') await fenetre.close();
        else await fenetre.toggleMaximize();
      } catch (cause) {
        /*
         * Un refus doit s'entendre.
         *
         * Ces appels passent par le systeme de permissions de Tauri : sans la
         * capacite correspondante, la promesse est rejetee et il ne se passe
         * rien du tout. Le bouton parait casse, et rien n'indique ou chercher —
         * c'est exactement ce qui est arrive a « Fermer » et « Agrandir »,
         * accordees nulle part pendant que « Reduire » l'etait.
         */
        console.error(`Commande de fenetre refusee (${action}) :`, cause);
      }
    })();
  };

  /*
   * Le dessin et la couleur, plutot que l'un ou l'autre.
   *
   * Une version precedente n'avait garde que des pastilles de couleur. La
   * couleur se lit de loin, mais elle ne dit pas laquelle des trois fait quoi a
   * qui ne le sait pas deja — et elle ne dit rien du tout a qui ne distingue
   * pas le vert du rouge, ce qui est frequent.
   *
   * Le dessin est donc revenu, et la couleur reste : discrete au repos, elle
   * s'allume sous le curseur. On voit ce qu'on s'apprete a faire au moment ou
   * cela compte, c'est-a-dire juste avant de cliquer.
   *
   * Les traits sont dessines en coordonnees de dix par dix et rendus a douze
   * pixels : les extremites tombent sur des demi-pixels, ce qui evite le trait
   * gris et fantome qu'on obtient en visant les bords entiers.
   */
  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control window-control--reduire"
        onClick={() => agir('reduire')}
        aria-label="Reduire la fenetre"
        title="Reduire"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 5.5h7" />
        </svg>
      </button>

      <button
        type="button"
        className="window-control window-control--agrandir"
        onClick={() => agir('basculer')}
        aria-label={agrandie ? 'Restaurer la fenetre' : 'Agrandir la fenetre'}
        title={agrandie ? 'Restaurer' : 'Agrandir'}
      >
        {agrandie ? (
          // Deux cadres decales : la fenetre qu'on va rendre a sa taille, et
          // celle qu'elle laisse derriere. Le trait interrompu evite que les
          // deux se confondent en une grille.
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3.5 3.5V1.5h5v5h-2" />
            <rect x="1.5" y="3.5" width="5" height="5" rx="0.8" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="window-control window-control--fermer"
        onClick={() => agir('fermer')}
        aria-label="Fermer la fenetre"
        title="Fermer"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      </button>
    </div>
  );
}
