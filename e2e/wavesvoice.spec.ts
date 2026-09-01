import { test, expect } from '@playwright/test';
import { openApp } from './session';

/**
 * La page de l'abonnement.
 *
 * Nommee pour tomber dans le projet « authentifie » : elle vit sous la liste
 * des conversations privees.
 */
test.describe('Waves', () => {
  test('s ouvre depuis la liste et annonce sans vendre', async ({ page }) => {
    await openApp(page);

    // On passe en messages prives, ou vit l'entree.
    await page.locator('.rail__button--home, .rail__button').first().click();

    const entree = page.getByRole('button', { name: /Waves/ });
    await expect(entree).toBeVisible({ timeout: 15_000 });

    /*
     * L'entree dit elle-meme que l'abonnement est arrete.
     *
     * On ne decouvre pas apres coup qu'il n'y a rien a acheter — et
     * « Maintenance » dit un arret la ou « Bientot » disait une attente qui
     * avance, ce qui n'etait plus vrai.
     */
    await expect(entree).toContainText('Maintenance');

    await entree.click();
    await expect(page.getByRole('heading', { name: 'Waves', level: 1 })).toBeVisible();

    // La page reprend le mot de l'entree, plutot que d'en donner un deuxieme.
    await expect(page.locator('.waves__annonce')).toContainText(/maintenance/i);

    // Le bouton n'est pas cliquable : aucun paiement n'existe.
    const bouton = page.getByRole('button', { name: /Indisponible/i });
    await expect(bouton).toBeVisible();
    await expect(bouton).toBeDisabled();

    // Les engagements sont la, pas seulement la liste d'avantages.
    await expect(page.getByRole('heading', { name: /ne fera jamais/i })).toBeVisible();
    await expect(page.getByText(/Rendre payant ce qui est gratuit/i)).toBeVisible();
  });
});
