import { test, expect } from '@playwright/test';
import { openApp } from './session';

/**
 * La page des badges.
 *
 * Nommee pour tomber dans le projet « authentifie » : elle vit sous la liste
 * des conversations privees. Le fichier garde son nom `waves` — celui de la
 * cle du magasin, qui ne suit pas les changements d'etiquette : elle a porte
 * « Vague », puis « Waves », puis « Echow + », et maintenant les badges.
 *
 * L'abonnement annoncait quelque chose d'invendable — ni paiement, ni compte
 * marchand, ni conditions de vente — et l'a annonce pendant des mois. Un badge,
 * lui, existe des qu'on le donne.
 */
test.describe('Badges', () => {
  test('s ouvrent depuis la liste des conversations', async ({ page }) => {
    await openApp(page);

    // On passe en messages prives, ou vit l'entree.
    await page.locator('.rail__button--home').first().click();

    const entree = page.getByRole('button', { name: /Badges/ });
    await expect(entree).toBeVisible({ timeout: 15_000 });

    await entree.click();
    await expect(page.locator('.badges-page')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.badges-page__titre')).toHaveText('Badges');
  });

  test('la page dit ce qu on a, meme quand on n a rien', async ({ page }) => {
    await openApp(page);
    await page.locator('.rail__button--home').first().click();
    await page.getByRole('button', { name: /Badges/ }).click();

    /*
     * Une page vide doit dire pourquoi elle est vide.
     *
     * C'est le cas le plus frequent au depart, et une page blanche laisserait
     * croire a un chargement qui n'aboutit pas. Le message annonce aussi les
     * courses ouvertes, qui sont ce qu'on vient chercher.
     */
    await expect(page.locator('.badges-mien')).toBeVisible();
    await expect(page.locator('.badges-section__titre').first()).toContainText('votres');
  });

  test('la page tient meme sans catalogue', async ({ page }) => {
    /*
     * Les badges vivent dans des tables recentes.
     *
     * Tant que la migration n'est pas appliquee, la page doit se comporter
     * comme s'il n'y avait pas encore de badges — et non montrer une erreur que
     * personne ne peut corriger depuis l'application.
     */
    const erreurs: string[] = [];
    page.on('pageerror', (cause) => erreurs.push(String(cause)));

    await openApp(page);
    await page.locator('.rail__button--home').first().click();
    await page.getByRole('button', { name: /Badges/ }).click();
    await expect(page.locator('.badges-page')).toBeVisible({ timeout: 10_000 });

    expect(erreurs).toEqual([]);
  });
});
