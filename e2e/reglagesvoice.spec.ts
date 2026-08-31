import { test, expect } from '@playwright/test';
import { openApp } from './session';

/**
 * La recherche de reglages.
 *
 * Nommee pour tomber dans le projet « authentifie » : les parametres supposent
 * une session ouverte.
 */
test.describe('Reglages', () => {
  const ouvrir = async (page: import('@playwright/test').Page) => {
    await openApp(page);
    await page.locator('.userbar__controls .icon-btn').last().click();
    await expect(page.locator('.settings')).toBeVisible({ timeout: 15_000 });
  };

  test('chercher « bruit » mene a Voix et video', async ({ page }) => {
    await ouvrir(page);

    const champ = page.getByLabel('Chercher un reglage');
    await champ.fill('bruit');

    const resultats = page.locator('.reglages-recherche__resultat');
    await expect(resultats.first()).toBeVisible();
    await expect(resultats.first()).toContainText(/bruit/i);

    // La section est annoncee : on apprend ou se trouve la chose.
    await expect(resultats.first()).toContainText('Voix et video');

    await resultats.first().click();
    await expect(page.getByRole('heading', { name: /Voix et video/i }).first()).toBeVisible();
  });

  test('elle trouve par mot-cle, pas seulement par libelle', async ({ page }) => {
    await ouvrir(page);

    const champ = page.getByLabel('Chercher un reglage');

    // « clavier » ne figure dans aucun libelle : c'est ce qu'on tape pourtant.
    await champ.fill('clavier');
    await expect(page.locator('.reglages-recherche__resultat').first()).toContainText(/bruit/i);

    // Sans accent, comme on tape.
    await champ.fill('performance');
    await expect(page.locator('.reglages-recherche__resultat').first()).toBeVisible();

    await champ.fill('zzzzzz');
    await expect(page.locator('.reglages-recherche__vide')).toBeVisible();
  });
});
