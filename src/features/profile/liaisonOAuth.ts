import { supabase } from '@/lib/supabase';
import type { Service } from '@/store/comptesLies';
import { FOURNISSEURS, lireIdentite, type Identite, type Trouvaille } from './identites';

export { FOURNISSEURS, seLiePaeLuiMeme, lireIdentite } from './identites';
export type { Trouvaille } from './identites';

/**
 * Part chez le service pour lier le compte.
 *
 * La page s'en va : ce qui suit se passe au retour, dans `identitesLiees`.
 * Rend un message d'erreur quand le depart lui-meme echoue — fournisseur non
 * active, liaison manuelle desactivee — et `null` quand tout est parti.
 */
export async function demarrerLiaison(service: Service): Promise<string | null> {
  const fournisseur = FOURNISSEURS[service];
  if (!fournisseur) return 'Ce service ne sait pas encore repondre de lui-meme.';

  const { error } = await supabase.auth.linkIdentity({
    provider: fournisseur,
    options: {
      // On revient exactement d'ou l'on part : la page des reglages, ouverte
      // sur la bonne section. Revenir a l'accueil obligerait a refaire tout le
      // chemin pour verifier que ca a marche.
      redirectTo: window.location.href,
    },
  });

  if (!error) return null;

  /*
   * Le message dit QUOI FAIRE, pas ce qui a echoue.
   *
   * « Provider is not enabled » n'apprend rien a qui utilise l'application, et
   * tout a qui l'administre. Comme les deux sont ici la meme personne, on
   * traduit vers le geste plutot que vers la cause.
   */
  const brut = error.message.toLowerCase();

  if (brut.includes('not enabled') || brut.includes('unsupported provider')) {
    return `${service} n’est pas encore active dans le tableau de bord Supabase (Authentication → Providers).`;
  }

  if (brut.includes('manual linking') || brut.includes('disabled')) {
    return 'La liaison de comptes est desactivee dans Supabase (Authentication → Settings → Manual Linking).';
  }

  return error.message;
}

/**
 * Ce que les services ont reconnu, au retour de la redirection.
 *
 * Rend une entree par service reconnu. L'appelant compare avec ce qui est deja
 * lie : reecrire a chaque ouverture ferait une ecriture par affichage de la
 * page, pour une valeur qui ne change qu'une fois tous les deux ans.
 */
export async function identitesLiees(): Promise<Partial<Record<Service, Trouvaille>>> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error || !data) return {};

  const trouvees: Partial<Record<Service, Trouvaille>> = {};

  for (const [service, fournisseur] of Object.entries(FOURNISSEURS) as [
    Service,
    string,
  ][]) {
    const identite = data.identities.find((entree) => entree.provider === fournisseur);
    if (!identite) continue;

    const lue = lireIdentite(service, identite as Identite);
    if (lue) trouvees[service] = lue;
  }

  return trouvees;
}
