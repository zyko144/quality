import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BATTEMENT, EXPIRATION } from '../src/lib/presence';
import { REPUBLICATION_PRESENCE } from '../src/features/voice/annonces';

/**
 * Ce que l'application coute quand elle ne fait rien.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce fichier protege une propriete qui ne se voit ni a l'ecran, ni dans les
 * traces, ni en relisant le code : le nombre de messages qu'Echow envoie par
 * minute sans que personne n'agisse. Elle ne se manifeste que sur une facture,
 * un mois plus tard, et sous une forme qui ne designe aucun fichier.
 *
 * Le releve qui a motive ces cas : 1 956 495 messages Realtime sur un plafond
 * de 2 000 000, et 14,3 Go de sortie servie par le cache sur un plafond de 5 —
 * avec ONZE utilisateurs actifs dans le mois. Ce n'etait pas de l'usage.
 *
 * Deux causes, toutes deux invisibles a la lecture :
 *
 *   1. `public:presence` est un canal GLOBAL. Un message diffuse y est
 *      reexpedie a chaque abonne, donc le cout va comme le CARRE du nombre de
 *      personnes connectees. Un battement de trois secondes y coutait cent
 *      quarante-cinq mille messages par heure a onze personnes.
 *   2. Les images envoyees partaient sans consigne de cache. Supabase repond
 *      alors `max-age=3600` : un avatar, une banniere, une piece jointe etaient
 *      retelecharges chaque heure, par chaque personne, a chaque rechargement.
 */

/** Ce qu'on s'autorise a envoyer par minute et par personne, au repos. */
const MESSAGES_PAR_MINUTE_MAX = 2;

test.describe('Cout au repos', () => {
  test('le battement de presence global reste rare', () => {
    /*
     * A une minute, onze personnes coutent cent vingt et un messages par
     * minute. A trois secondes, elles en coutaient deux mille quatre cents.
     */
    const parMinute = 60_000 / BATTEMENT;
    expect(parMinute).toBeLessThanOrEqual(MESSAGES_PAR_MINUTE_MAX);
  });

  test('l expiration tolere plusieurs battements manques', () => {
    // Sans cette marge, ralentir le battement ferait clignoter les gens hors
    // ligne au moindre hoquet de reseau — et l'on reaccelererait aussitot.
    expect(EXPIRATION).toBeGreaterThanOrEqual(BATTEMENT * 2);
  });

  test('la republication de presence vocale reste rare', () => {
    // Elle se paie en plus, et sur un canal ou chaque message part aussi vers
    // tous ceux qui observent le salon depuis la barre laterale.
    expect(60_000 / REPUBLICATION_PRESENCE).toBeLessThanOrEqual(MESSAGES_PAR_MINUTE_MAX + 1);
  });

  test('toute image envoyee porte une consigne de cache longue', () => {
    /*
     * Lu dans le fichier plutot que par un appel : ce qui compte est qu'AUCUN
     * envoi n'oublie la consigne, et c'est une propriete du fichier entier, pas
     * d'un appel en particulier. Un quatrieme envoi ajoute demain sans elle
     * ferait tomber ce cas.
     *
     * Les chemins portent tous un identifiant unique — `Date.now()` pour les
     * avatars et les bannieres, l'identifiant de l'envoi pour les pieces
     * jointes — donc une image modifiee est une AUTRE adresse, et rien ne peut
     * devenir perime a l'ancienne.
     */
    const source = readFileSync(new URL('../src/lib/upload.ts', import.meta.url), 'utf8');

    const envois = source.match(/\.upload\(/g) ?? [];
    const caches = source.match(/cacheControl:/g) ?? [];

    expect(envois.length).toBeGreaterThan(0);
    expect(caches.length).toBe(envois.length);

    // Un an, la valeur d'usage pour une adresse qui identifie son contenu.
    expect(source).toContain("'31536000'");
  });
});
