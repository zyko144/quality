import { useMemo, useState } from 'react';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useFriends } from '@/store/friends';
import { useSession } from '@/store/session';
import { Icon } from '@/components/Icon';
import { Avatar, AvatarStack } from '@/components/Avatar';
import type { Channel, Profile, UUID } from '@/types/db';

/**
 * Nom lisible d'une conversation privee.
 *
 * Une conversation a deux porte le nom de l'interlocuteur, pas celui stocke en
 * base : ce dernier a ete fige a la creation et ne suivrait pas un changement
 * de pseudo.
 */
export function dmTitle(
  channel: Channel,
  participantIds: UUID[],
  profiles: Record<UUID, Profile>,
  myId: UUID | undefined,
): string {
  const others = participantIds.filter((id) => id !== myId);

  if (channel.kind === 'group') {
    if (channel.name && channel.name !== 'Groupe') return channel.name;
    const names = others.map((id) => profiles[id]?.display_name ?? 'Inconnu');
    return names.length > 0 ? names.join(', ') : 'Groupe';
  }

  const other = others[0];
  return (other && profiles[other]?.display_name) ?? channel.name ?? 'Conversation';
}

/**
 * Acces a la page des amis, en tete de la liste privee.
 *
 * La pastille montre le nombre de demandes recues : sans elle, une demande
 * resterait invisible tant qu'on n'ouvre pas la page, et personne n'ouvre une
 * page qui n'annonce rien.
 */
function FriendsEntry() {
  const friendsOpen = useUI((state) => state.friendsOpen);
  const showFriends = useUI((state) => state.showFriends);
  const incoming = useFriends((state) => state.incoming.length);

  return (
    <button
      type="button"
      className={'dm-friends' + (friendsOpen ? ' is-active' : '')}
      onClick={showFriends}
      aria-current={friendsOpen ? 'page' : undefined}
    >
      <Icon name="users" size={19} />
      Amis
      {incoming > 0 ? <span className="dm-friends__badge">{incoming}</span> : null}
    </button>
  );
}

/**
 * L'entree de l'abonnement, juste sous « Amis ».
 *
 * Le nom est barre et la mention passe au rouge : l'abonnement est en
 * maintenance. « Bientot » disait une attente qui avance ; « Maintenance » dit
 * un arret, et c'est ce qu'il faut dire quand la page ne mene a rien.
 *
 * L'entree reste cliquable a dessein. La griser aurait cache la raison :
 * on aurait vu un mot barre sans savoir de quoi il s'agit, ni pour combien de
 * temps. La page, elle, peut l'expliquer.
 */
function WavesEntry() {
  const wavesOpen = useUI((state) => state.wavesOpen);
  const showWaves = useUI((state) => state.showWaves);

  return (
    <button
      type="button"
      className={'dm-friends dm-waves' + (wavesOpen ? ' is-active' : '')}
      onClick={showWaves}
      aria-current={wavesOpen ? 'page' : undefined}
    >
      {/*
        Les badges remplacent l'abonnement.

        La cle du magasin garde son nom d'origine — `waves` — pour la meme
        raison qui la lui laissait deja : un nom affiche se rechoisit, un nom
        de symbole se lit dans des dizaines d'endroits et se renomme mal.
      */}
      <Icon name="shield" size={19} />
      <span className="dm-waves__nom">Badges</span>
    </button>
  );
}

/**
 * L'entree des suggestions.
 *
 * En ambre plutot qu'aux couleurs de l'application : c'est le seul endroit ou
 * l'on s'adresse a ceux qui font Echow plutot qu'a ses autres utilisateurs, et
 * cette difference merite de se voir.
 */
function SuggestionsEntry() {
  const ouvert = useUI((state) => state.suggestionsOpen);
  const montrer = useUI((state) => state.showSuggestions);

  return (
    <button
      type="button"
      className={'dm-friends dm-suggestions' + (ouvert ? ' is-active' : '')}
      onClick={montrer}
      aria-current={ouvert ? 'page' : undefined}
    >
      <Icon name="inbox" size={19} />
      Suggestions
    </button>
  );
}

export function DirectMessageList() {
  const channels = useChat((state) => state.channels);
  const dmParticipants = useChat((state) => state.dmParticipants);
  const profiles = useChat((state) => state.profiles);
  const readStates = useChat((state) => state.readStates);
  const hideDm = useChat((state) => state.hideDm);

  const myId = useSession((state) => state.profile?.id);

  const activeChannelId = useUI((state) => state.activeChannelId);
  const selectChannel = useUI((state) => state.selectChannel);
  const openModal = useUI((state) => state.openModal);

  const [query, setQuery] = useState('');

  const conversations = useMemo(() => {
    const list = channels
      .filter((channel) => channel.space_id === null)
      .map((channel) => {
        const participants = dmParticipants[channel.id] ?? [];
        return {
          channel,
          participants,
          title: dmTitle(channel, participants, profiles, myId),
          others: participants.filter((id) => id !== myId),
        };
      });

    const needle = query.trim().toLowerCase();
    const filtered =
      needle.length === 0
        ? list
        : list.filter((item) => item.title.toLowerCase().includes(needle));

    // Les conversations non lues remontent : c'est ce qu'on vient y chercher.
    return filtered.sort((a, b) => {
      const unreadA = readStates[a.channel.id]?.unread_count ?? 0;
      const unreadB = readStates[b.channel.id]?.unread_count ?? 0;
      if ((unreadA > 0) !== (unreadB > 0)) return unreadA > 0 ? -1 : 1;
      return a.title.localeCompare(b.title, 'fr');
    });
  }, [channels, dmParticipants, profiles, myId, query, readStates]);

  const hasAny = channels.some((channel) => channel.space_id === null);

  return (
    <>
      <header className="sidebar__header">
        <h2 className="sidebar__heading">Messages prives</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={() => openModal({ kind: 'new-dm' })}
          title="Nouvelle conversation"
          aria-label="Nouvelle conversation"
        >
          <Icon name="plus" size={17} />
        </button>
      </header>

      <div className="sidebar__scroll scroll">
        <FriendsEntry />
        <WavesEntry />
        <SuggestionsEntry />

        {hasAny ? (
          <div className="dm-search">
            <Icon name="search" size={15} />
            <input
              className="dm-search__input"
              value={query}
              placeholder="Filtrer"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Filtrer les conversations"
            />
          </div>
        ) : null}

        {conversations.length === 0 ? (
          <div className="empty">
            <span className="empty__icon">
              <Icon name="thread" size={24} />
            </span>
            <p className="empty__title">
              {hasAny ? 'Aucune conversation ne correspond' : 'Aucune conversation'}
            </p>
            <p className="empty__body">
              {hasAny
                ? 'Essayez un autre nom.'
                : 'Ouvrez le profil de quelqu’un dans un espace commun, puis cliquez sur « Envoyer un message ».'}
            </p>
            {!hasAny ? (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => openModal({ kind: 'new-dm' })}
              >
                <Icon name="plus" size={14} />
                Nouvelle conversation
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="dm-list">
            {conversations.map(({ channel, title, others }) => {
              const state = readStates[channel.id];
              const unread = state?.unread_count ?? 0;
              const mentions = state?.mention_count ?? 0;
              const isActive = channel.id === activeChannelId;
              const other = others[0] ? profiles[others[0]] : undefined;

              return (
                <li key={channel.id} className="dm-row">
                  <button
                    type="button"
                    className={
                      'dm-item' +
                      (isActive ? ' is-active' : '') +
                      (unread > 0 && !isActive ? ' is-unread' : '')
                    }
                    onClick={() => selectChannel(channel.id)}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    {channel.kind === 'group' ? (
                      <AvatarStack
                        profiles={others.map((id) => profiles[id])}
                        size={26}
                        max={3}
                      />
                    ) : (
                      <Avatar
                        profile={other}
                        size={34}
                        status={other?.status}
                        showStatus
                      />
                    )}

                    <span className="dm-item__body">
                      <span className="dm-item__name truncate">{title}</span>
                      <span className="dm-item__meta truncate">
                        {channel.kind === 'group'
                          ? `${others.length + 1} personnes`
                          : (other?.custom_status ?? `@${other?.username ?? '…'}`)}
                      </span>
                    </span>

                    {mentions > 0 ? (
                      <span className="badge">{mentions > 99 ? '99+' : mentions}</span>
                    ) : unread > 0 && !isActive ? (
                      <span className="dm-item__dot" aria-label={`${unread} non lus`} />
                    ) : null}
                  </button>

                  <button
                    type="button"
                    className="icon-btn dm-row__hide"
                    onClick={() => void hideDm(channel.id)}
                    title="Masquer cette conversation"
                    aria-label={`Masquer la conversation avec ${title}`}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
