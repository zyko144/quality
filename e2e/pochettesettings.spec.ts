import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { POCHETTE_MAX, estFraiche, FRAICHEUR } from '../src/features/profile/ecoute';

/**
 * La pochette du morceau, des deux cotes de la frontiere.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que ce fichier protege : un defaut qui n'etait dans aucun des deux
 * fichiers concernes, mais entre les deux. La colonne `image_url` acceptait
 * cinq cents caracteres — une limite ecrite en pensant a une adresse. Le
 * client y envoyait une pochette reduite en `data:`, mesuree a trois mille
 * caracteres — une taille choisie en pensant a des octets.
 *
 * Chaque nombre etait raisonnable chez lui. Ensemble, ils faisaient rejeter
 * toutes les annonces portant une pochette, sans un mot, et celui qui ecoutait
 * voyait sa propre fiche parfaitement a jour puisque l'interface la posait
 * dans son etat local juste apres l'ecriture, sans en lire le resultat.
 *
 * Aucune relecture des deux fichiers ne l'aurait montre : il fallait les
 * confronter. C'est tout ce que fait ce fichier.
 */

/** La contrainte telle que la base la porte, lue dans les migrations. */
function limiteEnBase(): number {
  const dossier = join(process.cwd(), 'supabase', 'migrations');

  // La derniere migration qui touche a la contrainte fait foi : c'est celle
  // que la base a appliquee en dernier.
  const fichiers = readdirSync(dossier)
    .filter((nom) => nom.endsWith('.sql'))
    .sort();

  let trouvee: number | null = null;

  for (const nom of fichiers) {
    const sql = readFileSync(join(dossier, nom), 'utf8');

    // On ne lit que la contrainte de `image_url` sur `activites`, et seulement
    // hors commentaire : les commentaires de ce depot citent volontiers les
    // nombres dont ils parlent.
    for (const ligne of sql.split(/\r?\n/)) {
      if (ligne.trimStart().startsWith('--')) continue;
      if (!ligne.includes('image_url') || !ligne.includes('char_length')) continue;

      const trouve = /char_length\(image_url\)\s*<=\s*(\d+)/.exec(ligne);
      if (trouve) trouvee = Number(trouve[1]);
    }
  }

  return trouvee ?? -1;
}

test.describe('la pochette tient dans la colonne qui la porte', () => {
  test('le client et la base s’accordent sur la limite', () => {
    /*
     * L'egalite, pas une inegalite.
     *
     * Un client plus permissif que la base perd les annonces — c'est le defaut
     * qu'on repare. Un client plus strict que la base jette des pochettes que
     * la base aurait acceptees, sans que rien ne le dise. Les deux nombres
     * decrivent la meme chose : ils doivent etre le meme.
     */
    expect(limiteEnBase()).toBe(POCHETTE_MAX);
  });

  test('la limite couvre une pochette reelle', () => {
    /*
     * Mesure prise dans un navigateur, sur une image 72 pixels bien remplie
     * encodee en JPEG a 0,7 — ce que produit `reduirePochette` :
     *
     *     72px q0.7 : 3079 caracteres
     *     72px q0.5 : 2439
     *     48px q0.7 : 1995
     *
     * La limite doit laisser de la marge : une pochette photographique se
     * comprime moins bien qu'un degrade, et la reduction pourrait passer a
     * quatre-vingt-seize pixels.
     */
    const MESUREE = 3079;

    expect(POCHETTE_MAX).toBeGreaterThan(MESUREE * 2);

    /*
     * Et elle reste une limite.
     *
     * Cette ligne est lue par toute personne qui ouvre la fiche. Une pochette
     * non reduite pese deux cent vingt-cinq kilo-octets ; la laisser passer
     * couterait a chaque lecture ce qu'on a justement cesse de payer ailleurs.
     */
    expect(POCHETTE_MAX).toBeLessThan(30_000);
  });
});

test.describe('une annonce oubliee cesse d’etre crue', () => {
  test('une annonce recente est montree', () => {
    const maintenant = Date.now();
    expect(estFraiche(new Date(maintenant - 60_000).toISOString(), maintenant)).toBe(true);
  });

  test('un morceau long ne perime pas', () => {
    /*
     * L'annonce n'est rafraichie qu'au CHANGEMENT de morceau, jamais pendant.
     * Un seuil trop court ferait disparaitre quelqu'un au milieu d'un titre —
     * exactement le contraire de ce qu'on cherche.
     */
    const maintenant = Date.now();
    const ilYaVingtMinutes = new Date(maintenant - 20 * 60_000).toISOString();

    expect(estFraiche(ilYaVingtMinutes, maintenant)).toBe(true);
  });

  test('une annonce laissee par une application fermee net disparait', () => {
    const maintenant = Date.now();
    expect(estFraiche(new Date(maintenant - FRAICHEUR - 1000).toISOString(), maintenant)).toBe(false);
  });

  test('une annonce sans date reste montree', () => {
    /*
     * Une base d'avant cette lecture ne donnait pas `vu_le`. Traiter son
     * absence comme une peremption effacerait tout le monde d'un coup, au
     * premier lancement suivant la mise a jour.
     */
    expect(estFraiche(undefined)).toBe(true);
    expect(estFraiche(null)).toBe(true);
    expect(estFraiche('pas une date')).toBe(true);
  });
});
