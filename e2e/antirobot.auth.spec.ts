import { test, expect } from '@playwright/test';

/**
 * L'epreuve anti-robot.
 *
 * Fichier du projet « public » : elle vit sur l'ecran de connexion, avant
 * toute session.
 */
test.describe('Verification anti-robot', () => {
  test('elle garde la creation de compte, pas la connexion', async ({ page }) => {
    await page.goto('/connexion');

    // Connexion : aucune epreuve. Redemander un calcul a chaque ouverture
    // serait une nuisance sans contrepartie.
    await expect(page.locator('label[for="antirobot"]')).toHaveCount(0);

    await page.getByRole('tab', { name: /Creer un compte/i }).click();
    await expect(page.locator('label[for="antirobot"]')).toBeVisible();
  });

  test('une mauvaise reponse laisse le bouton refuse, la bonne l ouvre', async ({ page }) => {
    await page.goto('/connexion');
    await page.getByRole('tab', { name: /Creer un compte/i }).click();

    await page.getByLabel('Adresse e-mail').fill('essai@exemple.fr');
    await page.getByLabel('Mot de passe').fill('motdepasse123');
    await page.getByLabel('Pseudo').fill('essai');

    const envoyer = page.getByRole('button', { name: 'Creer mon espace' });

    // L'enonce est lu dans la page : le test resout la meme question que la
    // personne, sans connaitre la reponse a l'avance.
    const enonce = (await page.locator('label[for="antirobot"]').textContent()) ?? '';

    await page.locator('#antirobot').fill('0');
    await expect(envoyer).toBeDisabled();

    const somme = /(\d+)\s*\+\s*(\d+)/.exec(enonce);
    const diff = /(\d+)\s*−\s*(\d+)/.exec(enonce);
    const suite = /(\d+), (\d+), (\d+), (\d+), puis/.exec(enonce);

    let reponse: number;
    if (somme) reponse = Number(somme[1]) + Number(somme[2]);
    else if (diff) reponse = Number(diff[1]) - Number(diff[2]);
    else if (suite) reponse = Number(suite[4]) + (Number(suite[2]) - Number(suite[1]));
    else throw new Error('Enonce non reconnu : ' + enonce);

    await page.locator('#antirobot').fill(String(reponse));
    await expect(envoyer).toBeEnabled();
  });

  test('changer de question en propose une autre', async ({ page }) => {
    await page.goto('/connexion');
    await page.getByRole('tab', { name: /Creer un compte/i }).click();

    const lire = async () => (await page.locator('label[for="antirobot"]').textContent()) ?? '';
    const premier = await lire();

    // Plusieurs essais : deux tirages peuvent tomber sur le meme enonce.
    let change = false;
    for (let i = 0; i < 8 && !change; i += 1) {
      await page.getByRole('button', { name: 'Une autre question' }).click();
      await page.waitForTimeout(60);
      if ((await lire()) !== premier) change = true;
    }

    expect(change, 'l enonce doit finir par changer').toBe(true);
  });
});
