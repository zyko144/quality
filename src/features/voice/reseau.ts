import { supabase } from '@/lib/supabase';

/**
 * Ou passent la voix et l'image, et ce que cela revele.
 *
 * Une liaison directe suppose que les deux machines connaissent leurs adresses
 * reseau. Dans un salon vocal ordinaire, votre adresse IP est donc visible des
 * autres participants — ce n'est pas un defaut, c'est la definition du
 * pair-a-pair, et c'est le prix du chemin le plus court.
 *
 * La seule facon de la masquer est de faire passer tout le trafic par un
 * relais TURN : les pairs ne voient alors que l'adresse du relais. Cela coute
 * de la latence, de la bande passante sur le relais, et un serveur a tenir.
 *
 * Deux choses manquaient pour que ce soit realiste :
 *
 *  1. `VITE_ICE_SERVERS` est lue a la compilation et finit dans le binaire. Un
 *     identifiant TURN permanent qui y figure est un identifiant publie —
 *     n'importe qui peut extraire les chaines de l'executable et s'en servir
 *     comme relais gratuit. Il faut des identifiants temporaires, demandes a
 *     l'ouverture d'un salon.
 *
 *  2. Forcer le relais sans relais joignable ne masque rien : cela empeche
 *     simplement toute connexion. Mieux vaut refuser le reglage que promettre
 *     une protection qui coupe le son.
 *
 * Ce module repond aux deux : il demande les serveurs au serveur, retombe sur
 * la variable de compilation puis sur les serveurs STUN publics, et sait dire
 * si un relais est reellement disponible.
 */

/** Serveurs publics de dernier recours, pour que l'application marche nue. */
const STUN_PUBLICS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Ce qui a ete pose a la compilation.
 *
 * Format accepte : un JSON, ou une liste d'adresses separees par des virgules.
 * Reste utile pour un deploiement personnel ou l'on tient son propre coturn
 * sans identifiants — ou avec des identifiants qu'on accepte de publier.
 */
function depuisLaCompilation(): RTCIceServer[] | null {
  const brut = import.meta.env['VITE_ICE_SERVERS'];
  if (typeof brut !== 'string' || brut.trim() === '') return null;

  try {
    const analyse: unknown = JSON.parse(brut);
    if (Array.isArray(analyse)) return analyse as RTCIceServer[];
  } catch {
    // Pas du JSON : on accepte aussi la forme courte, une liste d'adresses.
  }

  const liste = brut
    .split(',')
    .map((adresse) => adresse.trim())
    .filter(Boolean)
    .map((urls) => ({ urls }));

  return liste.length > 0 ? liste : null;
}

/** Vrai si au moins un serveur sait relayer, et pas seulement decouvrir. */
export function comporteUnRelais(serveurs: RTCIceServer[]): boolean {
  return serveurs.some((serveur) => {
    const adresses = Array.isArray(serveur.urls) ? serveur.urls : [serveur.urls];
    return adresses.some((adresse) => String(adresse).startsWith('turn:') || String(adresse).startsWith('turns:'));
  });
}

/** Derniere reponse du serveur, et l'instant ou elle cessera d'etre sure. */
let cache: { serveurs: RTCIceServer[]; expire: number } | null = null;

/**
 * Les serveurs a utiliser maintenant.
 *
 * L'ordre est deliberé : ce que le serveur repond passe avant ce qui a ete
 * compile, parce que lui seul peut delivrer des identifiants temporaires.
 *
 * La fonction distante `ice_servers` n'existe pas forcement — c'est le cas
 * tant que la migration correspondante n'a pas ete appliquee. Son absence
 * n'est pas une panne : on retombe sur le reste, et l'application fonctionne
 * comme avant, sans relais.
 */
export async function serveursIce(): Promise<RTCIceServer[]> {
  if (cache && Date.now() < cache.expire) return cache.serveurs;

  try {
    const { data, error } = await supabase.rpc('ice_servers');

    if (!error && Array.isArray(data) && data.length > 0) {
      const serveurs = data as RTCIceServer[];

      /*
       * Une minute de marge sur la duree annoncee.
       *
       * Les identifiants temporaires de coturn valent une heure par defaut. Les
       * garder jusqu'a la derniere seconde ferait echouer une negociation
       * commencee juste avant l'echeance, et l'echec se lirait comme un
       * probleme de reseau plutot que comme un jeton perime.
       */
      cache = { serveurs, expire: Date.now() + 50 * 60 * 1000 };
      return serveurs;
    }
  } catch {
    // Reseau coupe, fonction absente : on continue avec ce qu'on a.
  }

  const compiles = depuisLaCompilation();
  const serveurs = compiles ?? STUN_PUBLICS;

  // Cache court : la fonction distante peut apparaitre en cours de route, une
  // fois la migration appliquee, et l'on veut la voir sans redemarrer.
  cache = { serveurs, expire: Date.now() + 2 * 60 * 1000 };
  return serveurs;
}

/** Oublie ce qui a ete retenu. Utile apres un changement de compte. */
export function oublierLesServeurs(): void {
  cache = null;
}
