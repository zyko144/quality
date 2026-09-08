import { supabase } from '@/lib/supabase';
import { journal } from '@/lib/journal';
import type { Session } from '@supabase/supabase-js';
import { profilDepuisDiscord, type CompteDiscord } from './profilDiscord';

/**
 * Ce qu'on rapatrie de Discord, et pourquoi il faut aller le chercher.
 *
 * Supabase range dans les metadonnees du compte ce que le fournisseur lui donne
 * a l'ouverture de session : pour Discord, le pseudo et l'adresse de la photo.
 * Le declencheur `handle_new_user` s'en sert deja, et cela suffit pour un
 * compte tout neuf.
 *
 * La banniere, elle, n'y est pas. Discord ne la met pas dans le jeton
 * d'identite : elle vit dans la reponse de `GET /users/@me`, sous la forme
 * d'une empreinte a partir de laquelle on fabrique une adresse. Il faut donc
 * appeler Discord soi-meme.
 *
 * Le jeton pour le faire ne passe qu'une fois
 * -------------------------------------------
 * `provider_token` accompagne la session au RETOUR de l'autorisation, et
 * seulement la : il n'est pas conserve, et un rafraichissement de session le
 * fait disparaitre. C'est pour cela que ce travail se fait a l'evenement
 * d'ouverture de session, et pas au premier affichage du profil — a ce
 * moment-la, il serait deja trop tard.
 *
 * L'echec ne coute rien : on garde ce que Supabase avait deja donne.
 */

/**
 * Reprend la photo, la banniere et le nom du compte Discord.
 *
 * Ne fait rien si la session ne vient pas de Discord, ou si le jeton du
 * fournisseur n'est plus la — c'est le cas normal a chaque rafraichissement.
 */
export async function reprendreLeProfilDiscord(session: Session | null): Promise<void> {
  const jeton = session?.provider_token;
  if (!jeton) return;

  const fournisseur = session?.user?.app_metadata?.['provider'];
  if (fournisseur !== 'discord') return;

  try {
    const reponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${jeton}` },
    });
    if (!reponse.ok) {
      journal.alerte('interface', 'Discord a refuse le profil', { statut: reponse.status });
      return;
    }

    const champs = profilDepuisDiscord((await reponse.json()) as CompteDiscord);
    if (Object.keys(champs).length === 0) return;

    /*
     * On n'ecrase QUE ce que Discord fournit.
     *
     * Quelqu'un qui a deja choisi sa banniere dans Echow, puis relie son compte
     * Discord ou celui-ci n'en a pas, garderait sinon un profil vide sans avoir
     * rien demande. `profilDepuisDiscord` ne rend que les champs presents ;
     * cette mise a jour ne touche pas au reste.
     */
    const { error } = await supabase.from('profiles').update(champs).eq('id', session.user.id);
    if (error) {
      journal.alerte('interface', 'Profil Discord non enregistre', { cause: error.message });
      return;
    }

    journal.info('interface', 'Profil repris depuis Discord', {
      photo: Boolean(champs.avatar_url),
      banniere: Boolean(champs.banner_url),
    });
  } catch (cause) {
    // Discord injoignable, hors ligne, bloqueur de requetes : le compte est
    // ouvert, c'est l'essentiel. On garde ce que Supabase avait deja pose.
    journal.alerte('interface', 'Profil Discord non repris', { cause: String(cause) });
  }
}
