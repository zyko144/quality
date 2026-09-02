import { test, expect } from '@playwright/test';
import { openApp } from './session';
import { traverseLaMaintenance, EN_MAINTENANCE } from '../src/features/maintenance/acces';

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

  /*
   * Ces deux cas decrivent une maintenance EN COURS.
   *
   * Une fois levee, ils echouent — et ils ont raison d'echouer : ils affirment
   * qu'un visiteur sans session ne voit que l'ecran rouge, ce qui devient faux.
   * Les supprimer perdrait la verification pour la prochaine maintenance ; les
   * reecrire pour qu'ils passent dans les deux etats ne verifierait plus rien.
   *
   * On les saute donc quand le verrou est ouvert, et le cas inverse est couvert
   * juste apres.
   */
  test.skip(!EN_MAINTENANCE, 'la maintenance est levee');

  test('sans session, on ne voit que la maintenance', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.maintenance-title')).toBeVisible({ timeout: 20_000 });

    // Ni la presentation, ni l'application.
    await expect(page.locator('.workspace')).toHaveCount(0);
  });

  /*
   * Le defaut que ce cas retient.
   *
   * « Acces equipe » ne faisait rien dans l'application de bureau, et marchait
   * dans un navigateur. La route etait lue dans l'adresse a chaque rendu :
   * `pushState` echouant, le chemin ne changeait pas, React relisait la meme
   * valeur, et l'ecran restait le meme. Aucune erreur, aucune trace — le bouton
   * paraissait simplement mort.
   *
   * On reproduit ici la condition plutot que l'environnement : une vue web qui
   * refuse d'ecrire l'adresse. C'est ce que fait le protocole a elle de
   * l'application de bureau, et rien d'autre dans un navigateur ne le simule.
   */
  test('la connexion s ouvre meme si l adresse refuse d etre ecrite', async ({ page }) => {
    await page.addInitScript(() => {
      history.pushState = () => {
        throw new DOMException('refuse', 'SecurityError');
      };
      history.replaceState = () => {
        throw new DOMException('refuse', 'SecurityError');
      };
    });

    await page.goto('/');
    await page.locator('.maintenance-equipe').click();

    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.maintenance-title')).toHaveCount(0);
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

/**
 * Une fois la maintenance levee.
 *
 * Le miroir des cas precedents : l'un des deux groupes est toujours saute, et
 * c'est voulu — ensemble ils decrivent le verrou dans ses deux positions, et le
 * fichier reste vrai quel que soit l'etat du drapeau.
 */
test.describe('Apres la levee', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(EN_MAINTENANCE, 'la maintenance est encore en cours');

  test('un visiteur sans session voit la presentation, pas l ecran rouge', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.maintenance-title')).toHaveCount(0);

    // Le bouton de la presentation, et non un conteneur : `main` existe aussi
    // sur l'ecran de maintenance, et le cas passerait sans rien prouver.
    await expect(page.getByRole('button', { name: 'Creer un compte' }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  /*
   * Le defaut que ce cas retient.
   *
   * L'ecran de retour s'adressait a tout le monde. Quelqu'un qui decouvrait
   * Echow apprenait donc la fin d'une absence qu'il n'avait pas vecue, et
   * devait cliquer pour passer une nouvelle qui ne le concernait pas. Le defaut
   * n'existe QUE la maintenance levee, et c'est pour ca qu'il n'a pas ete vu en
   * ecrivant l'ecran.
   */
  test('l ecran de retour ne s affiche pas a qui n a jamais vu la maintenance', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('.maintenance-title')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Entrer dans Echow' })).toHaveCount(0);
  });

  test('il s affiche a qui l a vue, et une seule fois', async ({ page }) => {
    // La marque que pose l'ecran de maintenance en s'affichant.
    await page.addInitScript(() => {
      localStorage.setItem('echow:maintenance-vue:2026-09-02', 'oui');
    });

    await page.goto('/');
    const entrer = page.getByRole('button', { name: 'Entrer dans Echow' });
    await expect(entrer).toBeVisible({ timeout: 20_000 });

    await entrer.click();
    await expect(entrer).toHaveCount(0);

    // Une seule fois : le revoir a chaque ouverture en ferait un peage.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Entrer dans Echow' })).toHaveCount(0);
  });
});
