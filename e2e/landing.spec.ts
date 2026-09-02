import { test, expect } from '@playwright/test';
import { EN_MAINTENANCE } from '../src/features/maintenance/acces';

/**
 * Page de presentation : la premiere chose que voit un visiteur.
 *
 * Pendant une maintenance, elle n'existe pas : l'ecran de maintenance prend
 * toute la place, pour les visiteurs comme pour les comptes. Ces cas se
 * declarent donc ignores plutot qu'echoues.
 *
 * La difference compte. Un echec attendu se confond avec un echec reel : on
 * apprend a ne plus les lire, et le jour ou il s'en ajoute un vrai, il passe
 * inapercu au milieu des autres. Un cas ignore dit ce qu'il est.
 */
test.describe.configure({ mode: 'default' });

test.describe('Ecran de chargement', () => {
  test.skip(EN_MAINTENANCE, 'La presentation est remplacee par l’ecran de maintenance.');

  test('couvre la page avant le premier rendu, puis disparait', async ({ page }) => {
    // Le voile est ecrit dans le document, pas rendu par React : il doit donc
    // etre la des la reception du HTML, avant l'execution du script.
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('#splash')).toBeAttached();

    // Puis il s'efface de lui-meme une fois l'application peinte : le laisser
    // reviendrait a bloquer l'interface derriere un voile.
    await expect(page.locator('#splash')).toHaveCount(0, { timeout: 15_000 });
  });

  test('le voile ne masque pas un ecran deja pret', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Commencer|Entrer/ }).first()).toBeVisible();
    await expect(page.locator('#splash')).toHaveCount(0);
  });
});

test.describe('Presentation', () => {
  test.skip(EN_MAINTENANCE, 'La presentation est remplacee par l’ecran de maintenance.');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('presente le produit et propose de commencer', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Creer un compte' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  });

  test('mene a la connexion', async ({ page }) => {
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page).toHaveURL(/\/connexion$/);
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
  });

  test('le bouton precedent ramene a la presentation', async ({ page }) => {
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/connexion$/);

    await page.goBack();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('depuis la connexion, on peut revenir a la presentation', async ({ page }) => {
    await page.goto('/connexion');
    // Le bouton a ete renomme : « Retour a l'accueil » dit ou l'on va, la ou
    // « Decouvrir Orbit » decrivait une decouverte qu'on a deja faite.
    await page.getByRole('button', { name: /Retour . l.accueil/i }).click();

    await expect(page).toHaveURL(/\/$/);
  });

  test('les sections annoncees sont presentes', async ({ page }) => {
    for (const id of ['fonctionnalites', 'detail', 'vocal']) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
  });

  test('une adresse inconnue retombe sur la presentation', async ({ page }) => {
    await page.goto('/nimporte-quoi');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('aucun defilement horizontal', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
