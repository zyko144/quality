import type { RealtimeChannel } from '@supabase/supabase-js';
import { create } from 'zustand';
import { supabase, errorMessage } from '@/lib/supabase';
import type { UUID } from '@/types/db';

/**
 * Demandes d'aide, et l'echange qui suit.
 *
 * A part du magasin de discussion, pour la meme raison que les suggestions :
 * une demande de support n'est pas un message. Elle a un sujet, un etat, elle
 * se termine, et elle n'appartient a aucun salon.
 *
 * A part des suggestions aussi, malgre la ressemblance : une suggestion se lit
 * par tout le monde, une demande de support par son seul auteur. Les meler
 * ferait cohabiter deux regles de visibilite opposees dans le meme code, et
 * c'est exactement le genre de voisinage ou l'on finit par se tromper.
 */

export type StatutDemande = 'ouverte' | 'en-cours' | 'resolue';

export type CategorieDemande =
  | 'compte'
  | 'technique'
  | 'moderation'
  | 'facturation'
  | 'autre';

export interface DemandeSupport {
  id: UUID;
  auteur_id: UUID;
  sujet: string;
  categorie: CategorieDemande;
  message: string;
  statut: StatutDemande;
  created_at: string;
  updated_at: string;
  /** Nombre de reponses attachees, compte par la base. */
  reponses: number;
  /** Vrai quand l'equipe a parle en dernier : il y a donc du neuf a lire. */
  derniere_reponse_de_l_equipe: boolean;
}

export interface ReponseSupport {
  id: UUID;
  demande_id: UUID;
  /** Nul pour une reponse de l'equipe, qui n'a pas de profil dans la base. */
  auteur_id: UUID | null;
  de_l_equipe: boolean;
  message: string;
  created_at: string;
}

/** Bornes reprises des contraintes des tables : refuser ici evite l'aller-retour. */
export const SUJET_MIN = 4;
export const SUJET_MAX = 120;
export const MESSAGE_MIN = 20;
export const MESSAGE_MAX = 4000;
export const REPONSE_MAX = 4000;

/**
 * Les categories, avec ce qu'elles veulent dire.
 *
 * L'intitule seul ne suffit pas : « Moderation » se comprend de deux facons
 * opposees selon qu'on se plaint d'une decision ou qu'on signale quelqu'un. La
 * precision evite que l'equipe passe sa journee a reclasser.
 */
export const CATEGORIES: ReadonlyArray<{
  valeur: CategorieDemande;
  libelle: string;
  aide: string;
}> = [
  { valeur: 'compte', libelle: 'Compte', aide: 'Connexion, pseudo, adresse e-mail, suppression.' },
  { valeur: 'technique', libelle: 'Technique', aide: 'Un bug, un plantage, quelque chose qui ne marche pas.' },
  { valeur: 'moderation', libelle: 'Moderation', aide: 'Signaler un comportement, ou contester une decision.' },
  { valeur: 'facturation', libelle: 'Facturation', aide: 'Paiement, abonnement, remboursement.' },
  { valeur: 'autre', libelle: 'Autre', aide: 'Tout ce qui n’entre dans aucune des cases ci-dessus.' },
];

export const LIBELLES_STATUT: Record<StatutDemande, string> = {
  ouverte: 'Ouverte',
  'en-cours': 'En cours',
  resolue: 'Resolue',
};

interface EtatSupport {
  liste: DemandeSupport[];
  /** Demande dont l'echange est affiche ; `null` quand on est sur la liste. */
  ouverte: UUID | null;
  /** Echanges deja charges, ranges par demande. */
  echanges: Record<UUID, ReponseSupport[]>;

  chargement: boolean;
  envoi: boolean;
  erreur: string | null;

  charger: () => Promise<void>;
  deposer: (sujet: string, categorie: CategorieDemande, message: string) => Promise<boolean>;
  ouvrir: (id: UUID) => Promise<void>;
  fermer: () => void;
  repondre: (id: UUID, message: string) => Promise<boolean>;
  resoudre: (id: UUID) => Promise<void>;

  /** Branche le flux temps reel. Rend la fonction qui le debranche. */
  ecouter: () => () => void;
}

/**
 * Un seul canal pour tout le magasin.
 *
 * Hors du `create` : c'est une ressource du navigateur, pas un etat a rendre.
 * La ranger dans le magasin ferait rejouer les composants a chaque
 * (re)connexion, pour une valeur qu'aucun d'eux n'affiche.
 */
let canal: RealtimeChannel | null = null;
let abonnes = 0;

export const useSupport = create<EtatSupport>((set, get) => ({
  liste: [],
  ouverte: null,
  echanges: {},

  chargement: false,
  envoi: false,
  erreur: null,

  charger: async () => {
    set({ chargement: true, erreur: null });

    const { data, error } = await supabase.rpc('mes_demandes_support');

    if (error) {
      set({ chargement: false, erreur: errorMessage(error) });
      return;
    }

    set({ liste: (data ?? []) as DemandeSupport[], chargement: false });
  },

  deposer: async (sujet, categorie, message) => {
    const titre = sujet.trim();
    const corps = message.trim();

    if (titre.length < SUJET_MIN || titre.length > SUJET_MAX) return false;
    if (corps.length < MESSAGE_MIN || corps.length > MESSAGE_MAX) return false;

    const { data: session } = await supabase.auth.getUser();
    const moi = session.user?.id;
    if (!moi) return false;

    set({ envoi: true, erreur: null });

    const { data, error } = await supabase
      .from('demandes_support')
      .insert({ auteur_id: moi, sujet: titre, categorie, message: corps })
      .select('id')
      .single();

    if (error) {
      set({ envoi: false, erreur: errorMessage(error) });
      return false;
    }

    await get().charger();

    // On ouvre la demande deposee : c'est le seul endroit ou la reponse
    // arrivera, et l'y conduire evite d'avoir a deviner qu'il faut y revenir.
    const id = (data as { id: UUID } | null)?.id ?? null;
    set({ envoi: false, ouverte: id });
    if (id) await get().ouvrir(id);

    return true;
  },

  ouvrir: async (id) => {
    set({ ouverte: id, erreur: null });

    const { data, error } = await supabase
      .from('reponses_support')
      .select('*')
      .eq('demande_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      set({ erreur: errorMessage(error) });
      return;
    }

    set((etat) => ({
      echanges: { ...etat.echanges, [id]: (data ?? []) as ReponseSupport[] },
    }));
  },

  fermer: () => set({ ouverte: null }),

  repondre: async (id, message) => {
    const corps = message.trim();
    if (corps.length === 0 || corps.length > REPONSE_MAX) return false;

    const { data: session } = await supabase.auth.getUser();
    const moi = session.user?.id;
    if (!moi) return false;

    set({ envoi: true, erreur: null });

    const { error } = await supabase
      .from('reponses_support')
      // `de_l_equipe` n'est pas passe : la politique d'insertion le refuserait
      // a `true`, et la valeur par defaut de la colonne dit deja `false`.
      .insert({ demande_id: id, auteur_id: moi, message: corps });

    if (error) {
      set({ envoi: false, erreur: errorMessage(error) });
      return false;
    }

    set({ envoi: false });

    // Le flux temps reel remontera la meme ligne ; `fusionner` ignore le
    // doublon. On recharge tout de meme : sans abonnement etabli — un onglet
    // en arriere-plan, une connexion coupee — l'ecran resterait fige.
    await get().ouvrir(id);
    await get().charger();
    return true;
  },

  resoudre: async (id) => {
    const avant = get().liste;

    // Applique tout de suite : le geste est sans surprise, et attendre
    // l'aller-retour donne l'impression que le clic n'a rien fait.
    set({
      liste: avant.map((demande) =>
        demande.id === id ? { ...demande, statut: 'resolue' } : demande,
      ),
    });

    const { error } = await supabase.rpc('resoudre_ma_demande', { p_demande: id });

    // La base a refuse : on remet ce qui etait affiche plutot que de laisser un
    // etat qui ne correspond a rien.
    if (error) set({ liste: avant, erreur: errorMessage(error) });
  },

  ecouter: () => {
    abonnes += 1;

    if (!canal) {
      canal = supabase
        .channel('echow:support')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'demandes_support' },
          () => {
            // La ligne recue suffirait pour un ajout, mais pas pour les comptes
            // de reponses que porte la liste. Un rechargement complet coute une
            // requete, sur une liste bornee a deux cents entrees.
            void useSupport.getState().charger();
          },
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'reponses_support' },
          (payload) => {
            const reponse = payload.new as ReponseSupport;
            fusionner(reponse);
            void useSupport.getState().charger();
          },
        )
        .subscribe();
    }

    return () => {
      abonnes -= 1;
      if (abonnes > 0 || !canal) return;

      void supabase.removeChannel(canal);
      canal = null;
    };
  },
}));

/**
 * Range une reponse arrivee par le flux temps reel.
 *
 * Ignore celle qu'on a deja : la meme ligne arrive deux fois quand on vient de
 * l'ecrire soi-meme — une fois par la reponse de l'insertion, une fois par le
 * flux — et l'afficher en double ferait douter de ce qui a ete envoye.
 */
function fusionner(reponse: ReponseSupport): void {
  useSupport.setState((etat) => {
    const connues = etat.echanges[reponse.demande_id];

    // Demande jamais ouverte : rien a completer, et la charger ici reviendrait
    // a garder en memoire des echanges que personne ne regarde.
    if (!connues) return {};
    if (connues.some((ligne) => ligne.id === reponse.id)) return {};

    return {
      echanges: {
        ...etat.echanges,
        [reponse.demande_id]: [...connues, reponse],
      },
    };
  });
}
