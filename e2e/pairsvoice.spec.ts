import { test, expect } from '@playwright/test';
import {
  decider,
  etatPairsVide,
  GRACE_ABSENCE,
  ATTENTE_OFFRE,
} from '../src/features/voice/pairs';

/**
 * La decision qui garde ou coupe une connexion vocale.
 *
 * Nomme pour tomber dans un projet existant. Ces cas ne touchent ni au reseau
 * ni a la base : c'est de la logique pure, et c'est precisement pour cela
 * qu'elle a ete extraite — elle portait le defaut le plus couteux du vocal, et
 * un defaut de ce genre ne se corrige pas de facon credible sans qu'on puisse
 * l'eprouver.
 *
 * Le defaut : une absence passagere dans la presence detruisait la connexion,
 * et un seul des deux cotes la rebatissait. Quand c'etait l'autre qui avait
 * coupe, la voix disparaissait dans un seul sens, definitivement.
 */

// `a` precede `b` : `a` est donc celui qui amorce.
const MOI = 'aaaa';
const AUTRE = 'zzzz';

test.describe('Connexions vocales', () => {
  test('une absence passagere ne coupe rien', () => {
    const etat = etatPairsVide();

    // Le pair disparait d'un instantane, puis revient au suivant.
    const premier = decider(MOI, [], [AUTRE], etat, 1000);
    expect(premier.retirer).toEqual([]);

    const second = decider(MOI, [AUTRE], [AUTRE], etat, 2000);
    expect(second.retirer).toEqual([]);

    // Et l'absence est oubliee : une disparition plus tard repart de zero.
    const troisieme = decider(MOI, [], [AUTRE], etat, 3000);
    expect(troisieme.retirer).toEqual([]);
  });

  test('une absence qui dure finit par couper', () => {
    const etat = etatPairsVide();

    expect(decider(MOI, [], [AUTRE], etat, 1000).retirer).toEqual([]);
    expect(decider(MOI, [], [AUTRE], etat, 1000 + GRACE_ABSENCE - 1).retirer).toEqual([]);
    expect(decider(MOI, [], [AUTRE], etat, 1000 + GRACE_ABSENCE).retirer).toEqual([AUTRE]);
  });

  test('celui qui amorce ouvre tout de suite', () => {
    const etat = etatPairsVide();
    const decision = decider(MOI, [AUTRE], [], etat, 1000);

    expect(decision.ouvrir).toEqual([AUTRE]);
    expect(decision.rebatir).toEqual([]);
  });

  test('celui qui attend n ouvre pas de lui-meme', () => {
    const etat = etatPairsVide();
    // Vu depuis l'autre bout : `zzzz` attend l'offre de `aaaa`.
    const decision = decider(AUTRE, [MOI], [], etat, 1000);

    expect(decision.ouvrir).toEqual([]);
    expect(decision.rebatir).toEqual([]);
  });

  /*
   * Le cas qui a coute le plus cher.
   *
   * Le cote qui attend a perdu sa connexion, l'autre non : aucune offre ne
   * viendra, puisque rien ne demande a l'autre de renegocier. Sans ce
   * rattrapage, la voix ne revenait qu'en quittant le salon.
   */
  test('celui qui attend rebatit quand l offre ne vient pas', () => {
    const etat = etatPairsVide();

    expect(decider(AUTRE, [MOI], [], etat, 1000).rebatir).toEqual([]);
    expect(decider(AUTRE, [MOI], [], etat, 1000 + ATTENTE_OFFRE - 1).rebatir).toEqual([]);
    expect(decider(AUTRE, [MOI], [], etat, 1000 + ATTENTE_OFFRE).rebatir).toEqual([MOI]);
  });

  test('le rattrapage ne se repete pas a chaque battement', () => {
    const etat = etatPairsVide();

    decider(AUTRE, [MOI], [], etat, 1000);
    expect(decider(AUTRE, [MOI], [], etat, 1000 + ATTENTE_OFFRE).rebatir).toEqual([MOI]);

    // Juste apres, la negociation est en cours : on ne relance pas.
    expect(decider(AUTRE, [MOI], [], etat, 1000 + ATTENTE_OFFRE + 100).rebatir).toEqual([]);
  });

  test('une connexion etablie arrete l attente', () => {
    const etat = etatPairsVide();

    decider(AUTRE, [MOI], [], etat, 1000);
    // La connexion s'etablit : le pair figure desormais parmi les connectes.
    decider(AUTRE, [MOI], [MOI], etat, 2000);

    // Meme longtemps apres, rien n'est rebati.
    expect(decider(AUTRE, [MOI], [MOI], etat, 60_000).rebatir).toEqual([]);
  });

  test('on ne se compte jamais soi-meme', () => {
    const etat = etatPairsVide();
    const decision = decider(MOI, [MOI, AUTRE], [], etat, 1000);

    expect(decision.ouvrir).toEqual([AUTRE]);
    expect(decision.retirer).toEqual([]);
  });
});
