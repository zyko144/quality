import { test, expect } from '@playwright/test';
import { afficheLeSite, adresseDeRetour, origineLocale } from '../src/lib/retourBureau';

/**
 * La fenetre de bureau qui se retrouvait sur le site.
 *
 * Fichier du projet « public » : ces regles ne dependent que de chaines de
 * caracteres, aucune session n'est necessaire.
 *
 * Ce que ce fichier protege : apres une connexion par Google ou Discord, la
 * fenetre de bureau affichait `echowebplayer.vercel.app` au lieu de
 * l'application locale. Tauri y refusait tout — « not allowed by ACL » sur les
 * boutons de la fenetre, le partage d'ecran et la recherche de mise a jour —
 * et le journal le montrait chez plusieurs membres le meme matin.
 */

test.describe('Retour de la fenetre de bureau', () => {
  test('le site dans la fenetre de bureau est reconnu', () => {
    expect(afficheLeSite('https:', true)).toBe(true);
  });

  test('l application locale ne l est pas', () => {
    // Windows et le developpement servent en `http`, Mac par son protocole :
    // les confondre avec le site renverrait la fenetre en boucle vers elle-meme.
    expect(afficheLeSite('http:', true)).toBe(false);
    expect(afficheLeSite('tauri:', true)).toBe(false);
  });

  test('un navigateur ordinaire n est jamais renvoye', () => {
    // Le site ouvert dans un navigateur est chez lui : le renvoyer vers
    // `tauri.localhost` le jetterait sur une page d'erreur.
    expect(afficheLeSite('https:', false)).toBe(false);
  });

  test('l origine locale suit le systeme', () => {
    expect(origineLocale('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'http://tauri.localhost',
    );
    expect(origineLocale('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe(
      'tauri://localhost',
    );
  });

  test('la session voyage dans le fragment, sous la forme que Supabase attend', () => {
    const adresse = new URL(
      adresseDeRetour('http://tauri.localhost', {
        access_token: 'jeton.acces',
        refresh_token: 'renouvellement',
        expires_in: 3600,
        expires_at: 1790000000,
        token_type: 'bearer',
        provider_token: 'discord123',
      }),
    );

    // Rien dans les parametres : ils partent vers le serveur, le fragment non.
    expect(adresse.search).toBe('');

    const champs = new URLSearchParams(adresse.hash.slice(1));
    expect(champs.get('access_token')).toBe('jeton.acces');
    expect(champs.get('refresh_token')).toBe('renouvellement');
    expect(champs.get('expires_in')).toBe('3600');
    expect(champs.get('token_type')).toBe('bearer');

    // Sans lui, la banniere Discord ne serait plus reprise une fois revenu.
    expect(champs.get('provider_token')).toBe('discord123');

    // `type=recovery` ferait croire a une reprise de mot de passe.
    expect(champs.has('type')).toBe(false);
  });

  test('sans session, on revient quand meme', () => {
    // Sur le site sans etre connecte, la fenetre n'a rien a y faire non plus.
    expect(adresseDeRetour('http://tauri.localhost', null)).toBe('http://tauri.localhost/');
  });
});
