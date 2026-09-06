/**
 * Recomposer des images a partir d'octets qui arrivent n'importe comment.
 *
 * La capture native ecrit ses images dans une connexion locale, chacune
 * precedee de douze octets qui disent sa largeur, sa hauteur et sa taille. Une
 * connexion ne respecte aucune de ces frontieres : une image peut arriver en
 * trois cents morceaux, trois images en un seul, et l'en-tete lui-meme peut
 * etre coupe en deux.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * La version precedente gardait un « reste » et le rejoignait au morceau
 * suivant :
 *
 *     joint.set(reste, 0);
 *     joint.set(morceau, reste.byteLength);
 *
 * Chaque morceau recopiait donc TOUT ce qui s'etait deja accumule. Le cout est
 * quadratique, et il ne se voit pas en lisant — il se voit en comptant. Une
 * image 1440p fait 14,7 Mo et arrive par morceaux d'environ soixante-quatre
 * kilo-octets : deux cent trente morceaux, chacun recopiant en moyenne la
 * moitie de l'image. Cela fait 1,7 GIGA-octet de recopie pour 14,7 Mo utiles,
 * cent quinze fois trop.
 *
 * Les traces le disaient sans qu'on sache le lire : quarante-cinq images par
 * seconde en 1080p, onze en 1440p, avec `limite: none` — l'encodeur ne se
 * retenait pas, il attendait. Le rapport des couts entre les deux definitions
 * vaut 3,16 ; quarante-cinq divise par 3,16 donne quatorze, et l'on en
 * mesurait onze. Les deux machines butaient sur la meme chose : la bande
 * passante memoire, une vingtaine de giga-octets par seconde, depensee a
 * recopier les memes pixels deux cents fois.
 *
 * Ici, la taille est connue des l'en-tete lu. On alloue une fois, et chaque
 * octet n'est ecrit qu'une seule fois, a sa place definitive.
 *
 * Pourquoi c'est un fichier a part
 * --------------------------------
 * Un automate a etats qui recolle des octets ne se verifie pas en le lisant :
 * ses defauts vivent dans les cas ou une frontiere tombe au mauvais endroit —
 * un en-tete coupe en deux, une image qui finit pile en fin de morceau, trois
 * images dans le meme. Aucun de ces cas ne se produit a volonte dans un
 * partage reel, et chacun donne la meme chose vu du dehors : une image
 * penchee, puis n'importe quoi.
 */

/** Largeur, hauteur et taille, en trois entiers de quatre octets. */
export const ENTETE = 12;

export interface ImageBrute {
  largeur: number;
  hauteur: number;
  /** Octets BGRA, exactement `largeur * hauteur * 4`. */
  pixels: Uint8Array<ArrayBuffer>;
}

export interface Assembleur {
  /**
   * Avale un morceau et rend les images qu'il a permis d'achever.
   *
   * Rend `null` si le flux n'a plus de sens — voir `taille_incoherente`.
   * L'appelant doit alors fermer : continuer ne produirait que du bruit.
   */
  avaler: (morceau: Uint8Array) => ImageBrute[] | null;
}

export function assembleur(): Assembleur {
  const entete = new Uint8Array(ENTETE);
  let entetePris = 0;

  /** L'image en cours de remplissage, ou `null` tant qu'on lit l'en-tete. */
  let corps: Uint8Array<ArrayBuffer> | null = null;
  let corpsPris = 0;
  let largeur = 0;
  let hauteur = 0;

  return {
    avaler(morceau) {
      const pretes: ImageBrute[] = [];
      let lu = 0;

      while (lu < morceau.byteLength) {
        if (corps === null) {
          // Douze octets au plus, jamais recopies deux fois.
          const pris = Math.min(ENTETE - entetePris, morceau.byteLength - lu);
          entete.set(morceau.subarray(lu, lu + pris), entetePris);
          entetePris += pris;
          lu += pris;

          // L'en-tete est a cheval sur deux morceaux : on attend la suite.
          if (entetePris < ENTETE) break;

          const vue = new DataView(entete.buffer, entete.byteOffset, ENTETE);
          largeur = vue.getUint32(0, true);
          hauteur = vue.getUint32(4, true);
          const octets = vue.getUint32(8, true);
          entetePris = 0;

          /*
           * Une taille qui ne colle pas ferme le flux plutot que d'allouer.
           *
           * Le passage est local et le jeton le protege, mais un en-tete
           * decale — par un defaut qu'on n'a pas encore vu — ferait demander
           * plusieurs gigaoctets d'un coup, sur la foi de quatre octets lus de
           * travers. On verifie donc que la taille annoncee est bien celle
           * qu'impliquent la largeur et la hauteur.
           */
          if (octets === 0 || octets !== largeur * hauteur * 4) return null;

          corps = new Uint8Array(octets);
          corpsPris = 0;
          continue;
        }

        const pris = Math.min(corps.byteLength - corpsPris, morceau.byteLength - lu);
        corps.set(morceau.subarray(lu, lu + pris), corpsPris);
        corpsPris += pris;
        lu += pris;

        if (corpsPris < corps.byteLength) break;

        pretes.push({ largeur, hauteur, pixels: corps });
        corps = null;
        corpsPris = 0;
      }

      return pretes;
    },
  };
}
