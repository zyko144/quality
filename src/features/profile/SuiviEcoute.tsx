import { useEffect, useRef } from 'react';
import { useSession } from '@/store/session';
import { useComptesLies } from '@/store/comptesLies';
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

    const relever = async () => {
      let lecture: Lecture | null = null;

      try {
        const { invoke } = await import('@tauri-apps/api/core');
        lecture = (await invoke<Lecture | null>('lecture_en_cours')) ?? null;
      } catch {
        // Version installee plus ancienne que ce code, ou commande absente :
        // on ne dit rien plutot que d'inventer.
        return;
      }

      if (arrete || memeMorceau(lecture, dernier.current)) return;
      dernier.current = lecture;

      if (!lecture || !lecture.joue) {
        await annoncer(null);
        return;
      }

      const pochette = lecture.image ? await reduirePochette(lecture.image) : null;
      if (arrete) return;

      await annoncer(versActivite(lecture, pochette));
    };

    void relever();
    const minuterie = window.setInterval(() => void relever(), CADENCE_LECTURE);

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
