import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { profilDepuisDiscord } from '../src/features/auth/profilDiscord';

/**
 * La politique de securite de l'application de bureau, face a ce qu'elle charge.
 *
 * Fichier du projet « public » : il ne lit que des fichiers du depot.
 *
 * Ce que ce fichier protege : les photos des comptes Discord, un rond noir dans
 * l'application de bureau. La politique n'autorisait les images que de Supabase
 * et de Google ; la photo d'un compte Discord vient de `cdn.discordapp.com`, et
 * le rapatriement de la banniere interroge `discord.com`. Le site, lui, n'a pas
 * de politique : tant que les fenetres de bureau l'affichaient par erreur, rien
 * ne se voyait. Le defaut est apparu le jour ou elles sont revenues chez elles.
 *
 * Les hotes sont tires du code lui-meme, pas recopies ici : si l'adresse change
 * un jour, le test la suit et designe la politique a mettre a jour.
 */

function directive(nom: string): string[] {
  const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
    app: { security: { csp: string } };
  };

  const regle = conf.app.security.csp
    .split(';')
    .map((morceau) => morceau.trim())
    .find((morceau) => morceau.startsWith(`${nom} `));

  return regle ? regle.split(/\s+/).slice(1) : [];
}

test.describe('Politique de securite du bureau', () => {
  test('les photos et bannieres Discord peuvent s afficher', () => {
    const profil = profilDepuisDiscord({ id: '1', avatar: 'abc', banner: 'def' });

    expect(directive('img-src')).toContain(new URL(profil.avatar_url!).origin);
    expect(directive('img-src')).toContain(new URL(profil.banner_url!).origin);
  });

  test('le profil Discord peut etre interroge', () => {
    // Lu dans le module qui fait l'appel plutot qu'importe : l'importer tirerait
    // le client Supabase, qui lit une configuration que le lanceur n'a pas.
    const source = readFileSync('src/features/auth/discord.ts', 'utf8');
    const appel = /fetch\(\s*'(https:\/\/[^']+)'/.exec(source);
    expect(appel, 'appel a Discord introuvable dans discord.ts').not.toBeNull();

    expect(directive('connect-src')).toContain(new URL(appel![1]!).origin);
  });
});
