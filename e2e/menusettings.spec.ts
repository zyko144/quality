import { test, expect } from '@playwright/test';
import { openApp, withoutCredentials, skipReason } from './session';

/**
 * Le menu contextuel d'un salon.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que ce fichier protege
 * -------------------------
 * Un menu qui s'ouvrait et se refermait dans la foulee, sans qu'on y touche.
 *
 * La mesure, relevee en ecoutant les evenements de la page pendant un clic
 * droit : `pointerdown SPAN.channel__name`, puis `scroll DIV.sidebar__scroll`.
 * Le navigateur donne le focus au bouton vise, le conteneur le ramene dans sa
 * vue de quelques pixels — et le menu se fermait sur ce defilement, qu'il avait
 * lui-meme provoque. Six releves a 400 ms d'intervalle donnaient `1,0,0,0,0,0`.
 *
 * Cela n'a jamais ete rattrape par les tests parce que les seuls clics droits
 * couverts visaient des messages, qui ne prennent pas le focus. Le defaut ne
 * frappait que la barre laterale — c'est-a-dire, depuis le retrait du bouton
 * « Nouveau salon », le seul chemin vers la creation d'un salon.
 */

test.describe('Menu contextuel d un salon', () => {
  test.skip(withoutCredentials, skipReason);

  test('reste ouvert apres le clic droit', async ({ page }) => {
    await openApp(page);

    // La liste des salons de l'espace, et non le premier `.channel` venu : la
    // colonne des conversations privees en contient aussi, et elle est en place
    // avant que l'espace ait fini de charger.
    const salon = page.locator('.sidebar__channels .channel').first();
    await expect(salon).toBeVisible();
    await salon.click({ button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Une seconde entiere : le defilement fautif arrivait dans les premieres
    // centaines de millisecondes, et un test qui regarderait tout de suite
    // aurait vu un menu bien ouvert.
    await page.waitForTimeout(1_000);
    await expect(menu).toBeVisible();
  });

  test('propose de creer un salon et une categorie', async ({ page }) => {
    await openApp(page);

    const salon = page.locator('.sidebar__channels .channel').first();
    await expect(salon).toBeVisible();
    await salon.click({ button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Les deux creations vivent aussi ici, et pas seulement au clic droit sur
    // le fond de la liste : passe une quinzaine de salons, il n'y a plus de
    // fond a viser.
    const creer = menu.getByRole('menuitem', { name: 'Creer un salon', exact: true });

    if ((await creer.count()) === 0) {
      test.skip(true, 'Ce compte n administre pas cet espace.');
      return;
    }

    await expect(menu.getByRole('menuitem', { name: 'Creer une categorie' })).toBeVisible();

    await creer.click();
    await expect(page.locator('dialog[open]').getByLabel('Nom')).toBeVisible();

    await page.keyboard.press('Escape');
  });
});
