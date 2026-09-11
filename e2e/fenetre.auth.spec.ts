import { test, expect, type Page } from '@playwright/test';

/**
 * Les commandes de fenetre, la ou un compte neuf passe.
 *
 * Fichier du projet « public » : l'ecran de connexion est justement l'un de
 * ceux qui n'en avaient pas. Elles etaient montees par l'espace de travail et
 * les deux ecrans de maintenance, et nulle part ailleurs — ni a la connexion,
 * ni au choix du pseudo, ni sur les regles a accepter. Apres le changement de
 * base, tout le monde repassait par ces ecrans, et la fenetre ne se fermait
 * plus que par la barre des taches.
 *
 * Elles ne s'affichent que dans l'application de bureau : le composant se tait
 * sans `__TAURI_INTERNALS__`. On simule donc ce que Tauri injecte — juste de
 * quoi repondre a `@tauri-apps/api/window`, en notant chaque commande recue. Le
 * test ne dit rien du binaire Windows ; il dit que les boutons existent sur cet
 * ecran, qu'il n'y en a qu'un jeu, et que chacun envoie la bonne commande.
 */

async function simulerTauri(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const appels: string[] = [];
    let prochain = 1;
    const fenetre = window as unknown as Record<string, unknown>;

    fenetre['__appels'] = appels;
    fenetre['__TAURI_INTERNALS__'] = {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' },
      },
      invoke: (commande: string) => {
        appels.push(commande);
        if (commande === 'plugin:window|is_maximized') return Promise.resolve(false);
        // `onResized` attend un identifiant d'ecoute, qu'il rendra pour se
        // detacher.
        if (commande === 'plugin:event|listen') return Promise.resolve(prochain++);
        return Promise.resolve(null);
      },
      transformCallback: () => prochain++,
      unregisterCallback: () => undefined,
      convertFileSrc: (chemin: string) => chemin,
    };
    fenetre['__TAURI_EVENT_PLUGIN_INTERNALS__'] = { unregisterListener: () => undefined };
  });
}

function commandes(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __appels: string[] }).__appels);
}

test.describe('Commandes de fenetre sur l ecran de connexion', () => {
  test('les trois boutons sont la, en un seul jeu', async ({ page }) => {
    await simulerTauri(page);
    await page.goto('/connexion');

    await expect(page.getByRole('button', { name: 'Reduire la fenetre' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Agrandir la fenetre' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fermer la fenetre' })).toBeVisible();

    // Un seul : les ecrans qui montaient les leurs, en plus de celui de la
    // racine, en auraient empile deux au meme endroit.
    await expect(page.locator('.window-controls')).toHaveCount(1);
  });

  test('chacun envoie sa commande', async ({ page }) => {
    await simulerTauri(page);
    await page.goto('/connexion');

    await page.getByRole('button', { name: 'Reduire la fenetre' }).click();
    await expect.poll(() => commandes(page)).toContain('plugin:window|minimize');

    await page.getByRole('button', { name: 'Agrandir la fenetre' }).click();
    await expect.poll(() => commandes(page)).toContain('plugin:window|toggle_maximize');

    await page.getByRole('button', { name: 'Fermer la fenetre' }).click();
    await expect.poll(() => commandes(page)).toContain('plugin:window|close');
  });

  test('rien sur le web', async ({ page }) => {
    // Sans Tauri, la fenetre appartient au navigateur : trois boutons qui ne
    // feraient rien seraient pires que pas de boutons.
    await page.goto('/connexion');

    await expect(page.getByRole('button', { name: 'Fermer la fenetre' })).toHaveCount(0);
  });
});
