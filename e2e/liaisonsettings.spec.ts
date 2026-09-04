import { test, expect } from '@playwright/test';
import { lireIdentite, seLiePaeLuiMeme, FOURNISSEURS } from '../src/features/profile/identites';

/**
 * Ce qu'un service repond quand on lui demande qui l'on est.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Spotify et Twitch se relient ainsi, et Spotify porte le piege le plus
 * couteux : il separe l'ADRESSE du NOM. Prendre l'un pour l'autre donne un
 * compte qui se lie, un nom qui s'affiche correctement, et un lien qui mene a
 * une page inexistante.
 *
 * Ce defaut-la ne se voit qu'en cliquant, sur le profil de quelqu'un d'autre,
 * un jour ou personne ne pense a le signaler.
 */

test.describe('Liaison des comptes', () => {
  test('Twitch : le pseudo EST l adresse', () => {
    // A la difference de Spotify, rien a separer : `twitch.tv/<pseudo>`.
    expect(
      lireIdentite('twitch', { provider: 'twitch', identity_data: { nickname: 'zyko682' } }),
    ).toEqual({ identifiant: 'zyko682', nom: 'zyko682' });

    // Twitch a change de champ au fil des versions : on accepte les deux.
    expect(
      lireIdentite('twitch', {
        provider: 'twitch',
        identity_data: { preferred_username: 'zyko682' },
      }),
    ).toEqual({ identifiant: 'zyko682', nom: 'zyko682' });

    expect(lireIdentite('twitch', { provider: 'twitch', identity_data: {} })).toBeNull();
  });

  test('l adresse et le nom sont DEUX choses', () => {
    /*
     * `open.spotify.com/user/<identifiant>` veut l'identifiant opaque ; la
     * personne, elle, veut lire son nom d'affichage.
     */
    const lue = lireIdentite('spotify', {
      provider: 'spotify',
      id: '31abcdef',
      identity_data: { provider_id: '31abcdef', name: 'Noam' },
    });

    expect(lue).toEqual({ identifiant: '31abcdef', nom: 'Noam' });

    // La forme que `SERVICES.spotify.profil` batira avec cet identifiant.
    expect(`https://open.spotify.com/user/${lue!.identifiant}`).toBe(
      'https://open.spotify.com/user/31abcdef',
    );
  });

  test('sans nom d affichage, on retombe sur l identifiant', () => {
    // Mieux vaut un lien juste sous un libelle laid qu'un lien mort.
    expect(
      lireIdentite('spotify', { provider: 'spotify', identity_data: { provider_id: '31abcdef' } }),
    ).toEqual({ identifiant: '31abcdef', nom: '31abcdef' });
  });

  test('l identifiant peut venir de l identite elle-meme', () => {
    // Supabase ne remplit pas toujours `identity_data.provider_id`.
    expect(
      lireIdentite('spotify', { provider: 'spotify', id: '31abcdef', identity_data: {} }),
    ).toEqual({ identifiant: '31abcdef', nom: '31abcdef' });
  });

  test('une identite sans rien d exploitable ne lie rien', () => {
    /*
     * `null` plutot qu'un compte invente. Un compte lie faux est pire qu'un
     * compte lie absent : il s'affiche, on clique, et il ne mene nulle part.
     */
    expect(lireIdentite('spotify', { provider: 'spotify', identity_data: {} })).toBeNull();
    expect(lireIdentite('spotify', { provider: 'spotify', identity_data: null })).toBeNull();
    expect(
      lireIdentite('spotify', { provider: 'spotify', identity_data: { provider_id: '   ' } }),
    ).toBeNull();
  });

  test('deux services seulement se relient tout seuls, et c est un choix', () => {
    /*
     * Chaque fournisseur ajoute coute une application a declarer chez lui, une
     * adresse de retour, un secret a poser dans le tableau de bord, et une
     * chose de plus a maintenir le jour ou il change ses regles.
     *
     * Ces deux-la portent une identite qu'on MONTRE — un pseudo de chaine, un
     * profil d'ecoute — et non une simple adresse. Spotify a de plus une
     * seconde raison : sa liaison sert AUSSI a lire ce qu'on ecoute depuis le
     * navigateur, la ou `musique.rs` ne va pas, Windows ne parlant qu'a
     * l'application de bureau.
     */
    expect(seLiePaeLuiMeme('spotify')).toBe(true);
    expect(seLiePaeLuiMeme('twitch')).toBe(true);

    /*
     * YouTube passe par Google, qui rend un nom mais AUCUN identifiant de
     * chaine : on saurait qui est la personne sans savoir ou mene sa chaine.
     * Steam et Roblox n'existent pas comme fournisseurs chez Supabase.
     */
    for (const autre of ['github', 'youtube', 'steam', 'roblox'] as const) {
      expect(seLiePaeLuiMeme(autre)).toBe(false);
    }
  });

  test('le fournisseur declare porte un nom de service connu', () => {
    /*
     * Une cle mal orthographiee donnerait un bouton qui ne lie rien, en
     * silence : le service n'existerait simplement jamais dans la liste.
     *
     * La liste est recopiee ici plutot qu'importee de `comptesLies`, qui ouvre
     * une connexion Supabase des qu'on le charge. Une divergence ferait tomber
     * ce cas, ce qui est exactement son role.
     */
    const connus = ['spotify', 'twitch', 'youtube', 'roblox', 'steam', 'github'];

    for (const service of Object.keys(FOURNISSEURS)) {
      expect(connus).toContain(service);
    }
  });
});
