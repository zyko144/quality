import { test, expect } from '@playwright/test';
import {
  CADRAGE_PAR_DEFAUT,
  ZOOM_MAX,
  ZOOM_MIN,
  deplacer,
  estLeCadrageParDefaut,
  lireCadrage,
  styleDeCadrage,
} from '../src/features/profile/cadrage';

/**
 * Le cadrage de la banniere.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Deux choses se verifient mal a l'oeil et cassent tout si elles sont fausses :
 * le SENS du glissement, qu'on ne remarque qu'en le trouvant « bizarre » sans
 * savoir dire pourquoi, et la lecture d'une colonne `jsonb` qui peut contenir
 * n'importe quoi — une fiche de profil qui ne s'ouvre pas ne se repare pas
 * toute seule.
 */

test.describe('Cadrage de la banniere', () => {
  test('on tire l image, on ne pousse pas le regard', () => {
    /*
     * Tirer vers la DROITE montre ce qui etait a GAUCHE : `x` diminue.
     *
     * Le sens inverse donne une impression immediate de commande cassee, sans
     * qu'on puisse dire laquelle — c'est le genre de defaut qu'on signale par
     * « c'est bizarre » et jamais autrement.
     */
    expect(deplacer(CADRAGE_PAR_DEFAUT, 10, 0).x).toBeLessThan(CADRAGE_PAR_DEFAUT.x);
    expect(deplacer(CADRAGE_PAR_DEFAUT, -10, 0).x).toBeGreaterThan(CADRAGE_PAR_DEFAUT.x);
    expect(deplacer(CADRAGE_PAR_DEFAUT, 0, 10).y).toBeLessThan(CADRAGE_PAR_DEFAUT.y);
  });

  test('un fort grossissement ralentit le geste', () => {
    // Sinon le sujet traverse le cadre au moindre mouvement.
    const proche = deplacer({ x: 50, y: 50, zoom: 3 }, 30, 0);
    const loin = deplacer({ x: 50, y: 50, zoom: 1 }, 30, 0);

    expect(50 - proche.x).toBeLessThan(50 - loin.x);
  });

  test('le cadrage ne sort jamais de l image', () => {
    const tropLoin = deplacer(CADRAGE_PAR_DEFAUT, -500, -500);
    expect(tropLoin.x).toBe(100);
    expect(tropLoin.y).toBe(100);

    const tropPres = deplacer(CADRAGE_PAR_DEFAUT, 500, 500);
    expect(tropPres.x).toBe(0);
    expect(tropPres.y).toBe(0);
  });

  test('une colonne vide ou abimee rend le cadrage par defaut', () => {
    /*
     * La colonne est du `jsonb` libre : elle arrive telle qu'elle a ete
     * ecrite, y compris par une version plus ancienne ou plus recente de
     * l'application. Rendre le defaut plutot que de lever est le bon choix —
     * une banniere mal cadree se regarde, une fiche qui ne s'ouvre pas non.
     */
    for (const brut of [null, undefined, 'centre', 42, [], {}, { x: 10 }, { x: 'a', y: 1, zoom: 1 }]) {
      expect(lireCadrage(brut)).toEqual(CADRAGE_PAR_DEFAUT);
    }
  });

  test('un cadrage hors bornes est ramene dans les clous', () => {
    // La base a la meme contrainte, mais elle ne protege pas d'une ligne
    // ecrite avant qu'elle existe.
    expect(lireCadrage({ x: -30, y: 400, zoom: 99 })).toEqual({
      x: 0,
      y: 100,
      zoom: ZOOM_MAX,
    });

    expect(lireCadrage({ x: 10, y: 20, zoom: 0.2 }).zoom).toBe(ZOOM_MIN);
  });

  test('le style grossit depuis le point vise, pas depuis le centre', () => {
    /*
     * Sans cela, grossir rejette hors du cadre ce qu'on venait d'y amener : on
     * cadre un visage a gauche, on grossit, le visage part.
     */
    const style = styleDeCadrage({ x: 20, y: 80, zoom: 2 });

    expect(style.objectPosition).toBe('20% 80%');
    expect(style.transform).toBe('scale(2)');
    expect(style.transformOrigin).toBe('20% 80%');
  });

  test('sans grossissement, aucune transformation n est posee', () => {
    /*
     * Elle ecraserait celle des feuilles de style. Le voile flou de la fiche
     * porte un `scale(1.35)` qui cache le lisere pale laisse par le flou sur
     * les bords ; une transformation inline a 1 le ferait reparaitre.
     */
    expect(styleDeCadrage(CADRAGE_PAR_DEFAUT).transform).toBeUndefined();
  });

  test('on reconnait un cadrage qui ne dit rien', () => {
    // C'est ce qui decide d'ecrire `null` en base plutot qu'un objet inutile.
    expect(estLeCadrageParDefaut(CADRAGE_PAR_DEFAUT)).toBe(true);
    expect(estLeCadrageParDefaut({ x: 50, y: 50, zoom: 1.5 })).toBe(false);
    expect(estLeCadrageParDefaut({ x: 30, y: 50, zoom: 1 })).toBe(false);
  });
});
