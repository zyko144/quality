import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import type { Activite } from '@/store/comptesLies';

/**
 * Ce que quelqu'un ecoute, en une carte.
 *
 * La barre avance sans que rien ne soit republie
 * ----------------------------------------------
 * C'est le point qui decide de toute la conception. L'annonce ne porte pas une
 * position mais l'INSTANT OU LE MORCEAU A COMMENCE, plus sa duree. Le temps
 * ecoule se deduit donc de l'horloge de celui qui REGARDE : la barre avance
 * chez lui, seconde par seconde, sans qu'un seul message ne circule.
 *
 * Republier la position aurait coute une ecriture toutes les dix secondes par
 * personne, diffusee a tous ceux qui ont la fiche ouverte — pour une barre qui
 * avance toute seule si on lui donne un point de depart.
 *
 * Ce que la carte ne pretend pas savoir
 * -------------------------------------
 * Windows donne un titre et un artiste, jamais une adresse. Le lien est donc
 * une recherche, et seulement quand le lecteur est reconnu : deviner une
 * adresse Spotify pour un fichier local menerait souvent ailleurs. Sans lien,
 * la carte reste une carte — elle ne fait simplement rien au clic.
 */

/** Un temps en millisecondes, ecrit comme sur un lecteur. */
function horloge(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const secondes = total % 60;
  return `${minutes}:${String(secondes).padStart(2, '0')}`;
}

export function CarteEcoute({
  activite,
  /** Proposer d'ecouter avec la personne. Absent sur sa propre fiche. */
  onInviter,
}: {
  activite: Activite;
  onInviter?: (activite: Activite) => void;
}) {
  const debut = activite.debut_le ? Date.parse(activite.debut_le) : Number.NaN;
  const duree = activite.duree_ms ?? 0;
  const chronometre = Number.isFinite(debut) && duree > 0;

  const [ecoule, setEcoule] = useState(() => (chronometre ? Date.now() - debut : 0));

  /*
   * Une seconde, et seulement si l'on a de quoi compter.
   *
   * Sans duree connue il n'y a pas de barre a remplir : la minuterie ne
   * servirait qu'a redessiner une carte immobile, dans chaque fiche ouverte.
   */
  useEffect(() => {
    if (!chronometre) return;

    const battement = window.setInterval(() => setEcoule(Date.now() - debut), 1000);
    return () => window.clearInterval(battement);
  }, [chronometre, debut]);

  const avance = chronometre ? Math.min(1, Math.max(0, ecoule / duree)) : 0;

  const genre =
    activite.genre === 'ecoute' ? 'Ecoute' : activite.genre === 'direct' ? 'En direct' : 'Joue a';

  const contenu = (
    <>
      <span className="ecoute__pochette" aria-hidden="true">
        {activite.image_url ? (
          <img src={activite.image_url} alt="" />
        ) : (
          <Icon name="volume" size={18} />
        )}
      </span>

      <span className="ecoute__corps">
        <span className="ecoute__source">
          {genre}
          {activite.service ? ` sur ${activite.service}` : ''}
        </span>

        <span className="ecoute__titre truncate">{activite.titre}</span>
        {activite.detail ? <span className="ecoute__artiste truncate">{activite.detail}</span> : null}

        {/*
          La barre et les deux temps.

          Cachee aux lecteurs d'ecran : elle redit ce que les chiffres a cote
          disent deja, et une barre annoncee a chaque seconde rendrait la carte
          insupportable a l'ecoute.
        */}
        {chronometre ? (
          <span className="ecoute__temps" aria-hidden="true">
            <span className="ecoute__barre">
              <span className="ecoute__barre-avance" style={{ transform: `scaleX(${avance})` }} />
            </span>
            <span className="ecoute__chiffres">
              {horloge(ecoule)} / {horloge(duree)}
            </span>
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <div className="ecoute">
      {activite.lien_url ? (
        <a
          className="ecoute__lien lien-carte"
          href={activite.lien_url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Ouvrir « ${activite.titre} »`}
        >
          {contenu}
        </a>
      ) : (
        <div className="ecoute__lien">{contenu}</div>
      )}

      {/*
        « Ecouter avec » envoie le morceau en message prive.

        Ce n'est pas une lecture synchronisee, et le libelle ne le promet pas :
        commander le lecteur de quelqu'un d'autre demanderait justement la
        liaison OAuth qu'on a evitee. Envoyer le morceau est ce qu'on ferait a
        la main, en un geste au lieu de quatre.
      */}
      {onInviter && activite.lien_url ? (
        <button
          type="button"
          className="ecoute__inviter"
          onClick={() => onInviter(activite)}
        >
          <Icon name="send" size={13} />
          Ecouter avec
        </button>
      ) : null}
    </div>
  );
}
