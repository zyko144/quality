import { test, expect } from '@playwright/test';
import { comparerVersions, notesManquees, resumerCumul } from '../src/features/shell/cumul';

/**
 * Ce qu'on a manque entre deux ouvertures.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Le message n'annoncait que la version courante : qui laissait passer trois
 * versions n'apprenait jamais ce que les deux intermediaires avaient apporte —
 * et c'est le cas le plus frequent, pas l'exception.
 *
 * La comparaison de versions est une de ces choses qu'on croit toujours savoir
 * faire. « 0.10.0 » vient apres « 0.9.0 », et toute comparaison de chaines dit
 * le contraire. L'erreur ne se voit qu'a la dixieme version mineure, quand
 * plus personne n'y pense.
 */

const H = [
  { version: '0.10.0', notes: 'dix' },
  { version: '0.9.0', notes: 'neuf' },
  { version: '0.8.2', notes: 'huit deux' },
  { version: '0.8.1', notes: 'huit un' },
  { version: '0.8.0', notes: 'huit' },
];

test.describe('Notes cumulees', () => {
  test('les numeros se comparent par nombres, pas par lettres', () => {
    // Le piege : « 0.10.0 » < « 0.9.0 » pour une comparaison de texte.
    expect(comparerVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(comparerVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(comparerVersions('0.8.2', '0.8.10')).toBeLessThan(0);
    expect(comparerVersions('2.0.0', '2.0.0')).toBe(0);
  });

  test('une version plus courte vaut la meme completee de zeros', () => {
    expect(comparerVersions('1.2', '1.2.0')).toBe(0);
    expect(comparerVersions('1.2', '1.2.1')).toBeLessThan(0);
  });

  test('trois versions sautees sont toutes rendues', () => {
    /*
     * Le cas qui motive tout : on ouvre l'application apres l'avoir laissee de
     * cote, et l'on doit voir ce qui a change pendant ce temps.
     */
    const manquees = notesManquees(H, '0.10.0', '0.8.0');

    expect(manquees.map((e) => e.version)).toEqual(['0.10.0', '0.9.0', '0.8.2', '0.8.1']);
    // La plus recente en tete : on lit ce qui vient d'arriver d'abord.
    expect(manquees[0]?.version).toBe('0.10.0');
  });

  test('la version deja vue n est pas remontree', () => {
    const manquees = notesManquees(H, '0.9.0', '0.9.0');
    expect(manquees).toEqual([]);
  });

  test('rien au-dela de ce qui tourne', () => {
    /*
     * L'historique embarque peut contenir des versions plus recentes que celle
     * qui tourne — le fichier est lu a la compilation, et l'on peut y avoir
     * ecrit la suivante. Les annoncer promettrait ce qui n'est pas la.
     */
    const manquees = notesManquees(H, '0.8.2', '0.8.0');
    expect(manquees.map((e) => e.version)).toEqual(['0.8.2', '0.8.1']);
  });

  test('sans version vue, on ne deroule pas tout l historique', () => {
    // Quelqu'un qui vient d'arriver n'a rien manque : lui derouler dix
    // versions serait un mur de texte devant une application qu'il ne connait
    // pas encore.
    const manquees = notesManquees(H, '0.9.0', null);
    expect(manquees.map((e) => e.version)).toEqual(['0.9.0']);
  });

  test('un numero illisible ne fait pas disparaitre les autres', () => {
    const bancal = [{ version: 'inconnue', notes: 'x' }, ...H];
    const manquees = notesManquees(bancal, '0.10.0', '0.9.0');
    expect(manquees.map((e) => e.version)).toContain('0.10.0');
  });

  test('le titre dit combien de versions il porte', () => {
    expect(resumerCumul([{ version: '0.9.0', notes: 'x' }])).toBe('Quoi de neuf en 0.9.0');

    const plusieurs = notesManquees(H, '0.10.0', '0.8.0');
    expect(resumerCumul(plusieurs)).toBe('Ce que vous avez manque — de 0.8.1 a 0.10.0');

    expect(resumerCumul([])).toBe('');
  });
});
