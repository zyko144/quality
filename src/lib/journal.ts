/**
 * Le journal de l'application.
 *
 * Ce que resout ce fichier
 * ------------------------
 * Un defaut signale par quelqu'un d'autre n'est jamais reproductible sur la
 * machine de celui qui doit le corriger. « Le partage a coupe » n'apprend rien.
 * Les lignes ecrites ici remontent dans une table que la console de l'equipe
 * lit — c'est la difference entre un temoignage et une trace.
 *
 * Ce qui n'y entre jamais
 * -----------------------
 * Aucun contenu de message, aucun nom de fichier, aucune adresse. Le journal
 * sert a comprendre un defaut, pas a savoir ce que les gens se disent. La regle
 * n'est pas seulement morale : une table de diagnostic finit toujours par etre
 * lue plus largement que prevu, et ce qu'on n'y met pas ne peut pas fuir.
 *
 * En pratique : des identifiants, des nombres, des noms d'etats. Si vous
 * hesitez a ecrire quelque chose ici, c'est que la reponse est non.
 */

import { supabase } from './supabase';

/** Ce qu'une ligne peut porter en plus de son message. */
export type Detail = Record<string, string | number | boolean | null>;

export type Niveau = 'trace' | 'info' | 'alerte' | 'erreur';

interface Ligne {
  niveau: Niveau;
  domaine: string;
  message: string;
  detail: Detail | null;
  seance: string;
  version: string;
  plateforme: 'bureau' | 'web';
  auteur_id: string | null;
}

/**
 * Delai avant l'envoi d'un lot, en millisecondes.
 *
 * Une requete par ligne rendrait le journal plus couteux que ce qu'il observe :
 * une connexion vocale en ecrit une dizaine en deux secondes. Deux secondes
 * d'attente les reunissent en un seul aller-retour, sans qu'on perde le fil
 * quand on suit quelqu'un au telephone.
 */
const REGROUPEMENT = 2000;

/**
 * Nombre de lignes qui declenche un envoi immediat.
 *
 * Une rafale — une boucle qui echoue a chaque image — ne doit pas attendre le
 * minuteur : ce sont precisement les moments ou l'on veut voir arriver la trace.
 */
const LOT = 25;

/**
 * Plafond de la file d'attente.
 *
 * Hors ligne, la file grandirait sans fin et finirait par peser plus lourd que
 * l'application. Au-dela de cette borne on jette les plus ANCIENNES : dans une
 * cascade d'erreurs, les dernieres disent ce qui s'est reellement passe, les
 * premieres disent ce qui a commence — et l'on garde la fin, qui est la ou
 * l'utilisateur en est.
 */
const FILE_MAX = 200;

/**
 * Identifiant de cette execution.
 *
 * Il recoud les lignes d'une meme seance. L'auteur n'y suffit pas : on ouvre
 * deux fenetres, et deux seances de la meme personne s'entrelacent alors dans
 * le journal sans qu'on puisse les separer.
 *
 * Il est tire au hasard a chaque lancement et n'est rattache a rien : ce n'est
 * pas un identifiant de machine, et il disparait a la fermeture.
 */
const SEANCE = Math.random().toString(36).slice(2, 12);

const PLATEFORME: 'bureau' | 'web' =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'bureau' : 'web';

let file: Ligne[] = [];
let minuteur: number | null = null;
let auteur: string | null = null;
let actif = true;

/**
 * Rattache les lignes suivantes a quelqu'un.
 *
 * Appele a l'ouverture et a la fermeture de session. Les lignes deja en file ne
 * sont pas reecrites : elles ont ete produites avant qu'on sache qui c'etait, et
 * les reattribuer apres coup ferait dire au journal autre chose que ce qui s'est
 * passe.
 */
export function journalAuteur(id: string | null) {
  auteur = id;
}

/**
 * Coupe le journal.
 *
 * Utile aux tests de bout en bout, ou une ecriture par action polluerait la
 * table sans rien apprendre a personne.
 */
export function journalActif(oui: boolean) {
  actif = oui;
  if (!oui) file = [];
}

/** Ecrit une ligne. Ne rejette jamais : un journal qui casse ne sert a rien. */
export function journaliser(
  niveau: Niveau,
  domaine: string,
  message: string,
  detail?: Detail,
) {
  if (!actif) return;

  file.push({
    niveau,
    domaine: domaine.slice(0, 40),
    // La colonne s'arrete a trois cents caracteres ; couper ici evite un rejet
    // de la base pour une ligne un peu longue, ce qui emporterait tout le lot.
    message: message.slice(0, 300),
    detail: detail ? borner(detail) : null,
    seance: SEANCE,
    version: __APP_VERSION__,
    plateforme: PLATEFORME,
    auteur_id: auteur,
  });

  if (file.length > FILE_MAX) file = file.slice(-FILE_MAX);
  if (file.length >= LOT) {
    void vider();
    return;
  }

  if (minuteur === null) {
    minuteur = window.setTimeout(() => {
      minuteur = null;
      void vider();
    }, REGROUPEMENT);
  }
}

/** Raccourcis, parce qu'un journal qu'on trouve verbeux ne s'ecrit pas. */
export const journal = {
  trace: (domaine: string, message: string, detail?: Detail) =>
    journaliser('trace', domaine, message, detail),
  info: (domaine: string, message: string, detail?: Detail) =>
    journaliser('info', domaine, message, detail),
  alerte: (domaine: string, message: string, detail?: Detail) =>
    journaliser('alerte', domaine, message, detail),
  erreur: (domaine: string, message: string, detail?: Detail) =>
    journaliser('erreur', domaine, message, detail),
};

/**
 * Ramene un detail a ce que la colonne accepte.
 *
 * Les valeurs y sont plates par construction du type, mais une chaine peut etre
 * une trace d'appel entiere. On coupe plutot que de laisser la base refuser le
 * lot : une ligne tronquee vaut mieux que dix perdues.
 */
function borner(detail: Detail): Detail {
  const sortie: Detail = {};

  for (const [cle, valeur] of Object.entries(detail)) {
    sortie[cle.slice(0, 40)] = typeof valeur === 'string' ? valeur.slice(0, 600) : valeur;
  }

  return sortie;
}

/**
 * Envoie ce qui attend.
 *
 * La file est videe AVANT l'envoi. En cas d'echec les lignes sont perdues, et
 * c'est voulu : les remettre en file ferait boucler une panne de reseau sur
 * elle-meme, chaque tentative ajoutant sa propre ligne d'erreur.
 */
async function vider() {
  if (file.length === 0) return;

  const lot = file;
  file = [];

  if (minuteur !== null) {
    window.clearTimeout(minuteur);
    minuteur = null;
  }

  try {
    await supabase.from('journal').insert(lot);
  } catch {
    // Le journal ne doit jamais faire tomber ce qu'il observe.
  }
}

/**
 * Installe le journal.
 *
 * Appele une fois au demarrage. Les deux gestionnaires globaux sont l'essentiel
 * de l'interet : ils attrapent ce que personne n'a pense a journaliser, ce qui
 * est par definition la categorie ou vivent les defauts inconnus.
 */
export function installerJournal() {
  if (typeof window === 'undefined') return;

  /*
   * Sous pilotage automatique, le journal se tait.
   *
   * La suite de bout en bout ouvre et referme l'application des centaines de
   * fois. Ses lignes noieraient celles des vraies personnes, qui sont les
   * seules qu'on lise — et un journal qu'on ne lit plus ne sert a rien.
   */
  if (navigator.webdriver) {
    actif = false;
    return;
  }

  window.addEventListener('error', (evenement) => {
    journal.erreur('interface', evenement.message || 'Erreur sans message', {
      fichier: evenement.filename ?? null,
      ligne: evenement.lineno ?? null,
      colonne: evenement.colno ?? null,
      pile: evenement.error instanceof Error ? (evenement.error.stack ?? null) : null,
    });
  });

  window.addEventListener('unhandledrejection', (evenement) => {
    const cause = evenement.reason;

    journal.erreur(
      'interface',
      cause instanceof Error ? cause.message : String(cause ?? 'Promesse rejetee'),
      { pile: cause instanceof Error ? (cause.stack ?? null) : null },
    );
  });

  /*
   * Le dernier lot part a la fermeture.
   *
   * `pagehide` plutot que `beforeunload` : c'est le seul evenement que les
   * moteurs garantissent encore, et il couvre aussi la mise en arriere-plan sur
   * mobile. `visibilitychange` complete le tableau quand la fenetre est
   * simplement masquee — on peut y rester des heures, et les lignes du dernier
   * lot attendraient tout ce temps.
   */
  window.addEventListener('pagehide', () => void vider());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void vider();
  });

  journal.info('session', 'Application demarree', {
    plateforme: PLATEFORME,
    langue: navigator.language,
    // La definition de l'ecran explique a elle seule une bonne part des
    // defauts d'affichage rapportes, et ne dit rien de personnel.
    ecran: `${window.screen.width}x${window.screen.height}`,
  });
}
