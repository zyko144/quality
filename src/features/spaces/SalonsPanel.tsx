import { useMemo, useState } from 'react';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { Icon } from '@/components/Icon';
import type { Channel, UUID } from '@/types/db';

/**
 * Les salons du serveur, tous visibles d'un coup.
 *
 * La barre laterale sert a naviguer, pas a ranger : elle montre les salons
 * dans leur categorie, un ecran a la fois. Pour reordonner une liste, il faut
 * la voir en entier — c'est ce que fait ce tableau.
 *
 * Les fleches font le meme travail que le glisser-deposer de la barre
 * laterale. Elles ne sont pas un repli pour l'accessibilite : deplacer un salon
 * de dix rangs a la souris demande dix gestes precis, deux clics ici.
 */
export function SalonsPanel({ spaceId }: { spaceId: UUID }) {
  const channels = useChat((state) => state.channels);
  const categories = useChat((state) => state.categories);
  const renameChannel = useChat((state) => state.renameChannel);
  const reorderChannels = useChat((state) => state.reorderChannels);
  const deleteChannel = useChat((state) => state.deleteChannel);
  const openModal = useUI((state) => state.openModal);

  const [renomme, setRenomme] = useState<{ id: UUID; nom: string } | null>(null);
  const [aSupprimer, setASupprimer] = useState<Channel | null>(null);
  const [occupe, setOccupe] = useState(false);

  const liste = useMemo(
    () =>
      channels
        .filter((channel) => channel.space_id === spaceId)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [channels, spaceId],
  );

  const nomCategorie = (id: UUID | null) =>
    id ? (categories.find((categorie) => categorie.id === id)?.name ?? '—') : 'Sans categorie';

  const deplacer = async (index: number, sens: -1 | 1) => {
    const cible = index + sens;
    if (cible < 0 || cible >= liste.length || occupe) return;

    const ordre = liste.map((channel) => channel.id);
    const [retire] = ordre.splice(index, 1);
    ordre.splice(cible, 0, retire!);

    setOccupe(true);
    await reorderChannels(spaceId, ordre);
    setOccupe(false);
  };

  const valider = async () => {
    if (!renomme || !renomme.nom.trim()) return;
    setOccupe(true);
    await renameChannel(renomme.id, renomme.nom.trim());
    setOccupe(false);
    setRenomme(null);
  };

  return (
    <div className="mod-section">
      <div className="salons__entete">
        <p className="settings__hint">
          {liste.length} salon{liste.length > 1 ? 's' : ''}. L&rsquo;ordre est celui de la
          barre laterale.
        </p>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={() => openModal({ kind: 'create-channel', spaceId })}
        >
          <Icon name="plus" size={14} />
          Nouveau salon
        </button>
      </div>

      {aSupprimer ? (
        <div className="mod-error" role="alert">
          <span>
            Supprimer #{aSupprimer.name} ? Les messages disparaissent avec le salon.
          </span>
          <button type="button" className="btn btn--sm" onClick={() => setASupprimer(null)}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => {
              const cible = aSupprimer;
              setASupprimer(null);
              void deleteChannel(cible.id);
            }}
          >
            Supprimer
          </button>
        </div>
      ) : null}

      <ul className="salons__liste">
        {liste.map((channel, index) => (
          <li key={channel.id} className="salons__ligne">
            <Icon name={channel.kind === 'voice' ? 'volume' : 'hash'} size={15} />

            {renomme?.id === channel.id ? (
              <input
                className="input salons__champ"
                value={renomme.nom}
                autoFocus
                onChange={(event) => setRenomme({ id: channel.id, nom: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void valider();
                  if (event.key === 'Escape') setRenomme(null);
                }}
                onBlur={() => void valider()}
                aria-label={`Nom du salon ${channel.name}`}
              />
            ) : (
              <button
                type="button"
                className="salons__nom truncate"
                onClick={() => setRenomme({ id: channel.id, nom: channel.name })}
                title="Renommer"
              >
                {channel.name}
              </button>
            )}

            <span className="salons__categorie truncate">{nomCategorie(channel.category_id)}</span>

            <span className="salons__actions">
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                disabled={index === 0 || occupe}
                onClick={() => void deplacer(index, -1)}
                title="Monter"
                aria-label={`Monter ${channel.name}`}
              >
                <Icon name="chevron-up" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                disabled={index === liste.length - 1 || occupe}
                onClick={() => void deplacer(index, 1)}
                title="Descendre"
                aria-label={`Descendre ${channel.name}`}
              >
                <Icon name="chevron-down" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                onClick={() => openModal({ kind: 'channel-settings', channelId: channel.id })}
                title="Reglages"
                aria-label={`Reglages de ${channel.name}`}
              >
                <Icon name="settings" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--sm icon-btn--danger"
                onClick={() => setASupprimer(channel)}
                title="Supprimer"
                aria-label={`Supprimer ${channel.name}`}
              >
                <Icon name="trash" size={14} />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
