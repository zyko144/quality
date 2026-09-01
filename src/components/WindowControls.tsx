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
   * Trois pastilles de couleur, sans dessin a l'interieur.
   *
   * Le trait, le carre et la croix disaient la meme chose que la position :
   * a droite d'une fenetre, on sait depuis trente ans ce que font ces trois
   * boutons dans cet ordre. La couleur suffit donc, et elle se lit de plus
   * loin qu'un trait d'un pixel — vert pour reduire, orange pour agrandir,
   * rouge pour fermer.
   *
   * Ce qui n'est PAS retire, c'est le nom : `aria-label` et `title` restent.
   * Une couleur ne se lit ni au clavier, ni par un lecteur d'ecran, ni par qui
   * ne distingue pas le vert du rouge — et ils sont nombreux. Sans ces deux
   * attributs, ce changement aurait rendu la fenetre impilotable pour eux.
   */
  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control window-control--reduire"
        onClick={() => agir('reduire')}
        aria-label="Reduire la fenetre"
        title="Reduire"
      />

      <button
        type="button"
        className="window-control window-control--agrandir"
        onClick={() => agir('basculer')}
        aria-label={agrandie ? 'Restaurer la fenetre' : 'Agrandir la fenetre'}
        title={agrandie ? 'Restaurer' : 'Agrandir'}
      />

      <button
        type="button"
        className="window-control window-control--fermer"
        onClick={() => agir('fermer')}
        aria-label="Fermer la fenetre"
        title="Fermer"
      />
    </div>
  );
}
