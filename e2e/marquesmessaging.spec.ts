import { test, expect } from '@playwright/test';
import { marqueDe, teinteDe } from '../src/lib/marques';

/**
 * La couleur d'un lien partage dans une conversation.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce qui se protege ici tient en une phrase : la reconnaissance ne doit rien
 * couter et ne rien raconter. Rien couter, parce qu'elle se deduit du seul nom
 * de domaine, qu'on a deja. Rien raconter, parce qu'aller chercher l'icone du
 * site lui annoncerait que quelqu'un vient de recevoir son lien — avant meme
 * qu'il clique, et une fois par personne dans le salon.
 *
 * Les cas ci-dessous portent sur les formes d'adresses reellement collees, qui
 * ne sont presque jamais la forme canonique.
 */

test.describe('Couleur des liens', () => {
  test('les formes courantes d une meme adresse donnent le meme site', () => {
    // C'est le cas qui casse en premier quand on compare des chaines brutes.
    for (const hote of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']) {
      expect(marqueDe(hote)?.nom).toBe('YouTube');
    }

    for (const hote of ['spotify.com', 'open.spotify.com', 'WWW.Spotify.COM']) {
      expect(marqueDe(hote)?.nom).toBe('Spotify');
    }
  });

  test('un domaine qui se termine par un domaine connu n est pas confondu', () => {
    /*
     * `notyoutube.com` finit par `youtube.com` si l'on compare betement les
     * suffixes. Le point est ce qui separe un sous-domaine d'un autre site, et
     * l'oublier donnerait la couleur de YouTube a n'importe qui la voulant.
     */
    expect(marqueDe('notyoutube.com')).toBeNull();
    expect(marqueDe('monsite-github.com')).toBeNull();

    // Un vrai sous-domaine, lui, doit passer.
    expect(marqueDe('gist.github.com')?.nom).toBe('GitHub');
  });

  test('un site inconnu prend la teinte de l application', () => {
    /*
     * Une valeur CSS et non une couleur figee : elle suit le theme et la
     * teinte que la personne a choisie pour sa fiche. Une couleur en dur
     * ferait une tache qui ne bouge pas avec le reste.
     */
    expect(marqueDe('un-site-inconnu.example')).toBeNull();
    expect(teinteDe('un-site-inconnu.example')).toBe('var(--accent)');
  });

  test('un site connu rend une couleur, pas une variable', () => {
    const teinte = teinteDe('twitch.tv');
    expect(teinte).toMatch(/^#[0-9a-f]{6}$/i);
    expect(teinte).not.toBe('var(--accent)');
  });

  test('une adresse vide ou etrange ne fait pas tomber la lecture', () => {
    // `new URL` a deja filtre l'essentiel, mais un hote vide reste possible.
    expect(marqueDe('')).toBeNull();
    expect(teinteDe('')).toBe('var(--accent)');
  });
});
