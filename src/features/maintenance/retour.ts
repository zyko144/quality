/**
 * L'ecran de retour, et le souvenir de l'avoir vu.
 *
 * Il s'affiche une fois, a la levee de la maintenance, puis plus jamais. Le
 * revoir a chaque ouverture le transformerait en peage : la deuxieme fois il ne
 * dit plus rien, et il faut quand meme cliquer pour passer.
 */

/**
 * Ce que l'on retient : cette levee-ci, pas cette version-ci.
 *
 * Un numero de version changerait au prochain correctif et ferait reapparaitre
 * l'ecran a des gens qui l'ont deja vu, pour annoncer un retour qui a eu lieu
 * la semaine derniere. On identifie donc l'evenement lui-meme.
 */
const RETOUR = 'echow:retour:2026-09-02';

/**
 * Ceux a qui la porte a ete fermee.
 *
 * L'ecran de retour ne s'adresse qu'a eux. Le montrer a tout le monde le
 * rendait absurde pour qui decouvre Echow : « nous sommes de retour » annonce
 * la fin d'une absence que cette personne n'a pas vecue, et il faut cliquer
 * pour passer une nouvelle qui ne la concerne pas.
 *
 * L'ecran de maintenance pose donc cette marque en s'affichant. C'est la seule
 * facon de savoir qui a ete refoule : rien d'autre ne le retient — pas la
 * session, qui n'existait peut-etre pas, pas le compte, qui n'a pas ete ouvert.
 */
const REFOULE = 'echow:maintenance-vue:2026-09-02';

/** Retient que cette personne a vu l'ecran de maintenance. */
export function marquerMaintenanceVue(): void {
  try {
    window.localStorage.setItem(REFOULE, 'oui');
  } catch {
    // Sans stockage, cette personne n'aura pas son ecran de retour. C'est une
    // nouvelle manquee, pas une porte fermee.
  }
}

/**
 * Vrai si l'on doit annoncer le retour a cette personne.
 *
 * Deux conditions : avoir ete refoule, et ne pas avoir deja vu l'annonce.
 *
 * Un stockage indisponible — navigation privee, donnees effacees, reglage du
 * navigateur — rend `false` sur les deux lectures, donc pas d'annonce. C'est le
 * bon defaut : ne pas savoir si quelqu'un a ete refoule doit le laisser entrer,
 * jamais l'arreter sur un ecran de plus.
 */
export function doitAnnoncerLeRetour(): boolean {
  try {
    const stockage = window.localStorage;
    return stockage.getItem(REFOULE) === 'oui' && stockage.getItem(RETOUR) !== 'oui';
  } catch {
    return false;
  }
}

/** Retient que l'ecran a ete vu. Sans effet si le stockage refuse. */
export function marquerRetourVu(): void {
  try {
    window.localStorage.setItem(RETOUR, 'oui');
  } catch {
    // Le clic a deja fait passer l'ecran. Ne pas pouvoir s'en souvenir le fera
    // revenir a la prochaine ouverture, ce qui est genant et non bloquant.
  }
}
