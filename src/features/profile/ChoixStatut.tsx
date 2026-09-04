import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useSession } from '@/store/session';
import type { PresenceStatus } from '@/types/db';

/**
 * Changer son etat, dans la barre du bas.
 *
 * Il y etait deja, mais SUR le nom : cliquer son pseudo ouvrait la liste des
 * etats. Or partout ailleurs, cliquer un nom montre la personne — et l'on
 * n'avait aucun moyen simple de voir sa propre fiche.
 *
 * Le nom ouvre donc la fiche, et l'etat garde sa place en bas a gauche, dans un
 * bouton a lui. Deux gestes voisins, deux boutons distincts : c'est ce qui
 * evite qu'un clic fasse la mauvaise des deux choses.
 *
 * Il a transite par la fiche de profil entre-temps, et il y encombrait : la
 * colonne de gauche porte deja un visage, un nom, des badges, un statut et une
 * carte d'ecoute. Un reglage n'a pas sa place dans une vitrine.
 *
 * Un point, pas une ligne
 * -----------------------
 * Dans la barre, il ne prend que la place d'une pastille de couleur — celle qui
 * dit deja l'etat. Le libelle ne parait qu'au survol, et la liste qu'au clic.
 */

const ETATS: readonly [PresenceStatus, string][] = [
  ['online', 'En ligne'],
  ['idle', 'Absent'],
  ['dnd', 'Ne pas deranger'],
  ['offline', 'Invisible'],
];

export function ChoixStatut() {
  const profile = useSession((etat) => etat.profile);
  const setStatus = useSession((etat) => etat.setStatus);

  const [ouvert, setOuvert] = useState(false);
  const boite = useRef<HTMLDivElement>(null);

  /*
   * Un clic ailleurs referme.
   *
   * Sans cela, le menu reste ouvert derriere ce qu'on fait ensuite — et sur une
   * fiche, ce qu'on fait ensuite est souvent de la fermer, ce qui laisserait le
   * menu ouvert a la prochaine ouverture.
   */
  useEffect(() => {
    if (!ouvert) return;

    const dehors = (event: MouseEvent) => {
      if (!boite.current?.contains(event.target as Node)) setOuvert(false);
    };

    const echap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOuvert(false);
    };

    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', echap);

    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('keydown', echap);
    };
  }, [ouvert]);

  if (!profile) return null;

  const courant = ETATS.find(([valeur]) => valeur === profile.status);

  return (
    <div className="choix-statut" ref={boite}>
      <button
        type="button"
        className="icon-btn choix-statut__bouton"
        onClick={() => setOuvert((etat) => !etat)}
        aria-expanded={ouvert}
        aria-haspopup="menu"
        aria-label={`Mon etat : ${courant?.[1] ?? 'En ligne'}. Changer.`}
        title={`Mon etat : ${courant?.[1] ?? 'En ligne'}`}
      >
        <span className={`status-dot status-dot--${profile.status}`} aria-hidden="true" />
      </button>

      {ouvert ? (
        <div className="choix-statut__menu surface" role="menu">
          {ETATS.map(([valeur, libelle]) => (
            <button
              type="button"
              key={valeur}
              className="choix-statut__item"
              role="menuitem"
              onClick={() => {
                /*
                 * L'etat personnalise est conserve.
                 *
                 * `setStatus` prend un second argument, et l'omettre l'efface :
                 * passer « ne pas deranger » aurait supprime la phrase qu'on
                 * venait d'ecrire, sans que rien ne le laisse prevoir.
                 */
                void setStatus(valeur, profile.custom_status);
                setOuvert(false);
              }}
            >
              <span className={`status-dot status-dot--${valeur}`} aria-hidden="true" />
              {libelle}
              {profile.status === valeur ? <Icon name="check" size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
