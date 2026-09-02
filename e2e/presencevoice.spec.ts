import { test, expect } from '@playwright/test';
import { etatReel, estEnLigne, EXPIRATION, BATTEMENT } from '../src/lib/presence';

/**
 * La presence reelle.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Le defaut repare est de ceux qu'on ne remarque pas tout de suite et qui usent
 * la confiance : on voyait « en ligne » des gens partis depuis des jours, parce
 * que l'etat etait declare a la connexion et retire par une requete envoyee
 * pendant que la page disparait — donc jamais envoyee en cas de veille, de
 * plantage ou de coupure.
 *
 * La regle qui repare cela a une facon desagreable de se tromper : trop stricte,
 * les gens clignotent au moindre hoquet de reseau ; trop laxiste, elle ne
 * repare rien. Aucun des deux ne se voit en lisant le code.
 */

const MAINTENANT = Date.parse('2026-09-02T12:00:00Z');
const ilY = (ms: number) => new Date(MAINTENANT - ms).toISOString();

test.describe('Presence reelle', () => {
  test('un battement recent tient l etat declare', () => {
    expect(etatReel('online', ilY(10_000), MAINTENANT)).toBe('online');
    expect(etatReel('idle', ilY(60_000), MAINTENANT)).toBe('idle');
    expect(etatReel('dnd', ilY(120_000), MAINTENANT)).toBe('dnd');
  });

  test('le silence prolonge fait passer hors ligne', () => {
    /*
     * Le cas qui motive tout : l'application dit encore « en ligne » parce que
     * personne n'a jamais pu dire le contraire.
     */
    expect(etatReel('online', ilY(EXPIRATION + 1000), MAINTENANT)).toBe('offline');
    expect(etatReel('dnd', ilY(6 * 3600_000), MAINTENANT)).toBe('offline');
    expect(estEnLigne('online', ilY(48 * 3600_000), MAINTENANT)).toBe(false);
  });

  test('un battement manque ne fait pas clignoter', () => {
    /*
     * L'expiration couvre plus de deux battements. Sans cette marge, la
     * moindre requete perdue ferait disparaitre quelqu'un de la liste, puis
     * reapparaitre une minute apres — et l'on aurait remplace un defaut par un
     * autre, plus visible.
     */
    expect(EXPIRATION).toBeGreaterThan(BATTEMENT * 2);
    expect(estEnLigne('online', ilY(BATTEMENT + 5_000), MAINTENANT)).toBe(true);
  });

  test('un choix explicite n est jamais contredit', () => {
    // La mesure rattrape les absences non annoncees ; elle ne decide pas a la
    // place de qui s'est declare hors ligne.
    expect(etatReel('offline', ilY(1000), MAINTENANT)).toBe('offline');
  });

  test('sans mesure, on garde ce qui est declare', () => {
    /*
     * La colonne est recente : les profils qui n'ont jamais battu ne doivent
     * pas tous basculer hors ligne d'un coup, ce qui ferait paraitre
     * l'application vide le jour de la mise a jour.
     */
    expect(etatReel('online', null, MAINTENANT)).toBe('online');
    expect(etatReel('online', undefined, MAINTENANT)).toBe('online');
    expect(etatReel('online', 'pas une date', MAINTENANT)).toBe('online');
  });

  test('une horloge en avance n est pas une absence', () => {
    // Le poste peut avancer sur le serveur : refuser une date future ferait
    // passer hors ligne quelqu'un qui vient de battre.
    expect(etatReel('online', ilY(-30_000), MAINTENANT)).toBe('online');
  });

  test('un etat absent vaut hors ligne', () => {
    expect(etatReel(null, ilY(1000), MAINTENANT)).toBe('offline');
    expect(etatReel(undefined, null, MAINTENANT)).toBe('offline');
  });
});
