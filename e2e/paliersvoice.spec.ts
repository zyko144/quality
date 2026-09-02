import { test, expect } from '@playwright/test';
import {
  lirePalier,
  badgesMerites,
  mesuresUtiles,
} from '../src/features/badges/paliers';

/**
 * Les paliers, lus dans la cle du badge.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ces seuils etaient ecrits deux fois — en SQL dans le catalogue, en TypeScript
 * dans le code qui attribue — et les deux listes ont diverge des la premiere
 * modification. Le catalogue proposait `espace-10` que le code n'attribuait
 * jamais, le code visait `espace-100` qui n'existait pas.
 *
 * Aucun des deux defauts ne se voit : un badge qui n'arrive pas ne produit ni
 * erreur ni trace, et personne ne remarque l'absence de quelque chose. C'est
 * pour cela que la lecture est eprouvee ici plutot que verifiee a l'oeil.
 */

test.describe('Lecture des paliers', () => {
  test('les quatre familles se lisent', () => {
    expect(lirePalier('vocal-150')).toEqual({ mesure: 'vocal', seuil: 150 });
    expect(lirePalier('messages-10k')).toEqual({ mesure: 'messages', seuil: 10_000 });
    expect(lirePalier('espace-100')).toEqual({ mesure: 'espace', seuil: 100 });
    expect(lirePalier('anciennete-3ans')).toEqual({ mesure: 'anciennete', seuil: 3 });
  });

  test('les echelles multiplient', () => {
    expect(lirePalier('messages-1m')).toEqual({ mesure: 'messages', seuil: 1_000_000 });
    expect(lirePalier('espace-100k')).toEqual({ mesure: 'espace', seuil: 100_000 });
    expect(lirePalier('espace-1m')).toEqual({ mesure: 'espace', seuil: 1_000_000 });
  });

  test('le pluriel de l anciennete ne change rien', () => {
    // « 1an » et « 3ans » : le nombre compte, la lettre non.
    expect(lirePalier('anciennete-1an')?.seuil).toBe(1);
    expect(lirePalier('anciennete-10ans')?.seuil).toBe(10);
  });

  test('les badges qui ne se calculent pas rendent null', () => {
    /*
     * `null` est la reponse normale, pas une erreur : ces badges s'attribuent
     * autrement. Les confondre avec une cle mal formee ferait chercher un
     * defaut inexistant.
     */
    expect(lirePalier('pionnier')).toBeNull();
    expect(lirePalier('equipe')).toBeNull();
    expect(lirePalier('premiere-heure')).toBeNull();
    expect(lirePalier('rapporteur')).toBeNull();
  });

  test('une cle mal formee ne rend jamais un nombre approchant', () => {
    /*
     * Le cas qui compte : un seuil mal lu donnerait un badge de mille heures a
     * qui en a passe dix. Mieux vaut ne rien attribuer.
     */
    expect(lirePalier('vocal-')).toBeNull();
    expect(lirePalier('vocal-abc')).toBeNull();
    expect(lirePalier('vocal-10x')).toBeNull();
    expect(lirePalier('vocal-1.5')).toBeNull();
    expect(lirePalier('vocal-0')).toBeNull();
    expect(lirePalier('inconnu-10')).toBeNull();
    expect(lirePalier('')).toBeNull();
  });
});

test.describe('Attribution par palier', () => {
  const CATALOGUE = [
    { cle: 'pionnier' },
    { cle: 'vocal-10' },
    { cle: 'vocal-100' },
    { cle: 'vocal-5000' },
    { cle: 'messages-10k' },
    { cle: 'espace-100' },
    { cle: 'anciennete-1an' },
  ];

  test('on ne merite que ce qu on a atteint', () => {
    const merites = badgesMerites(
      CATALOGUE,
      { vocal: 120, messages: 500, espace: 4, anciennete: 0.2 },
      new Set(),
    );

    // Cent vingt heures : les deux premiers paliers, pas le troisieme.
    expect(merites).toEqual(['vocal-10', 'vocal-100']);
  });

  test('ce qu on a deja n est pas redemande', () => {
    /*
     * Chaque demande est un aller-retour, et il y a une trentaine de badges.
     * Les redemander a chaque ouverture de session serait trente requetes pour
     * trente refus.
     */
    const merites = badgesMerites(CATALOGUE, { vocal: 9999 }, new Set(['vocal-10']));
    expect(merites).toEqual(['vocal-100', 'vocal-5000']);
  });

  test('une mesure absente n attribue rien', () => {
    // Absente n'est pas zero : la distinction cessera d'etre theorique le jour
    // ou l'on ajoutera un badge « moins de X ».
    expect(badgesMerites(CATALOGUE, {}, new Set())).toEqual([]);
  });

  test('les badges hors palier ne sont jamais rendus', () => {
    // `pionnier` s'attribue autrement : le rendre ici le ferait demander deux
    // fois, une fois de trop.
    const merites = badgesMerites(CATALOGUE, { vocal: 99999, messages: 99999999 }, new Set());
    expect(merites).not.toContain('pionnier');
  });

  test('on ne mesure que ce qui peut encore etre gagne', () => {
    /*
     * Compter les messages de quelqu'un qui a deja tous les paliers est une
     * requete pour rien — et elle partirait a chaque ouverture de session, pour
     * toujours.
     */
    const tout = mesuresUtiles(CATALOGUE, new Set());
    expect([...tout].sort()).toEqual(['anciennete', 'espace', 'messages', 'vocal']);

    const restant = mesuresUtiles(
      CATALOGUE,
      new Set(['vocal-10', 'vocal-100', 'vocal-5000', 'messages-10k']),
    );
    expect([...restant].sort()).toEqual(['anciennete', 'espace']);

    const rien = mesuresUtiles(
      CATALOGUE,
      new Set(['vocal-10', 'vocal-100', 'vocal-5000', 'messages-10k', 'espace-100', 'anciennete-1an']),
    );
    expect([...rien]).toEqual([]);
  });
});
