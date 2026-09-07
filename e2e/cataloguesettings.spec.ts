import { test, expect } from '@playwright/test';
import { auCatalogue, type Catalogable } from '../src/features/badges/catalogue';

/**
 * Ce qui figure au catalogue des badges, et ce qui n'y figure pas.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * La page « Badges » sert a savoir ce qui existe ET ce qu'il reste a faire. Un
 * badge qu'on ne peut pas obtenir y pose une question dont la seule reponse
 * honnete — « celui-la, on ne peut pas l'avoir » — ne vaut pas d'etre affichee
 * a tout le monde.
 *
 * Ce que cet essai protege : la regle est une ligne, et une ligne se perd. Le
 * jour ou quelqu'un ajoute un filtre par famille, par palier ou par teinte,
 * rien ne rappellera qu'un badge donne a la main doit rester en dehors — et le
 * defaut ne se verra que sur la page de quelqu'un d'autre.
 */

function badge(champs: Catalogable & { cle?: string }): Catalogable {
  return champs;
}

test.describe('le catalogue des badges', () => {
  test('un badge ordinaire y figure', () => {
    expect(auCatalogue(badge({ cle: 'vocal-10' }))).toBe(true);
  });

  test('un badge reserve n’y figure pas', () => {
    /*
     * `reserve` veut dire « il se donne, il ne se prend pas ». C'est le cas du
     * C.E.O et du Singe. Rien a accomplir, donc rien a annoncer.
     */
    expect(auCatalogue(badge({ cle: 'singe', reserve: true }))).toBe(false);
  });

  test('un badge cache n’y figure pas non plus', () => {
    /*
     * `cache` couvre ce que `reserve` ne couvre pas : un badge qu'on PEUT
     * gagner mais qu'on prefere ne pas annoncer.
     */
    expect(auCatalogue(badge({ cle: 'surprise', cache: true }))).toBe(false);
  });

  test('une base sans ces colonnes montre tout', () => {
    /*
     * `cache` n'existe pas encore en base, et `reserve` n'existait pas non plus
     * avant le C.E.O. Une valeur absente doit donc valoir « non » : traiter
     * `undefined` comme « oui » viderait le catalogue d'un coup, au premier
     * lancement suivant une mise a jour.
     */
    const ancien = badge({ cle: 'pionnier' });
    expect(ancien.reserve).toBeUndefined();
    expect(ancien.cache).toBeUndefined();
    expect(auCatalogue(ancien)).toBe(true);
  });
});
