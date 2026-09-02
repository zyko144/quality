import { test, expect } from '@playwright/test';
import { commencer, progression, conclure, BORD, SEUIL, DECISION } from '../src/features/shell/glisse';
import { nettoyer, abreger } from '../src/features/shell/notes';

/**
 * Le geste du tiroir, et le nettoyage des notes de version.
 *
 * Nomme pour tomber dans le projet « authentifie » ; ces cas ne touchent
 * pourtant a aucune interface — ce sont deux mecaniques qui se trompent en
 * silence, et dont l'erreur ne se voit qu'a l'usage.
 */

const LARGEUR = 300;

/** Rejoue un trajet de doigt et rend l'etat final du tiroir. */
function glisser(
  depart: [number, number],
  trajet: [number, number][],
  ouvert: boolean,
): boolean | null {
  const etat = commencer(depart[0], depart[1], ouvert, LARGEUR);
  if (!etat) return null;

  for (const [x, y] of trajet) progression(etat, x, y);

  const dernier = trajet[trajet.length - 1] ?? depart;
  return conclure(etat, dernier[0]);
}

test.describe('Geste du tiroir', () => {
  test('un glissement depuis le bord ouvre', () => {
    expect(glisser([6, 400], [[60, 402], [180, 405], [240, 408]], false)).toBe(true);
  });

  test('un glissement qui part du milieu ne fait rien', () => {
    /*
     * Ailleurs qu'au bord, le geste appartient a ce qu'on touche : faire
     * defiler, glisser sur un message. Le tiroir n'a pas a s'en meler.
     */
    expect(commencer(BORD + 1, 400, false, LARGEUR)).toBeNull();
    expect(commencer(200, 400, false, LARGEUR)).toBeNull();
  });

  test('un tiroir ouvert se ferme depuis n importe ou', () => {
    // Il recouvre l'ecran : il n'y a rien d'autre a faire glisser par-dessus.
    expect(glisser([250, 400], [[200, 402], [90, 405], [40, 408]], true)).toBe(false);
  });

  test('un defilement vertical n ouvre rien', () => {
    /*
     * Le cas qui rendrait l'application penible plutot que cassee : un doigt ne
     * trace jamais une ligne droite, et sans la pente le moindre ecart lateral
     * pendant qu'on lit ferait surgir le tiroir.
     */
    expect(glisser([6, 400], [[10, 380], [14, 300], [18, 200]], false)).toBe(false);
    expect(glisser([6, 400], [[20, 370], [30, 260], [36, 160]], false)).toBe(false);
  });

  test('le sens, une fois tranche, ne change plus', () => {
    /*
     * Un geste qui commence vertical puis part de cote ne doit pas ouvrir le
     * tiroir au milieu d'un defilement : le tiroir sauterait sous le doigt.
     */
    const etat = commencer(6, 400, false, LARGEUR)!;
    progression(etat, 8, 340);
    expect(etat.sens).toBe('vertical');

    expect(progression(etat, 250, 340)).toBeNull();
    expect(conclure(etat, 250)).toBe(false);
  });

  test('un geste trop court renonce', () => {
    // Sous le seuil, on rend le tiroir la ou il etait : le geste hesitant se
    // defait de lui-meme, ce qui est exactement ce qu'on attend.
    const court = Math.round(LARGEUR * SEUIL) - 10;
    expect(glisser([4, 400], [[40, 401], [4 + court, 402]], false)).toBe(false);
  });

  test('la progression suit le doigt, bornee', () => {
    const etat = commencer(0, 400, false, LARGEUR)!;

    // Rien tant que le sens n'est pas tranche.
    expect(progression(etat, DECISION - 2, 400)).toBeNull();

    expect(progression(etat, 150, 400)).toBeCloseTo(0.5, 2);
    // Au-dela du tiroir, on ne depasse pas : sans borne, il continuerait de
    // glisser hors de l'ecran.
    expect(progression(etat, 900, 400)).toBe(1);
  });

  test('fermer part de la position ouverte', () => {
    const etat = commencer(250, 400, true, LARGEUR)!;
    progression(etat, 200, 401);

    // Recule de cinquante sur trois cents : le tiroir est aux cinq sixiemes.
    expect(progression(etat, 200, 401)).toBeCloseTo(1 - 50 / LARGEUR, 2);
  });
});

/**
 * Le nettoyage des notes de version.
 *
 * Il s'affiche dans la fenetre que tout le monde voit apres chaque mise a jour :
 * une erreur ici est vue par tout le monde, une fois par version.
 */
test.describe('Notes de version', () => {
  test('le gras disparait entierement, puce comprise', () => {
    /*
     * Le defaut repare : la puce etait retiree en premier, par une expression
     * qui mangeait aussi les asterisques. Le gras n'avait donc plus de paire a
     * reconnaitre, et les deux asterisques fermants restaient au milieu de la
     * phrase — visibles par tout le monde, a chaque mise a jour.
     */
    expect(nettoyer('- **Ce qui change.** Le reste.')).toBe('Ce qui change. Le reste.');
    expect(nettoyer('* **Gras** puis suite')).toBe('Gras puis suite');
    expect(nettoyer('**Sans puce.** Suite')).toBe('Sans puce. Suite');
  });

  test('ce qui n a pas de marqueur passe intact', () => {
    expect(nettoyer('- Sans gras du tout')).toBe('Sans gras du tout');
    expect(nettoyer('  - Avec une indentation')).toBe('Avec une indentation');
  });

  test('les bouts de code perdent leurs accents graves', () => {
    expect(nettoyer('- Un `bout de code` ici')).toBe('Un bout de code ici');
  });

  test('un asterisque isole n est pas pris pour une puce', () => {
    // « 3 * 4 » ne doit pas perdre son signe : une puce est un caractere en
    // tete de ligne suivi d'une espace, pas un asterisque n'importe ou.
    expect(nettoyer('- Trois * quatre')).toBe('Trois * quatre');
  });
});

/**
 * L'abregement des notes.
 *
 * Le meme texte sert deux publics : la page de publication, ou l'on vient
 * chercher le detail, et la fenetre qui s'ouvre apres une mise a jour, ou l'on
 * veut savoir en trois secondes ce qui a change. Certaines puces font pres de
 * trois cents caracteres, cause du defaut et raisonnement compris.
 *
 * Personne ne lit un paragraphe dans une fenetre qui s'ouvre par surprise.
 */
test.describe('Abregement des notes', () => {
  test('la premiere phrase suffit', () => {
    expect(abreger('Ce qui change. Et voici pourquoi, longuement.')).toBe('Ce qui change.');
  });

  test('une phrase unique passe intacte', () => {
    expect(abreger('Rien a couper ici')).toBe('Rien a couper ici');
  });

  test('un point sans espace ne coupe pas', () => {
    // « 9.5.7 » et « 1.5 » ne sont pas des fins de phrase.
    expect(abreger('La version 9.5.7 corrige le defaut')).toBe('La version 9.5.7 corrige le defaut');
  });

  test('sans phrase, on tronque sur un mot entier', () => {
    const long = 'mot '.repeat(60).trim();
    const court = abreger(long);

    expect(court.length).toBeLessThan(long.length);
    expect(court.endsWith('…')).toBe(true);
    // Jamais au milieu d'un mot : la coupe tombe sur une espace.
    expect(court.slice(0, -1).trimEnd().endsWith('mot')).toBe(true);
  });
});
