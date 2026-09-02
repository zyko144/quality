import { useEffect } from 'react';
import { useUI } from '@/store/ui';
import { commencer, progression, conclure, type Glisse } from './glisse';

/**
 * Le tiroir suit le doigt.
 *
 * Un composant sans rendu : il ecoute le toucher sur toute la page et deplace
 * le tiroir pendant le geste, plutot que d'attendre qu'on lache pour le faire
 * apparaitre d'un coup. La difference n'est pas cosmetique — un tiroir qui
 * suit le doigt dit ou l'on en est et se laisse annuler a mi-chemin ; un tiroir
 * qui surgit apres coup laisse dans le doute jusqu'au dernier instant.
 *
 * Il n'existe que sur petit ecran : ailleurs la navigation est posee a cote de
 * la conversation et n'a rien a decouvrir.
 *
 * Les seuils vivent dans `glisse.ts`, avec leurs cas. Un geste mal regle ne
 * tombe pas en panne, il devient penible : trop sensible, le tiroir s'ouvre en
 * defilant ; trop exigeant, il ne repond pas et l'on croit l'application figee.
 */
export function TiroirGlissant({ actif }: { actif: boolean }) {
  useEffect(() => {
    if (!actif) return;

    const tiroir = document.querySelector<HTMLElement>('.workspace__nav');
    if (!tiroir) return;

    let etat: Glisse | null = null;

    /** Pose le tiroir a une fraction de sa course, sans animation. */
    const placer = (part: number) => {
      tiroir.style.transition = 'none';
      tiroir.style.transform = `translateX(${(part - 1) * 100}%)`;
      // L'ombre accompagne l'avancee : elle detache le tiroir du fond au fur et
      // a mesure, au lieu d'apparaitre d'un coup a la fin.
      tiroir.style.boxShadow = part > 0.02 ? 'var(--shadow-lg)' : 'none';
    };

    /** Rend la main au CSS, qui reprend avec sa transition. */
    const relacher = () => {
      tiroir.style.transition = '';
      tiroir.style.transform = '';
      tiroir.style.boxShadow = '';
    };

    const debut = (event: TouchEvent) => {
      const doigt = event.touches[0];
      if (!doigt || event.touches.length > 1) return;

      etat = commencer(
        doigt.clientX,
        doigt.clientY,
        useUI.getState().navOpen,
        tiroir.offsetWidth,
      );
    };

    const bouge = (event: TouchEvent) => {
      if (!etat) return;

      const doigt = event.touches[0];
      if (!doigt) return;

      const part = progression(etat, doigt.clientX, doigt.clientY);
      if (part === null) {
        // Le geste s'est avere vertical : on rend ce qu'on avait pris.
        if (etat.sens === 'vertical') {
          relacher();
          etat = null;
        }
        return;
      }

      /*
       * On empeche le defilement pendant un geste horizontal.
       *
       * Sans cela, la page glisse en meme temps que le tiroir et l'on obtient
       * deux mouvements pour un doigt. L'ecouteur est donc pose en mode non
       * passif — voir plus bas — sans quoi le navigateur refuse cet appel.
       */
      event.preventDefault();
      placer(part);
    };

    const fin = () => {
      if (!etat) return;

      const dernier = etat;
      etat = null;

      if (dernier.sens !== 'horizontal') {
        relacher();
        return;
      }

      const ouvert = conclure(dernier, dernierX);
      relacher();

      const ui = useUI.getState();
      if (ouvert !== ui.navOpen) {
        if (ouvert) ui.openNav();
        else ui.closeNav();
      }
    };

    /*
     * La derniere position est retenue a part.
     *
     * `touchend` ne porte pas de `touches` — le doigt n'est plus la — et
     * `changedTouches` existe mais decrit la levee, pas le trajet. Retenir le
     * dernier point du mouvement est plus sur que de lire un evenement qui
     * decrit autre chose.
     */
    let dernierX = 0;
    const noter = (event: TouchEvent) => {
      const doigt = event.touches[0];
      if (doigt) dernierX = doigt.clientX;
    };

    document.addEventListener('touchstart', debut, { passive: true });
    document.addEventListener('touchmove', noter, { passive: true });
    document.addEventListener('touchmove', bouge, { passive: false });
    document.addEventListener('touchend', fin);
    document.addEventListener('touchcancel', fin);

    return () => {
      document.removeEventListener('touchstart', debut);
      document.removeEventListener('touchmove', noter);
      document.removeEventListener('touchmove', bouge);
      document.removeEventListener('touchend', fin);
      document.removeEventListener('touchcancel', fin);
      relacher();
    };
    // `navOpen` est relu a chaque geste par le magasin : le laisser hors des
    // dependances evite de reposer cinq ecouteurs a chaque ouverture.
  }, [actif]);

  return null;
}
