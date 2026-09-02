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

/**
 * Ce qui depasse doit rester atteignable.
 *
 * `html` et `body` sont en `overflow: hidden` — l'application est une coquille a
 * hauteur fixe, et ce sont ses panneaux qui defilent. La presentation et l'ecran
 * de connexion n'en sont pas : ce sont des pages longues, et ils n'avaient aucun
 * conteneur pour defiler. Tout ce qui passait sous le bord de la fenetre etait
 * simplement inatteignable.
 *
 * Le defaut ne se voit pas sur un grand ecran, ou tout tient. Il apparait dans
 * l'application de bureau, dont la fenetre est plus basse qu'un navigateur : les
 * boutons se retrouvaient sous le bord, et la page paraissait morte alors qu'elle
 * allait bien.
 *
 * Les cas mesurent donc a une hauteur OU LE CONTENU DEPASSE. A pleine hauteur ils
 * passeraient sans rien prouver — c'est exactement ce qui a laisse le defaut
 * arriver jusqu'a un utilisateur.
 */
test.describe('Pages longues, fenetre basse', () => {
  test.use({ viewport: { width: 1100, height: 620 } });

  test('la presentation defile jusqu a son dernier ecran', async ({ page }) => {
    await page.goto('/');

    const mesures = await page.evaluate(() => {
      const l = document.querySelector('.landing');
      if (!l) return null;
      return { contenu: l.scrollHeight, boite: l.clientHeight };
    });

    expect(mesures, 'la presentation doit etre affichee').not.toBeNull();
    expect(mesures!.contenu, 'le contenu depasse la fenetre : sinon le cas ne prouve rien')
      .toBeGreaterThan(mesures!.boite);

    // On va jusqu'en bas, et on verifie qu'on y est arrive.
    const atteint = await page.evaluate(() => {
      const l = document.querySelector('.landing')!;
      l.scrollTop = l.scrollHeight;
      return l.scrollTop;
    });

    expect(atteint, 'le bas de la page doit etre atteignable').toBeGreaterThan(0);
  });

  test('l ecran de connexion peut vraiment etre defile', async ({ page }) => {
    await page.goto('/connexion');
    await expect(page.getByRole('button', { name: 'Entrer' })).toBeVisible({ timeout: 15_000 });

    /*
     * On mesure la capacite a defiler, pas le resultat d'un defilement.
     *
     * Une premiere version appelait `scrollIntoViewIfNeeded` puis verifiait que
     * le bouton etait dans la fenetre — et elle passait avec ou sans le
     * correctif. Un defilement PAR PROGRAMME reussit meme sur un conteneur en
     * `overflow: hidden` ; c'est l'utilisateur qui n'y arrive pas. Le cas
     * mesurait donc quelque chose que le defaut n'empeche pas.
     */
    const etat = await page.evaluate(() => {
      const auth = document.querySelector('.auth');
      if (!auth) return null;
      const style = getComputedStyle(auth);
      return {
        // La contrainte est la FENETRE, pas la boite. Un conteneur laisse libre
        // de grandir ne deborde jamais de lui-meme : il deborde de son parent,
        // et c'est invisible a qui ne mesure que lui.
        depasse: auth.scrollHeight > window.innerHeight + 4,
        defilement: style.overflowY,
        contenu: auth.scrollHeight,
        fenetre: window.innerHeight,
      };
    });

    expect(etat, "l'ecran de connexion doit etre affiche").not.toBeNull();

    // Si le contenu depasse, le conteneur doit pouvoir defiler de lui-meme.
    if (etat!.depasse) {
      expect(
        ['auto', 'scroll'],
        `contenu de ${etat!.contenu}px dans une fenetre de ${etat!.fenetre}px`,
      ).toContain(etat!.defilement);
    }
  });
});
