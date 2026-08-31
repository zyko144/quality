import { useEffect } from 'react';
import { useVoice } from './useVoice';
import { useRaccourcis, correspond } from '@/store/raccourcis';

/**
 * Parler en maintenant une touche.
 *
 * Toutes les autres commandes vocales sont des bascules : une pression, un
 * changement d'etat. Celle-ci suit l'enfoncement et le relachement, ce qui
 * demande d'ecouter deux evenements et de tenir ce qu'il y avait avant.
 *
 * Ce qu'elle rend est ce qu'elle a trouve
 * ----------------------------------------
 * Relacher la touche ne coupe pas le micro : il rend l'etat qui precedait
 * l'appui. Quelqu'un qui parlait deja micro ouvert continue de parler, sans
 * quoi la premiere pression sur la touche l'aurait coupe pour de bon — et
 * c'est exactement le genre de surprise qu'on ne relie jamais a un raccourci.
 *
 * La repetition automatique est ignoree
 * --------------------------------------
 * Maintenir une touche emet une rafale d'evenements. Sans ce filtre, chacun
 * relirait l'etat courant — devenu « ouvert » depuis le premier — et le
 * memoriserait comme etat a rendre. On ne reviendrait alors jamais au silence.
 */
export function PousserPourParler() {
  const raccourcis = useRaccourcis((state) => state.liste);

  useEffect(() => {
    const combinaison =
      raccourcis.find((entree) => entree.action === 'pousser-pour-parler')?.combinaison ?? null;

    if (!combinaison) return;

    /** Etat du micro avant l'appui, ou `null` si la touche n'est pas tenue. */
    let avant: boolean | null = null;

    const dansUneSaisie = (cible: EventTarget | null) => {
      const noeud = cible as HTMLElement | null;
      if (!noeud) return false;
      return (
        noeud.tagName === 'INPUT' ||
        noeud.tagName === 'TEXTAREA' ||
        noeud.isContentEditable === true
      );
    };

    const enfoncee = (event: KeyboardEvent) => {
      if (event.repeat || avant !== null) return;
      if (!correspond(event, combinaison)) return;

      // Une touche de conversation ne doit pas s'activer pendant qu'on ecrit :
      // la lettre irait dans le message et le micro s'ouvrirait par surprise.
      if (dansUneSaisie(event.target)) return;

      const voix = useVoice.getState();
      if (!voix.channelId) return;

      event.preventDefault();
      avant = voix.muted;

      // Deja ouvert : rien a faire, mais on retient l'etat pour le rendre.
      if (voix.muted) voix.toggleMute();
    };

    const relachee = (event: KeyboardEvent) => {
      if (avant === null) return;
      if (event.code !== combinaison.code) return;

      const voix = useVoice.getState();
      const aRendre = avant;
      avant = null;

      if (!voix.channelId) return;
      if (voix.muted !== aRendre) voix.toggleMute();
    };

    /*
     * La fenetre peut perdre le focus touche enfoncee — un alt-tab en pleine
     * phrase. Le relachement partirait alors ailleurs et le micro resterait
     * ouvert sans qu'on tienne quoi que ce soit.
     */
    const perdue = () => {
      if (avant === null) return;

      const voix = useVoice.getState();
      const aRendre = avant;
      avant = null;

      if (voix.channelId && voix.muted !== aRendre) voix.toggleMute();
    };

    window.addEventListener('keydown', enfoncee);
    window.addEventListener('keyup', relachee);
    window.addEventListener('blur', perdue);

    return () => {
      window.removeEventListener('keydown', enfoncee);
      window.removeEventListener('keyup', relachee);
      window.removeEventListener('blur', perdue);
      perdue();
    };
  }, [raccourcis]);

  return null;
}
