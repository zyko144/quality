import { test, expect } from '@playwright/test';
import { openApp, withoutCredentials, skipReason, STATE_FILE } from './session';

/**
 * La barre du bas : le nom, l'etat, et les commandes.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Deux gestes voisins y cohabitent, et ils ont ete confondus. Cliquer son nom
 * ouvrait la liste des etats — alors que partout ailleurs, cliquer un nom
 * montre la personne, et qu'on n'avait aucun moyen simple de voir sa propre
 * fiche.
 *
 * Le nom ouvre donc la fiche, et l'etat a son propre bouton, entre le nom et
 * les reglages. Cette separation ne se verifie pas en lisant le code : les deux
 * elements sont voisins dans le meme conteneur, et les intervertir ne casse
 * rien de visible — jusqu'a ce qu'un clic fasse la mauvaise des deux choses.
 */

test.describe('Barre du bas', () => {
  test.skip(withoutCredentials, skipReason);
  test.use({ storageState: STATE_FILE });

  test('le nom ouvre la fiche, l etat ouvre les etats', async ({ page }) => {
    await openApp(page);

    const barre = page.locator('.userbar');
    await expect(barre).toBeVisible();

    // Le bouton d'etat existe, et il est distinct de celui du nom.
    const etat = barre.locator('.choix-statut__bouton');
    await expect(etat).toBeVisible();

    await etat.click();

    const menu = page.locator('.choix-statut__menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Ne pas deranger')).toBeVisible();

    /*
     * Le menu s'ouvre VERS LE HAUT.
     *
     * La barre est collee au bas de la fenetre : un menu qui descend en
     * sortirait, et l'on ne pourrait pas atteindre ses dernieres lignes.
     */
    const cadreMenu = await menu.boundingBox();
    const cadreBouton = await etat.boundingBox();

    expect(cadreMenu).not.toBeNull();
    expect(cadreBouton).not.toBeNull();
    expect(cadreMenu!.y + cadreMenu!.height).toBeLessThanOrEqual(cadreBouton!.y + 2);

    // Echap referme, sans quoi il resterait ouvert derriere la suite.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('le nom ouvre sa propre fiche', async ({ page }) => {
    await openApp(page);

    await page.locator('.userbar__identity').click();

    // La fiche s'ouvre sur soi : elle porte le bouton de modification, que la
    // fiche de quelqu'un d'autre n'a jamais.
    await expect(page.getByRole('button', { name: /Modifier mon profil/i })).toBeVisible();
  });
});
