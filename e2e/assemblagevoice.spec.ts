import { test, expect } from '@playwright/test';
import { assembleur, ENTETE, type ImageBrute } from '../src/features/voice/assemblage';

/**
 * Le recollage des images de la capture native.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que ce fichier protege : un automate a etats dont les defauts vivent tous
 * dans les cas ou une frontiere tombe au mauvais endroit — un en-tete coupe en
 * deux, une image qui finit pile en fin de morceau, trois images dans le meme.
 * Aucun ne se produit a volonte dans un partage reel, et tous donnent la meme
 * chose vue du dehors : une image penchee, puis n'importe quoi. On ne saurait
 * pas lequel on regarde.
 *
 * Le decoupage vient d'une CONNEXION, pas de nous : elle rend les octets par
 * morceaux quelconques, et rien ne permet de lui demander autre chose.
 */

/** Fabrique le paquet d'une image : en-tete, puis des pixels reconnaissables. */
function paquet(largeur: number, hauteur: number, graine: number): Uint8Array {
  const octets = largeur * hauteur * 4;
  const tout = new Uint8Array(ENTETE + octets);

  const vue = new DataView(tout.buffer);
  vue.setUint32(0, largeur, true);
  vue.setUint32(4, hauteur, true);
  vue.setUint32(8, octets, true);

  for (let i = 0; i < octets; i += 1) tout[ENTETE + i] = (graine + i) % 256;

  return tout;
}

/** Ce que les pixels devraient valoir, pour une graine donnee. */
function attendus(octets: number, graine: number): Uint8Array {
  const pixels = new Uint8Array(octets);
  for (let i = 0; i < octets; i += 1) pixels[i] = (graine + i) % 256;
  return pixels;
}

/** Passe un flux d'octets a l'assembleur, decoupe en morceaux de `taille`. */
function decouper(flux: Uint8Array, taille: number): ImageBrute[] {
  const recolle = assembleur();
  const sorties: ImageBrute[] = [];

  for (let i = 0; i < flux.byteLength; i += taille) {
    const pretes = recolle.avaler(flux.subarray(i, Math.min(i + taille, flux.byteLength)));
    expect(pretes).not.toBeNull();
    sorties.push(...pretes!);
  }

  return sorties;
}

test.describe('recollage des images', () => {
  test('une image arrivee d’un seul tenant', () => {
    const images = decouper(paquet(4, 2, 7), 4 * 2 * 4 + ENTETE);

    expect(images).toHaveLength(1);
    expect(images[0]!.largeur).toBe(4);
    expect(images[0]!.hauteur).toBe(2);
    expect([...images[0]!.pixels]).toEqual([...attendus(32, 7)]);
  });

  test('une image coupee en morceaux d’un octet', () => {
    /*
     * Le pire decoupage possible, et le seul qui eprouve vraiment l'en-tete :
     * ses douze octets arrivent alors en douze fois.
     */
    const images = decouper(paquet(3, 3, 11), 1);

    expect(images).toHaveLength(1);
    expect([...images[0]!.pixels]).toEqual([...attendus(36, 11)]);
  });

  test('l’en-tete coupe en deux', () => {
    // Cinq octets, puis le reste : la coupure tombe au milieu de la hauteur.
    const images = decouper(paquet(2, 2, 3), 5);

    expect(images).toHaveLength(1);
    expect(images[0]!.largeur).toBe(2);
    expect(images[0]!.hauteur).toBe(2);
    expect([...images[0]!.pixels]).toEqual([...attendus(16, 3)]);
  });

  test('trois images dans un seul morceau', () => {
    const flux = new Uint8Array(3 * (ENTETE + 16));
    flux.set(paquet(2, 2, 0), 0);
    flux.set(paquet(2, 2, 50), ENTETE + 16);
    flux.set(paquet(2, 2, 100), 2 * (ENTETE + 16));

    const images = decouper(flux, flux.byteLength);

    expect(images).toHaveLength(3);
    expect([...images[0]!.pixels]).toEqual([...attendus(16, 0)]);
    expect([...images[1]!.pixels]).toEqual([...attendus(16, 50)]);
    expect([...images[2]!.pixels]).toEqual([...attendus(16, 100)]);
  });

  test('une image qui finit pile en fin de morceau', () => {
    /*
     * Le cas ou l'on peut oublier de rendre la main : l'image est complete, et
     * il ne reste plus rien a lire dans le morceau. Une boucle mal ecrite
     * garderait l'image pour le morceau suivant, ou la rendrait deux fois.
     */
    const flux = new Uint8Array(2 * (ENTETE + 16));
    flux.set(paquet(2, 2, 20), 0);
    flux.set(paquet(2, 2, 60), ENTETE + 16);

    const images = decouper(flux, ENTETE + 16);

    expect(images).toHaveLength(2);
    expect([...images[0]!.pixels]).toEqual([...attendus(16, 20)]);
    expect([...images[1]!.pixels]).toEqual([...attendus(16, 60)]);
  });

  test('deux definitions differentes a la suite', () => {
    // Une fenetre redimensionnee pendant qu'on la partage : c'est pour cela
    // que chaque image porte sa taille.
    const a = paquet(2, 2, 1);
    const b = paquet(4, 1, 90);

    const flux = new Uint8Array(a.byteLength + b.byteLength);
    flux.set(a, 0);
    flux.set(b, a.byteLength);

    const images = decouper(flux, 7);

    expect(images).toHaveLength(2);
    expect([images[0]!.largeur, images[0]!.hauteur]).toEqual([2, 2]);
    expect([images[1]!.largeur, images[1]!.hauteur]).toEqual([4, 1]);
    expect([...images[1]!.pixels]).toEqual([...attendus(16, 90)]);
  });

  test('une taille qui ne colle pas ferme le flux', () => {
    /*
     * Quatre octets lus de travers feraient demander plusieurs gigaoctets d'un
     * coup. On verifie que la taille annoncee est bien celle qu'impliquent la
     * largeur et la hauteur — sans quoi il n'y a rien a comprendre dans ce qui
     * suit, et il vaut mieux s'arreter que fabriquer du bruit.
     */
    const mauvais = new Uint8Array(ENTETE);
    const vue = new DataView(mauvais.buffer);
    vue.setUint32(0, 1920, true);
    vue.setUint32(4, 1080, true);
    vue.setUint32(8, 4_000_000_000, true);

    expect(assembleur().avaler(mauvais)).toBeNull();
  });

  test('une image annoncee vide ferme le flux', () => {
    const vide = new Uint8Array(ENTETE);
    expect(assembleur().avaler(vide)).toBeNull();
  });

  test('chaque octet n’est ecrit qu’une fois', () => {
    /*
     * La raison d'etre de tout ce fichier.
     *
     * La version precedente recopiait tout l'accumule a chaque morceau : le
     * cout etait quadratique, et c'est ce qui ramenait un partage 1440p a onze
     * images par seconde alors que rien ne retenait l'encodeur.
     *
     * On ne mesure pas un temps — ce serait fragile sur une machine chargee —
     * mais le NOMBRE d'octets ecrits, qui ne depend d'aucune horloge. Il doit
     * valoir exactement la taille de l'image, et non un multiple du nombre de
     * morceaux.
     */
    const largeur = 64;
    const hauteur = 64;
    const octets = largeur * hauteur * 4;

    let ecrits = 0;
    const vraiSet = Uint8Array.prototype.set;

    // eslint-disable-next-line no-extend-native
    Uint8Array.prototype.set = function (source: ArrayLike<number>, decalage?: number) {
      ecrits += (source as ArrayLike<number>).length ?? 0;
      return vraiSet.call(this, source as never, decalage as never);
    } as typeof vraiSet;

    try {
      const images = decouper(paquet(largeur, hauteur, 5), 1024);
      expect(images).toHaveLength(1);
    } finally {
      Uint8Array.prototype.set = vraiSet;
    }

    // Les pixels, plus les douze octets d'en-tete. Rien de plus.
    expect(ecrits).toBe(octets + ENTETE);
  });
});
