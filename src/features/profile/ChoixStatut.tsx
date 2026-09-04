import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useSession } from '@/store/session';
import type { PresenceStatus } from '@/types/db';

/**
 * Changer son etat, depuis sa propre fiche.
 *
 * Il vivait dans la barre du bas : cliquer son nom ouvrait une liste de quatre
 * etats. Utile, mais ce n'est pas ce qu'un nom promet — partout ailleurs,
 * cliquer un nom montre la personne — et l'on n'avait aucun moyen simple de
 * voir sa propre fiche.
 *
 * Le nom ouvre donc la fiche, et l'etat se change ici, contre la photo, la ou
 * l'anneau de couleur le montre deja. Le reglage est a cote de ce qu'il regle.
 *
 * Une pastille, pas une ligne
 * ---------------------------
 * Elle ne prend que la place de son libelle, et le menu ne parait qu'au clic.
 * Quatre boutons poses en permanence auraient pousse le nom, les badges et le
 * statut vers le bas — pour un reglage qu'on touche une fois par jour.
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
        className="choix-statut__pastille"
        onClick={() => setOuvert((etat) => !etat)}
        aria-expanded={ouvert}
        aria-haspopup="menu"
        title="Changer mon etat"
      >
        <span className={`status-dot status-dot--${profile.status}`} aria-hidden="true" />
        <span>{courant?.[1] ?? 'En ligne'}</span>
        <Icon name="chevron-down" size={12} aria-hidden="true" />
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
