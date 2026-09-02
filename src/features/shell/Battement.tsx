import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/store/session';
import { BATTEMENT } from '@/lib/presence';

/**
 * Le signe de vie, envoye a intervalle regulier.
 *
 * Un composant sans rendu. Il repare un defaut qu'on ne pouvait pas corriger
 * autrement : l'etat « en ligne » etait pose a la connexion et retire par une
 * requete envoyee pendant que la page disparait. Cela marche quand on ferme
 * proprement, et seulement dans ce cas — une veille, un processus tue, une
 * coupure, et le compte restait affiche « en ligne » indefiniment.
 *
 * On ne peut pas soigner un adieu qui n'a pas lieu. On dit donc « je suis la »
 * regulierement, et celui qui cesse de le dire cesse d'etre en ligne, sans que
 * personne ait a l'annoncer. Voir `lib/presence.ts` pour la lecture.
 *
 * Le battement s'arrete quand l'onglet passe en arriere-plan et repart au
 * retour : une fenetre reduite depuis une heure n'est pas une presence, et
 * continuer a battre reviendrait a mentir poliment.
 */
export function Battement() {
  const session = useSession((state) => state.session);

  useEffect(() => {
    if (!session) return;

    let vivant = true;

    const battre = async () => {
      if (!vivant || document.visibilityState === 'hidden') return;

      try {
        /*
         * Par une fonction plutot qu'une mise a jour directe.
         *
         * Elle est minuscule et ne touche qu'une colonne : c'est l'ecriture la
         * plus frequente de toute l'application, une par minute et par personne
         * connectee, et tout ce qu'on y ajouterait serait paye a ce rythme.
         *
         * L'echec est ignore : la fonction n'existe pas tant que la migration
         * n'est pas appliquee, et l'application doit fonctionner avant comme
         * apres. Sans battement, la lecture retombe simplement sur l'etat
         * declare — le comportement d'avant.
         */
        await supabase.rpc('battement', { nouvel_etat: null });
      } catch {
        // Rien a faire : un battement perdu sera suivi d'un autre.
      }
    };

    void battre();
    const minuterie = window.setInterval(() => void battre(), BATTEMENT);

    // Revenir a la fenetre vaut signe de vie : sans cela, on resterait affiche
    // hors ligne jusqu'au battement suivant, soit une minute apres etre revenu.
    const auRetour = () => {
      if (document.visibilityState === 'visible') void battre();
    };
    document.addEventListener('visibilitychange', auRetour);

    return () => {
      vivant = false;
      window.clearInterval(minuterie);
      document.removeEventListener('visibilitychange', auRetour);
    };
  }, [session]);

  return null;
}
