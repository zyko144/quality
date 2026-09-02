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
 * Vrai si cette personne a deja vu l'ecran de retour.
 *
 * Un stockage indisponible — navigation privee, donnees effacees, reglage du
 * navigateur — rend `false` : mieux vaut montrer l'ecran une fois de trop que
 * laisser une lecture qui echoue empecher l'application de s'ouvrir.
 */
export function retourDejaVu(): boolean {
  try {
    return window.localStorage.getItem(RETOUR) === 'oui';
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
