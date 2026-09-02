import { test, expect } from '@playwright/test';
import { openApp } from './session';
import { traverseLaMaintenance } from '../src/features/maintenance/acces';

/**
 * Le verrou de maintenance.
 *
 * Nomme pour tomber dans le projet « authentifie » : le cas qui compte est
 * celui d'un compte de l'equipe, et il suppose une session.
 *
 * Ce verrou a une propriete desagreable : quand il se trompe, il se trompe
 * TOTALEMENT. Trop large, l'application est fermee a ceux qui doivent la
 * reparer et l'on ne s'en apercoit qu'en essayant ; trop etroite, elle est
 * ouverte a tous alors qu'on la croit fermee. Aucun des deux ne se voit en
 * lisant le code.
 */

test.describe('Verrou de maintenance', () => {
  test('la liste ne laisse passer que ce qu on y a mis', () => {
    expect(traverseLaMaintenance('zyko682@gmail.com')).toBe(true);

    // Une adresse ne distingue pas la casse, et les espaces d'un
    // copier-coller ne doivent pas fermer la porte a qui a le droit d'entrer.
    expect(traverseLaMaintenance('  ZYKO682@Gmail.com ')).toBe(true);

    expect(traverseLaMaintenance('quelquun@exemple.fr')).toBe(false);

    // Sans adresse, on ne passe pas : pendant une maintenance, le doute profite
    // a la maintenance.
    expect(traverseLaMaintenance(null)).toBe(false);
    expect(traverseLaMaintenance(undefined)).toBe(false);
    expect(traverseLaMaintenance('')).toBe(false);
  });

  test('un compte de l equipe voit l application, pas l ecran de maintenance', async ({
    page,
  }) => {
    await openApp(page);

    // L'espace de travail est monte : c'est la preuve que le verrou a laisse
    // passer, et non qu'il a affiche quelque chose qui y ressemble.
    await expect(page.locator('.workspace')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.maintenance-title')).toHaveCount(0);
  });
});

/**
 * Le visiteur ordinaire, sans session.
 *
 * Dans son propre contexte : `openApp` rejoue une session, et c'est justement
 * ce qu'il ne faut pas ici.
 */
test.describe('Maintenance pour les autres', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sans session, on ne voit que la maintenance', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.maintenance-title')).toBeVisible({ timeout: 20_000 });

    // Ni la presentation, ni l'application.
    await expect(page.locator('.workspace')).toHaveCount(0);
  });

  test('l acces equipe mene a la connexion, et nulle part ailleurs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.maintenance-equipe')).toBeVisible({ timeout: 20_000 });

    await page.locator('.maintenance-equipe').click();

    // Le formulaire de connexion parait — c'est le seul chemin ouvert.
    await expect(page.locator('.maintenance-title')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 10_000 });
  });
});
