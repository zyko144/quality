import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/store/session';
import { useBadges } from '@/store/badges';
import { journal } from '@/lib/journal';
import { badgesMerites, mesuresUtiles, type Mesures } from './paliers';

/**
 * Ce qui attribue les badges.
 *
 * Sans ce composant, le catalogue existe et personne n'obtient rien : des
 * badges qu'on ne peut pas gagner sont une decoration, pas une recompense.
 *
 * Les paliers ne sont plus ecrits ici
 * -----------------------------------
 * Ils l'ont ete, en double : une fois en SQL dans le catalogue, une fois ici.
 * Les deux listes ont diverge des la premiere modification — le catalogue
 * proposait `espace-10` que ce fichier n'attribuait jamais, et ce fichier
 * visait `espace-100` qui n'existait pas. Deux defauts inverses, et aucun des
 * deux visible : un badge simplement jamais donne, et personne ne remarque
 * l'absence de quelque chose.
 *
 * Les seuils se lisent desormais dans la cle du badge — voir `paliers.ts`.
 * Ajouter un palier redevient une ligne de SQL, et ce fichier suit tout seul.
 *
 * Pourquoi ici et pas dans la base
 * --------------------------------
 * Un declencheur cote base serait plus sur — il ne dependrait pas de
 * l'application — mais il en faudrait un par condition, et chacun s'executerait
 * a chaque ecriture de la table qu'il surveille. « Dix mille messages »
 * couterait un comptage a chaque message envoye par qui que ce soit.
 *
 * La verification a donc lieu une fois par ouverture de session. C'est
 * suffisant : un badge obtenu trois minutes plus tard reste obtenu, et personne
 * ne regarde sa collection a la seconde pres.
 *
 * La rarete, elle, reste tenue par la base : `attribuer_badge` compte et insere
 * dans la meme instruction, sous un verrou. Deux personnes qui arrivent en meme
 * temps sur la centieme place ne peuvent pas l'obtenir toutes les deux.
 */
export function AttributionBadges() {
  const profile = useSession((etat) => etat.profile);
  const reclamer = useBadges((etat) => etat.reclamer);
  const charger = useBadges((etat) => etat.charger);

  useEffect(() => {
    if (!profile) return;

    let abandonne = false;

    void (async () => {
      await charger();
      if (abandonne) return;

      const catalogue = useBadges.getState().catalogue;
      const deja = new Set(
        (useBadges.getState().parProfil[profile.id] ?? []).map((entree) => entree.badge_cle),
      );

      /** Demande un badge, si on ne l'a pas deja. */
      const tenter = async (cle: string, merite: boolean) => {
        if (!merite || deja.has(cle)) return;

        const obtenu = await reclamer(cle);
        if (obtenu) journal.info('badges', 'Badge obtenu', { badge: cle });
      };

      /* --------------------------------------------- Ce qui ne se mesure pas */

      /*
       * Pionnier : parmi les cent premiers comptes.
       *
       * On tente sans savoir si la place est libre — c'est la base qui tranche,
       * et elle seule peut le faire sans se tromper. Un refus ne coute rien et
       * ne se voit pas.
       */
      await tenter('pionnier', true);

      /*
       * Premiere heure : compte ouvert le jour du lancement.
       *
       * La date est ecrite ici parce qu'elle ne se deduit de rien : c'est un
       * fait de l'histoire du projet, pas une donnee.
       */
      const ouverture = Date.parse('2026-08-26T00:00:00Z');
      const cree = Date.parse(profile.created_at ?? '');
      if (!Number.isNaN(cree)) {
        await tenter('premiere-heure', cree - ouverture < 24 * 3600 * 1000);
      }

      /* ------------------------------------------------- Ce qui se mesure */

      /*
       * On ne mesure que ce qui peut encore etre gagne.
       *
       * Compter les messages de quelqu'un qui a deja les cinq paliers est une
       * requete pour rien — et elle partirait a chaque ouverture de session,
       * pour toujours.
       */
      const besoins = mesuresUtiles(catalogue, deja);
      const mesures: Mesures = {};

      if (besoins.has('anciennete') && !Number.isNaN(cree)) {
        mesures.anciennete = (Date.now() - cree) / (365 * 24 * 3600 * 1000);
      }

      if (besoins.has('messages')) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('author_id', profile.id);

        mesures.messages = count ?? 0;
      }

      if (besoins.has('vocal')) {
        const { data: temps } = await supabase
          .from('temps_vocal')
          .select('secondes')
          .eq('profil_id', profile.id)
          .maybeSingle();

        mesures.vocal = Number(temps?.secondes ?? 0) / 3600;
      }

      if (besoins.has('espace')) {
        const { data: miens } = await supabase
          .from('spaces')
          .select('id')
          .eq('owner_id', profile.id);

        /*
         * On retient le PLUS GRAND espace, pas leur somme.
         *
         * Les paliers portent sur un espace : fonder dix espaces de dix membres
         * n'est pas fonder un espace de cent.
         */
        let plusGrand = 0;

        for (const espace of miens ?? []) {
          const { count } = await supabase
            .from('space_members')
            .select('user_id', { count: 'exact', head: true })
            .eq('space_id', espace.id);

          plusGrand = Math.max(plusGrand, count ?? 0);
        }

        mesures.espace = plusGrand;
      }

      if (abandonne) return;

      for (const cle of badgesMerites(catalogue, mesures, deja)) {
        await tenter(cle, true);
      }
    })();

    return () => {
      abandonne = true;
    };
    // Ce que l'on possede est relu par `getState` a l'interieur plutot que
    // suivi par un abonnement : il change des qu'un badge est obtenu, et
    // l'observer relancerait la verification en boucle.
  }, [profile?.id, profile, reclamer, charger]);

  return null;
}
