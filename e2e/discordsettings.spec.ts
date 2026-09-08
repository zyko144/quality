import { test, expect } from '@playwright/test';
import { profilDepuisDiscord } from '../src/features/auth/profilDiscord';

/**
 * Ce qu'on reprend d'un compte Discord.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * La partie qui decide est separee de l'appel reseau exactement pour cela :
 * les cas qui comptent — une banniere absente, un nom d'affichage separe du
 * pseudo, une image animee — se posent en trois lignes, sans session ni
 * autorisation a rejouer.
 */

test.describe('Le profil repris de Discord', () => {
  test('prend le nom affiche, pas l identifiant', () => {
    /*
     * Depuis que Discord a separe les deux, `username` est un identifiant
     * technique — « noam_4412 » — et `global_name` le nom que tout le monde
     * voit. Prendre le premier donnerait un pseudo que personne ne reconnait.
     */
    const profil = profilDepuisDiscord({
      id: '123',
      username: 'noam_4412',
      global_name: 'Noam',
    });

    expect(profil.display_name).toBe('Noam');
  });

  test('se rabat sur l identifiant quand il n y a pas de nom affiche', () => {
    const profil = profilDepuisDiscord({ id: '123', username: 'noam_4412' });
    expect(profil.display_name).toBe('noam_4412');
  });

  test('fabrique les adresses de la photo et de la banniere', () => {
    const profil = profilDepuisDiscord({
      id: '42',
      username: 'x',
      avatar: 'abc',
      banner: 'def',
    });

    expect(profil.avatar_url).toBe('https://cdn.discordapp.com/avatars/42/abc.png?size=256');
    expect(profil.banner_url).toBe('https://cdn.discordapp.com/banners/42/def.png?size=1024');
  });

  test('rend les images animees en gif', () => {
    // Une empreinte qui commence par `a_` designe une image animee, et Discord
    // ne la sert en mouvement qu'en `.gif` : demander `.png` rendrait une
    // vignette figee, ce qui se lit comme une animation perdue.
    const profil = profilDepuisDiscord({ id: '42', avatar: 'a_abc', banner: 'a_def' });

    expect(profil.avatar_url).toContain('.gif');
    expect(profil.banner_url).toContain('.gif');
  });

  test('une banniere absente ne s ecrit pas', () => {
    /*
     * Le cas qui abime un profil sans qu'on le remarque. La plupart des comptes
     * Discord n'ont pas de banniere : `banner` vaut alors `null`. Si l'absence
     * devenait une ecriture, relier son compte effacerait la banniere qu'on
     * avait choisie dans Echow.
     */
    const profil = profilDepuisDiscord({ id: '42', username: 'x', banner: null });

    expect(profil).not.toHaveProperty('banner_url');
    expect(profil).not.toHaveProperty('avatar_url');
  });

  test('sans identifiant, on ne fabrique rien', () => {
    // Les adresses du reseau de diffusion se batissent sur l'identifiant : sans
    // lui, on produirait des liens brises plutot que rien.
    expect(profilDepuisDiscord({ username: 'x', avatar: 'abc' })).toEqual({});
  });
});
