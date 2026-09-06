import { test, expect } from '@playwright/test';
import {
  decideRelance,
  peutReoffrir,
  ATTENTE_AVANT_RELANCE,
  INTERVALLE_RELANCE,
  RELANCES_MAX,
  REPOS_REOFFRE,
  type AttentePartage,
} from '../src/features/voice/relance';

/**
 * La relance d'un partage qui n'arrive pas.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que ce fichier protege : « des fois connexion au partage a l'infini ».
 * Le defaut ne se voit d'aucun des deux cotes — celui qui partage a bien pose
 * sa piste, celui qui regarde n'a rien recu, et rien dans le code ne
 * distinguait une offre perdue d'une negociation encore en cours.
 *
 * Une regle qui se declenche trop tot derange une negociation qui allait
 * aboutir ; une regle qui ne se declenche jamais laisse le voile tourner pour
 * toujours. Les deux se ressemblent a la lecture, et aucune ne se verifie a
 * l'oeil dans un appel : on simule donc le temps qui passe.
 */

/** Une attente qui vient de naitre. */
function neuve(maintenant: number): AttentePartage {
  return { depuis: maintenant, relances: 0, derniereRelance: 0 };
}

/**
 * Le battement des pairs, tel qu'il tourne : toutes les trois secondes.
 *
 * Rend la suite des instants ou une relance serait partie, en appliquant la
 * decision comme le fait `surveillerPartages`.
 */
function relancesSur(duree: number): number[] {
  const attente = neuve(0);
  const partes: number[] = [];

  for (let t = 0; t <= duree; t += 3_000) {
    if (decideRelance(attente, t) !== 'relancer') continue;
    attente.relances += 1;
    attente.derniereRelance = t;
    partes.push(t);
  }

  return partes;
}

test.describe('quand redemander une offre', () => {
  test('une negociation ordinaire a le temps d’aboutir', () => {
    /*
     * Le cas le plus courant, et de loin : le partage arrive tout seul en une
     * seconde ou deux. Relancer pendant ce temps ferait renegocier une
     * connexion qui allait tres bien.
     */
    const attente = neuve(0);
    expect(decideRelance(attente, 0)).toBe('attendre');
    expect(decideRelance(attente, 3_000)).toBe('attendre');
    expect(decideRelance(attente, ATTENTE_AVANT_RELANCE - 1)).toBe('attendre');
  });

  test('passe le delai, on redemande', () => {
    expect(decideRelance(neuve(0), ATTENTE_AVANT_RELANCE)).toBe('relancer');
  });

  test('deux relances ne se suivent pas immediatement', () => {
    /*
     * Le battement tourne toutes les trois secondes. Sans repos, une attente
     * qui dure enverrait une demande a chaque passage — et l'on martelerait
     * une liaison qui va deja mal.
     */
    const attente: AttentePartage = { depuis: 0, relances: 1, derniereRelance: 10_000 };

    expect(decideRelance(attente, 10_000 + INTERVALLE_RELANCE - 1)).toBe('attendre');
    expect(decideRelance(attente, 10_000 + INTERVALLE_RELANCE)).toBe('relancer');
  });

  test('on renonce apres trois essais, et une seule fois', () => {
    const attente: AttentePartage = {
      depuis: 0,
      relances: RELANCES_MAX,
      derniereRelance: 60_000,
    };

    expect(decideRelance(attente, 120_000)).toBe('renoncer');

    /*
     * Renoncer ne se rejuge pas : le compteur monte d'un cran au moment ou on
     * l'ecrit dans le journal, et la decision reste la meme ensuite. Sans
     * cela, la ligne serait reecrite a chaque battement — toutes les trois
     * secondes, pour toute la duree du partage.
     */
    attente.relances += 1;
    expect(decideRelance(attente, 130_000)).toBe('renoncer');
  });

  test('une minute d’attente ne produit que trois demandes', () => {
    const partes = relancesSur(60_000);

    expect(partes).toHaveLength(RELANCES_MAX);
    // La premiere au plus tot apres le delai de grace, jamais avant.
    expect(partes[0]).toBeGreaterThanOrEqual(ATTENTE_AVANT_RELANCE);

    for (let i = 1; i < partes.length; i += 1) {
      expect(partes[i]! - partes[i - 1]!).toBeGreaterThanOrEqual(INTERVALLE_RELANCE);
    }
  });

  test('celui qui recoit se protege aussi', () => {
    /*
     * La demande fait renegocier celui qui la recoit. La borne est chez lui,
     * pas chez l'emetteur : un client modifie n'appliquerait pas la sienne.
     */
    expect(peutReoffrir(undefined, 1_000)).toBe(true);
    expect(peutReoffrir(1_000, 1_000 + REPOS_REOFFRE - 1)).toBe(false);
    expect(peutReoffrir(1_000, 1_000 + REPOS_REOFFRE)).toBe(true);
  });
});
