import { test, expect } from '@playwright/test';
import { openApp } from './session';

/**
 * Le message des nouveautes.
 *
 * Nomme pour tomber dans le projet « authentifie » : il s'affiche depuis
 * l'espace de travail, qui suppose une session.
 */
test.describe('Nouveautes', () => {
  test('s affiche apres une mise a jour, une seule fois', async ({ page }) => {
    test.setTimeout(90_000);

    // On se fait passer pour quelqu'un qui arrive d'une version precedente.
    // C'est le seul etat qui declenche le message — et celui qu'aucune
    // installation manuelle ne produisait auparavant.
    await page.addInitScript(() => {
      localStorage.setItem('quality:version-vue', '0.0.1');
    });

    await openApp(page);

    const boite = page.getByRole('dialog').filter({ hasText: /Quoi de neuf/i });
    await expect(boite).toBeVisible({ timeout: 20_000 });

    // Le contenu vient de NOUVEAUTES.md, pas d'un texte de remplissage.
    await expect(boite.locator('li').first()).toBeVisible();

    await page.getByRole('button', { name: 'Compris' }).click();
    await expect(boite).toHaveCount(0);

    // Une seule fois : la version vue est enregistree.
    await page.reload();
    await expect(page.getByRole('dialog').filter({ hasText: /Quoi de neuf/i })).toHaveCount(0);
  });

  test('ne s affiche pas au tout premier lancement', async ({ page }) => {
    test.setTimeout(90_000);

    // Stockage entierement vide : c'est ce qui distingue une premiere
    // installation d'une mise a jour vers la premiere version qui sait poser
    // cette cle. Les deux n'ont pas de version enregistree, et demandent
    // l'inverse l'une de l'autre.
    await page.addInitScript(() => {
      for (const cle of Object.keys(localStorage)) {
        if (cle.startsWith('quality:') || cle.startsWith('orbit:')) localStorage.removeItem(cle);
      }
    });

    await openApp(page);
    await page.waitForTimeout(2500);

    await expect(page.getByRole('dialog').filter({ hasText: /Quoi de neuf/i })).toHaveCount(0);
  });

  test('s affiche en arrivant d une version qui ne posait pas la cle', async ({ page }) => {
    test.setTimeout(90_000);

    // Pas de version enregistree, mais d'autres reglages presents : c'est la
    // signature d'une mise a jour depuis une version anterieure au mecanisme,
    // et non d'une premiere installation.
    await page.addInitScript(() => {
      localStorage.removeItem('quality:version-vue');
      localStorage.setItem('orbit:media', '{}');
    });

    await openApp(page);

    await expect(
      page.getByRole('dialog').filter({ hasText: /Quoi de neuf/i }),
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Compris' }).click();
  });
});
