import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRoles } from '@/store/roles';
import type { UUID } from '@/types/db';

/**
 * Roles d'une personne dans un espace, modifiables depuis sa fiche.
 *
 * C'est la qu'on se pose la question — on regarde quelqu'un, on decide de lui
 * confier quelque chose. Passer par les reglages de l'espace obligerait a
 * quitter la fiche, retrouver la personne dans une seconde liste, et revenir.
 *
 * La fiche ne montre que ce que la personne PORTE, plus un bouton pour
 * ajouter. Auparavant elle listait tous les roles de l'espace, portes ou non,
 * chacun servant d'interrupteur : sur un serveur qui en compte quinze, il
 * fallait les lire tous pour repondre a « qu'est-ce qu'il a, lui ? », qui est
 * la seule question qu'on se pose en ouvrant une fiche.
 *
 * Sans droit d'administration, la liste reste affichee mais figee : savoir ce
 * que porte quelqu'un est utile a tout le monde ; le changer ne l'est pas.
 */

export function MemberRoles({
  spaceId,
  userId,
  peutModifier,
}: {
  spaceId: UUID;
  userId: UUID;
  peutModifier: boolean;
}) {
  const loadSpace = useRoles((state) => state.loadSpace);
  const roles = useRoles((state) => state.roles[spaceId]);
  const memberRoles = useRoles((state) => state.memberRoles[`${spaceId}:${userId}`]);
  const toggleMemberRole = useRoles((state) => state.toggleMemberRole);

  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadSpace(spaceId);
  }, [spaceId, loadSpace]);

  // Un clic ailleurs referme : c'est ce qu'on tente quand on a change d'avis,
  // avant meme de chercher une croix.
  useEffect(() => {
    if (!ouvert) return;

    const dehors = (event: MouseEvent) => {
      if (!zone.current?.contains(event.target as Node)) setOuvert(false);
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

  const liste = roles ?? [];
  if (liste.length === 0) return null;

  const portes = new Set(memberRoles ?? []);

  /*
   * Du plus haut au plus bas.
   *
   * `position` est deja l'echelle d'autorite de l'espace — c'est elle qui
   * decide qui peut moderer qui. Trier dessus, et non par ordre alphabetique,
   * fait remonter les roles qui engagent quelque chose : on veut voir
   * « Administrateur » avant « Amateur de chats ».
   */
  const parRang = [...liste].sort((a, b) => b.position - a.position);
  const attribues = parRang.filter((role) => portes.has(role.id));
  const disponibles = parRang.filter((role) => !portes.has(role.id));

  return (
    <section className="membre-roles">
      <h3 className="profile__section-title">Roles</h3>

      <div className="membre-roles__zone" ref={zone}>
        <ul className="membre-roles__liste">
          {attribues.map((role) => (
            <li key={role.id}>
              <button
                type="button"
                className="membre-role is-porte"
                style={{ borderColor: role.color, color: role.color }}
                disabled={!peutModifier}
                onClick={() => void toggleMemberRole(spaceId, userId, role.id)}
                title={peutModifier ? `Retirer « ${role.name} »` : role.name}
              >
                <span
                  className="membre-role__pastille"
                  style={{ background: role.color }}
                  aria-hidden="true"
                />
                {role.name}
                {peutModifier ? <Icon name="x" size={12} /> : null}
              </button>
            </li>
          ))}

          {attribues.length === 0 && !peutModifier ? (
            <li className="membre-roles__aucun">Aucun role</li>
          ) : null}

          {peutModifier && disponibles.length > 0 ? (
            <li>
              <button
                type="button"
                className="membre-role membre-role--ajouter"
                onClick={() => setOuvert((etat) => !etat)}
                aria-expanded={ouvert}
                aria-haspopup="listbox"
              >
                <Icon name="plus" size={13} />
                Ajouter un role
              </button>
            </li>
          ) : null}
        </ul>

        {ouvert ? (
          <ul className="membre-roles__menu" role="listbox" aria-label="Roles disponibles">
            {disponibles.map((role) => (
              <li key={role.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="membre-roles__option"
                  onClick={() => {
                    void toggleMemberRole(spaceId, userId, role.id);
                    // Le menu reste ouvert : on en attribue souvent deux ou
                    // trois d'affilee, et le refermer a chaque fois obligerait
                    // a le rouvrir autant.
                  }}
                >
                  <span
                    className="membre-role__pastille"
                    style={{ background: role.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{role.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
