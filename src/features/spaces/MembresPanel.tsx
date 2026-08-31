import { useMemo, useState } from 'react';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { useUI } from '@/store/ui';
import { useRoles } from '@/store/roles';
import { useVoice } from '@/features/voice/useVoice';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import type { SpaceRole, UUID } from '@/types/db';

/**
 * Les membres d'un serveur, en une liste qu'on peut fouiller.
 *
 * La fiche d'une personne repond a « qui est-ce ? ». Cette liste repond a une
 * autre question — « qui est la, et que portent-ils ? » — a laquelle on ne
 * pouvait repondre qu'en ouvrant les fiches une par une.
 *
 * Les filtres tiennent en une ligne parce qu'ils repondent aux trois questions
 * qu'on se pose vraiment : qui est connecte, qui n'a aucun role, qui discute en
 * ce moment.
 */

type Filtre = 'tous' | 'en-ligne' | 'sans-role' | 'en-vocal';

/** Ordre d'autorite, pour trier. Les noms seuls ne se comparent pas. */
const POIDS: Record<SpaceRole, number> = { owner: 3, admin: 2, moderator: 1, member: 0 };

export function MembresPanel({ spaceId, peutGerer }: { spaceId: UUID; peutGerer: boolean }) {
  const members = useChat((state) => state.members);
  const profiles = useChat((state) => state.profiles);
  const channels = useChat((state) => state.channels);
  const openModal = useUI((state) => state.openModal);
  const moi = useSession((state) => state.profile);

  const roles = useRoles((state) => state.roles[spaceId]);
  const memberRoles = useRoles((state) => state.memberRoles);
  const participantsParSalon = useVoice((state) => state.participantsByChannel);

  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('tous');

  /** Qui discute, dans n'importe quel salon vocal de ce serveur. */
  const enVocal = useMemo(() => {
    const ids = new Set<UUID>();
    for (const channel of channels) {
      if (channel.space_id !== spaceId || channel.kind !== 'voice') continue;
      for (const p of participantsParSalon[channel.id] ?? []) ids.add(p.user_id);
    }
    return ids;
  }, [channels, participantsParSalon, spaceId]);

  const liste = useMemo(() => {
    const terme = recherche.trim().toLowerCase();

    return members
      .filter((membre) => membre.space_id === spaceId)
      .map((membre) => ({
        membre,
        profil: profiles[membre.user_id],
        portes: memberRoles[`${spaceId}:${membre.user_id}`] ?? [],
      }))
      .filter(({ membre, profil, portes }) => {
        if (filtre === 'en-ligne' && (profil?.status ?? 'offline') === 'offline') return false;
        if (filtre === 'sans-role' && portes.length > 0) return false;
        if (filtre === 'en-vocal' && !enVocal.has(membre.user_id)) return false;

        if (!terme) return true;
        const nom = (profil?.display_name ?? '') + ' ' + (profil?.username ?? '');
        return nom.toLowerCase().includes(terme);
      })
      .sort((a, b) => {
        // Le rang d'abord : on cherche presque toujours quelqu'un qui decide.
        const ecart = POIDS[b.membre.role] - POIDS[a.membre.role];
        if (ecart !== 0) return ecart;
        return (a.profil?.display_name ?? '').localeCompare(b.profil?.display_name ?? '');
      });
  }, [members, profiles, memberRoles, spaceId, recherche, filtre, enVocal]);

  const rangs: Record<SpaceRole, string> = {
    owner: 'Proprietaire',
    admin: 'Admin',
    moderator: 'Moderateur',
    member: 'Membre',
  };

  return (
    <section className="membres">
      <div className="membres__barre">
        <label className="membres__recherche">
          <Icon name="search" size={15} />
          <input
            className="input"
            type="search"
            value={recherche}
            onChange={(event) => setRecherche(event.target.value)}
            placeholder="Chercher un membre"
            aria-label="Chercher un membre"
          />
        </label>

        <div className="membres__filtres" role="group" aria-label="Filtrer">
          {(
            [
              ['tous', 'Tous'],
              ['en-ligne', 'En ligne'],
              ['en-vocal', 'En vocal'],
              ['sans-role', 'Sans role'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={'chip' + (filtre === id ? ' is-active' : '')}
              aria-pressed={filtre === id}
              onClick={() => setFiltre(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="settings__hint">
        {liste.length} membre{liste.length > 1 ? 's' : ''}
        {filtre !== 'tous' ? ' pour ce filtre' : ' dans cet espace'}.
      </p>

      {liste.length === 0 ? (
        <p className="roles__vide">Personne ne correspond.</p>
      ) : (
        <ul className="membres__liste">
          {liste.map(({ membre, profil, portes }) => {
            const roleNoms = (roles ?? []).filter((role) => portes.includes(role.id));

            return (
              <li key={membre.user_id} className="membres__ligne">
                <button
                  type="button"
                  className="membres__identite"
                  onClick={() => openModal({ kind: 'profile', userId: membre.user_id })}
                  title={`Voir le profil de ${profil?.display_name ?? 'ce membre'}`}
                >
                  <Avatar profile={profil} size={32} status={profil?.status} showStatus />
                  <span className="membres__noms">
                    <span className="membres__nom truncate">
                      {membre.nickname ?? profil?.display_name ?? 'Quelqu’un'}
                      {membre.user_id === moi?.id ? ' (vous)' : ''}
                    </span>
                    <span className="membres__handle truncate">@{profil?.username ?? '…'}</span>
                  </span>
                </button>

                <span className="membres__marques">
                  {enVocal.has(membre.user_id) ? (
                    <span className="chip chip--sm" title="En vocal">
                      <Icon name="volume" size={11} />
                    </span>
                  ) : null}

                  {roleNoms.slice(0, 3).map((role) => (
                    <span
                      key={role.id}
                      className="chip chip--sm"
                      style={{ borderColor: role.color, color: role.color }}
                    >
                      {role.name}
                    </span>
                  ))}
                  {roleNoms.length > 3 ? (
                    <span className="chip chip--sm">+{roleNoms.length - 3}</span>
                  ) : null}

                  <span className="membres__rang">{rangs[membre.role]}</span>
                </span>

                {peutGerer ? (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => openModal({ kind: 'profile', userId: membre.user_id })}
                    title="Gerer les roles de ce membre"
                  >
                    <Icon name="shield" size={14} />
                    Roles
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
