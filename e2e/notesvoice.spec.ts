import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { lireLesNotes, nettoyer, abreger } from '../src/features/shell/notes';

/**
 * Ce que voit quelqu'un qui installe une mise a jour.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que ce fichier protege : une fenetre que TOUT LE MONDE voit, une fois par
 * version, et que personne ne relit jamais — surtout pas celui qui vient
 * d'ecrire les notes, puisqu'il ne fait pas la mise a jour.
 *
 * Le defaut trouve : le markdown se replie a quatre-vingts colonnes, et le
 * decoupage se faisait ligne a ligne. Chaque ligne d'une puce repliee devenait
 * donc une puce a part entiere, et la fenetre affichait des morceaux de
 * phrase — « tenir. », « se donnent. », « perd en qualite. ». Le fichier, lui,
 * se lisait parfaitement.
 */

/** Les notes telles qu'elles partent dans l'application. */
function version(numero: string): string {
  const brut = readFileSync(join(process.cwd(), 'NOUVEAUTES.md'), 'utf8');
  const bloc = brut.split(new RegExp(`^## ${numero}$`, 'm'))[1];

  if (bloc === undefined) throw new Error(`Version ${numero} introuvable`);
  return bloc.split(/^## /m)[0] ?? '';
}

/** Ce qui s'affiche vraiment, apres nettoyage et abregement. */
function affichees(notes: string): string[] {
  return lireLesNotes(notes).flatMap((categorie) => categorie.lignes);
}

test.describe('les notes de version', () => {
  test('une puce repliee reste une seule puce', () => {
    const notes = [
      '- Une premiere chose, dite en une phrase assez longue pour que le',
      '  markdown la replie sur trois lignes entieres, comme il le fait',
      '  toujours au-dela de quatre-vingts colonnes.',
      '- Une seconde chose.',
    ].join('\n');

    const lignes = affichees(notes);

    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toContain('Une premiere chose');
    expect(lignes[1]).toBe('Une seconde chose.');
  });

  test('aucune puce ne commence au milieu d’une phrase', () => {
    /*
     * Le symptome exact du defaut. Une puce qui commence par une minuscule est
     * presque toujours la suite d'une autre — c'est ce qu'on voyait, et cela
     * se reconnait sans connaitre le texte.
     */
    const notes = [
      '- Le partage coute moins cher a celui qui partage. Chaque image',
      '  etait recopiee une fois de trop avant d’etre envoyee, ce qui',
      '  se payait a chaque seconde.',
    ].join('\n');

    for (const ligne of affichees(notes)) {
      const premiere = ligne.charAt(0);
      expect(premiere).toBe(premiere.toUpperCase());
    }
  });

  test('les titres de categorie coupent, ils ne prolongent pas', () => {
    const notes = ['### Corrige', '- Un defaut repare.', '### Nouveau', '- Une chose neuve.'].join(
      '\n',
    );

    const categories = lireLesNotes(notes);

    expect(categories).toHaveLength(2);
    expect(categories[0]!.genre).toBe('corrige');
    expect(categories[0]!.lignes).toEqual(['Un defaut repare.']);
    expect(categories[1]!.genre).toBe('nouveau');
    expect(categories[1]!.lignes).toEqual(['Une chose neuve.']);
  });

  test('le nettoyage et l’abregement ne changent pas', () => {
    expect(nettoyer('- **Ce qui change.** Le reste')).toBe('Ce qui change. Le reste');
    expect(abreger('Court et net. Puis l’explication qui suit.')).toBe('Court et net.');
  });

  test('les notes recentes tiennent en une phrase courte', () => {
    /*
     * La regle est ecrite en tete de `NOUVEAUTES.md`, et une regle qui n'est
     * qu'ecrite se perd. Cent caracteres : de quoi dire ce qui a change, pas
     * de quoi expliquer pourquoi — le detail est dans le message de commit,
     * ou quelqu'un ira le chercher s'il le veut.
     *
     * Les versions anterieures ne sont pas verifiees : elles sont publiees, et
     * les reecrire ne changerait rien pour qui les a deja vues.
     */
    for (const numero of ['9.9.9', '9.9.8', '9.9.7', '9.9.6', '9.9.5', '9.9.4', '9.9.3']) {
      for (const ligne of affichees(version(numero))) {
        expect(ligne.length, `${numero} : « ${ligne} »`).toBeLessThanOrEqual(100);
      }
    }
  });
});
