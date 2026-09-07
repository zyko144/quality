import { test, expect } from '@playwright/test';
import { presumeMort, attenteAvant, SILENCE_CANAL, ATTENTE_MAX } from '../src/features/voice/sante';
import { REPUBLICATION_PRESENCE } from '../src/features/voice/annonces';

/**
 * La surveillance du canal vocal.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que ce fichier protege : une boucle qui a tourne pendant des jours, sur
 * toutes les machines, sans que rien ne la signale comme anormale — le journal
 * disait « canal perdu » puis « canal rebati », ce qui ressemble a une reprise
 * reussie plutot qu'a un defaut.
 *
 * L'ordre des traces la nommait pourtant, a condition de les lire par
 * identifiant et non par date — le journal ecrit par lots, et tout un lot
 * porte la meme heure :
 *
 *     02:29:49  rebati (silence 46191)
 *     02:29:49  CLOSED
 *     02:29:49  perdu
 *
 * `rebati` AVANT `CLOSED` : le serveur ne fermait rien, c'est notre propre
 * demontage qui produisait ce `CLOSED`. On demontait un canal sain.
 */

/**
 * Un salon calme, ou l'on se republie sans que rien ne change.
 *
 * C'est le cas exact du defaut, et c'est le cas ORDINAIRE : deux personnes qui
 * discutent sans toucher a leur micro ni partager quoi que ce soit. Rien ne
 * change dans la presence, donc aucune synchronisation n'est emise.
 *
 * Rend le nombre de fois ou le canal a ete presume mort.
 */
function salonCalme(minutes: number, signeSurAcquittement: boolean): number {
  let dernierSigneDeVie = 0;
  let reconstructions = 0;
  let demontages = 0;

  // Le battement des pairs, toutes les trois secondes.
  for (let t = 0; t <= minutes * 60_000; t += 3_000) {
    /*
     * La republication a lieu, et le serveur l'acquitte.
     *
     * Elle n'emet AUCUNE synchronisation : le contenu est identique au
     * precedent, donc l'etat de presence ne change pas. C'est toute la cause
     * du defaut.
     */
    if (t > 0 && t % REPUBLICATION_PRESENCE < 3_000 && signeSurAcquittement) {
      dernierSigneDeVie = t;
      reconstructions = 0;
    }

    if (presumeMort(dernierSigneDeVie, t, reconstructions)) {
      demontages += 1;
      reconstructions += 1;
      dernierSigneDeVie = t;
    }
  }

  return demontages;
}

test.describe('la sante du canal', () => {
  test('un salon calme ne fait rien demonter', () => {
    /*
     * Cinq minutes sans qu'un seul reglage bouge. C'est la situation la plus
     * ordinaire qui soit, et celle qui rebatissait le canal six fois.
     */
    expect(salonCalme(5, true)).toBe(0);
  });

  test('sans l’acquittement, la boucle revient', () => {
    /*
     * Le comportement d'AVANT, simule : seule une synchronisation comptait, et
     * un salon calme n'en produit aucune. Cinq minutes donnent alors six
     * demontages — un toutes les quarante-six secondes, exactement ce que les
     * traces montraient.
     *
     * Ce cas n'est pas la pour decrire un bug qu'on garde : il est la pour que
     * la correction ne puisse pas etre defaite sans que quelque chose tombe.
     */
    expect(salonCalme(5, false)).toBeGreaterThan(0);
  });

  test('la borne reste bien au-dessus de la republication', () => {
    /*
     * Le rapport entre les deux est ce qui rend la surveillance possible : si
     * l'on se republiait moins souvent qu'on ne surveille, on mesurerait sa
     * propre retenue et non la sante du canal.
     *
     * Le raisonnement etait deja ecrit dans le code, et il etait juste — il
     * supposait seulement qu'une republication laisse une trace, ce qui n'etait
     * pas le cas. Le garder ici, avec les deux nombres cote a cote, evite
     * qu'un reglage de l'un rende l'autre absurde.
     */
    expect(SILENCE_CANAL).toBeGreaterThan(REPUBLICATION_PRESENCE * 1.5);
  });

  test('un canal vraiment mort est repris', () => {
    // Aucun signe de vie : passe la borne, on rebatit.
    expect(presumeMort(0, SILENCE_CANAL + 1, 0)).toBe(true);
    expect(presumeMort(0, SILENCE_CANAL - 1, 0)).toBe(false);
  });

  test('l’attente double, sans depasser deux minutes', () => {
    /*
     * Rebatir repare un canal mort. Si cinq reconstructions n'ont rien change,
     * la sixieme ne changera rien non plus — et fermer le canal toutes les
     * quarante-cinq secondes empeche justement celui-ci de s'etablir.
     */
    expect(attenteAvant(0)).toBe(SILENCE_CANAL);
    expect(attenteAvant(1)).toBe(SILENCE_CANAL * 2);
    expect(attenteAvant(10)).toBe(ATTENTE_MAX);
  });
});
