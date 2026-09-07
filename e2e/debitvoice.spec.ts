import { test, expect } from '@playwright/test';
import {
  reglagePourDebit,
  vautLeChangement,
  BITS_PAR_PIXEL,
  IMAGES_PLANCHER,
} from '../src/features/voice/debit';

/**
 * Ce qu'on emet quand le debit ne suffit pas.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que ce fichier protege : une correction qui a deja rate une fois, faute
 * de portee. Elle ne touchait qu'a la cadence, avec un plancher de vingt-quatre
 * images — lequel annulait tout en dessous de trois megabits, c'est-a-dire sur
 * toute la plage ou elle servait. Les debits releves chez ceux qui se
 * plaignaient : 95, 134, 480, 1346 kilobits.
 *
 * Le rapport se verifie en une ligne : quatre-vingt-quinze kilobits sur
 * vingt-quatre images font trois mille neuf cents bits par image, pour un
 * seuil vise a cent vingt mille. Une regle peut etre juste dans son
 * raisonnement et sans effet dans ses chiffres, et rien ne le dit tant qu'on
 * ne les pose pas cote a cote.
 */

/** Les bits par pixel qu'un reglage obtient vraiment, au debit donne. */
function bitsParPixel(kbps: number, largeur: number, hauteur: number, reglage: { reduction: number; images: number }): number {
  const pixels = (largeur / reglage.reduction) * (hauteur / reglage.reduction) * reglage.images;
  return (kbps * 1000) / pixels;
}

test.describe('le reglage suit le debit', () => {
  test('une liaison large garde tout', () => {
    const reglage = reglagePourDebit(16_000, 1920, 1080, 60);

    expect(reglage.reduction).toBe(1);
    expect(reglage.images).toBe(60);
  });

  test('les debits qui ont ete releves donnent une image lisible', () => {
    /*
     * Le vrai test de la correction : les memes nombres que ceux du journal.
     * Chacun doit atteindre le seuil, ou s'en approcher au plus pres quand
     * meme le dernier cran ne suffit pas.
     */
    for (const kbps of [480, 1346, 2263, 3769, 4278]) {
      const reglage = reglagePourDebit(kbps, 1920, 1080, 60);
      const obtenu = bitsParPixel(kbps, 1920, 1080, reglage);

      expect(obtenu, `${kbps} kbps donne ${obtenu.toFixed(3)} bits/px`).toBeGreaterThanOrEqual(
        BITS_PAR_PIXEL * 0.95,
      );
    }
  });

  test('la definition baisse avant la cadence', () => {
    /*
     * C'est l'arbitrage demande : « qu'on voit bien l'ecriture sur un stream
     * meme les mouvement fast ». Une image nette a vingt images se lit ; une
     * image floue a soixante non.
     *
     * A 1346 kbps, garder le 1080p imposerait moins de huit images par
     * seconde — sous le plancher. La definition doit donc ceder.
     */
    const reglage = reglagePourDebit(1_346, 1920, 1080, 60);

    expect(reglage.reduction).toBeGreaterThan(1);
    expect(reglage.images).toBeGreaterThanOrEqual(IMAGES_PLANCHER);
  });

  test('la cadence demandee reste un plafond', () => {
    // Quelqu'un qui a choisi trente images ne doit pas en recevoir soixante
    // parce que sa liaison est excellente : c'est un choix, pas une limite.
    expect(reglagePourDebit(50_000, 1920, 1080, 30).images).toBeLessThanOrEqual(30);
  });

  test('on ne descend jamais sous le plancher d’images', () => {
    // Meme sur une liaison catastrophique : en dessous ce n'est plus un
    // partage, et l'on ne suit plus le geste de celui qui montre quelque chose.
    expect(reglagePourDebit(20, 1920, 1080, 60).images).toBeGreaterThanOrEqual(IMAGES_PLANCHER);
  });

  test('sans mesure, on ne touche a rien', () => {
    // Le premier releve, avant qu'un octet ne soit parti.
    expect(reglagePourDebit(0, 1920, 1080, 60)).toEqual({ reduction: 1, images: 60 });
    expect(reglagePourDebit(5_000, 0, 0, 60)).toEqual({ reduction: 1, images: 60 });
  });

  test('on ne bouge pas pour du bruit de mesure', () => {
    /*
     * Chaque changement se voit — la definition saute, la cadence aussi. Suivre
     * le bruit ferait osciller le partage en permanence, ce qui est plus
     * penible que le defaut qu'on corrige.
     */
    expect(vautLeChangement({ reduction: 1, images: 60 }, { reduction: 1, images: 58 })).toBe(false);
    expect(vautLeChangement({ reduction: 1, images: 60 }, { reduction: 1, images: 48 })).toBe(true);
    expect(vautLeChangement({ reduction: 1, images: 60 }, { reduction: 1.5, images: 60 })).toBe(true);
  });

  test('le chemin de retour existe', () => {
    /*
     * La moitie qu'on oublie toujours. Sans elle, une seconde de creux
     * ramenait le partage en 360p pour le reste de la seance : la regle ne se
     * relisait que sous contrainte, et rien ne remontait jamais.
     */
    const creux = reglagePourDebit(300, 1920, 1080, 60);
    const large = reglagePourDebit(20_000, 1920, 1080, 60);

    expect(creux.reduction).toBeGreaterThan(1);
    expect(large.reduction).toBe(1);
    expect(vautLeChangement(creux, large)).toBe(true);
  });
});
