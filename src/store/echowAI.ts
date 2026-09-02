import { create } from 'zustand';
import { supabase, SUPABASE_URL, SUPABASE_KEY } from '@/lib/supabase';
import { journal } from '@/lib/journal';

/**
 * Echow AI, cote application.
 *
 * L'application ne parle jamais a Gemini. Elle appelle une fonction du projet
 * Supabase, qui detient la cle et ne la rend jamais — voir
 * `supabase/functions/echow-ai`. C'est la seule facon de proposer l'assistant a
 * tout le monde sans poser la cle dans le paquet livre, ou n'importe qui
 * l'installant pourrait la lire et la faire facturer.
 *
 * Ce magasin ne garde rien entre deux sessions : une conversation d'assistance
 * n'a pas vocation a etre retrouvee trois jours plus tard, et la conserver
 * poserait la question de ou et pour combien de temps.
 */

export interface Tour {
  role: 'user' | 'model';
  texte: string;
  /** Vrai tant que rien n'est arrive : c'est l'etat des points de reflexion. */
  enAttente?: boolean;
  /**
   * Vrai pendant que la reponse s'ecrit.
   *
   * Distinct de `enAttente` : les points ont deja cede la place au texte, mais
   * la reponse n'est pas finie. Sans cette distinction, chaque morceau recu
   * aurait remis les points a la place du texte deja affiche.
   */
  enCours?: boolean;
}

interface EtatIA {
  ouvert: boolean;
  echanges: Tour[];
  occupe: boolean;
  erreur: string | null;
  /** Questions restantes aujourd'hui, ou `null` tant qu'on ne sait pas. */
  restant: number | null;

  ouvrir: () => void;
  fermer: () => void;
  demander: (question: string) => Promise<void>;
  effacer: () => void;
}

/** Nombre d'echanges renvoyes au modele pour qu'il suive le fil. */
const MEMOIRE = 8;

export const useEchowAI = create<EtatIA>((set, get) => ({
  ouvert: false,
  echanges: [],
  occupe: false,
  erreur: null,
  restant: null,

  ouvrir: () => set({ ouvert: true }),
  fermer: () => set({ ouvert: false }),
  effacer: () => set({ echanges: [], erreur: null }),

  demander: async (question) => {
    const texte = question.trim();
    if (!texte || get().occupe) return;

    // La question parait tout de suite, et la reponse s'annonce comme
    // attendue : sans cela, on ne sait pas si le clic a ete pris.
    set((etat) => ({
      occupe: true,
      erreur: null,
      echanges: [
        ...etat.echanges,
        { role: 'user', texte },
        { role: 'model', texte: '', enAttente: true },
      ],
    }));

    /**
     * Ecrit dans la reponse en cours.
     *
     * `fini` distingue les deux usages : pendant la diffusion la ligne reste
     * « occupee » — le champ de saisie attend, et les points de reflexion ont
     * deja cede la place au texte qui arrive. Au dernier morceau seulement, la
     * main revient.
     */
    const poser = (contenu: string, fini = true) =>
      set((etat) => {
        const suite = [...etat.echanges];
        for (let i = suite.length - 1; i >= 0; i -= 1) {
          if (suite[i]?.enAttente || suite[i]?.enCours) {
            suite[i] = { role: 'model', texte: contenu, enCours: !fini };
            break;
          }
        }
        return { echanges: suite, ...(fini ? { occupe: false } : null) };
      });

    try {
      /*
       * L'historique part avec la question, borne aux derniers echanges.
       *
       * Le contexte est facture : renvoyer une conversation entiere a chaque
       * tour ferait grossir le cout a chaque question, sans que personne ne
       * s'en apercoive avant la facture.
       */
      const historique = get()
        .echanges.filter((tour) => !tour.enAttente)
        .slice(-MEMOIRE - 1, -1)
        .map((tour) => ({ role: tour.role, texte: tour.texte }));

      /*
       * On appelle la fonction directement, pas par `invoke`.
       *
       * `functions.invoke` attend la reponse ENTIERE avant de la rendre : il ne
       * peut pas diffuser, et c'est justement ce qu'on veut ici. `fetch` donne
       * acces au corps au fur et a mesure.
       */
      const { data: session } = await supabase.auth.getSession();
      const jeton = session.session?.access_token;

      if (!jeton) {
        poser('');
        set({ erreur: 'Votre session a expire. Reconnectez-vous.' });
        return;
      }

      const reponse = await fetch(`${SUPABASE_URL}/functions/v1/echow-ai`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jeton}`,
          apikey: SUPABASE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: texte, historique }),
      });

      /*
       * Une erreur arrive AVANT le flux, jamais pendant.
       *
       * La fonction verifie tout — session, quota, cle, refus de Gemini — avant
       * d'ouvrir la diffusion. Un statut different de 200 porte donc toujours
       * un corps JSON complet, comme avant.
       */
      if (!reponse.ok) {
        let message = 'L’assistant n’a pas repondu. Reessayez dans un instant.';

        try {
          const corps = await reponse.json();
          if (corps?.message) message = corps.message;
          if (typeof corps?.restant === 'number') set({ restant: corps.restant });

          /*
           * La raison exacte part au journal.
           *
           * Elle ne s'affiche pas : elle vient d'un service tiers et peut
           * contenir n'importe quoi. Le journal la garde pour qui la cherche.
           */
          if (corps?.detail) {
            journal.erreur('ia', 'Echow AI a refuse la demande', {
              message: String(corps.message ?? ''),
              detail: String(corps.detail).slice(0, 300),
            });
          }
        } catch {
          // Le corps n'est pas lisible : le message par defaut fera l'affaire.
        }

        poser('');
        set((etat) => ({
          erreur: message,
          echanges: etat.echanges.filter((tour) => tour.texte !== '' || tour.role === 'user'),
        }));
        return;
      }

      /*
       * Le flux, ligne par ligne.
       *
       * Chaque ligne est un objet JSON complet — c'est la fonction qui garantit
       * ce decoupage. Les paquets reseau, eux, arrivent coupes n'importe ou :
       * le fragment de fin est donc garde pour le tour suivant.
       */
      const lecteur = reponse.body?.getReader();
      if (!lecteur) {
        poser('');
        set({ erreur: 'L’assistant n’a rien renvoye.' });
        return;
      }

      const decodeur = new TextDecoder();
      let reste = '';
      let recu = '';

      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;

        reste += decodeur.decode(value, { stream: true });
        const lignes = reste.split(String.fromCharCode(10));
        reste = lignes.pop() ?? '';

        for (const ligne of lignes) {
          if (!ligne.trim()) continue;

          try {
            const bout = JSON.parse(ligne);

            if (typeof bout.morceau === 'string') {
              recu += bout.morceau;
              poser(recu, false);
            }

            if (bout.fin) {
              if (typeof bout.restant === 'number') set({ restant: bout.restant });
              if (bout.interrompu && !recu) {
                set({ erreur: 'La reponse a ete interrompue. Reessayez.' });
              }
            }
          } catch {
            // Une ligne illisible ne doit pas arreter les suivantes.
          }
        }
      }

      // La main revient, meme si rien n'est arrive : sans cela le champ de
      // saisie resterait bloque sur une reponse qui ne viendra plus.
      poser(recu);
    } catch (cause) {
      poser('');
      set((etat) => ({
        occupe: false,
        erreur: `L’assistant est injoignable. ${String(cause).slice(0, 120)}`,
        echanges: etat.echanges.filter((tour) => tour.texte !== '' || tour.role === 'user'),
      }));
    }
  },
}));

/**
 * Quelques questions pour demarrer.
 *
 * Une fenetre de discussion vide devant une IA laisse court : on ne sait pas ce
 * qu'elle sait, donc on ne sait pas quoi lui demander. Ces trois-la disent son
 * domaine en meme temps qu'elles l'amorcent.
 */
export const AMORCES = [
  'Comment regler une touche pour parler ?',
  'Pourquoi je m’entends en double quand je partage mon ecran ?',
  'Comment obtenir un badge ?',
];
