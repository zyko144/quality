import { useEffect } from 'react';
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

  useEffect(() => {
    void loadSpace(spaceId);
  }, [spaceId, loadSpace]);

  const liste = roles ?? [];
  const portes = new Set(memberRoles ?? []);

  if (liste.length === 0) return null;

  return (
    <section className="membre-roles">
      <h3 className="profile__section-title">Roles</h3>

      <ul className="membre-roles__liste">
        {liste.map((role) => {
          const porte = portes.has(role.id);

          return (
            <li key={role.id}>
              <button
                type="button"
                className={'membre-role' + (porte ? ' is-porte' : '')}
                style={porte ? { borderColor: role.color, color: role.color } : undefined}
                disabled={!peutModifier}
                onClick={() => void toggleMemberRole(spaceId, userId, role.id)}
                aria-pressed={porte}
                title={
                  peutModifier
                    ? porte
                      ? `Retirer « ${role.name} »`
                      : `Attribuer « ${role.name} »`
                    : role.name
                }
              >
                <span
                  className="membre-role__pastille"
                  style={{ background: role.color }}
                  aria-hidden="true"
                />
                {role.name}
                {peutModifier ? (
                  <Icon name={porte ? 'x' : 'plus'} size={12} />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
