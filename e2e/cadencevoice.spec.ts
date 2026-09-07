import { test, expect } from '@playwright/test';
import { ajuster, PLANCHER_LIAISON, BITS_PAR_IMAGE, PLANCHER, MARGE, PAS_DE_REMONTEE } from '../src/features/voice/cadence';

/**
 * La cadence de capture.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * C'est une boucle de contre-reaction : ce qu'elle decide change la mesure sur
 * laquelle elle decidera ensuite. Une regle mal posee ne se trompe pas d'un
 * cran, elle s'effondre — on capture moins, donc l'encodeur sort moins, donc on
 * capture moins encore. Cette derive ne se voit pas en lisant le code ; elle se
 * voit en faisant tourner la boucle, ce que font les cas ci-dessous.
 */

/**
 * Fait tourner la boucle en simulant un encodeur.
 *
 * `capacite` est ce que la machine sait sortir : l'encodeur emet le minimum
 * entre ce qu'on lui donne et ce qu'il tient, et se declare limite par le
 * processeur des qu'il ne suit pas.
 */
function tourner(depart: number, voulu: number, capacite: number, tours: number): number[] {
  let courante = depart;
  const suite: number[] = [];

  for (let i = 0; i < tours; i += 1) {
    const emises = Math.min(courante, capacite);
    const limite = emises < courante ? 'cpu' : 'none';

    const decide = ajuster(courante, voulu, { images: emises, limite, kbps: LARGE });
    if (decide !== null) courante = decide;
    suite.push(courante);
  }

  return suite;
}

/** Un debit confortable : ces cas-la ne parlent pas de la liaison. */
const LARGE = 20_000;

test.describe('Cadence de capture', () => {
  test('une machine qui suit garde la cadence demandee', () => {
    // Rien ne freine : on ne doit pas bouger d'un pouce.
    const suite = tourner(60, 60, 60, 10);
    expect(suite.every((valeur) => valeur === 60)).toBe(true);
  });

  test('une machine a la peine se stabilise au-dessus de ce qu elle sort', () => {
    /*
     * Le cas qui motive tout : soixante demandees, vingt-cinq tenues. Sans
     * ajustement on rapatrie trente-cinq images par seconde pour rien, a deux
     * millisecondes chacune.
     */
    const suite = tourner(60, 60, 25, 30);
    const fin = suite[suite.length - 1]!;

    // On capture au-dessus de ce qui sort — sinon on brimerait l'encodeur —
    // mais nettement en dessous des soixante payees pour rien.
    expect(fin).toBeGreaterThan(25);
    expect(fin).toBeLessThan(40);
  });

  test('la boucle ne s effondre jamais', () => {
    /*
     * La derive qu'on craint : chaque baisse en justifie une nouvelle. On la
     * cherche sur toutes les capacites, y compris les plus basses.
     */
    for (const capacite of [1, 3, 8, 15, 24, 30, 45, 59]) {
      const suite = tourner(60, 60, capacite, 60);
      const fin = suite[suite.length - 1]!;

      expect(fin, `capacite ${capacite}`).toBeGreaterThanOrEqual(PLANCHER);
      // Et jamais au-dessous de ce que la machine sort vraiment.
      expect(fin, `capacite ${capacite}`).toBeGreaterThanOrEqual(Math.min(capacite, PLANCHER));
    }
  });

  test('la machine qui se libere retrouve la cadence demandee', () => {
    // Un jeu qui se ferme, une autre application qui rend le processeur.
    let courante = 20;
    for (let i = 0; i < 30; i += 1) {
      const decide = ajuster(courante, 60, { images: courante, limite: 'none', kbps: LARGE });
      if (decide !== null) courante = decide;
    }

    expect(courante).toBe(60);
  });

  test('la remontee est progressive, jamais d un bond', () => {
    const decide = ajuster(20, 60, { images: 20, limite: 'none', kbps: LARGE });
    expect(decide).toBe(20 + PAS_DE_REMONTEE);
  });

  test('le choix de la personne n est jamais depasse', () => {
    /*
     * Trente demandees et une machine qui pourrait en tenir cent : on reste a
     * trente. C'est un choix, pas une limite technique — le depasser
     * remplacerait la decision de quelqu'un par la notre.
     */
    const suite = tourner(30, 30, 120, 20);
    expect(Math.max(...suite)).toBe(30);
  });

  test('une liaison etroite fait baisser la capture', () => {
    /*
     * Ce cas disait l'inverse, et il avait tort.
     *
     * Le raisonnement d'alors : « `bandwidth` se traite en baissant le debit,
     * ce que le moteur fait deja ». La premiere moitie est vraie ; la
     * conclusion ne l'est pas. Sous contrainte, le moteur fait ce que
     * `degradationPreference` lui dit — et nous lui demandons de TENIR la
     * cadence. Il garde donc les soixante images et retire des bits a chacune.
     *
     * Releve d'un vrai partage : `limite: bandwidth`, 95 kilobits par seconde,
     * soixante images. Cela fait mille six cents bits par image — il n'y a plus
     * d'image, seulement des blocs.
     */
    const decide = ajuster(60, 60, { images: 60, limite: 'bandwidth', kbps: 95 });

    expect(decide).not.toBeNull();
    expect(decide).toBe(PLANCHER_LIAISON);
  });

  test('la cadence visee rend aux images de quoi etre lisibles', () => {
    /*
     * Trois megabits par seconde : de quoi tenir vingt-cinq images a cent
     * vingt kilobits chacune. On ne perd pas de la qualite, on la deplace.
     */
    const decide = ajuster(60, 60, { images: 60, limite: 'bandwidth', kbps: 3_000 });

    expect(decide).not.toBeNull();
    expect(decide! * BITS_PAR_IMAGE).toBeLessThanOrEqual(3_000 * 1000 * 1.05);
    expect(decide!).toBeGreaterThanOrEqual(PLANCHER_LIAISON);
  });

  test('une liaison large ne retire rien', () => {
    // Douze megabits a soixante images : deux cents kilobits chacune, bien
    // au-dessus du seuil. Rien a corriger.
    expect(ajuster(60, 60, { images: 60, limite: 'bandwidth', kbps: 12_000 })).toBeNull();
  });

  test('la cadence demandee reste un plafond, meme avec du debit a revendre', () => {
    /*
     * Quelqu'un qui a choisi trente images ne doit pas en recevoir soixante
     * parce que sa liaison est bonne : c'est un choix, pas une limite.
     */
    expect(ajuster(30, 30, { images: 30, limite: 'bandwidth', kbps: 50_000 })).toBeNull();
  });

  test('un debit nul ne decide rien', () => {
    // Le premier releve, avant qu'un seul octet ne soit parti.
    expect(ajuster(60, 60, { images: 60, limite: 'bandwidth', kbps: 0 })).toBeNull();
  });

  test('un premier releve vide ne decide rien', () => {
    // Avant la premiere image, le moteur annonce zero. S'y fier ramenerait la
    // capture au plancher des la premiere seconde d'un partage qui va bien.
    expect(ajuster(60, 60, { images: 0, limite: 'cpu', kbps: LARGE })).toBeNull();
  });

  test('on ne suit pas le bruit de mesure', () => {
    // Une image d'ecart n'est pas un signal : chaque changement traverse le
    // pont vers le systeme, et suivre le bruit couterait plus que le gain.
    expect(ajuster(60, 60, { images: 58, limite: 'cpu' })).toBeNull();
  });

  test('la marge tient l encodeur au large', () => {
    // Capturer exactement ce que l'encodeur sort le priverait de toute reserve,
    // et le moindre a-coup deviendrait une baisse durable.
    const decide = ajuster(60, 60, { images: 25, limite: 'cpu' });
    expect(decide).toBe(Math.round(25 * MARGE));
  });
});
