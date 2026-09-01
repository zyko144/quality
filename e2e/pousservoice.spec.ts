import { test, expect } from '@playwright/test';
import { openApp } from './session';
import { tenir, etatTenueVide, type Evenement } from '../src/features/voice/tenue';

/**
 * Les touches qu'on maintient : parler, et se taire.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Deux sortes de cas. Les premiers passent par l'interface et verifient que les
 * deux touches sont proposees et reglables. Les seconds portent sur la
 * mecanique elle-meme, qui est de la logique a etats : elle se trompe
 * silencieusement, et son erreur ne se voit qu'a l'usage — un micro qui reste
 * coupe apres qu'on a lache, ce que personne ne relie a un raccourci.
 */

/** Rejoue une suite d'evenements et rend l'etat du micro a la fin. */
function jouer(evenements: Evenement[], depart: boolean, voulu: boolean): boolean {
  const etat = etatTenueVide();
  let micro = depart;

  for (const evenement of evenements) {
    const suite = tenir(etat, evenement, micro, voulu);
    if (suite.micro !== null) micro = suite.micro;
  }

  return micro;
}

test.describe('Touches maintenues', () => {
  test('les deux touches sont proposees dans les raccourcis', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('button', { name: 'Raccourcis', exact: true }).click();

    await expect(
      page.locator('.raccourcis__ligne', { hasText: /push-to-talk/i }),
    ).toBeVisible({ timeout: 10_000 });

    const seTaire = page.locator('.raccourcis__ligne', { hasText: /push-to-mute/i });
    await expect(seTaire).toBeVisible();

    /*
     * Aucune touche par defaut, et c'est dit.
     *
     * Une touche imposee entrerait en conflit avec ce que font les jeux, et
     * l'on decouvrirait le conflit en pleine partie.
     */
    await expect(seTaire.locator('.raccourcis__detail')).toContainText(/aucun raccourci/i);
  });

  test('la touche « se taire » se regle et se retire', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('button', { name: 'Raccourcis', exact: true }).click();

    const ligne = page.locator('.raccourcis__ligne', { hasText: /push-to-mute/i });
    await expect(ligne).toBeVisible({ timeout: 10_000 });

    await ligne.locator('.raccourcis__touche').click();
    await page.keyboard.press('F9');
    await expect(ligne.locator('.raccourcis__touche')).toHaveText(/F9/);

    // Et l'on peut la reprendre : un raccourci qu'on ne peut pas defaire est
    // un raccourci qu'on hesite a poser.
    await ligne.getByRole('button', { name: /retirer le raccourci/i }).click();
    await expect(ligne.locator('.raccourcis__touche')).not.toHaveText(/F9/);
  });

  /*
   * Le cas demande explicitement : marteler ne doit rien casser.
   *
   * Vingt allers-retours, c'est ce que fait quelqu'un qui essaie un raccourci
   * pour voir. Chaque appui non relache, ou chaque relachement sans appui,
   * decalait autrefois l'etat d'un cran — et l'on finissait micro coupe en
   * croyant l'avoir rouvert.
   */
  test('marteler ramene toujours a la position de depart', () => {
    const martelement: Evenement[] = [];
    for (let i = 0; i < 20; i += 1) martelement.push('bas', 'haut');

    for (const depart of [false, true]) {
      for (const voulu of [false, true]) {
        expect(jouer(martelement, depart, voulu)).toBe(depart);
      }
    }
  });

  test('la repetition automatique ne change rien', () => {
    // Windows emet une rafale de « bas » tant que la touche reste enfoncee.
    const rafale: Evenement[] = ['bas', 'bas', 'bas', 'bas', 'bas', 'haut'];

    expect(jouer(rafale, false, true)).toBe(false);
    expect(jouer(rafale, true, false)).toBe(true);
  });

  test('un relachement en trop ne rend rien', () => {
    // La touche etait enfoncee avant que la fenetre prenne le focus.
    expect(jouer(['haut', 'haut'], false, true)).toBe(false);
    expect(jouer(['haut'], true, false)).toBe(true);
  });

  test('perdre le focus touche enfoncee rend l etat de depart', () => {
    // Un alt-tab en pleine phrase : sans cela, le micro resterait comme la
    // pression l'avait laisse, indefiniment.
    expect(jouer(['bas', 'perdu'], false, true)).toBe(false);
    expect(jouer(['bas', 'perdu'], true, false)).toBe(true);
  });

  test('tenir la touche produit bien l etat voulu', () => {
    const etat = etatTenueVide();

    // « Se taire » depuis un micro ouvert : il se ferme.
    expect(tenir(etat, 'bas', false, true)).toEqual({ micro: true, tenue: true });
    // Et le lacher rend l'ouverture.
    expect(tenir(etat, 'haut', true, true)).toEqual({ micro: false, tenue: false });
  });

  /*
   * Le relachement doit toujours aboutir, meme hors d'un salon.
   *
   * La mecanique notait le relachement, puis l'application verifiait qu'on
   * etait bien dans un salon — et abandonnait sinon. Or cette verification
   * echoue pendant les fractions de seconde ou l'on rejoint. Le relachement
   * etait alors enregistre sans etre applique : la touche comptait pour lachee,
   * le micro restait coupe, et plus rien ne le rouvrait.
   */
  test('le relachement rend toujours l etat, quoi qu il arrive ensuite', () => {
    const etat = etatTenueVide();

    // On tient la touche « se taire » depuis un micro ouvert.
    expect(tenir(etat, 'bas', false, true)).toEqual({ micro: true, tenue: true });

    // La mecanique a note la touche comme tenue : elle DOIT rendre au
    // relachement, et rendre l'ouverture.
    const rendu = tenir(etat, 'haut', true, true);
    expect(rendu.micro).toBe(false);
    expect(rendu.tenue).toBe(false);

    // Et l'etat est propre : un second relachement ne rend plus rien.
    expect(tenir(etat, 'haut', false, true)).toEqual({ micro: null, tenue: false });
  });

  test('« parler » depuis un micro deja ouvert ne le coupe pas au relachement', () => {
    const etat = etatTenueVide();

    expect(tenir(etat, 'bas', false, false)).toEqual({ micro: false, tenue: true });
    // On rend ce qu'on a trouve : ouvert. C'est le defaut qu'on ne relie
    // jamais a un raccourci — la touche coupait pour de bon.
    expect(tenir(etat, 'haut', false, false)).toEqual({ micro: false, tenue: false });
  });
});
