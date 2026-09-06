import { test, expect } from '@playwright/test';
import {
  prochainPalier,
  PALIERS,
  CHARGE_HAUTE,
  CHARGE_BASSE,
  CALMES_AVANT_REMONTEE,
  PERTES_HAUTES,
  type Constat,
} from '../src/features/voice/allegement';

/**
 * L'allegement d'un partage pour la machine qui ne suit pas.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que ce fichier protege : une boucle de contre-reaction, et celles-la ne
 * se verifient pas en les lisant. Ce qu'elle decide change la mesure sur
 * laquelle elle decidera ensuite — alleger fait baisser la charge, ce qui
 * donne envie de remonter, ce qui refait monter la charge. Une regle mal
 * posee ne se trompe pas d'un cran, elle oscille : la definition change toutes
 * les deux secondes, et c'est plus penible que la saccade qu'on voulait
 * corriger.
 *
 * Le meme raisonnement que `cadence.ts`, de l'autre cote du fil.
 */

/** Une machine qui met `ms` a decoder chaque image, a `fps` images par seconde. */
function machine(ms: number, fps = 60, perdues = 0): Constat {
  return { msParImage: ms, imagesParSeconde: fps, perdues };
}

/** Fait tourner la regle sur une suite de constats. Rend les paliers visites. */
function suivre(constats: Constat[]): number[] {
  let etat = { palier: 0, calmes: 0 };
  const visites: number[] = [];

  for (const constat of constats) {
    etat = prochainPalier(etat.palier, etat.calmes, constat);
    visites.push(etat.palier);
  }

  return visites;
}

test.describe('quand alleger, et de combien', () => {
  test('une machine a l’aise ne se voit rien retirer', () => {
    // 4 ms par image sur un budget de 16,7 : un quart du temps reel.
    const visites = suivre(Array.from({ length: 10 }, () => machine(4)));
    expect(visites.every((palier) => palier === 0)).toBe(true);
  });

  test('une machine en peine descend d’un cran a la fois', () => {
    /*
     * Un seul cran par mesure, meme quand la charge est tres au-dessus.
     *
     * Descendre de trois d'un coup ramenerait l'image a un timbre-poste avant
     * d'avoir vu si le premier cran suffisait — et il suffit souvent.
     */
    const visites = suivre(Array.from({ length: 6 }, () => machine(15)));
    expect(visites).toEqual([1, 2, 3, 4, 4, 4]);
  });

  test('on ne descend jamais sous le dernier cran', () => {
    const visites = suivre(Array.from({ length: 20 }, () => machine(30)));
    expect(Math.max(...visites)).toBe(PALIERS.length - 1);
  });

  test('des images perdues suffisent, meme sans charge', () => {
    /*
     * Le decodage peut tenir dans le budget et l'affichage decrocher quand
     * meme : c'est le cas d'une machine dont la carte graphique suit mal, ou
     * dont le compositeur du systeme prend la main. Les deux signaux disent la
     * meme chose vue de celui qui regarde — ca saute.
     */
    const visites = suivre([machine(3, 60, PERTES_HAUTES + 0.02)]);
    expect(visites[0]).toBe(1);
  });

  test('on remonte, mais lentement', () => {
    let etat = { palier: 2, calmes: 0 };

    // Deux mesures au calme ne suffisent pas.
    for (let i = 0; i < CALMES_AVANT_REMONTEE - 1; i += 1) {
      etat = prochainPalier(etat.palier, etat.calmes, machine(3));
      expect(etat.palier).toBe(2);
    }

    etat = prochainPalier(etat.palier, etat.calmes, machine(3));
    expect(etat.palier).toBe(1);
  });

  test('la zone tiede ne fait ni monter ni descendre', () => {
    /*
     * L'ecart entre les deux seuils est ce qui empeche l'oscillation. Une
     * charge entre les deux ne doit rien declencher — et surtout ne pas
     * accumuler de calme, sans quoi on finirait par remonter par lassitude
     * dans une machine qui n'a jamais eu de marge.
     */
    const budget = 1000 / 60;
    const tiede = machine(((CHARGE_HAUTE + CHARGE_BASSE) / 2) * budget);

    let etat = { palier: 2, calmes: 0 };
    for (let i = 0; i < 12; i += 1) {
      etat = prochainPalier(etat.palier, etat.calmes, tiede);
    }

    expect(etat.palier).toBe(2);
    expect(etat.calmes).toBe(0);
  });

  test('une mesure vide ne decide rien', () => {
    /*
     * C'est ce que rend le premier releve, et celui d'un partage qu'on vient
     * de fermer. S'y fier ferait descendre l'echelle entiere dans les deux
     * premieres secondes de chaque partage.
     */
    expect(prochainPalier(0, 0, machine(0, 0))).toEqual({ palier: 0, calmes: 0 });
    expect(prochainPalier(2, 1, { msParImage: Number.NaN, imagesParSeconde: 60, perdues: 0 })).toEqual(
      { palier: 2, calmes: 1 },
    );
  });

  test('une machine qui se retablit ne se met pas a osciller', () => {
    /*
     * Le scenario complet, et celui qui compte : une machine qui peine, qu'on
     * allege, qui va alors mieux PARCE QU'on l'a allegee. Sans hysteresis, ce
     * mieux la fait remonter, la remontee la fait repeiner, et la definition
     * change toutes les deux secondes pour toujours.
     *
     * On simule cela franchement : la charge est divisee par le carre de la
     * reduction, puisque c'est la surface qui compte.
     */
    /*
     * 12,5 ms, et le choix n'est pas anodin.
     *
     * Une premiere version de cet essai prenait 15 ms — une valeur qui passe,
     * et qui ne prouvait donc rien. La bande dangereuse est etroite : il faut
     * que la machine peine a pleine definition ET soit tres a l'aise au cran
     * du dessous, sans quoi elle se stabilise d'elle-meme dans la zone tiede.
     *
     * Simule sur la regle sans projection, cette valeur donne TRENTE
     * changements en soixante mesures — un toutes les quatre secondes, sans
     * fin. C'est le cas qu'il fallait attraper.
     */
    const BRUT = 12.5;
    let etat = { palier: 0, calmes: 0 };
    let changements = 0;
    /** Changements survenus dans la seconde moitie : ils devraient etre nuls. */
    let tardifs = 0;
    let precedent = 0;

    for (let tour = 0; tour < 60; tour += 1) {
      const reduction = PALIERS[etat.palier]!.reduction;
      const ms = BRUT / (reduction * reduction);

      etat = prochainPalier(etat.palier, etat.calmes, machine(ms));
      if (etat.palier !== precedent) {
        changements += 1;
        if (tour >= 30) tardifs += 1;
      }
      precedent = etat.palier;
    }

    /*
     * Deux minutes de partage, et l'image ne doit pas avoir change dix fois.
     *
     * Le compte exact importe moins que l'ordre de grandeur : sans hysteresis,
     * cette boucle donne un changement une mesure sur deux, soit une trentaine.
     */
    expect(changements).toBeLessThanOrEqual(3);

    // Et l'on se stabilise sur un cran qui tient vraiment.
    const reduction = PALIERS[etat.palier]!.reduction;
    expect(BRUT / (reduction * reduction) / (1000 / 60)).toBeLessThan(CHARGE_HAUTE);

    /*
     * La stabilite s'installe : rien ne bouge sur la seconde moitie.
     *
     * Le compte total pourrait etre bas et l'image changer quand meme a la fin
     * du partage. Ce qu'on veut, c'est que ca se pose.
     */
    expect(tardifs).toBe(0);
  });
});
