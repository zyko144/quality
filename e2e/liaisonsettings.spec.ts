import { test, expect } from '@playwright/test';
import { lireIdentite, seLiePaeLuiMeme, FOURNISSEURS } from '../src/features/profile/identites';

/**
 * Ce qu'un service repond quand on lui demande qui l'on est.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Chaque fournisseur range le pseudo sous un nom different, et aucun ne
 * garantit un champ en particulier. Le defaut qu'on protege ici est silencieux :
 * un compte se lie, le nom s'affiche correctement, et le lien mene a une page
 * qui n'existe pas — parce qu'on a pris le NOM pour l'ADRESSE.
 *
 * Il ne se voit qu'en cliquant, sur le profil de quelqu'un d'autre, un jour ou
 * personne ne pense a le signaler.
 */

test.describe('Liaison des comptes', () => {
  test('Twitch : le pseudo est aussi l adresse', () => {
    expect(lireIdentite('twitch', { provider: 'twitch', identity_data: { nickname: 'zyko682' } }))
      .toEqual({ identifiant: 'zyko682', nom: 'zyko682' });

    // Twitch a change de champ au fil des versions : on accepte les deux.
    expect(
      lireIdentite('twitch', { provider: 'twitch', identity_data: { preferred_username: 'zyko682' } }),
    ).toEqual({ identifiant: 'zyko682', nom: 'zyko682' });
  });

  test('Spotify : l adresse et le nom sont DEUX choses', () => {
    /*
     * Le coeur de ce fichier. `open.spotify.com/user/<identifiant>` veut
     * l'identifiant opaque ; la personne veut lire son nom. Les confondre
     * donne un lien mort sous un libelle parfaitement juste.
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

  test('Spotify sans nom d affichage retombe sur l identifiant', () => {
    // Mieux vaut un lien juste sous un libelle laid qu'un lien mort.
    expect(
      lireIdentite('spotify', { provider: 'spotify', identity_data: { provider_id: '31abcdef' } }),
    ).toEqual({ identifiant: '31abcdef', nom: '31abcdef' });
  });

  test('GitHub distingue le pseudo du nom civil', () => {
    expect(
      lireIdentite('github', {
        provider: 'github',
        identity_data: { user_name: 'zyko144', name: 'Noam B' },
      }),
    ).toEqual({ identifiant: 'zyko144', nom: 'Noam B' });
  });

  test('une identite sans rien d exploitable ne lie rien', () => {
    /*
     * `null` plutot qu'un compte invente. Un compte lie faux est pire qu'un
     * compte lie absent : il s'affiche, on clique, et il ne mene nulle part.
     */
    expect(lireIdentite('twitch', { provider: 'twitch', identity_data: {} })).toBeNull();
    expect(lireIdentite('spotify', { provider: 'spotify', identity_data: null })).toBeNull();
    expect(lireIdentite('twitch', { provider: 'twitch', identity_data: { nickname: '   ' } })).toBeNull();
  });

  test('seuls les services qui savent repondre proposent la connexion', () => {
    /*
     * YouTube passe par Google, qui rend un nom mais AUCUN identifiant de
     * chaine : on saurait qui est la personne sans savoir ou mene sa chaine.
     * Steam et Roblox n'existent pas comme fournisseurs. Pour ces trois-la, la
     * saisie a la main reste la seule voie honnete.
     */
    expect(seLiePaeLuiMeme('twitch')).toBe(true);
    expect(seLiePaeLuiMeme('spotify')).toBe(true);
    expect(seLiePaeLuiMeme('github')).toBe(true);

    expect(seLiePaeLuiMeme('youtube')).toBe(false);
    expect(seLiePaeLuiMeme('steam')).toBe(false);
    expect(seLiePaeLuiMeme('roblox')).toBe(false);
  });

  test('chaque fournisseur declare porte un nom de service connu', () => {
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
