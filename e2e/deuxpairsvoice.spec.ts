import { test, expect, type Page } from '@playwright/test';
import { openApp, signIn, withoutCredentials, skipReason, withoutSecondAccount, secondAccountReason } from './session';

/**
 * Deux pairs dans le meme salon vocal.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Le reste des cas vocaux ne regarde qu'un cote : ils verifient que le micro se
 * coupe, que l'anneau change de couleur, que l'on entre et que l'on sort. Rien
 * n'y verifie ce pour quoi un salon vocal existe — que deux personnes s'y
 * voient et s'y entendent.
 *
 * C'est pourtant la que les defauts sont revenus : « on voit personne en voc,
 * c'est separe ». Un tel defaut ne se voit d'aucun cote pris isolement — chacun
 * se croit bien entre, et c'est vrai ; ce qui manque est entre les deux.
 *
 * Il faut reellement DEUX COMPTES. Deux pages du meme compte ne suffisent pas :
 * les participants sont indexes par utilisateur — `key={participant.user_id}` —
 * et deux sessions d'une meme personne n'en font donc qu'une, a dessein. Un
 * essai a deux pages montre une seule tuile, ce qui est correct et ne prouve
 * rien sur ce qui nous interesse.
 *
 * Sans second compte, ce cas se declare ignore. Un test qui ne peut pas
 * conclure doit le dire, jamais passer : il donnerait alors exactement la
 * confiance qu'il ne merite pas, sur le point ou elle a le plus manque.
 */

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['microphone', 'camera'],
});

/** Entre dans le premier salon vocal du compte. Rend `false` s'il n'y en a pas. */
async function rejoindre(page: Page): Promise<boolean> {
  await openApp(page);

  const salon = page.locator('.channel[data-kind="voice"]').first();
  if ((await salon.count()) === 0) return false;

  await salon.click();
  const bouton = page.getByRole('button', { name: 'Rejoindre le salon vocal' });
  await expect(bouton).toBeEnabled({ timeout: 20_000 });
  await bouton.click();

  // La commande du micro ne parait qu'une fois entre : l'attendre evite de
  // mesurer une scene encore vide.
  await expect(page.locator('.voice-stage').getByRole('button', { name: 'Couper le micro' }))
    .toBeVisible({ timeout: 25_000 });
  return true;
}

/** Ce que cette page recoit reellement : des pistes audio, vivantes ou non. */
async function pistesRecues(page: Page) {
  return page.evaluate(() => {
    const flux = [...document.querySelectorAll('audio, video')]
      .map((el) => (el as HTMLMediaElement).srcObject as MediaStream | null)
      .filter((f): f is MediaStream => !!f && typeof f.getAudioTracks === 'function');

    const pistes = flux.flatMap((f) => f.getAudioTracks());
    return {
      elements: document.querySelectorAll('audio, video').length,
      flux: flux.length,
      pistes: pistes.length,
      vivantes: pistes.filter((p) => p.readyState === 'live' && !p.muted).length,
    };
  });
}

test.describe('Deux pairs en vocal', () => {
  test.skip(withoutCredentials, skipReason);

  test.skip(withoutSecondAccount, secondAccountReason);

  test('chacun voit l autre, et recoit une piste audio vivante', async ({ browser }) => {
    test.setTimeout(180_000);

    // Deux contextes separes : un seul partagerait les cookies, et la seconde
    // connexion remplacerait la premiere au lieu de s'y ajouter.
    const chezAlice = await browser.newContext({ permissions: ['microphone', 'camera'] });
    const chezBob = await browser.newContext({ permissions: ['microphone', 'camera'] });

    const alice = await chezAlice.newPage();
    const bob = await chezBob.newPage();

    await signIn(alice, 'premier');
    await signIn(bob, 'second');

    if (!(await rejoindre(alice))) {
      test.skip(true, 'Aucun salon vocal sur ce compte.');
      return;
    }
    await rejoindre(bob);

    /*
     * Deux tuiles de chaque cote.
     *
     * C'est l'assertion qui aurait attrape « on voit personne » : chacun se
     * voyait bien lui-meme — une tuile — et n'avait aucun moyen de savoir que
     * l'autre manquait.
     */
    for (const [nom, page] of [['alice', alice], ['bob', bob]] as const) {
      await expect(page.locator('.voice-tile'), `${nom} doit voir deux participants`)
        .toHaveCount(2, { timeout: 40_000 });
    }

    // La piste distante, et non seulement la tuile : une tuile peut paraitre
    // sur une simple annonce de presence, sans qu'aucun son ne circule.
    for (const [nom, page] of [['alice', alice], ['bob', bob]] as const) {
      await expect
        .poll(async () => (await pistesRecues(page)).vivantes, {
          timeout: 40_000,
          message: `${nom} doit recevoir une piste audio vivante`,
        })
        .toBeGreaterThan(0);
    }

    await chezAlice.close();
    await chezBob.close();
  });
});
