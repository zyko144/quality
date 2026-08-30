import { useState } from 'react';
import { ContextMenu, type MenuEntry, type MenuPosition } from '@/components/ContextMenu';
import { Icon } from '@/components/Icon';
import { useChat } from '@/store/chat';
import { useFriends } from '@/store/friends';
import { useSession } from '@/store/session';
import { useUI } from '@/store/ui';
import { useUserAudio } from '@/store/userAudio';
import { useVoice } from '@/features/voice/useVoice';
import type { UUID } from '@/types/db';

/**
 * Curseur de volume individuel, integre dans le menu contextuel.
 *
 * Le volume va de 0 a 200 % : au-dela de 100 le gain numerique amplifie le
 * flux, ce qui peut saturer — c'est le meme compromis que Discord propose.
 */
function VolumeSlider({ userId }: { userId: UUID }) {
  const volume = useUserAudio((s) => s.getVolume(userId));
  const setVolume = useUserAudio((s) => s.setVolume);
  const [local, setLocal] = useState(volume);

  return (
    <div className="ctx-volume">
      <Icon name="volume" size={14} />
      <input
        type="range"
        className="ctx-volume__slider"
        min={0}
        max={200}
        step={1}
        value={local}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocal(v);
          setVolume(userId, v);
        }}
        aria-label="Volume de l'utilisateur"
      />
      <span className="ctx-volume__value">{local} %</span>
    </div>
  );
}

/**
 * Actions disponibles sur une personne.
 *
 * Le meme menu partout — auteur d'un message, tuile vocale, liste des membres —
 * pour que le clic droit reponde toujours la meme chose. Les entrees qui
 * n'auraient pas de sens sont retirees plutot que grisees : proposer
 * « Ajouter en ami » a quelqu'un qui l'est deja n'informe personne.
 *
 * Inspiré de Discord : voir le profil, envoyer un message, copier le pseudo,
 * régler le volume individuel, muter/démuter, ajouter/retirer en ami,
 * signaler et bloquer.
 */
export function UserContextMenu({
  userId,
  position,
  onClose,
}: {
  userId: UUID;
  position: MenuPosition;
  onClose: () => void;
}) {
  const me = useSession((state) => state.profile);
  const profiles = useChat((state) => state.profiles);
  const openDm = useChat((state) => state.openDm);

  const amis = useFriends((state) => state.friends);
  const sortants = useFriends((state) => state.outgoing);
  const bloques = useFriends((state) => state.blocked);
  const envoyer = useFriends((state) => state.sendRequest);
  const bloquer = useFriends((state) => state.block);
  const debloquer = useFriends((state) => state.unblock);
  const retirer = useFriends((state) => state.remove);

  const openModal = useUI((state) => state.openModal);
  const deconnecter = useVoice((state) => state.deconnecter);
  const salonVocal = useVoice((state) => state.channelId);
  const participants = useVoice((state) =>
    salonVocal ? state.participantsByChannel[salonVocal] : undefined,
  );

  // Presente dans MON salon vocal : c'est la seule situation ou la demande a
  // une chance d'aboutir.
  const dansMonVocal =
    userId !== me?.id && (participants ?? []).some((p) => p.user_id === userId);
  const selectChannel = useUI((state) => state.selectChannel);
  const showDirectMessages = useUI((state) => state.showDirectMessages);
  const openSettings = useUI((state) => state.openSettings);

  const userMuted = useUserAudio((s) => s.isMuted(userId));
  const toggleMute = useUserAudio((s) => s.toggleMute);

  const profil = useFriends((state) => state.profiles[userId]) ?? profiles[userId];
  const estMoi = userId === me?.id;

  const dejaAmi = amis.some((lien) => lien.user_id === userId);
  const demandeEnvoyee = sortants.some((lien) => lien.user_id === userId);
  const estBloque = bloques.some((lien) => lien.user_id === userId);

  const entrees: MenuEntry[] = [
    // ── Profil ──
    {
      id: 'profil',
      label: estMoi ? 'Mon profil' : 'Voir le profil',
      icon: <Icon name="smile" size={15} />,
      onSelect: () =>
        estMoi ? openSettings('profil') : openModal({ kind: 'profile', userId }),
    },
  ];

  if (!estMoi) {
    // ── Envoyer un message privé ──
    entrees.push({
      id: 'message',
      label: 'Envoyer un message',
      icon: <Icon name="thread" size={15} />,
      disabled: estBloque,
      onSelect: () => {
        void openDm(userId).then((salon) => {
          if (salon) {
            // Basculer sur la vue "messages privés" AVANT de sélectionner le salon,
            // sinon selectChannel ne change pas la vue et on reste dans le space.
            showDirectMessages();
            selectChannel(salon.id);
          }
        });
      },
    });
  }

  // ── Copier le pseudo ──
  if (profil) {
    entrees.push({
      id: 'copier',
      label: 'Copier le pseudo',
      icon: <Icon name="copy" size={15} />,
      onSelect: () => void navigator.clipboard.writeText(profil.username).catch(() => undefined),
    });
  }

  // ── Section audio (seulement pour les autres) ──
  if (!estMoi) {
    entrees.push({ id: 'sep-audio', separator: true });

    // Muter / Démuter l'utilisateur
    entrees.push({
      id: 'muter',
      label: userMuted ? 'Démuter' : 'Muter',
      icon: <Icon name={userMuted ? 'mic' : 'mic-off'} size={15} />,
      onSelect: () => toggleMute(userId),
    });

    // Slider de volume individuel (toujours visible, comme Discord)
    entrees.push({
      id: 'volume-slider',
      custom: <VolumeSlider userId={userId} />,
    });
  }

  // ── Section amis / blocage ──
  if (!estMoi) {
    /*
     * Deconnecter du vocal.
     *
     * N'apparait que si la personne est effectivement dans le salon ou l'on se
     * trouve : proposer l'action ailleurs reviendrait a promettre un effet qui
     * n'aurait lieu nulle part.
     */
    if (dansMonVocal) {
      entrees.push({ id: 'sep-vocal', separator: true });
      entrees.push({
        id: 'deconnecter',
        label: 'Deconnecter du vocal',
        icon: <Icon name="phone-off" size={15} />,
        danger: true,
        onSelect: () => deconnecter(userId),
      });
    }

    entrees.push({ id: 'sep-amis', separator: true });

    if (estBloque) {
      entrees.push({
        id: 'debloquer',
        label: 'Débloquer',
        icon: <Icon name="shield-off" size={15} />,
        onSelect: () => void debloquer(userId),
      });
    } else {
      if (dejaAmi) {
        entrees.push({
          id: 'retirer',
          label: 'Retirer de mes amis',
          icon: <Icon name="user-x" size={15} />,
          danger: true,
          onSelect: () => void retirer(userId),
        });
      } else if (demandeEnvoyee) {
        entrees.push({
          id: 'annuler',
          label: 'Annuler la demande',
          icon: <Icon name="x" size={15} />,
          onSelect: () => void retirer(userId),
        });
      } else if (profil) {
        entrees.push({
          id: 'ajouter',
          label: 'Ajouter en ami',
          icon: <Icon name="user-plus" size={15} />,
          onSelect: () => void envoyer(profil.username),
        });
      }

      entrees.push({ id: 'sep-danger', separator: true });

      // ── Signaler ──
      entrees.push({
        id: 'signaler',
        label: 'Signaler',
        icon: <Icon name="shield" size={15} />,
        danger: true,
        onSelect: () => openModal({ kind: 'profile', userId }),
      });

      // ── Bloquer ──
      entrees.push({
        id: 'bloquer',
        label: 'Bloquer',
        icon: <Icon name="shield" size={15} />,
        danger: true,
        onSelect: () => void bloquer(userId),
      });
    }
  }

  return (
    <ContextMenu
      position={position}
      entries={entrees}
      onClose={onClose}
      label={profil ? `Actions pour ${profil.display_name}` : 'Actions'}
    />
  );
}
