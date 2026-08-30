import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { ModerationPanel } from '@/features/moderation/ModerationPanel';
import { ReportModal } from '@/features/moderation/ReportModal';
import { PollComposer } from '@/features/polls/PollComposer';
import { BookmarksModal } from '@/features/bookmarks/BookmarksModal';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { ProfileEditor } from '@/features/profile/ProfileEditor';
import { NewDmModal } from '@/features/dm/NewDmModal';
import { SpaceSettings } from '@/features/spaces/SpaceSettings';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { useUI } from '@/store/ui';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { useFriends } from '@/store/friends';
import { supabase } from '@/lib/supabase';
import type { UUID } from '@/types/db';
import { LIMITS } from '@/constants';

/** Point d'entree unique : affiche la boite de dialogue demandee par l'etat. */
export function Modals() {
  const modal = useUI((state) => state.modal);
  const closeModal = useUI((state) => state.closeModal);

  return (
    <>
      <CreateSpaceModal open={modal.kind === 'create-space'} onClose={closeModal} />
      <JoinSpaceModal open={modal.kind === 'join-space'} onClose={closeModal} />
      <CreateChannelModal
        open={modal.kind === 'create-channel'}
        spaceId={modal.kind === 'create-channel' ? modal.spaceId : null}
        onClose={closeModal}
      />
      <InviteModal
        open={modal.kind === 'invite'}
        spaceId={modal.kind === 'invite' ? modal.spaceId : null}
        onClose={closeModal}
      />
      <ProfileModal
        open={modal.kind === 'profile'}
        userId={modal.kind === 'profile' ? modal.userId : null}
        onClose={closeModal}
      />
      <ModerationPanel
        open={modal.kind === 'moderation'}
        spaceId={modal.kind === 'moderation' ? modal.spaceId : null}
        onClose={closeModal}
      />
      <ReportModal
        open={modal.kind === 'report'}
        messageId={modal.kind === 'report' ? modal.messageId : null}
        onClose={closeModal}
      />
      <PollComposer
        open={modal.kind === 'poll'}
        channelId={modal.kind === 'poll' ? modal.channelId : null}
        threadId={modal.kind === 'poll' ? modal.threadId : null}
        onClose={closeModal}
      />
      <ChannelSettingsModal
        open={modal.kind === 'channel-settings'}
        channelId={modal.kind === 'channel-settings' ? modal.channelId : null}
        onClose={closeModal}
      />
      <BookmarksModal open={modal.kind === 'bookmarks'} onClose={closeModal} />
      <ProfileEditor open={modal.kind === 'edit-profile'} onClose={closeModal} />
      <NewDmModal open={modal.kind === 'new-dm'} onClose={closeModal} />
      <SpaceSettings
        open={modal.kind === 'space-settings'}
        spaceId={modal.kind === 'space-settings' ? modal.spaceId : null}
        onClose={closeModal}
      />
    </>
  );
}

/* ========================================================================== */
/* Creation d'espace                                                          */
/* ========================================================================== */

function CreateSpaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createSpace = useChat((state) => state.createSpace);
  const selectSpace = useUI((state) => state.selectSpace);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const space = await createSpace(name.trim(), description.trim() || undefined);
    setBusy(false);
    if (space) {
      selectSpace(space.id);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      title="Creer un espace"
      description="Un espace regroupe des salons et des personnes."
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!name.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? <span className="spinner" /> : null}
            Creer
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="space-name">
          Nom
        </label>
        <input
          id="space-name"
          className="input"
          value={name}
          maxLength={LIMITS.spaceNameLength}
          placeholder="Equipe produit"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="space-description">
          Description
        </label>
        <input
          id="space-description"
          className="input"
          value={description}
          maxLength={280}
          placeholder="Facultatif"
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <p className="field__hint">
        Un salon <strong>#general</strong> et un salon vocal sont crees automatiquement.
      </p>
    </Modal>
  );
}

/* ========================================================================== */
/* Rejoindre un espace                                                        */
/* ========================================================================== */

function JoinSpaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const joinSpace = useChat((state) => state.joinSpace);
  const selectSpace = useUI((state) => state.selectSpace);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) {
      setCode('');
      setFailed(false);
    }
  }, [open]);

  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setFailed(false);
    const space = await joinSpace(code.trim());
    setBusy(false);

    if (space) {
      selectSpace(space.id);
      onClose();
    } else {
      setFailed(true);
    }
  };

  return (
    <Modal
      open={open}
      title="Rejoindre un espace"
      description="Collez le code d’invitation qu’on vous a transmis."
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!code.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? <span className="spinner" /> : null}
            Rejoindre
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="invite-code">
          Code d’invitation
        </label>
        <input
          id="invite-code"
          className="input"
          value={code}
          placeholder="a1b2c3d4e5f6"
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
          autoComplete="off"
          spellCheck={false}
        />
        {failed ? (
          <p className="field__error">Ce code ne correspond a aucun espace.</p>
        ) : null}
      </div>
    </Modal>
  );
}

/* ========================================================================== */
/* Creation de salon                                                          */
/* ========================================================================== */

function CreateChannelModal({
  open,
  spaceId,
  onClose,
}: {
  open: boolean;
  spaceId: string | null;
  onClose: () => void;
}) {
  const createChannel = useChat((state) => state.createChannel);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<'text' | 'voice'>('text');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setKind('text');
    }
  }, [open]);

  const submit = async () => {
    if (!spaceId || !name.trim() || busy) return;
    setBusy(true);
    // Un nom de salon textuel suit la convention en minuscules avec tirets, ce
    // qui rend les references `#salon` previsibles.
    const clean =
      kind === 'text'
        ? name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
        : name.trim();
    await createChannel(spaceId, clean || 'salon', kind);
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Nouveau salon"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!name.trim() || busy}
            onClick={() => void submit()}
          >
            Creer
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field__label">Type</span>
        <div className="segmented">
          <button
            type="button"
            className={'segmented__item' + (kind === 'text' ? ' is-active' : '')}
            onClick={() => setKind('text')}
          >
            <Icon name="hash" size={15} />
            Texte
          </button>
          <button
            type="button"
            className={'segmented__item' + (kind === 'voice' ? ' is-active' : '')}
            onClick={() => setKind('voice')}
          >
            <Icon name="volume" size={15} />
            Vocal
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="channel-name">
          Nom
        </label>
        <input
          id="channel-name"
          className="input"
          value={name}
          maxLength={LIMITS.channelNameLength}
          placeholder={kind === 'text' ? 'annonces' : 'Salon vocal'}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
        />
      </div>
    </Modal>
  );
}

/* ========================================================================== */
/* Invitation                                                                 */
/* ========================================================================== */

function InviteModal({
  open,
  spaceId,
  onClose,
}: {
  open: boolean;
  spaceId: string | null;
  onClose: () => void;
}) {
  const spaces = useChat((state) => state.spaces);
  const openDm = useChat((state) => state.openDm);
  const sendMessage = useChat((state) => state.sendMessage);
  const friends = useFriends((state) => state.friends);
  const friendProfiles = useFriends((state) => state.profiles);
  const space = spaces.find((item) => item.id === spaceId) ?? null;

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [invitedFriends, setInvitedFriends] = useState<Record<string, boolean>>({});
  const [searchFriend, setSearchFriend] = useState('');

  useEffect(() => {
    if (open) {
      setCopiedCode(false);
      setCopiedLink(false);
      setInvitedFriends({});
      setSearchFriend('');
      setCode(space?.invite_code ?? null);
    }
  }, [open, space?.invite_code]);

  const inviteLink = code ? `${window.location.origin}/invite/${code}` : '';

  const copy = async (text: string, isLink: boolean) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (isLink) {
        setCopiedLink(true);
        window.setTimeout(() => setCopiedLink(false), 2000);
      } else {
        setCopiedCode(true);
        window.setTimeout(() => setCopiedCode(false), 2000);
      }
    } catch {}
  };

  const rotate = async () => {
    if (!spaceId) return;
    setRotating(true);
    const { data } = await supabase.rpc('rotate_invite_code', { p_space_id: spaceId });
    setRotating(false);
    if (typeof data === 'string') setCode(data);
  };

  const inviteFriendDirect = async (friendId: string) => {
    if (!code || !space) return;
    setInvitedFriends((prev) => ({ ...prev, [friendId]: true }));
    try {
      const dmChannel = await openDm(friendId);
      const currentUserId = useSession.getState().session?.user.id;
      if (dmChannel && currentUserId) {
        await sendMessage({
          channelId: dmChannel.id,
          authorId: currentUserId,
          content: `👋 Salut ! Je t'invite à rejoindre mon serveur **${space.name}** !\nCode d'invitation : \`${code}\`\nLien direct : ${inviteLink}`,
        });
      }
    } catch (e) {
      console.warn('Invite error:', e);
    }
  };

  const filteredFriends = friends.filter((f) => {
    const p = friendProfiles[f.user_id];
    if (!p) return true;
    if (!searchFriend.trim()) return true;
    const q = searchFriend.toLowerCase();
    return p.display_name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q);
  });

  return (
    <Modal
      open={open}
      title="Inviter des amis"
      description={`Partagez ce serveur ou invitez directement vos amis en un clic.`}
      onClose={onClose}
    >
      {/* Carte visuelle du serveur */}
      <div className="invite-server-card">
        {space?.banner_url ? (
          <img src={space.banner_url} alt="Bannière" className="invite-server-card__banner" />
        ) : (
          <div className="invite-server-card__banner-placeholder" />
        )}
        <div className="invite-server-card__content">
          <div className="invite-server-card__icon">
            {space?.icon_url ? (
              <img src={space.icon_url} alt={space.name} />
            ) : (
              <span>{space?.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="invite-server-card__info">
            <h3 className="invite-server-card__name">{space?.name ?? 'Serveur'}</h3>
            <p className="invite-server-card__desc">
              {space?.description || 'Serveur communautaire Quality'}
            </p>
          </div>
        </div>
      </div>

      {/* Inviter directement un ami */}
      {friends.length > 0 ? (
        <div className="invite-friends-section">
          <div className="field">
            <label className="field__label" htmlFor="search-invite-friends">
              Inviter directement un ami ({friends.length})
            </label>
            <div className="invite-search-wrap">
              <input
                id="search-invite-friends"
                type="text"
                className="input input--sm"
                placeholder="Rechercher un ami..."
                value={searchFriend}
                onChange={(e) => setSearchFriend(e.target.value)}
              />
            </div>
          </div>

          <ul className="invite-friends-list">
            {filteredFriends.map((friend) => {
              const profile = friendProfiles[friend.user_id];
              const wasInvited = invitedFriends[friend.user_id];
              return (
                <li key={friend.user_id} className="invite-friend-item">
                  <div className="invite-friend-item__left">
                    <Avatar profile={profile} size={32} />
                    <span className="invite-friend-item__name">
                      {profile?.display_name ?? 'Ami'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`btn btn--sm ${wasInvited ? 'btn--ghost' : 'btn--primary'}`}
                    onClick={() => void inviteFriendDirect(friend.user_id)}
                    disabled={wasInvited}
                  >
                    {wasInvited ? (
                      <>
                        <Icon name="check" size={13} />
                        Envoyé
                      </>
                    ) : (
                      'Inviter'
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Lien d'invitation */}
      <div className="field" style={{ marginTop: 'var(--space-3)' }}>
        <label className="field__label">Lien d'invitation direct</label>
        <div className="invite">
          <input
            type="text"
            readOnly
            className="input input--sm invite__link-input"
            value={inviteLink}
          />
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={() => void copy(inviteLink, true)}
          >
            <Icon name={copiedLink ? 'check' : 'copy'} size={14} />
            {copiedLink ? 'Copié !' : 'Copier le lien'}
          </button>
        </div>
      </div>

      {/* Code d'invitation brut */}
      <div className="field" style={{ marginTop: 'var(--space-2)' }}>
        <label className="field__label">Code d'accès rapide</label>
        <div className="invite">
          <code className="invite__code">{code ?? '—'}</code>
          <button type="button" className="btn btn--sm" onClick={() => void copy(code ?? '', false)}>
            <Icon name={copiedCode ? 'check' : 'copy'} size={14} />
            {copiedCode ? 'Copié' : 'Copier'}
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Régénérer le code"
            onClick={() => void rotate()}
            disabled={rotating}
          >
            {rotating ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ========================================================================== */
/* Profil                                                                     */
/* ========================================================================== */

function ProfileModal({
  open,
  userId,
  onClose,
}: {
  open: boolean;
  userId: string | null;
  onClose: () => void;
}) {
  // La carte se suffit a elle-meme : la boite ne porte ni titre ni chrome, pour
  // que la banniere touche le bord et que la carte reste l'objet principal.
  return (
    <Modal open={open} title="Profil" onClose={onClose} width={900} bare>
      {userId ? <ProfileCard userId={userId} /> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* Notifications                                                              */
/* ========================================================================== */


/* ========================================================================== */
/* Reglages d'un salon                                                        */
/* ========================================================================== */

/**
 * Renommer ou supprimer un salon.
 *
 * La suppression demande de retaper le nom du salon. C'est une friction
 * volontaire : elle emporte tous les messages et rien ne les ramene, alors
 * qu'une simple confirmation se clique sans lire.
 */
function ChannelSettingsModal({
  open,
  channelId,
  onClose,
}: {
  open: boolean;
  channelId: UUID | null;
  onClose: () => void;
}) {
  const channels = useChat((state) => state.channels);
  const renameChannel = useChat((state) => state.renameChannel);
  const deleteChannel = useChat((state) => state.deleteChannel);
  const selectSpace = useUI((state) => state.selectSpace);

  const channel = channels.find((item) => item.id === channelId) ?? null;

  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !channel) return;
    setName(channel.name);
    setTopic(channel.topic ?? '');
    setConfirmation('');
  }, [open, channel?.id]);

  if (!channel) return null;

  const renamed = name.trim() !== '' && (name.trim() !== channel.name || topic !== (channel.topic ?? ''));
  const confirmed = confirmation.trim() === channel.name;

  const save = async () => {
    setBusy(true);
    const done = await renameChannel(channel.id, name.trim(), topic.trim() || null);
    setBusy(false);
    if (done) onClose();
  };

  const remove = async () => {
    setBusy(true);
    const spaceId = await deleteChannel(channel.id);
    setBusy(false);

    if (spaceId) {
      // Le salon vient de disparaitre : rester dessus laisserait une vue vide.
      selectSpace(spaceId);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      title={`Reglages de ${channel.name}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
          <div className="spacer" />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!renamed || busy}
            onClick={() => void save()}
          >
            {busy ? <span className="spinner" /> : null}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="channel-rename">
          Nom
        </label>
        <input
          id="channel-rename"
          className="input"
          value={name}
          maxLength={LIMITS.channelNameLength}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      {channel.kind === 'text' ? (
        <div className="field">
          <label className="field__label" htmlFor="channel-topic">
            Sujet
          </label>
          <input
            id="channel-topic"
            className="input"
            value={topic}
            maxLength={LIMITS.topicLength}
            placeholder="De quoi parle-t-on ici ?"
            onChange={(event) => setTopic(event.target.value)}
          />
        </div>
      ) : null}

      <hr className="divider" />

      <section className="danger-zone">
        <h3 className="danger-zone__title">Supprimer ce salon</h3>
        <p className="danger-zone__body">
          Tous les messages, fichiers et fils de ce salon partent avec lui, sans
          retour possible. Tapez <strong>{channel.name}</strong> pour confirmer.
        </p>

        <div className="danger-zone__row">
          <input
            className="input"
            value={confirmation}
            placeholder={channel.name}
            aria-label={`Tapez ${channel.name} pour confirmer la suppression`}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <button
            type="button"
            className="btn btn--danger"
            disabled={!confirmed || busy}
            onClick={() => void remove()}
          >
            <Icon name="trash" size={14} />
            Supprimer
          </button>
        </div>
      </section>
    </Modal>
  );
}
