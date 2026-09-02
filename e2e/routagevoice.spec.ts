import { test, expect } from '@playwright/test';

/**
 * Le routage, dans l'application de bureau.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * « Acces equipe » rechargeait tout : ecran de chargement, puis retour au point
 * de depart. Le bouton semblait ne mener nulle part alors qu'il faisait
 * beaucoup trop.
 *
 * La vue web de l'application de bureau sert ses fichiers par un protocole a
 * elle, qui ne resout que l'adresse de base. Ecrire `/connexion` dans
 * l'historique n'y deplace pas la page : cela declenche une VRAIE navigation, le
 * protocole ne trouve rien, et la fenetre repart de zero. Tenir la route en
 * memoire n'y suffit pas — le rechargement remet le module a zero, et la memoire
 * avec.
 *
 * Ce qui se verifie ici est l'APPEL, pas ce que le protocole en fait : le
 * protocole n'existe pas dans un navigateur, la cause si. Elle tient dans ces
 * deux lignes, et c'est elles qu'on surveille.
 *
 * Le cas ne depend pas de l'etat de la maintenance : il clique sur celui des
 * deux chemins vers la connexion qui se presente. Un cas qui se saute des qu'un
 * drapeau change ne surveille plus rien — et c'est exactement ce qui m'a fait
 * croire, une fois, que le defaut etait corrige.
 */

test.describe('Routage dans l application de bureau', () => {
  // Sans session : avec une session ouverte et hors maintenance, l'application
  // va droit a l'espace de travail, ou aucune des deux portes n'existe.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('changer d ecran n ecrit jamais dans l historique', async ({ page }) => {
    await page.addInitScript(() => {
      // Ce que l'application regarde pour se savoir dans Tauri.
      (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};

      const journal: string[] = [];
      (window as unknown as Record<string, unknown>)['__historique'] = journal;

      const push = history.pushState.bind(history);
      const remplace = history.replaceState.bind(history);
      history.pushState = (...args) => {
        journal.push(`push ${String(args[2])}`);
        return push(...args);
      };
      history.replaceState = (...args) => {
        journal.push(`replace ${String(args[2])}`);
        return remplace(...args);
      };
    });

    await page.goto('/');

    /*
     * Deux portes menent a la connexion selon l'etat de la maintenance :
     * « Acces equipe » quand elle est en cours, « Se connecter » sinon. Les deux
     * appellent la meme fonction, qui est ce qu'on surveille.
     */
    const equipe = page.locator('.maintenance-equipe');
    const connecter = page.getByRole('button', { name: 'Se connecter' }).first();

    const porte = (await equipe.count()) > 0 ? equipe : connecter;
    await expect(porte).toBeVisible({ timeout: 20_000 });
    await porte.click();

    // L'ecran doit changer : sans cela le cas passerait sur une page morte.
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 15_000 });

    const ecritures = await page.evaluate(
      () => (window as unknown as { __historique: string[] }).__historique,
    );

    expect(ecritures, "l'historique ne doit pas etre touche dans l'application de bureau").toEqual(
      [],
    );
  });
});
