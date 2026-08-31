import { test, expect } from '@playwright/test';
import { openApp } from './session';

/**
 * Les raccourcis vocaux, choisis par l'utilisateur.
 *
 * Nomme pour tomber dans le projet « authentifie » : les reglages supposent
 * une session ouverte.
 */
test.describe('Raccourcis vocaux', () => {
  const ouvrir = async (page: import('@playwright/test').Page) => {
    await openApp(page);
    await page.locator('.userbar__controls .icon-btn').last().click();
    await expect(page.locator('.settings')).toBeVisible({ timeout: 15_000 });
    await page.locator('.settings__navitem', { hasText: 'Raccourcis' }).first().click();
    await expect(page.locator('.raccourcis__ligne').first()).toBeVisible();
  };

  test('les six actions sont reglables, dont parler en maintenant', async ({ page }) => {
    await ouvrir(page);

    const lignes = page.locator('.raccourcis__ligne');
    await expect(lignes).toHaveCount(6);

    // Celle-ci n'existait pas : c'est la seule qui suive l'enfoncement.
    await expect(page.locator('.raccourcis')).toContainText('Parler en maintenant');
  });

  test('appuyer sur une touche la prend, et Echap annule', async ({ page }) => {
    await ouvrir(page);

    const ligne = page.locator('.raccourcis__ligne', { hasText: 'Couper ou reactiver le micro' });
    const touche = ligne.locator('.raccourcis__touche');
    const avant = await touche.textContent();

    // Echap n'enregistre rien : on doit pouvoir se raviser.
    await touche.click();
    await expect(touche).toHaveText('Appuyez…');
    await page.keyboard.press('Escape');
    await expect(touche).toHaveText(avant ?? '');

    // Une vraie combinaison est prise, et affichee telle qu'on la lit.
    await touche.click();
    await page.keyboard.press('Alt+Shift+KeyG');
    await expect(touche).toContainText('Alt');
    await expect(touche).toContainText('G');

    // Elle survit au rechargement : un raccourci qui s'oublie ne sert a rien.
    await page.reload();
    await page.locator('.userbar__controls .icon-btn').last().click();
    await page.locator('.settings__navitem', { hasText: 'Raccourcis' }).first().click();
    await expect(
      page.locator('.raccourcis__ligne', { hasText: 'Couper ou reactiver le micro' })
        .locator('.raccourcis__touche'),
    ).toContainText('G');

    // On repose l'etat d'origine.
    await page.getByRole('button', { name: /Revenir aux raccourcis par defaut/i }).click();
    await expect(touche).toContainText('M');
  });

  test('une combinaison deja prise libere l ancienne action', async ({ page }) => {
    await ouvrir(page);

    const micro = page.locator('.raccourcis__ligne', { hasText: 'Couper ou reactiver le micro' })
      .locator('.raccourcis__touche');
    const son = page.locator('.raccourcis__ligne', { hasText: 'Couper ou reactiver le son' })
      .locator('.raccourcis__touche');

    // On donne au son la combinaison du micro.
    await son.click();
    await page.keyboard.press('Control+Shift+KeyM');

    // Le micro n'en a plus : deux actions sur la meme touche donneraient l'une
    // ou l'autre sans qu'on puisse prevoir laquelle.
    await expect(micro).toHaveText('Aucun');
    await expect(page.locator('.settings__group', { hasText: 'Raccourcis vocaux' }))
      .toContainText('etait prise par');

    await page.getByRole('button', { name: /Revenir aux raccourcis par defaut/i }).click();
  });
});
