import { useMemo, useState } from 'react';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useSession } from '@/store/session';
import { useVoice } from '@/features/voice/useVoice';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { formatRelative } from '@/lib/time';
import { DirectMessageList } from '@/features/dm/DirectMessageList';
import { ChannelContextMenu } from '@/features/channels/ChannelContextMenu';
import { ListeContextMenu } from '@/features/channels/ListeContextMenu';
import { UserContextMenu } from '@/features/profile/UserContextMenu';
import { useContextMenu } from '@/components/ContextMenu';
import { Modal } from '@/components/Modal';
import type { Channel, UUID } from '@/types/db';

export function Sidebar() {
  const activeSpaceId = useUI((state) => state.activeSpaceId);
  const activeChannelId = useUI((state) => state.activeChannelId);
  const selectChannel = useUI((state) => state.selectChannel);
  const openThread = useUI((state) => state.openThread);
  const openModal = useUI((state) => state.openModal);

  const spaces = useChat((state) => state.spaces);
  const channels = useChat((state) => state.channels);
  const categories = useChat((state) => state.categories);
  const threads = useChat((state) => state.threads);
  const readStates = useChat((state) => state.readStates);
  const profiles = useChat((state) => state.profiles);
  const ranks = useChat((state) => state.ranks);

  // Le rang decide des outils affiches. La base revalide de toute facon chaque
  // action : ce test ne sert qu'a ne pas montrer un bouton qui echouerait.
  const myRank = activeSpaceId ? (ranks[activeSpaceId] ?? 0) : 0;
  const [menuListe, setMenuListe] = useState<{ x: number; y: number } | null>(null);

  /*
   * Le salon en cours de deplacement, et celui qu'il survole.
   *
   * Deux etats plutot qu'un : le premier survit au passage d'une categorie a
   * l'autre, le second change a chaque ligne franchie. Les melanger ferait
   * perdre la piste des qu'on sort de la liste et qu'on y revient.
   */
  const [deplace, setDeplace] = useState<UUID | null>(null);
  const [survole, setSurvole] = useState<UUID | null>(null);

  const reorderChannels = useChat((state) => state.reorderChannels);

  /*
   * Range le salon deplace juste avant celui qu'on relache.
   *
   * L'ordre transmis porte sur TOUS les salons de l'espace, pas seulement sur
   * la categorie visee : les positions sont un entier unique par espace, et
   * renumeroter une seule categorie decalerait les autres sans qu'on l'ait
   * demande.
   */
  const relacher = (idDeplace: string, cible: UUID) => {
    setDeplace(null);
    setSurvole(null);
    if (!idDeplace || idDeplace === cible || !activeSpaceId) return;

    const ordre = channels
      .filter((canal) => canal.space_id === activeSpaceId)
      .map((canal) => canal.id);

    const depuis = ordre.indexOf(idDeplace as UUID);
    const vers = ordre.indexOf(cible);
    if (depuis === -1 || vers === -1) return;

    ordre.splice(depuis, 1);
    ordre.splice(vers, 0, idDeplace as UUID);

    void reorderChannels(activeSpaceId, ordre);
  };

  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [threadsOpen, setThreadsOpen] = useState(true);

  const view = useUI((state) => state.view);
  const space = spaces.find((item) => item.id === activeSpaceId) ?? null;

  const spaceChannels = useMemo(
    () =>
      channels
        .filter((channel) => channel.space_id !== null && channel.space_id === activeSpaceId)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [channels, activeSpaceId],
  );

  const spaceCategories = useMemo(
    () => categories.filter((category) => category.space_id === activeSpaceId),
    [categories, activeSpaceId],
  );

  // Fils encore ouverts de cet espace, les plus recents en premier. C'est la
  // section qui remplace la chasse au message perdu dans l'historique.
  const openThreads = useMemo(
    () =>
      Object.values(threads)
        .filter((thread) => thread.space_id === activeSpaceId && !thread.resolved)
        .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
        .slice(0, 12),
    [threads, activeSpaceId],
  );

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  // La vue privee remplace entierement le contenu de la barre laterale.
  if (view === 'direct') {
    return (
      <aside className="sidebar">
        <DirectMessageList />
        <UserBar />
      </aside>
    );
  }

  if (!space) {
    return (
      <aside className="sidebar">
        <div className="sidebar__empty">
          <Icon name="compass" size={28} />
          <p>Choisissez un espace a gauche, ou creez-en un.</p>
        </div>
        <UserBar />
      </aside>
    );
  }

  const uncategorized = spaceChannels.filter((channel) => channel.category_id === null);

  return (
    <aside className="sidebar">
      {/*
        La banniere de l'espace, au-dessus de tout.
        C'est ce qui donne son caractere a un serveur une fois qu'on y est : la
        pastille du rail ne se voit que de loin, et de trois centimetres.
      */}
      {space.banner_url ? (
        <div className="sidebar__banniere">
          <img src={space.banner_url} alt="" />
        </div>
      ) : null}

      <header className="sidebar__header">
        <button
          type="button"
          className="sidebar__space"
          onClick={() => openModal({ kind: 'invite', spaceId: space.id })}
          title="Inviter du monde"
        >
          <span className="truncate">{space.name}</span>
          <Icon name="link" size={14} />
        </button>

        {myRank >= 2 ? (
          <button
            type="button"
            className="icon-btn"
            onClick={() => openModal({ kind: 'space-settings', spaceId: space.id })}
            title="Parametres de l’espace"
            aria-label="Parametres de l’espace"
          >
            <Icon name="settings" size={16} />
          </button>
        ) : null}

        {myRank >= 1 ? (
          <button
            type="button"
            className="icon-btn"
            onClick={() => openModal({ kind: 'moderation', spaceId: space.id })}
            title="Console de moderation"
            aria-label="Console de moderation"
          >
            <Icon name="filter" size={16} />
          </button>
        ) : null}
      </header>

      {/*
        Le clic droit dans le vide de la liste.
        Viser le « + » d'une categorie demande de la survoler d'abord ; le fond
        de la colonne, lui, fait plusieurs centaines de pixels et ne servait a
        rien. On ne l'ouvre qu'a qui peut administrer : quatre entrees grisees
        informent moins que pas de menu du tout.
      */}
      <div
        className="sidebar__scroll scroll"
        onContextMenu={(event) => {
          if (myRank < 2 || !activeSpaceId) return;

          // Seulement le fond : un clic droit sur un salon ou un membre parle
          // d'eux, et leur propre menu s'en charge.
          if ((event.target as HTMLElement).closest('li, button')) return;

          event.preventDefault();
          setMenuListe({ x: event.clientX, y: event.clientY });
        }}
      >
        {menuListe && activeSpaceId ? (
          <ListeContextMenu
            spaceId={activeSpaceId}
            position={menuListe}
            onClose={() => setMenuListe(null)}
          />
        ) : null}

        {openThreads.length > 0 ? (
          <section className="sidebar__section">
            <button
              type="button"
              className="sidebar__section-title"
              onClick={() => setThreadsOpen((open) => !open)}
              aria-expanded={threadsOpen}
            >
              <Icon name={threadsOpen ? 'chevron-down' : 'chevron-right'} size={12} />
              <span>A suivre</span>
              <span className="sidebar__count">{openThreads.length}</span>
            </button>

            {threadsOpen ? (
              <ul className="sidebar__threads">
                {openThreads.map((thread) => {
                  const channel = channels.find((item) => item.id === thread.channel_id);
                  return (
                    <li key={thread.id}>
                      <button
                        type="button"
                        className="thread-pill"
                        onClick={() => {
                          selectChannel(thread.channel_id);
                          openThread(thread.id);
                        }}
                      >
                        <span className="thread-pill__dot" aria-hidden="true" />
                        <span className="thread-pill__body">
                          <span className="thread-pill__title truncate">{thread.title}</span>
                          <span className="thread-pill__meta truncate">
                            {channel ? `#${channel.name}` : ''} · {formatRelative(thread.last_activity_at)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ) : null}

        {uncategorized.length > 0 ? (
          <section className="sidebar__section">
            <ul className="sidebar__channels">
              {uncategorized.map((channel) => (
                <ChannelItem
                  key={channel.id}
                  channel={channel}
                  active={channel.id === activeChannelId}
                  survole={survole === channel.id && deplace !== null}
                  onDragStart={setDeplace}
                  onDragOver={setSurvole}
                  onDrop={relacher}
                  onDragEnd={() => {
                    setDeplace(null);
                    setSurvole(null);
                  }}
                  unread={readStates[channel.id]?.unread_count ?? 0}
                  mentions={readStates[channel.id]?.mention_count ?? 0}
                  onSelect={selectChannel}
                  profiles={profiles}
                  canManage={myRank >= 2}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {spaceCategories.map((category) => {
          const items = spaceChannels.filter((channel) => channel.category_id === category.id);
          if (items.length === 0) return null;
          const collapsed = collapsedCategories.has(category.id);

          return (
            <section className="sidebar__section" key={category.id}>
              <button
                type="button"
                className="sidebar__section-title"
                onClick={() => toggleCategory(category.id)}
                aria-expanded={!collapsed}
              >
                <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
                <span>{category.name}</span>
              </button>

              {!collapsed ? (
                <ul className="sidebar__channels">
                  {items.map((channel) => (
                    <ChannelItem
                      key={channel.id}
                      channel={channel}
                      active={channel.id === activeChannelId}
                      unread={readStates[channel.id]?.unread_count ?? 0}
                      mentions={readStates[channel.id]?.mention_count ?? 0}
                      onSelect={selectChannel}
                      profiles={profiles}
                      canManage={myRank >= 2}
                    />
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}

        <button
          type="button"
          className="sidebar__add"
          onClick={() => openModal({ kind: 'create-channel', spaceId: space.id })}
        >
          <Icon name="plus" size={14} />
          Nouveau salon
        </button>
      </div>

      <UserBar />
    </aside>
  );
}

/* -------------------------------------------------------------------------- */

function ChannelItem({
  channel,
  active,
  unread,
  mentions,
  onSelect,
  profiles,
  canManage,
  survole,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  channel: Channel;
  active: boolean;
  unread: number;
  mentions: number;
  onSelect: (id: UUID) => void;
  profiles: Record<UUID, import('@/types/db').Profile>;
  /** Rang dans l'espace : les reglages n'ont de sens qu'a partir d'admin. */
  canManage: boolean;
  /** Vrai quand un salon deplace survole celui-ci. */
  survole?: boolean;
  onDragStart?: (id: UUID) => void;
  onDragOver?: (id: UUID) => void;
  onDrop?: (deplace: string, cible: UUID) => void;
  onDragEnd?: () => void;
}) {
  const participants = useVoice((state) =>
    channel.kind === 'voice' ? state.participantsByChannel[channel.id] : undefined,
  );
  const openModal = useUI((state) => state.openModal);
  const deleteChannel = useChat((state) => state.deleteChannel);
  const menu = useContextMenu();
  const [aSupprimer, setASupprimer] = useState(false);
  const [menuMembre, setMenuMembre] = useState<{ userId: UUID; x: number; y: number } | null>(
    null,
  );

  const hasUnread = unread > 0 && !active;

  return (
    <li
      onContextMenu={menu.open}
      /*
       * Glisser un salon pour le ranger.
       *
       * Reserve a qui peut administrer : pour les autres, un salon qui suit le
       * curseur donnerait l'illusion d'un pouvoir qu'ils n'ont pas, et le
       * serveur refuserait l'ecriture au relachement.
       */
      draggable={canManage}
      onDragStart={(event) => {
        if (!canManage) return;
        event.dataTransfer.setData('text/plain', channel.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart?.(channel.id);
      }}
      onDragOver={(event) => {
        if (!canManage) return;
        // Sans `preventDefault`, le navigateur refuse le depot : c'est lui qui
        // decide, et son defaut est de tout refuser.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onDragOver?.(channel.id);
      }}
      onDrop={(event) => {
        if (!canManage) return;
        event.preventDefault();
        onDrop?.(event.dataTransfer.getData('text/plain'), channel.id);
      }}
      onDragEnd={() => onDragEnd?.()}
      className={survole ? 'is-drop-target' : undefined}
    >
      {menu.position ? (
        <ChannelContextMenu
          channel={channel}
          position={menu.position}
          onClose={menu.close}
          canManage={canManage}
          onDelete={() => setASupprimer(true)}
        />
      ) : null}

      <Modal
        open={aSupprimer}
        title={`Supprimer #${channel.name} ?`}
        description="Les messages du salon disparaissent avec lui. Cette action est definitive."
        onClose={() => setASupprimer(false)}
        width={440}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setASupprimer(false)}>
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                setASupprimer(false);
                void deleteChannel(channel.id);
              }}
            >
              <Icon name="trash" size={15} />
              Supprimer
            </button>
          </>
        }
      >
        <p className="field__hint">
          Personne ne pourra plus lire ce qui s&rsquo;y est dit, vous compris.
        </p>
      </Modal>

      <button
        type="button"
        className={
          'channel' +
          (active ? ' is-active' : '') +
          (hasUnread ? ' is-unread' : '')
        }
        onClick={() => onSelect(channel.id)}
        aria-current={active ? 'true' : undefined}
        // Seule l'icone distinguait un salon vocal d'un salon texte : rien
        // qu'une feuille de style ou un test puisse viser.
        data-kind={channel.kind}
      >
        <Icon name={channel.kind === 'voice' ? 'volume' : 'hash'} size={16} />
        <span className="channel__name truncate">{channel.name}</span>

        {mentions > 0 ? (
          <span className="badge" aria-label={`${mentions} mentions`}>
            {mentions > 99 ? '99+' : mentions}
          </span>
        ) : hasUnread ? (
          <span className="channel__dot" aria-label={`${unread} messages non lus`} />
        ) : null}
        {canManage ? (
          // Un `span` et non un `button` : imbriquer deux boutons est invalide,
          // et le navigateur en fait ce qu'il veut. Le role et le clavier sont
          // rendus explicitement.
          <span
            role="button"
            tabIndex={0}
            className="channel__manage"
            title={`Reglages de ${channel.name}`}
            aria-label={`Reglages de ${channel.name}`}
            onClick={(event) => {
              event.stopPropagation();
              openModal({ kind: 'channel-settings', channelId: channel.id });
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              openModal({ kind: 'channel-settings', channelId: channel.id });
            }}
          >
            <Icon name="settings" size={14} />
          </span>
        ) : null}
      </button>

      {channel.kind === 'voice' && participants && participants.length > 0 ? (
        <ul className="channel__voice">
          {menuMembre ? (
            <UserContextMenu
              userId={menuMembre.userId}
              position={{ x: menuMembre.x, y: menuMembre.y }}
              onClose={() => setMenuMembre(null)}
            />
          ) : null}

          {participants.map((participant) => {
            const profile = profiles[participant.user_id];
            return (
              <li
                key={participant.user_id}
                /*
                  Le clic droit sur une personne parle d'elle, pas du salon.
                  La liste des participants vit a l'interieur de la ligne du
                  salon : sans arreter l'evenement ici, il remontait jusqu'a
                  elle et l'on obtenait « Supprimer le salon » en visant
                  quelqu'un.
                */
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenuMembre({
                    userId: participant.user_id,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                {/* Un nom se clique pour savoir a qui l'on a affaire — ici comme
                    dans la conversation ou sur la scene vocale. */}
                <button
                  type="button"
                  className="voice-member"
                  onClick={() => openModal({ kind: 'profile', userId: participant.user_id })}
                  title={
                    profile ? `Voir le profil de ${profile.display_name}` : 'Voir le profil'
                  }
                >
                  <Avatar profile={profile} size={20} />
                  <span className="truncate">{profile?.display_name ?? 'Quelqu’un'}</span>
                  {participant.muted ? <Icon name="mic-off" size={12} /> : null}
                  {participant.sharing ? <Icon name="screen" size={12} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function UserBar() {
  const profile = useSession((state) => state.profile);
  const setStatus = useSession((state) => state.setStatus);
  const openSettings = useUI((state) => state.openSettings);
  const selectChannel = useUI((state) => state.selectChannel);
  const selectSpace = useUI((state) => state.selectSpace);

  const voiceChannelId = useVoice((state) => state.channelId);
  const muted = useVoice((state) => state.muted);
  const deafened = useVoice((state) => state.deafened);
  const toggleMute = useVoice((state) => state.toggleMute);
  const toggleDeafen = useVoice((state) => state.toggleDeafen);
  const leave = useVoice((state) => state.leave);

  const channels = useChat((state) => state.channels);
  const voiceChannel = channels.find((channel) => channel.id === voiceChannelId);

  const [statusOpen, setStatusOpen] = useState(false);

  if (!profile) return null;

  return (
    <div className="userbar">
      {voiceChannelId ? (
        <div className="userbar__voice">
          {/* Le bandeau ramene au salon ou l'on parle. On y revient souvent —
              pour voir qui est la, pour partager — et il fallait sinon le
              retrouver dans la liste. */}
          <button
            type="button"
            className="userbar__voice-info"
            onClick={() => {
              if (!voiceChannel) return;
              if (voiceChannel.space_id) selectSpace(voiceChannel.space_id);
              selectChannel(voiceChannel.id);
            }}
            title="Revenir au salon vocal"
          >
            <span className="userbar__voice-state">
              <Icon name="volume" size={13} /> Connecte
            </span>
            <span className="userbar__voice-channel truncate">
              {voiceChannel?.name ?? 'Salon vocal'}
            </span>
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            onClick={() => void leave()}
            title="Quitter le vocal"
          >
            <Icon name="phone-off" size={16} />
          </button>
        </div>
      ) : null}

      <div className="userbar__row">
        <button
          type="button"
          className="userbar__identity"
          onClick={() => setStatusOpen((open) => !open)}
          aria-expanded={statusOpen}
        >
          <Avatar profile={profile} size={30} status={profile.status} showStatus />
          <span className="userbar__names">
            <span className="userbar__display truncate">{profile.display_name}</span>
            <span className="userbar__handle truncate">
              {profile.custom_status ?? `@${profile.username}`}
            </span>
          </span>
        </button>

        <div className="userbar__controls">
          <button
            type="button"
            className={'icon-btn' + (muted ? ' is-active' : '')}
            onClick={() => toggleMute()}
            aria-pressed={muted}
            title={muted ? 'Reactiver le micro' : 'Couper le micro'}
          >
            <Icon name={muted ? 'mic-off' : 'mic'} size={16} />
          </button>
          <button
            type="button"
            className={'icon-btn' + (deafened ? ' is-active' : '')}
            onClick={() => toggleDeafen()}
            aria-pressed={deafened}
            title={deafened ? 'Reactiver le son' : 'Couper le son'}
          >
            <Icon name={deafened ? 'headphones-off' : 'headphones'} size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => openSettings()}
            title="Preferences"
          >
            <Icon name="settings" size={16} />
          </button>
        </div>
      </div>

      {statusOpen ? (
        <div className="status-menu surface">
          {(
            [
              ['online', 'En ligne'],
              ['idle', 'Absent'],
              ['dnd', 'Ne pas deranger'],
              ['offline', 'Invisible'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className="status-menu__item"
              onClick={() => {
                void setStatus(value);
                setStatusOpen(false);
              }}
            >
              <span className={`status-dot status-dot--${value}`} aria-hidden="true" />
              {label}
              {profile.status === value ? <Icon name="check" size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
