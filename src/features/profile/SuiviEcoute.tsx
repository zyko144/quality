import { useEffect, useRef } from 'react';
import { useSession } from '@/store/session';
import { useComptesLies } from '@/store/comptesLies';
import { journal } from '@/lib/journal';
import {
  CADENCE_LECTURE,
  memeMorceau,
  reduirePochette,
  versActivite,
  type Lecture,
} from './ecoute';

/**
 * Annonce ce qu'on ecoute, tant que le reglage est actif.
 *
 * Un composant sans rendu : il n'a rien a montrer, il observe et publie. Pose
 * une fois au niveau de l'espace de travail, il vit aussi longtemps que la
 * session.
 *
 * Trois garde-fous, et chacun repare un defaut previsible
 * -------------------------------------------------------
 * **Le reglage d'abord.** Rien n'est lu tant qu'il est eteint. Lire sans
 * publier serait deja de trop : ce module existe pour dire aux autres ce qu'on
 * ecoute, et ne pas le lire est la seule facon honnete de ne rien en dire.
 *
 * **On ne publie qu'au CHANGEMENT.** La position avance a chaque releve ; s'en
 * servir ferait une ecriture toutes les dix secondes par personne, laquelle
 * partirait aussi dans le direct vers tous ceux qui regardent. C'est
 * exactement la depense qu'on vient de corriger ailleurs.
 *
 * **On efface en partant.** Sans cela, on resterait « en train d'ecouter »
 * indefiniment apres avoir ferme l'application — l'annonce serait fausse et
 * personne ne pourrait la corriger.
 */
export function SuiviEcoute() {
  const actif = useSession((etat) => etat.preferences.partagerEcoute);
  const connecte = useSession((etat) => Boolean(etat.profile?.id));
  const annoncer = useComptesLies((etat) => etat.annoncer);

  /** Le dernier morceau publie. Sert a ne rien republier d'identique. */
  const dernier = useRef<Lecture | null>(null);

  useEffect(() => {
    if (!connecte) return;

    /*
     * Le reglage vient d'etre eteint : on retire ce qu'on avait annonce.
     *
     * Le faire ici plutot qu'au clic du reglage evite d'avoir a s'en souvenir a
     * deux endroits — et couvre le cas ou le reglage change pendant qu'on est
     * hors ligne.
     */
    if (!actif) {
      if (dernier.current !== null) {
        dernier.current = null;
        void annoncer(null);
      }
      return;
    }

    // La lecture n'existe que dans l'application de bureau : ailleurs, aucun
    // systeme ne nous dira ce que le navigateur joue.
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;

    let arrete = false;
    let echecs = 0;

    const relever = async () => {
      let lecture: Lecture | null = null;

      const depart = performance.now();

      try {
        const { invoke } = await import('@tauri-apps/api/core');
        lecture = (await invoke<Lecture | null>('lecture_en_cours')) ?? null;
      } catch (cause) {
        /*
         * Trois echecs, et l'on s'arrete pour de bon.
         *
         * Cette boucle a rendu l'application inutilisable une fois : la
         * commande etait synchrone, donc executee sur le fil qui dessine la
         * fenetre, et l'attente y gelait tout. « Echow ne repond pas », et
         * cliquer n'importe ou faisait apparaitre la boite de Windows qui
         * propose de fermer le programme — ce qui ressemble a un plantage.
         *
         * La cause est corrigee cote natif. Ce compteur est la pour que le
         * MEME genre de defaut ne puisse plus enfermer personne : un reglage
         * qu'on ne peut plus atteindre pour l'eteindre est bien pire qu'une
         * fonction qui s'arrete d'elle-meme.
         */
        echecs += 1;

        if (echecs === 1) {
          journal.alerte('interface', 'Lecture en cours illisible', {
            cause: String(cause),
            ms: Math.round(performance.now() - depart),
          });
        }

        if (echecs >= 3) {
          window.clearInterval(minuterie);
          journal.erreur('interface', 'Suivi de l ecoute arrete', { echecs });
        }

        return;
      }

      /*
       * Une reponse trop lente arrete aussi le suivi.
       *
       * La commande est desormais portee par un fil qui n'est pas celui de la
       * fenetre, donc une attente ne gele plus rien. Mais une attente longue
       * signale que quelque chose ne va pas — un lecteur qui ne repond plus,
       * un systeme charge — et repeter l'appel toutes les dix secondes ne
       * ferait qu'empiler des attentes.
       */
      const duree = performance.now() - depart;
      if (duree > 4000) {
        window.clearInterval(minuterie);
        journal.erreur('interface', 'Suivi de l ecoute arrete', { ms: Math.round(duree) });
        return;
      }

      echecs = 0;

      if (arrete || memeMorceau(lecture, dernier.current)) return;
      dernier.current = lecture;

      if (!lecture || !lecture.joue) {
        await annoncer(null);
        return;
      }

      /*
       * La pochette se demande a PART, et seulement quand le titre a change.
       *
       * Elle pese jusqu'a plusieurs centaines de kilo-octets une fois encodee.
       * La joindre a chaque releve la faisait traverser le pont toutes les dix
       * secondes pour redire la meme image.
       */
      let pochette: string | null = null;

      if (lecture.a_une_pochette) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const brute = await invoke<string>('pochette_en_cours');
          pochette = brute ? await reduirePochette(brute) : null;
        } catch {
          // Une pochette manquante est un detail d'affichage, jamais une
          // raison de ne rien dire de ce qui joue.
        }
      }

      if (arrete) return;

      await annoncer(versActivite(lecture, pochette));
    };

    const minuterie = window.setInterval(() => void relever(), CADENCE_LECTURE);
    void relever();

    return () => {
      arrete = true;
      window.clearInterval(minuterie);
    };
  }, [actif, connecte, annoncer]);

  /*
   * On efface en fermant l'application.
   *
   * `beforeunload` est le seul moment ou l'on sache encore parler. Une requete
   * ordinaire y serait annulee — d'ou `annoncer`, qui passe par le client
   * Supabase, et dont on accepte qu'il n'aboutisse pas toujours : l'annonce
   * expire de toute facon a la prochaine ouverture.
   */
  useEffect(() => {
    if (!actif) return;

    const enPartant = () => {
      if (dernier.current !== null) void annoncer(null);
    };

    window.addEventListener('beforeunload', enPartant);
    return () => window.removeEventListener('beforeunload', enPartant);
  }, [actif, annoncer]);

  return null;
}
