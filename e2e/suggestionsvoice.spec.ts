import { test, expect } from '@playwright/test';
import { openApp } from './session';

/**
 * L'espace suggestions.
 *
 * Nomme pour tomber dans le projet « authentifie » : la page vit sous la liste
 * des conversations privees.
 *
 * Les tests ne deposent pas de suggestion : la table n'existe que sur une base
 * migree, et un test qui ecrit laisserait des traces dans une liste publique.
 * Ce qui est verifie ici, c'est le chemin, le refus, et le fait que la commande
 * ne reponde plus ailleurs — les trois choses qui peuvent casser sans qu'on
 * s'en apercoive.
 */
test.describe('Suggestions', () => {
  test('l espace s ouvre avec son champ', async ({ page }) => {
    await openApp(page);
    await page.locator('.rail__button--home').first().click();

    const entree = page.getByRole('button', { name: 'Suggestions' });
    await expect(entree).toBeVisible({ timeout: 15_000 });
    await entree.click();

    await expect(page.getByRole('heading', { name: 'Suggestions', level: 1 })).toBeVisible();

    /*
     * Le champ est ce qui distingue cet espace de la liste qu'il etait.
     *
     * Sans lui, il n'y a plus aucun moyen de proposer : la commande a ete
     * retiree des salons, et c'etait la seule autre porte.
     */
    const champ = page.getByRole('textbox', { name: 'Proposer une suggestion' });
    await expect(champ).toBeVisible();

    // Le compteur remplace l'ancienne consigne : il dit la limite pendant la
    // saisie plutot qu'apres le refus.
    await expect(page.locator('.suggestions__avis')).toContainText('caracteres');
  });

  test('une idee trop courte est refusee et le texte reste', async ({ page }) => {
    await openApp(page);
    await page.locator('.rail__button--home').first().click();
    await page.getByRole('button', { name: 'Suggestions' }).click();

    const champ = page.getByRole('textbox', { name: 'Proposer une suggestion' });
    await champ.click();
    await champ.fill('trop');
    await champ.press('Enter');

    // Le refus est dit, et le texte reste : on corrige au lieu de retaper.
    await expect(page.locator('.suggestions__avis.is-alerte')).toBeVisible({
      timeout: 10_000,
    });
    await expect(champ).toHaveValue('trop');

    await champ.fill('');
  });

  test('la commande ne repond plus dans un salon et mene ici', async ({ page }) => {
    await openApp(page);

    const zone = page.getByRole('textbox', { name: /message/i }).first();
    await zone.click();
    await zone.fill('/suggestion une idee qui tient largement la longueur');
    await zone.press('Enter');

    /*
     * On arrive dans l'espace, sans avoir rien depose.
     *
     * C'est tout l'objet du changement : la commande deposait depuis n'importe
     * quel salon, vers une page que son auteur decouvrait au moment de l'envoi
     * — sans avoir vu ce qui avait deja ete propose.
     */
    await expect(page.getByRole('heading', { name: 'Suggestions', level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('textbox', { name: 'Proposer une suggestion' })).toBeVisible();
  });
});
