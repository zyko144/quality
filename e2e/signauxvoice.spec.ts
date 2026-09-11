import { test, expect } from '@playwright/test';
import { arriveesASignaler, departASignaler, etatSignauxVide } from '../src/features/voice/signaux';
import { GRACE_ABSENCE } from '../src/features/voice/pairs';

/**
 * Les sons d'arrivee et de depart.
 *
 * Nomme pour tomber dans le projet « authentifie », comme les autres regles du
 * vocal ; ces cas ne demandent pourtant aucune session.
 *
 * Ce que ce fichier protege : un son de depart qui arrivait cinq secondes apres
 * le depart, un son d'arrivee que la moitie des paires n'entendait jamais, et
 * une rafale de sons chaque fois qu'on entrait soi-meme.
 */

const MOI = 'aaaa';
const ALICE = 'bbbb';
const BOB = 'cccc';

test.describe('Sons d arrivee et de depart', () => {
  test('en entrant, on ne salue pas ceux qui sont deja la', () => {
    const etat = etatSignauxVide();
    expect(arriveesASignaler(MOI, [MOI, ALICE, BOB], etat, 0)).toEqual([]);
  });

  test('une arrivee se signale au premier instantane qui la montre', () => {
    const etat = etatSignauxVide();
    arriveesASignaler(MOI, [MOI], etat, 0);
    expect(arriveesASignaler(MOI, [MOI, ALICE], etat, 100)).toEqual([ALICE]);
  });

  test('des deux cotes, quel que soit l identifiant', () => {
    // L'ancien son ne jouait que du cote au plus petit identifiant, celui qui
    // ouvre la connexion. `zzzz` est plus grand que MOI, `0000` plus petit.
    for (const autre of ['zzzz', '0000']) {
      const etat = etatSignauxVide();
      arriveesASignaler(MOI, [MOI], etat, 0);
      expect(arriveesASignaler(MOI, [MOI, autre], etat, 100)).toEqual([autre]);
    }
  });

  test('on ne se salue jamais soi-meme', () => {
    const etat = etatSignauxVide();
    arriveesASignaler(MOI, [ALICE], etat, 0);
    expect(arriveesASignaler(MOI, [ALICE, MOI], etat, 100)).toEqual([]);
  });

  test('un hoquet de presence ne fait aucun son', () => {
    const etat = etatSignauxVide();
    arriveesASignaler(MOI, [MOI, ALICE], etat, 0);
    // Alice disparait un instant d'un instantane, puis revient.
    arriveesASignaler(MOI, [MOI], etat, 1000);
    expect(arriveesASignaler(MOI, [MOI, ALICE], etat, 2000)).toEqual([]);
  });

  test('le retour apres un depart annonce se signale', () => {
    const etat = etatSignauxVide();
    arriveesASignaler(MOI, [MOI, ALICE], etat, 0);
    expect(departASignaler(etat, ALICE)).toBe(true);
    arriveesASignaler(MOI, [MOI], etat, 500);
    expect(arriveesASignaler(MOI, [MOI, ALICE], etat, 1500)).toEqual([ALICE]);
  });

  test('un depart ne se signale qu une fois, par l annonce ou par l absence', () => {
    const etat = etatSignauxVide();
    arriveesASignaler(MOI, [MOI, ALICE], etat, 0);
    // L'annonce arrive d'abord, puis la marge expire : un seul son.
    expect(departASignaler(etat, ALICE)).toBe(true);
    expect(departASignaler(etat, ALICE)).toBe(false);
  });

  test('revenir apres la marge se signale, meme sans annonce', () => {
    const etat = etatSignauxVide();
    arriveesASignaler(MOI, [MOI, ALICE], etat, 0);
    arriveesASignaler(MOI, [MOI], etat, 1000);
    expect(arriveesASignaler(MOI, [MOI, ALICE], etat, 1000 + GRACE_ABSENCE + 1)).toEqual([ALICE]);
  });
});
