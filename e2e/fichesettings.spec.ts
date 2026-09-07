import { test, expect } from '@playwright/test';
import { openApp } from './session';

/**
 * La fiche de profil tient dans l'ecran, quelle que soit sa taille.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que cet essai protege : la fiche a ete elargie sur demande — huit cent
 * quatre-vingts pixels devenus mille cent vingt — et une fiche trop grande ne
 * se voit pas sur l'ecran de celui qui l'agrandit. Elle se voit chez quelqu'un
 * d'autre, sur un portable de treize pouces, sous la forme d'un bouton qu'on
 * ne peut plus atteindre.
 *
 * Deux plafonds se contredisaient d'ailleurs deja : la grille se donnait
 * jusqu'a 92vh, la boite qui la porte s'arretait a 85. Personne ne pouvait le
 * voir — cela ne produisait pas une erreur, seulement une colonne de droite un
 * peu plus courte que prevu.
 */
test.describe('la fiche de profil', () => {
  test('ne deborde d’aucun ecran', async ({ page }) => {
    await openApp(page);

    await page.locator('.userbar__identite, .userbar button').first().click();
    await page.locator('.profile__grid').waitFor({ timeout: 15_000 });

    /*
     * Du grand ecran au telephone.
     *
     * 1280x720 est le cas qui compte : c'est la definition d'un portable
     * ordinaire, et celle ou une fenetre reglee sur un grand ecran deborde en
     * premier.
     */
    for (const [largeur, hauteur] of [
      [1440, 900],
      [1280, 720],
      [1024, 768],
      [900, 700],
      [420, 780],
    ] as const) {
      await page.setViewportSize({ width: largeur, height: hauteur });
      await page.waitForTimeout(250);

      const mesure = await page.evaluate(() => {
        const cadre = document.querySelector('.profile__grid')?.getBoundingClientRect();
        if (!cadre) return null;

        return {
          w: Math.round(cadre.width),
          h: Math.round(cadre.height),
          // Une marge d'un pixel : les bordures et les arrondis tombent
          // parfois sur une demi-unite, et ce n'est pas un debordement.
          deborde: cadre.bottom > window.innerHeight + 1 || cadre.right > window.innerWidth + 1,
        };
      });

      expect(mesure, `fiche absente en ${largeur}x${hauteur}`).not.toBeNull();
      expect(mesure!.deborde, `la fiche deborde en ${largeur}x${hauteur}`).toBe(false);

      // Et elle reste grande : une fiche qui se retracte sur son contenu
      // sauterait d'une taille a l'autre selon ce que la personne a rempli.
      expect(mesure!.h, `fiche trop courte en ${largeur}x${hauteur}`).toBeGreaterThan(400);
    }
  });
});
