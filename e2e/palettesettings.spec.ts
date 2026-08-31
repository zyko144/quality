import { test, expect } from '@playwright/test';
import { openApp } from './session';

/**
 * La palette de commandes.
 *
 * Nommee pour tomber dans le projet « authentifie » : sans session il n'y a ni
 * salon ni personne a proposer, et la liste n'aurait rien a montrer.
 */
test.describe('Palette de commandes', () => {
  test('Ctrl+K ouvre la liste, Echap la referme', async ({ page }) => {
    await openApp(page);

    await expect(page.locator('.palette')).toHaveCount(0);

    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible();
    await expect(page.locator('.palette__list li').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.palette')).toHaveCount(0);
  });

  test('elle propose de rejoindre un vocal et d ecrire a quelqu un', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+k');

    const champ = page.locator('.palette__input');

    // « Rejoindre » n'existait pas : la palette ne savait qu'afficher un salon,
    // pas y entrer.
    await champ.fill('rejoindre');
    await expect(page.locator('.palette__list')).toContainText('Rejoindre');

    await champ.fill('ecrire a');
    await expect(page.locator('.palette__list')).toContainText('Ecrire a');

    await page.keyboard.press('Escape');
  });

  test('les reglages et le statut sont atteignables', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+k');

    const champ = page.locator('.palette__input');

    await champ.fill('ne pas deranger');
    await expect(page.locator('.palette__list')).toContainText('Ne pas deranger');

    // Un mot-cle absent du libelle doit suffire : c'est tout l'interet de la
    // colonne de mots-cles.
    await champ.fill('bruit');
    await expect(page.locator('.palette__list')).toContainText('porte de bruit');

    await champ.fill('apparence');
    await page.keyboard.press('Enter');

    await expect(page.locator('.palette')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Apparence/i }).first()).toBeVisible();

    await page.keyboard.press('Escape');
  });
});
