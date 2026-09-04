import { test, expect } from '@playwright/test';
import {
  COULEURS_PAR_DEFAUT,
  estLeDefaut,
  inverser,
  lireCouleurs,
  styleDesCouleurs,
} from '../src/features/profile/couleursProfil';

/**
 * Les couleurs d'une fiche de profil.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce qui a motive ce fichier : le reglage precedent ne servait a RIEN. Huit
 * teintes etaient proposees, posees en `--hue-primary` sur la carte, et aucune
 * regle CSS ne lisait cette variable. Le choix existait, l'effet non — et rien
 * ne le disait, puisqu'un reglage sans effet ressemble a un reglage subtil.
 *
 * Les cas ci-dessous portent donc sur ce qui se verifie sans navigateur : la
 * lecture d'une colonne libre, et les VARIABLES effectivement produites. Que la
 * feuille de style les emploie se voit a l'ecran ; qu'elles soient justes se
 * voit ici.
 */

test.describe('Couleurs de la fiche', () => {
  test('une colonne vide ou abimee rend les couleurs par defaut', () => {
    /*
     * Rendre le defaut plutot que de lever : une fiche mal coloree se regarde,
     * une fiche qui ne s'ouvre pas ne se repare pas toute seule.
     */
    for (const brut of [null, undefined, 'bleu', 42, [], {}, { a: 'rouge' }, { a: '#12345' }]) {
      expect(lireCouleurs(brut)).toEqual(COULEURS_PAR_DEFAUT);
    }
  });

  test('un style inconnu retombe sur la couleur unique', () => {
    // Une version plus recente pourrait ecrire un style que celle-ci ignore.
    expect(lireCouleurs({ a: '#112233', b: '#445566', style: 'arc-en-ciel' })).toEqual({
      a: '#112233',
      b: '#445566',
      style: 'unique',
    });
  });

  test('une seconde couleur absente ne fait pas perdre la premiere', () => {
    expect(lireCouleurs({ a: '#112233', style: 'duo' })).toEqual({
      a: '#112233',
      b: COULEURS_PAR_DEFAUT.b,
      style: 'duo',
    });
  });

  test('inverser echange le haut et le bas, sans toucher au style', () => {
    /*
     * C'est pourquoi il n'existe pas de style « duo inverse » : ce serait la
     * meme chose ecrite deux fois, et la liste des styles doublerait pour dire
     * la meme chose a l'envers.
     */
    const avant = { a: '#111111', b: '#222222', style: 'duo' } as const;
    expect(inverser(avant)).toEqual({ a: '#222222', b: '#111111', style: 'duo' });
    expect(inverser(inverser(avant))).toEqual(avant);
  });

  test('en couleur unique, les deux variables sont identiques', () => {
    /*
     * C'est ce qui evite un jeu de regles CSS par style : un degrade d'une
     * couleur vers elle-meme est un aplat, donc la meme formule sert aux deux.
     */
    const style = styleDesCouleurs({ a: '#112233', b: '#445566', style: 'unique' }) as Record<
      string,
      string
    >;

    expect(style['--profil-a']).toBe('#112233');
    expect(style['--profil-b']).toBe('#112233');
  });

  test('en duo et en degrade, la seconde couleur est bien la seconde', () => {
    for (const style of ['duo', 'degrade'] as const) {
      const produit = styleDesCouleurs({ a: '#112233', b: '#445566', style }) as Record<
        string,
        string
      >;

      expect(produit['--profil-a']).toBe('#112233');
      expect(produit['--profil-b']).toBe('#445566');
    }
  });

  test('on reconnait des couleurs qui ne disent rien', () => {
    // C'est ce qui decide d'ecrire `null` en base plutot qu'un objet inutile.
    expect(estLeDefaut(COULEURS_PAR_DEFAUT)).toBe(true);
    expect(estLeDefaut({ ...COULEURS_PAR_DEFAUT, style: 'degrade' })).toBe(false);
    expect(estLeDefaut({ ...COULEURS_PAR_DEFAUT, a: '#000000' })).toBe(false);
  });
});
