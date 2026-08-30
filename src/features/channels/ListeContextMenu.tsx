import { ContextMenu, type MenuEntry, type MenuPosition } from '@/components/ContextMenu';
import { Icon } from '@/components/Icon';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import type { UUID } from '@/types/db';

/**
 * Actions sur la liste des salons, au clic droit dans le vide.
 *
 * Creer un salon demandait de viser un « + » qui n'apparait qu'au survol d'une
 * categorie. Le fond de la liste, lui, fait plusieurs centaines de pixels de
 * haut et ne servait a rien : c'est la cible la plus facile de la colonne.
 *
 * Le menu ne s'ouvre que pour qui peut administrer. Le proposer aux autres
 * afficherait quatre entrees grisees, ce qui informe moins que rien.
 */

export function ListeContextMenu({
  spaceId,
  position,
  onClose,
}: {
  spaceId: UUID;
  position: MenuPosition;
  onClose: () => void;
}) {
  const openModal = useUI((state) => state.openModal);
  const channels = useChat((state) => state.channels);
  const markRead = useChat((state) => state.markRead);
  const readStates = useChat((state) => state.readStates);

  const salons = channels.filter((channel) => channel.space_id === spaceId);
  const nonLus = salons.reduce(
    (total, channel) => total + (readStates[channel.id]?.unread_count ?? 0),
    0,
  );

  const entrees: MenuEntry[] = [
    {
      id: 'salon',
      label: 'Creer un salon',
      icon: <Icon name="hash" size={15} />,
      onSelect: () => openModal({ kind: 'create-channel', spaceId }),
    },
    {
      id: 'categorie',
      label: 'Creer une categorie',
      icon: <Icon name="inbox" size={15} />,
      // Les categories se gerent dans les reglages : elles n'ont ni sujet ni
      // permissions propres, et une boite dediee pour un seul champ ferait une
      // fenetre de plus a fermer.
      onSelect: () => openModal({ kind: 'space-settings', spaceId }),
    },

    { id: 'sep-lecture', separator: true },

    {
      id: 'lu',
      label: 'Tout marquer comme lu',
      icon: <Icon name="check-circle" size={15} />,
      disabled: nonLus === 0,
      onSelect: () => {
        for (const channel of salons) void markRead(channel.id);
      },
    },
    {
      id: 'inviter',
      label: 'Inviter des personnes',
      icon: <Icon name="user-plus" size={15} />,
      onSelect: () => openModal({ kind: 'invite', spaceId }),
    },

    { id: 'sep-reglages', separator: true },

    {
      id: 'reglages',
      label: "Parametres de l'espace",
      icon: <Icon name="settings" size={15} />,
      onSelect: () => openModal({ kind: 'space-settings', spaceId }),
    },
  ];

  return (
    <ContextMenu
      position={position}
      entries={entrees}
      onClose={onClose}
      label="Actions sur la liste des salons"
    />
  );
}
