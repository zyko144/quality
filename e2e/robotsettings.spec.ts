import { test, expect } from '@playwright/test';
import { accepteLaCoche, REFLEXION_MS } from '../src/features/onboarding/CaseHumaine';

/**
 * La case « je ne suis pas un robot ».
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que cet essai protege : une condition qui refusait tout, en silence, et
 * qui ne se voyait ni a la lecture ni a l'usage de qui l'a ecrite.
 *
 * La regle exigeait qu'un mouvement de pointeur, une touche ou un contact ait
 * ete observe DEPUIS L'AFFICHAGE. Elle est raisonnable sur le papier — un
 * robot ne bouge pas la souris — et fausse en pratique : une fenetre qui
 * parait sous le curseur se coche sans que rien ne bouge. On clique la ou
 * l'on etait deja.
 *
 * Le defaut ne se produit donc que si la case tombe pile sous le pointeur, ce
 * qui arrive tout le temps a l'usage et jamais quand on essaie a la main.
 */
test.describe('quand la case est acceptee', () => {
  test('un clic de confiance passe', () => {
    expect(accepteLaCoche(true, REFLEXION_MS)).toBe(true);
    expect(accepteLaCoche(true, 5_000)).toBe(true);
  });

  test('un clic fabrique par un script est refuse', () => {
    /*
     * `isTrusted` est pose par le navigateur, et un `click()` appele depuis du
     * code ne l'a pas. C'est la seule des deux conditions qu'un script ne peut
     * pas contourner depuis la page.
     */
    expect(accepteLaCoche(false, 10_000)).toBe(false);
  });

  test('une coche instantanee est refusee', () => {
    // Un script coche des qu'il trouve la case ; une personne la lit d'abord.
    expect(accepteLaCoche(true, 0)).toBe(false);
    expect(accepteLaCoche(true, REFLEXION_MS - 1)).toBe(false);
  });

  test('aucun mouvement prealable n’est exige', () => {
    /*
     * Le coeur du correctif, dit comme une propriete.
     *
     * La regle ne prend que deux entrees : la confiance et le temps. Il n'y a
     * plus de place pour une troisieme condition portant sur ce qui s'est
     * passe AVANT le clic — c'est celle-la qui refusait tout.
     *
     * Le clic EST le geste : un evenement de confiance porte deja tout ce
     * qu'un mouvement aurait apporte.
     */
    expect(accepteLaCoche.length).toBe(2);
    expect(accepteLaCoche(true, REFLEXION_MS)).toBe(true);
  });
});
