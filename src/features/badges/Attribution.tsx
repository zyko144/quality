import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/store/session';
import { useBadges } from '@/store/badges';
import { journal } from '@/lib/journal';

/**
 * Ce qui attribue les badges.
 *
 * Sans ce composant, le catalogue existe et personne n'obtient rien : des
 * badges qu'on ne peut pas gagner sont une decoration, pas une recompense.
 *
 * Pourquoi ici et pas dans la base
 * --------------------------------
 * Un declencheur cote base serait plus sur — il ne dependrait pas de
 * l'application — mais il faudrait un declencheur par condition, et chacun
 * s'executerait a chaque ecriture de la table qu'il surveille. « A ecrit mille
 * messages » couterait un comptage a chaque message envoye par qui que ce soit.
 *
 * Ici, la verification a lieu une fois par ouverture de session. C'est
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

      const deja = new Set(
        (useBadges.getState().parProfil[profile.id] ?? []).map((entree) => entree.badge_cle),
      );

      /** Demande un badge, si on ne l'a pas deja. */
      const tenter = async (cle: string, merite: boolean) => {
        if (!merite || deja.has(cle)) return;

        const obtenu = await reclamer(cle);
        if (obtenu) journal.info('badges', 'Badge obtenu', { badge: cle });
      };

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
        const jour = 24 * 3600 * 1000;
        await tenter('premiere-heure', cree - ouverture < jour);

        // Fidele : plus d'un an. Personne ne l'a encore, et c'est normal.
        await tenter('fidele', Date.now() - cree > 365 * jour);
      }

      /*
       * Bavard : mille messages ecrits.
       *
       * Compte a la demande plutot que tenu a jour : une colonne de compteur
       * demanderait d'etre incrementee a chaque message, et de rester juste
       * apres chaque suppression. Une requete de comptage une fois par session
       * coute moins cher que cette exactitude-la.
       */
      if (!deja.has('bavard')) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('author_id', profile.id);

        await tenter('bavard', (count ?? 0) >= 1000);
      }

      /*
       * Fondateur : avoir cree un espace qui compte au moins dix membres.
       *
       * On lit les espaces dont on est proprietaire, puis leurs membres. Deux
       * requetes, une fois par session : personne ne cree un espace assez vite
       * pour que cela vaille un declencheur.
       */
      if (!deja.has('fondateur')) {
        const { data: miens } = await supabase
          .from('spaces')
          .select('id')
          .eq('owner_id', profile.id);

        for (const espace of miens ?? []) {
          const { count } = await supabase
            .from('space_members')
            .select('user_id', { count: 'exact', head: true })
            .eq('space_id', espace.id);

          if ((count ?? 0) >= 10) {
            await tenter('fondateur', true);
            break;
          }
        }
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
