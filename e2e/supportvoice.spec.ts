import { test, expect } from '@playwright/test';
import { openApp } from './session';

/**
 * L'onglet Support.
 *
 * Nomme pour tomber dans le projet « authentifie » : la page vit sous la liste
 * des conversations privees, a cote des suggestions.
 *
 * Aucun test ne depose de demande. Les tables n'existent que sur une base
 * migree, et surtout une demande deposee ici resterait dans la file de
 * l'equipe : un test qui ecrit fabrique du travail pour quelqu'un. Ce qui est
 * verifie, c'est le chemin, ce que la page promet, et le refus d'un envoi
 * incomplet — les trois choses qui peuvent casser sans qu'on s'en apercoive.
 */
test.describe('Support', () => {
  test('la page s ouvre et dit qui peut lire les demandes', async ({ page }) => {
    await openApp(page);
    await page.locator('.rail__button--home').first().click();

    const entree = page.getByRole('button', { name: 'Support' });
    await expect(entree).toBeVisible({ timeout: 15_000 });
    await entree.click();

    await expect(page.getByRole('heading', { name: 'Support', level: 1 })).toBeVisible();

    /*
     * La regle de visibilite est affichee sur la page.
     *
     * C'est la seule chose que les politiques RLS ne peuvent pas faire : elles
     * empechent la lecture, mais ne rassurent personne. Quelqu'un qui hesite a
     * decrire un incident a besoin de savoir qui le lira avant d'ecrire.
     */
    const promesse = page.locator('.support__confidentialite');
    await expect(promesse).toBeVisible();
    await expect(promesse).toContainText(/visibles que de vous et de l’equipe/i);
  });

  test('le formulaire refuse un envoi incomplet', async ({ page }) => {
    await openApp(page);
    await page.locator('.rail__button--home').first().click();

    await page.getByRole('button', { name: 'Support' }).click();
    await page.getByRole('button', { name: 'Nouvelle demande' }).click();

    const envoyer = page.getByRole('button', { name: 'Envoyer la demande' });

    // Rien de saisi : l'envoi est hors de portee, et pas seulement refuse apres
    // coup par la base.
    await expect(envoyer).toBeDisabled();

    // Un sujet valable ne suffit pas : le message porte la demande, et une
    // ligne de trop peu ferait perdre un aller-retour a tout le monde.
    await page.getByLabel('Sujet').fill('Impossible de me connecter');
    await page.getByLabel('Ce qui s’est passe').fill('Ca marche pas');
    await expect(envoyer).toBeDisabled();

    // Le compte restant est affiche pendant la saisie, pas apres le refus.
    await expect(page.locator('.support__compte')).toContainText('caracteres');

    // On repart sans rien envoyer : ce parcours ne doit laisser aucune trace
    // dans la file de l'equipe.
    await page.getByRole('button', { name: 'Annuler' }).click();
    await expect(envoyer).toHaveCount(0);
  });

  test('les categories couvrent les cas et se decrivent', async ({ page }) => {
    await openApp(page);
    await page.locator('.rail__button--home').first().click();

    await page.getByRole('button', { name: 'Support' }).click();
    await page.getByRole('button', { name: 'Nouvelle demande' }).click();

    const categorie = page.getByLabel('Categorie');
    await expect(categorie).toBeVisible();

    // L'intitule seul ne suffit pas : « Moderation » se comprend de deux facons
    // opposees selon qu'on se plaint d'une decision ou qu'on signale quelqu'un.
    await categorie.selectOption('moderation');
    await expect(page.locator('.support__aide')).toContainText(/signaler/i);

    await categorie.selectOption('compte');
    await expect(page.locator('.support__aide')).toContainText(/connexion/i);

    await page.getByRole('button', { name: 'Annuler' }).click();
  });
});
