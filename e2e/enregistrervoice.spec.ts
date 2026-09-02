import { test, expect } from '@playwright/test';
import { openApp } from './session';

/**
 * Le bandeau des modifications non enregistrees.
 *
 * Nomme pour tomber dans le projet « authentifie » : les reglages supposent une
 * session.
 *
 * Ces cas passent par l'interface plutot que par la logique seule, et c'est
 * voulu : ce qu'on veut verifier n'est pas le calcul de « quelque chose a
 * change » — il est trivial — mais qu'il soit relie aux trois magasins de
 * reglages, au bouton de fermeture et a la touche Echap. Chacun de ces fils
 * peut se detacher sans qu'aucun type ne s'en plaigne.
 */
test.describe('Enregistrement des reglages', () => {
  test('rien ne s affiche tant qu on n a rien touche', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Preferences' }).click();

    // Ouvrir, parcourir, refermer : un bandeau qui apparaitrait la ferait
    // douter d'avoir change quelque chose sans le vouloir.
    await page.getByRole('button', { name: 'Raccourcis', exact: true }).click();
    await expect(page.locator('.reglages-barre')).toHaveCount(0);
  });

  test('changer un raccourci fait apparaitre le bandeau', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('button', { name: 'Raccourcis', exact: true }).click();

    const ligne = page.locator('.raccourcis__ligne', { hasText: /push-to-mute/i });
    await expect(ligne).toBeVisible({ timeout: 10_000 });

    await ligne.locator('.raccourcis__touche').click();
    await page.keyboard.press('F9');

    const barre = page.locator('.reglages-barre');
    await expect(barre).toBeVisible();

    /*
     * Le bandeau doit etre VISIBLE, pas seulement present.
     *
     * Un fond absent le rendrait transparent sur le contenu qui defile
     * derriere : le texte se superposerait aux reglages et l'on ne saurait plus
     * lire ni l'un ni l'autre. C'est arrive ailleurs dans cette application,
     * pour avoir invente un nom de couleur qui n'existait pas.
     */
    const fond = await barre.evaluate((noeud) => getComputedStyle(noeud).backgroundColor);
    expect(fond).not.toBe('rgba(0, 0, 0, 0)');
    expect(fond).not.toBe('transparent');
  });

  test('« tout annuler » remet le reglage comme il etait', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('button', { name: 'Raccourcis', exact: true }).click();

    const ligne = page.locator('.raccourcis__ligne', { hasText: /push-to-mute/i });
    await expect(ligne).toBeVisible({ timeout: 10_000 });

    const avant = await ligne.locator('.raccourcis__touche').textContent();

    await ligne.locator('.raccourcis__touche').click();
    await page.keyboard.press('F9');
    await expect(ligne.locator('.raccourcis__touche')).toHaveText(/F9/);

    await page.getByRole('button', { name: 'Tout annuler' }).click();

    await expect(ligne.locator('.raccourcis__touche')).toHaveText(avant ?? '');
    await expect(page.locator('.reglages-barre')).toHaveCount(0);
  });

  test('on ne referme pas sans avoir tranche', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('button', { name: 'Raccourcis', exact: true }).click();

    const ligne = page.locator('.raccourcis__ligne', { hasText: /push-to-mute/i });
    await expect(ligne).toBeVisible({ timeout: 10_000 });

    await ligne.locator('.raccourcis__touche').click();
    await page.keyboard.press('F9');
    await expect(page.locator('.reglages-barre')).toBeVisible();

    // Echap ne referme rien : partir en laissant des changements qu'on n'a pas
    // vus est exactement ce qui fait dire « je n'ai rien change ».
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings')).toBeVisible();

    // Le bouton de fermeture non plus.
    await page.getByRole('button', { name: /fermer les parametres/i }).click();
    await expect(page.locator('.settings')).toBeVisible();

    // Une fois enregistre, la page se referme normalement.
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.locator('.reglages-barre')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('.settings')).toHaveCount(0);
  });
});
