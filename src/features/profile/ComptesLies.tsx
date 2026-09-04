import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useSession } from '@/store/session';
import {
  useComptesLies,
  SERVICES,
  comptesVisibles,
  type Service,
} from '@/store/comptesLies';
import { demarrerLiaison, identitesLiees, seLiePaeLuiMeme } from './liaisonOAuth';

/**
 * Les comptes lies, dans les reglages.
 *
 * Lier et afficher sont deux gestes separes, et c'est le coeur de cet ecran :
 * on peut vouloir la synchronisation sans la vitrine. Les confondre reviendrait
 * a publier ce qu'on voulait seulement connecter — et ce genre de surprise ne
 * se repare pas apres coup.
 *
 * Deux facons de lier, et pourquoi les deux existent
 * ---------------------------------------------------
 * **Le service repond lui-meme.** On part chez lui, il demande son accord a la
 * personne, et il rend un identifiant qu'elle ne choisit pas. Twitch, Spotify
 * et GitHub savent le faire. C'est la bonne facon : le compte lie devient une
 * affirmation verifiable.
 *
 * **On tape son pseudo.** Pour les autres. Personne ne verifie rien — on peut
 * ecrire le pseudo d'un autre, ou une faute de frappe qui mene a une page
 * vide.
 *
 * Les deux sont proposees, et l'ecran dit laquelle est laquelle. Une seule
 * facon qui mentirait sur la moitie des cas serait pire que deux honnetes.
 * Voir `liaisonOAuth.ts` pour la liste et ses raisons.
 */
export function ComptesLies() {
  const moi = useSession((etat) => etat.profile?.id);
  const parProfil = useComptesLies((etat) => etat.parProfil);
  const charger = useComptesLies((etat) => etat.charger);
  const lier = useComptesLies((etat) => etat.lier);
  const delier = useComptesLies((etat) => etat.delier);
  const basculer = useComptesLies((etat) => etat.basculerVisibilite);

  const [ouvert, setOuvert] = useState<Service | null>(null);
  const [saisie, setSaisie] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [enRoute, setEnRoute] = useState<Service | null>(null);

  /*
   * Part chez le service. La page s'en va si tout se passe bien.
   *
   * L'attente n'est donc jamais levee dans le cas nominal — c'est voulu : entre
   * le clic et le depart il s'ecoule quelques centaines de millisecondes, et un
   * bouton qui redevient cliquable pendant ce temps invite a cliquer deux fois.
   */
  const connecter = async (service: Service) => {
    setRefus(null);
    setEnRoute(service);

    const probleme = await demarrerLiaison(service);
    if (probleme) {
      setRefus(probleme);
      setEnRoute(null);
    }
  };

  useEffect(() => {
    if (moi) void charger([moi]);
  }, [moi, charger]);

  /*
   * Au retour du service, on enregistre ce qu'il a reconnu.
   *
   * `linkIdentity` quitte la page : rien de ce qui suit l'appel ne s'execute.
   * L'identite existe donc cote Supabase quand on revient, mais notre table ne
   * la connait pas encore — c'est ici que les deux se rejoignent.
   *
   * On n'ecrit que ce qui DIFFERE. Sans cette comparaison, chaque ouverture de
   * la page reecrirait les memes lignes, pour une valeur qui ne change qu'une
   * fois tous les deux ans.
   */
  useEffect(() => {
    if (!moi) return;
    let annule = false;

    void (async () => {
      const trouvees = await identitesLiees();
      if (annule) return;

      const deja = comptesVisibles(useComptesLies.getState().parProfil[moi], true);

      for (const [service, lue] of Object.entries(trouvees) as [
        Service,
        { identifiant: string; nom: string },
      ][]) {
        const courant = deja.find((entree) => entree.service === service);
        if (courant?.identifiant === lue.identifiant && courant.nom_affiche === lue.nom) {
          continue;
        }

        await lier(service, lue.identifiant, lue.nom);
      }

      if (!annule) await charger([moi]);
    })();

    return () => {
      annule = true;
    };
  }, [moi, lier, charger]);

  const miens = comptesVisibles(parProfil[moi ?? ''], true);
  const parService = new Map(miens.map((entree) => [entree.service, entree]));

  const valider = async (service: Service) => {
    const identifiant = saisie.trim();
    if (!identifiant) return;

    setRefus(null);
    const ok = await lier(service, identifiant, identifiant);

    if (!ok) {
      setRefus(
        'Le compte n’a pas pu etre lie. Cette fonction demande une mise a jour de la base : elle sera disponible sous peu.',
      );
      return;
    }

    setOuvert(null);
    setSaisie('');
  };

  return (
    <section className="settings__section">
      <h2 className="settings__title">Comptes lies</h2>
      <p className="settings__hint">
        Indiquez ou vous retrouver ailleurs. Chaque service se montre ou se cache
        separement : lier n&rsquo;est pas afficher, et vous pouvez vouloir
        l&rsquo;un sans l&rsquo;autre.
      </p>

      {refus ? (
        <p className="settings__hint settings__hint--erreur" role="alert">
          {refus}
        </p>
      ) : null}

      <ul className="comptes">
        {(Object.keys(SERVICES) as Service[]).map((service) => {
          const info = SERVICES[service];
          const lie = parService.get(service);

          return (
            <li
              className={'compte' + (lie ? ' is-lie' : '')}
              key={service}
              style={{ '--teinte': info.teinte } as React.CSSProperties}
            >
              <span className="compte__marque" aria-hidden="true">
                <LogoService service={service} />
              </span>

              <span className="compte__corps">
                <span className="compte__nom">{info.nom}</span>

                {lie ? (
                  <a
                    className="compte__identifiant"
                    href={info.profil(lie.identifiant)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {lie.nom_affiche}
                    <Icon name="link" size={12} />
                  </a>
                ) : (
                  <span className="compte__identifiant compte__identifiant--vide">
                    Non lie
                  </span>
                )}
              </span>

              {lie ? (
                <>
                  {/* Afficher ou non, service par service. */}
                  <label className="compte__visible">
                    <input
                      type="checkbox"
                      checked={lie.visible}
                      onChange={(event) => void basculer(service, event.target.checked)}
                    />
                    <span>Sur mon profil</span>
                  </label>

                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    onClick={() => void delier(service)}
                    aria-label={`Delier ${info.nom}`}
                    title={`Delier ${info.nom}`}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </>
              ) : ouvert === service ? (
                <span className="compte__saisie">
                  <input
                    className="input input--sm"
                    value={saisie}
                    autoFocus
                    placeholder={`Votre identifiant ${info.nom}`}
                    onChange={(event) => setSaisie(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void valider(service);
                      if (event.key === 'Escape') setOuvert(null);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--sm btn--primary"
                    onClick={() => void valider(service)}
                  >
                    Lier
                  </button>
                </span>
              ) : seLiePaeLuiMeme(service) ? (
                /*
                  Un seul bouton, qui emmene chez le service.

                  Pas de champ a cote : proposer les deux laisserait croire
                  qu'ils font la meme chose, alors que l'un verifie et l'autre
                  non. Quand le service sait repondre, c'est lui qui repond.
                */
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  disabled={enRoute === service}
                  onClick={() => void connecter(service)}
                >
                  {enRoute === service ? (
                    <span className="spinner" />
                  ) : (
                    <Icon name="link" size={14} />
                  )}
                  Connecter {info.nom}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => {
                    setOuvert(service);
                    setSaisie('');
                  }}
                  title={`${info.nom} ne sait pas repondre de lui-meme : l'identifiant est saisi a la main.`}
                >
                  Lier a la main
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Le logo de chaque service, dessine plutot que charge.
 *
 * Une image distante ferait dependre l'affichage d'un serveur tiers, qui voit
 * alors passer l'adresse de chacun de nos utilisateurs a chaque ouverture des
 * reglages. Ces formes tiennent en quelques traits et ne bougent plus.
 */
export function LogoService({ service, taille = 18 }: { service: Service; taille?: number }) {
  const commun = {
    width: taille,
    height: taille,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    'aria-hidden': true as const,
  };

  if (service === 'spotify') {
    return (
      <svg {...commun}>
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.04 8.5-.59 11.66 1.34.35.22.46.68.25 1.03Zm1.23-2.75a.94.94 0 0 1-1.29.31c-3.23-1.98-8.15-2.56-11.97-1.4a.94.94 0 1 1-.54-1.8c4.37-1.31 9.79-.67 13.5 1.6.44.27.58.85.3 1.29Zm.11-2.86C14.06 8.5 7.9 8.29 4.2 9.41a1.12 1.12 0 1 1-.65-2.15c4.25-1.29 11.05-1.04 15.4 1.54a1.12 1.12 0 1 1-1.14 1.94l.13-.15Z" />
      </svg>
    );
  }

  if (service === 'twitch') {
    return (
      <svg {...commun}>
        <path d="M4.3 2 2.5 6.5v14h5V24h3l3-3.5h4L22 15V2H4.3Zm16 12.3-3 3h-4l-3 3v-3H6.5V4h13.8v10.3ZM17 7v6h-2V7h2Zm-5 0v6h-2V7h2Z" />
      </svg>
    );
  }

  if (service === 'youtube') {
    return (
      <svg {...commun}>
        <path d="M22.5 7.2a2.8 2.8 0 0 0-2-2C18.8 4.7 12 4.7 12 4.7s-6.8 0-8.5.5a2.8 2.8 0 0 0-2 2C1 8.9 1 12 1 12s0 3.1.5 4.8a2.8 2.8 0 0 0 2 2c1.7.4 8.5.4 8.5.4s6.8 0 8.5-.4a2.8 2.8 0 0 0 2-2c.5-1.7.5-4.8.5-4.8s0-3.1-.5-4.8ZM9.8 15.3V8.7l5.7 3.3-5.7 3.3Z" />
      </svg>
    );
  }

  if (service === 'roblox') {
    return (
      <svg {...commun}>
        <path d="M18.9 1 23 18.9 5.1 23 1 5.1 18.9 1ZM9.6 14.4l4.8-1.1-1.1-4.8-4.8 1.1 1.1 4.8Z" />
      </svg>
    );
  }

  if (service === 'steam') {
    return (
      <svg {...commun}>
        <path d="M12 2a10 10 0 0 0-10 9.6l5.4 2.2a2.8 2.8 0 0 1 1.6-.5h.2l2.4-3.5v-.1a3.8 3.8 0 1 1 3.8 3.8h-.1l-3.4 2.5v.2a2.8 2.8 0 0 1-5.6.2l-3.8-1.6A10 10 0 1 0 12 2Zm-4.3 15.2 1.2.5a2.1 2.1 0 1 0 1.2-2.8l1.3.5a1.6 1.6 0 1 1-1.2 2.9l-2.5-1.1Zm7.7-4.6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm0-.9a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Z" />
      </svg>
    );
  }

  return (
    <svg {...commun}>
      <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.7.4-1.1.7-1.4-2.2-.2-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.6 5 .4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />
    </svg>
  );
}
