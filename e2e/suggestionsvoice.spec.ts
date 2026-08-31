import { test, expect } from '@playwright/test';
import { openApp } from './session';

/**
 * L'espace suggestions.
 *
 * Nomme pour tomber dans le projet « authentifie » : la page vit sous la liste
 * des conversations privees.
 *
 * Les tests ne deposent pas de suggestion : la table n'existe que sur une base
 * migree, et un test qui ecrit laisserait des traces dans la liste publique.
 * Ce qui est verifie ici, c'est le chemin et le refus — les deux choses qui
 * peuvent casser sans qu'on s'en apercoive.
 */
test.describe('Suggestions', () => {
  test('la page s ouvre et rappelle la commande', async ({ page }) => {
    await openApp(page);
    await page.locator('.rail__button--home').first().click();

    const entree = page.getByRole('button', { name: 'Suggestions' });
    await expect(entree).toBeVisible({ timeout: 15_000 });
    await entree.click();

    await expect(page.getByRole('heading', { name: 'Suggestions', level: 1 })).toBeVisible();

    // La commande est rappelee : une fonctionnalite qui ne s'atteint que par
    // une commande n'existe que pour qui la connait.
    await expect(page.locator('.suggestions__commande')).toContainText('/suggestion');
  });

  test('une commande trop courte est refusee et rien n est envoye', async ({ page }) => {
    await openApp(page);

    const zone = page.getByRole('textbox', { name: /message/i }).first();
    await zone.click();
    await zone.fill('/suggestion trop');
    await zone.press('Enter');

    // Le refus est dit, et le texte reste : on corrige au lieu de retaper.
    await expect(page.locator('.composer-notice')).toBeVisible({
      timeout: 10_000,
    });
    await expect(zone).toHaveValue('/suggestion trop');

    await zone.fill('');
  });
});
