import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useVoice } from './useVoice';

/**
 * Le temps passe en salon vocal.
 *
 * Il n'etait mesure nulle part, et un badge qui recompense une chose qu'on ne
 * compte pas ne peut pas etre attribue.
 *
 * Ce qu'on garde, et ce qu'on ne garde pas
 * ----------------------------------------
 * Un total cumule, en secondes. Pas les sessions : qui etait ou, avec qui, de
 * quand a quand, ce serait un journal de presence conserve indefiniment. Un
 * total ne dit que « a beaucoup discute », ce qui est tout ce dont un badge a
 * besoin.
 *
 * Pourquoi on rapporte souvent plutot qu'a la sortie
 * --------------------------------------------------
 * Rapporter seulement en quittant paraissait economique et perdait tout : une
 * fermeture brutale, un plantage, une coupure de courant, et trois heures de
 * conversation disparaissent. C'est le meme raisonnement que la presence — on
 * ne peut pas compter sur un adieu qui n'a pas lieu.
 *
 * Cinq minutes est le pas : on perd au pire cinq minutes, et cela fait douze
 * ecritures par heure et par personne en vocal.
 */

/** Intervalle entre deux rapports, en millisecondes. */
const PAS = 5 * 60 * 1000;

export function TempsVocal() {
  const channelId = useVoice((etat) => etat.channelId);

  /** Depuis quand le temps courant n'a pas ete rapporte. */
  const depuis = useRef<number | null>(null);

  useEffect(() => {
    if (!channelId) {
      depuis.current = null;
      return;
    }

    depuis.current = Date.now();

    /** Envoie ce qui s'est ecoule, et repart de zero. */
    const rapporter = () => {
      const debut = depuis.current;
      if (debut === null) return;

      const secondes = Math.round((Date.now() - debut) / 1000);
      depuis.current = Date.now();

      // Sous une minute, cela ne vaut pas une ecriture : entrer et ressortir
      // aussitot d'un salon ne compte pas comme du temps passe.
      if (secondes < 60) return;

      /*
       * L'echec est ignore, et volontairement.
       *
       * La fonction n'existe pas tant que la migration n'est pas appliquee, et
       * l'application doit fonctionner avant comme apres. Un total qui ne monte
       * pas ne se voit pas ; une erreur a chaque cinq minutes, si.
       */
      // `rpc` rend un constructeur de requete, pas une promesse : `.catch`
      // n'existe pas dessus. On l'enveloppe pour avaler l'echec.
      void (async () => {
        try {
          await supabase.rpc('ajouter_temps_vocal', { p_secondes: secondes });
        } catch {
          // Voir plus haut : un total qui ne monte pas ne se voit pas.
        }
      })();
    };

    const minuterie = window.setInterval(rapporter, PAS);

    /*
     * On rapporte aussi en quittant la fenetre.
     *
     * `pagehide` part meme quand l'onglet se ferme, ce que `beforeunload` ne
     * garantit plus. Ce n'est pas une garantie — la requete peut ne pas
     * aboutir — mais c'est gratuit, et cela rattrape le cas ordinaire.
     */
    const auDepart = () => rapporter();
    window.addEventListener('pagehide', auDepart);

    return () => {
      window.removeEventListener('pagehide', auDepart);
      window.clearInterval(minuterie);

      // En quittant le salon, on rend le temps restant : c'est le cas le plus
      // frequent, et le seul qu'on maitrise vraiment.
      rapporter();
      depuis.current = null;
    };
  }, [channelId]);

  return null;
}
