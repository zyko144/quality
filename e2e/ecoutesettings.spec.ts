import { test, expect } from '@playwright/test';
import {
  lienDuMorceau,
  memeMorceau,
  nomDuLecteur,
  versActivite,
  type Lecture,
} from '../src/features/profile/ecoute';

/**
 * Ce qu'on annonce de sa musique, et surtout QUAND.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * La regle qui compte ici ne se voit pas a l'ecran : on ne publie qu'au
 * CHANGEMENT de morceau. La position avance a chaque releve ; s'en servir
 * ferait une ecriture toutes les dix secondes par personne, diffusee en direct
 * a tous ceux qui ont la fiche ouverte. C'est exactement la depense qui a mis
 * ce projet a 98 % de son quota de messages avec onze utilisateurs.
 *
 * Le defaut serait invisible pendant des semaines, puis apparaitrait sur une
 * facture, sous une forme qui ne designe aucun fichier.
 */

function lecture(patch: Partial<Lecture> = {}): Lecture {
  return {
    titre: 'Barbie',
    artiste: 'Le Crime',
    album: '',
    source: 'Spotify.exe',
    joue: true,
    position_ms: 83_711,
    duree_ms: 180_000,
    image: '',
    ...patch,
  };
}

test.describe('Ce qu on ecoute', () => {
  test('la position ne compte pas dans « est-ce le meme morceau »', () => {
    /*
     * Le coeur du fichier. Deux releves du meme morceau a dix secondes
     * d'intervalle ne different que par la position — et republier a ce
     * rythme couterait six messages par minute et par personne.
     */
    expect(memeMorceau(lecture(), lecture({ position_ms: 120_000 }))).toBe(true);
  });

  test('un autre titre, un autre artiste ou une pause sont des changements', () => {
    expect(memeMorceau(lecture(), lecture({ titre: 'Autre' }))).toBe(false);
    expect(memeMorceau(lecture(), lecture({ artiste: 'Autre' }))).toBe(false);

    // La pause en est un aussi : rester « en train d'ecouter » apres avoir mis
    // en pause serait faux, et personne ne pourrait le corriger.
    expect(memeMorceau(lecture(), lecture({ joue: false }))).toBe(false);
  });

  test('l absence des deux cotes est une absence, pas un changement', () => {
    // Sinon on effacerait l'annonce a chaque releve, indefiniment.
    expect(memeMorceau(null, null)).toBe(true);
    expect(memeMorceau(null, lecture())).toBe(false);
  });

  test('le nom du lecteur se lit, celui de Windows non', () => {
    expect(nomDuLecteur('Spotify.exe')).toBe('Spotify');
    expect(nomDuLecteur('Microsoft.YourPhone_8wekyb3d8bbwe!App')).toBe('Musique');
    expect(nomDuLecteur('msedge')).toBe('le navigateur');
  });

  test('le lien n est propose que pour un lecteur reconnu', () => {
    /*
     * Windows donne un titre et un artiste, JAMAIS une adresse. Deviner une
     * adresse Spotify pour un fichier local menerait souvent ailleurs — et un
     * lien qui trompe est pire qu'une carte sans lien.
     */
    expect(lienDuMorceau(lecture())).toBe(
      'https://open.spotify.com/search/Le%20Crime%20Barbie',
    );
    expect(lienDuMorceau(lecture({ source: 'vlc.exe' }))).toBeNull();
    expect(lienDuMorceau(lecture({ titre: '', artiste: '' }))).toBeNull();
  });

  test('on annonce l instant de DEPART, pas la position', () => {
    /*
     * C'est ce qui fait avancer la barre chez celui qui regarde, sans qu'un
     * seul message ne circule : il connait le point de depart et lit sa propre
     * horloge. Republier la position aurait fait le contraire.
     */
    const avant = Date.now();
    const activite = versActivite(lecture({ position_ms: 30_000 }), null);
    const depart = Date.parse(activite.debut_le ?? '');

    expect(activite.duree_ms).toBe(180_000);

    // Le depart tombe trente secondes avant maintenant, a la marge d'execution.
    expect(depart).toBeLessThanOrEqual(avant - 30_000 + 50);
    expect(depart).toBeGreaterThan(avant - 30_000 - 2_000);
  });

  test('une duree inconnue ne devient pas une duree de zero', () => {
    // Sans duree il n'y a pas de barre a remplir ; `0` en dessinerait une,
    // pleine ou vide selon le sens de la division.
    expect(versActivite(lecture({ duree_ms: 0 }), null).duree_ms).toBeNull();
  });
});
