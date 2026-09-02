import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
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
  /** Vrai tant que la reponse n'est pas arrivee. */
  enAttente?: boolean;
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

    /** Remplace la reponse en attente par ce qui est arrive. */
    const poser = (contenu: string) =>
      set((etat) => {
        const suite = [...etat.echanges];
        for (let i = suite.length - 1; i >= 0; i -= 1) {
          if (suite[i]?.enAttente) {
            suite[i] = { role: 'model', texte: contenu };
            break;
          }
        }
        return { echanges: suite, occupe: false };
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

      const { data, error } = await supabase.functions.invoke('echow-ai', {
        body: { question: texte, historique },
      });

      if (error) {
        /*
         * Le corps de la reponse porte le vrai message.
         *
         * `invoke` rend une erreur generique des que le statut n'est pas 200 :
         * « quota atteint » et « service en panne » y ressemblent, alors que
         * l'un se resout en attendant demain et l'autre pas.
         */
        let message = 'L’assistant n’a pas repondu. Reessayez dans un instant.';

        try {
          const corps = await (error as { context?: Response }).context?.json();
          if (corps?.message) message = corps.message;
          if (typeof corps?.restant === 'number') set({ restant: corps.restant });

          /*
           * La raison exacte part au journal.
           *
           * La fonction la renvoie dans `detail` — « cle refusee », « quota
           * epuise », « modele inconnu » — et le client la jetait. Restait
           * « L'assistant est momentanement indisponible », qui ne dit ni ce
           * qui se passe ni quoi faire, ni a celui qui lit ni a celui qui
           * repare.
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
          // La ligne en attente n'a plus lieu d'etre : l'erreur la remplace.
          echanges: etat.echanges.filter((tour) => tour.texte !== '' || tour.role === 'user'),
        }));
        return;
      }

      poser(data?.texte ?? '');
      if (typeof data?.restant === 'number') set({ restant: data.restant });
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
