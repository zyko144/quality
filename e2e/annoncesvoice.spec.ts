import { test, expect } from '@playwright/test';
import {
  attenteAvantAnnonce,
  retenirAnnonce,
  ANNONCES_PAR_FENETRE,
  FENETRE_PRESENCE,
  REPUBLICATION_PRESENCE,
} from '../src/features/voice/annonces';

/**
 * La cadence des annonces de presence.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce qui rend ce fichier necessaire : la regle qu'il protege ne se verifie pas
 * en lisant le code. Depasser la cadence n'a aucun effet visible sur le coup —
 * le canal se ferme, l'application le rebatit, et le defaut se manifeste
 * quinze secondes plus tard sous la forme « on s'entend mais on ne se voit
 * pas », sur la machine de quelqu'un d'autre. Quatre hypotheses ont ete
 * ecrites et publiees avant que la mesure ne donne la vraie cause.
 *
 * On simule donc le serveur, avec la loi relevee contre le vrai : cinq
 * annonces par fenetre glissante de trente secondes, la sixieme ferme le
 * canal. Un jour ou quelqu'un resserrera la republication, ces cas tomberont
 * ici plutot que dans un appel.
 */

/** Le serveur, tel qu'il a ete mesure. Rend `false` quand il ferme le canal. */
function serveurRealtime() {
  const recues: number[] = [];
  const PLAFOND = 5;

  return {
    annonce(maintenant: number): boolean {
      while (recues.length > 0 && maintenant - (recues[0] ?? 0) >= FENETRE_PRESENCE) recues.shift();
      recues.push(maintenant);
      return recues.length <= PLAFOND;
    },
  };
}

/**
 * Fait tourner un appel, en temps simule.
 *
 * `changements` porte les instants ou l'utilisateur touche a quelque chose —
 * sa sourdine, son partage, sa camera. Le reste est le battement de
 * republication, tel que `useVoice` le declenche.
 *
 * Rend l'instant de fermeture, ou `null` si le canal a tenu.
 */
function appel(duree: number, changements: number[]): number | null {
  const serveur = serveurRealtime();
  const envois: number[] = [];
  const aVenir = [...changements].sort((a, b) => a - b);

  let dernierEnvoi = 0;
  let enAttente = true; // l'annonce d'arrivee
  let prochaineTentative = 0;

  for (let t = 0; t <= duree; t += 100) {
    while (aVenir.length > 0 && (aVenir[0] ?? Infinity) <= t) {
      aVenir.shift();
      enAttente = true;
    }

    // Le battement de `useVoice` : toutes les trois secondes, mais il ne
    // republie que passe REPUBLICATION_PRESENCE sans avoir rien envoye.
    if (t % 3000 === 0 && t - dernierEnvoi >= REPUBLICATION_PRESENCE) enAttente = true;

    if (!enAttente || t < prochaineTentative) continue;

    const attente = attenteAvantAnnonce(envois, t);
    if (attente > 0) {
      prochaineTentative = t + attente;
      continue;
    }

    retenirAnnonce(envois, t);
    dernierEnvoi = t;
    enAttente = false;

    if (!serveur.annonce(t)) return t;
  }

  return null;
}

test.describe('Annonces de presence', () => {
  test('la fenetre laisse passer ce qu on s autorise, et pas un de plus', () => {
    const envois: number[] = [];

    for (let i = 0; i < ANNONCES_PAR_FENETRE; i += 1) {
      expect(attenteAvantAnnonce(envois, 1000 + i * 10)).toBe(0);
      retenirAnnonce(envois, 1000 + i * 10);
    }

    // La suivante attend que la premiere sorte de la fenetre.
    const attente = attenteAvantAnnonce(envois, 1040);
    expect(attente).toBeGreaterThan(0);
    expect(1040 + attente).toBeGreaterThanOrEqual(1000 + FENETRE_PRESENCE);
  });

  test('une place se libere des que la plus ancienne sort de la fenetre', () => {
    const envois: number[] = [];
    for (let i = 0; i < ANNONCES_PAR_FENETRE; i += 1) retenirAnnonce(envois, 1000 + i * 10);

    expect(attenteAvantAnnonce(envois, 1000 + FENETRE_PRESENCE - 1)).toBeGreaterThan(0);
    expect(attenteAvantAnnonce(envois, 1000 + FENETRE_PRESENCE)).toBe(0);
  });

  test('on reste sous le plafond du serveur, avec une annonce de reserve', () => {
    expect(ANNONCES_PAR_FENETRE).toBeLessThan(5);
  });

  test('la republication seule ne remplit jamais la fenetre', () => {
    // Sans elle, le battement mangerait a lui seul le budget des changements
    // d'etat — ce qui etait exactement le defaut.
    const parFenetre = FENETRE_PRESENCE / REPUBLICATION_PRESENCE;
    expect(parFenetre).toBeLessThan(ANNONCES_PAR_FENETRE);
  });

  test('un appel calme de dix minutes ne ferme jamais le canal', () => {
    expect(appel(600_000, [])).toBeNull();
  });

  test('un appel anime de dix minutes ne ferme jamais le canal', () => {
    // Quelqu'un qui coupe et rouvre son micro sans arret, partage, arrete.
    const changements: number[] = [];
    for (let t = 20_000; t < 600_000; t += 4_000) changements.push(t);

    expect(appel(600_000, changements)).toBeNull();
  });

  test('une rafale de bascules ne ferme pas le canal', () => {
    // Huit bascules en trois secondes, trois fois dans l'appel.
    const changements: number[] = [];
    for (const depart of [40_000, 200_000, 400_000]) {
      for (let i = 0; i < 8; i += 1) changements.push(depart + i * 400);
    }

    expect(appel(600_000, changements)).toBeNull();
  });

  test('le serveur simule ferme bien sur l ancienne cadence', () => {
    /*
     * La preuve que ce fichier mesure quelque chose.
     *
     * L'ancien battement republiait toutes les trois secondes sans aucune
     * retenue. Si ce cas ne fermait pas, le serveur simule serait trop
     * indulgent et les cas ci-dessus ne garantiraient rien.
     */
    const serveur = serveurRealtime();
    let ferme: number | null = null;

    for (let t = 0; t <= 60_000 && ferme === null; t += 3_000) {
      if (!serveur.annonce(t)) ferme = t;
    }

    expect(ferme).toBe(15_000);
  });
});
