import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';

/** Cycle des themes, et leur nom tel qu'il est annonce dans la palette. */
const NEXT_THEME: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'black',
  black: 'system',
  system: 'light',
};

const THEME_LABELS: Record<Theme, string> = {
  light: 'clair',
  dark: 'sombre',
  black: 'noir',
  system: 'du systeme',
};
import { useSession, type Theme } from '@/store/session';
import { Icon, type IconName } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { useVoice } from '@/features/voice/useVoice';
import { useDevices } from '@/store/devices';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  group: string;
  /** Texte supplementaire pris en compte par le filtre. */
  keywords?: string;
  run: () => void;
}

/**
 * Palette de commandes, ouverte par Ctrl+K.
 *
 * Elle sert de point d'entree unique : aller a un salon, ouvrir un profil,
 * changer de theme, lancer une recherche. Une application ou tout se fait au
 * clavier evite l'aller-retour permanent vers la souris, et c'est ce qui
 * distingue le plus un outil qu'on utilise huit heures par jour.
 */
export function CommandPalette() {
  const open = useUI((state) => state.paletteOpen);
  const setOpen = useUI((state) => state.setPaletteOpen);
  const selectChannel = useUI((state) => state.selectChannel);
  const selectSpace = useUI((state) => state.selectSpace);
  const setPanel = useUI((state) => state.setPanel);
  const openModal = useUI((state) => state.openModal);
  const setSearchQuery = useUI((state) => state.setSearchQuery);

  const channels = useChat((state) => state.channels);
  const spaces = useChat((state) => state.spaces);
  const profiles = useChat((state) => state.profiles);

  const ranks = useChat((state) => state.ranks);
  const activeSpaceId = useUI((state) => state.activeSpaceId);

  const preferences = useSession((state) => state.preferences);
  const setPreference = useSession((state) => state.setPreference);
  const setStatus = useSession((state) => state.setStatus);
  const signOut = useSession((state) => state.signOut);
  const moi = useSession((state) => state.profile);

  const openDm = useChat((state) => state.openDm);
  const showDirectMessages = useUI((state) => state.showDirectMessages);
  const openSettings = useUI((state) => state.openSettings);

  const salonVocal = useVoice((state) => state.channelId);
  const rejoindreVocal = useVoice((state) => state.join);
  const quitterVocal = useVoice((state) => state.leave);
  const basculerMicro = useVoice((state) => state.toggleMute);
  const basculerSon = useVoice((state) => state.toggleDeafen);
  const basculerPartage = useVoice((state) => state.toggleScreenShare);
  const basculerCamera = useVoice((state) => state.toggleCamera);

  const media = useDevices((state) => state.media);
  const setMedia = useDevices((state) => state.setMedia);

  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlighted(0);
    // Le focus doit attendre que l'element soit reellement affiche.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  /*
   * Echap ferme la palette, quoi qu'il ait le focus.
   *
   * La touche n'etait ecoutee que sur le champ de saisie, lui-meme mis au
   * focus dans une frame d'animation. Quand cette frame tombait au mauvais
   * moment — machine chargee, rendu concurrent — le focus restait ailleurs et
   * la palette devenait impossible a fermer au clavier : elle recouvrait
   * l'application sans qu'aucune touche n'ait d'effet. Ecouter sur la fenetre
   * ne depend plus de rien.
   *
   * La capture est utilisee pour passer avant les autres consommateurs
   * d'Echap : la palette est la couche la plus haute, c'est elle qui doit
   * partir en premier.
   */
  useEffect(() => {
    if (!open) return;

    const surTouche = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };

    window.addEventListener('keydown', surTouche, true);
    return () => window.removeEventListener('keydown', surTouche, true);
  }, [open, setOpen]);

  const commands = useMemo((): Command[] => {
    const list: Command[] = [];

    for (const space of spaces) {
      const spaceChannels = channels.filter((channel) => channel.space_id === space.id);
      for (const channel of spaceChannels) {
        list.push({
          id: `channel:${channel.id}`,
          label: `${channel.kind === 'voice' ? '' : '#'}${channel.name}`,
          hint: space.name,
          icon: channel.kind === 'voice' ? 'volume' : 'hash',
          group: 'Salons',
          keywords: `${space.name} ${channel.topic ?? ''}`,
          run: () => {
            selectSpace(space.id);
            selectChannel(channel.id);
          },
        });

        /*
         * Un salon vocal se rejoint.
         *
         * L'entree ci-dessus ne fait que l'afficher — ce qui a du sens pour
         * voir qui s'y trouve. Mais quand on tape le nom d'un salon vocal, on
         * veut neuf fois sur dix y entrer, et il fallait encore viser un
         * bouton apres coup.
         *
         * Deux entrees plutot qu'une seule qui rejoindrait : regarder sans
         * ouvrir son micro doit rester possible.
         */
        if (channel.kind === 'voice' && channel.id !== salonVocal && moi) {
          list.push({
            id: `rejoindre:${channel.id}`,
            label: `Rejoindre ${channel.name}`,
            hint: space.name,
            icon: 'phone',
            group: 'Salons',
            keywords: `vocal parler entrer connecter ${space.name}`,
            run: () => {
              selectSpace(space.id);
              selectChannel(channel.id);
              void rejoindreVocal(channel.id, moi.id);
            },
          });
        }
      }
    }

    for (const space of spaces) {
      list.push({
        id: `space:${space.id}`,
        label: space.name,
        hint: 'Espace',
        icon: 'compass',
        group: 'Espaces',
        run: () => selectSpace(space.id),
      });
    }

    for (const profile of Object.values(profiles)) {
      list.push({
        id: `profile:${profile.id}`,
        label: profile.display_name,
        hint: `@${profile.username}`,
        icon: 'users',
        group: 'Personnes',
        keywords: profile.username,
        run: () => openModal({ kind: 'profile', userId: profile.id }),
      });

      // Ecrire a quelqu'un est ce qu'on veut faire le plus souvent apres
      // l'avoir cherche ; ouvrir sa fiche vient ensuite.
      if (profile.id !== moi?.id) {
        list.push({
          id: `dm:${profile.id}`,
          label: `Ecrire a ${profile.display_name}`,
          hint: `@${profile.username}`,
          icon: 'send',
          group: 'Personnes',
          keywords: `message prive conversation dm ${profile.username}`,
          run: () => void openDm(profile.id),
        });
      }
    }

    list.push(
      {
        id: 'action:search',
        label: 'Rechercher dans les messages',
        hint: 'Ouvre le panneau de recherche',
        icon: 'search',
        group: 'Actions',
        keywords: 'trouver chercher',
        run: () => {
          setSearchQuery('');
          setPanel('search');
        },
      },
      {
        id: 'action:theme',
        // Le cycle annonce ou il mene : « changer de theme » obligerait a
        // cliquer pour savoir ce qu'on obtient.
        label: `Passer au theme ${THEME_LABELS[NEXT_THEME[preferences.theme]]}`,
        icon: preferences.theme === 'light' ? 'moon' : 'sun',
        group: 'Actions',
        keywords: 'theme sombre clair noir systeme apparence',
        run: () => setPreference('theme', NEXT_THEME[preferences.theme]),
      },
      {
        id: 'action:density',
        label: `Densite : ${preferences.density === 'compact' ? 'passer a confortable' : preferences.density === 'cozy' ? 'passer a aeree' : 'passer a compacte'}`,
        icon: 'filter',
        group: 'Actions',
        keywords: 'densite espacement compact',
        run: () =>
          setPreference(
            'density',
            preferences.density === 'compact'
              ? 'cozy'
              : preferences.density === 'cozy'
                ? 'spacious'
                : 'compact',
          ),
      },
      {
        id: 'action:bookmarks',
        label: 'Messages sauvegardes',
        hint: 'Visibles de vous seul',
        icon: 'inbox',
        group: 'Actions',
        keywords: 'signets garder cote favoris',
        run: () => openModal({ kind: 'bookmarks' }),
      },
      {
        id: 'action:preferences',
        label: 'Ouvrir les preferences',
        icon: 'settings',
        group: 'Actions',
        keywords: 'reglages parametres options',
        run: () => useUI.getState().openSettings(),
      },
      {
        id: 'action:create-space',
        label: 'Creer un espace',
        icon: 'plus',
        group: 'Actions',
        run: () => openModal({ kind: 'create-space' }),
      },
      {
        id: 'action:join-space',
        label: 'Rejoindre un espace avec un code',
        icon: 'compass',
        group: 'Actions',
        keywords: 'invitation code',
        run: () => openModal({ kind: 'join-space' }),
      },
      {
        id: 'action:signout',
        label: 'Se deconnecter',
        icon: 'log-out',
        group: 'Actions',
        keywords: 'quitter deconnexion',
        run: () => void signOut(),
      },
    );

    // La console n'apparait que pour qui peut s'en servir : proposer une
    // commande qui echouerait ensuite ne rend service a personne.
    if (activeSpaceId && (ranks[activeSpaceId] ?? 0) >= 1) {
      list.push({
        id: 'action:moderation',
        label: 'Console de moderation',
        hint: 'Membres, signalements, journal',
        icon: 'filter',
        group: 'Actions',
        keywords: 'bannir exclure silence signalement',
        run: () => openModal({ kind: 'moderation', spaceId: activeSpaceId }),
      });
    }

    /*
     * Les commandes du salon vocal.
     *
     * Elles n'ont de sens qu'en ligne : proposer « couper le micro » a qui n'a
     * pas de micro ouvert donnerait une commande sans effet, et l'on douterait
     * ensuite de celles qui en ont un.
     */
    if (salonVocal) {
      list.push(
        {
          id: 'voix:micro',
          label: 'Couper ou reactiver le micro',
          icon: 'mic-off',
          group: 'Voix',
          keywords: 'muet sourdine mute silence',
          run: () => basculerMicro(),
        },
        {
          id: 'voix:son',
          label: 'Couper ou reactiver le son',
          icon: 'headphones-off',
          group: 'Voix',
          keywords: 'sourd casque deafen',
          run: () => basculerSon(),
        },
        {
          id: 'voix:partage',
          label: 'Partager ou arreter le partage d ecran',
          icon: 'screen',
          group: 'Voix',
          keywords: 'stream diffuser ecran jeu',
          run: () => void basculerPartage(),
        },
        {
          id: 'voix:camera',
          label: 'Allumer ou eteindre la camera',
          icon: 'video',
          group: 'Voix',
          keywords: 'webcam video visage',
          run: () => void basculerCamera(),
        },
        {
          id: 'voix:quitter',
          label: 'Quitter le salon vocal',
          icon: 'phone-off',
          group: 'Voix',
          keywords: 'raccrocher partir deconnecter',
          run: () => void quitterVocal(),
        },
      );
    }

    list.push(
      {
        id: 'voix:porte',
        label: media.noiseGate ? 'Couper la porte de bruit' : 'Activer la porte de bruit',
        hint: 'Coupe le micro entre les phrases',
        icon: 'mic',
        group: 'Voix',
        keywords: 'bruit suppression fond ventilateur clavier',
        run: () => setMedia('noiseGate', !media.noiseGate),
      },
      {
        id: 'voix:qualite',
        label:
          media.audioQuality === 'musique'
            ? 'Qualite du son : repasser en voix'
            : media.audioQuality === 'haute'
              ? 'Qualite du son : passer en musique'
              : 'Qualite du son : passer en haute',
        hint:
          media.audioQuality === 'musique'
            ? '128 kb/s stereo aujourd hui'
            : media.audioQuality === 'haute'
              ? '64 kb/s aujourd hui'
              : '32 kb/s aujourd hui',
        icon: 'volume',
        group: 'Voix',
        keywords: 'audio debit qualite stereo musique',
        run: () =>
          setMedia(
            'audioQuality',
            media.audioQuality === 'musique'
              ? 'voix'
              : media.audioQuality === 'haute'
                ? 'musique'
                : 'haute',
          ),
      },
      {
        id: 'voix:priorite',
        label:
          media.screenPriority === 'motion'
            ? 'Partage : privilegier la nettete'
            : 'Partage : privilegier la fluidite',
        hint: media.screenPriority === 'motion' ? 'Fluidite aujourd hui' : 'Nettete aujourd hui',
        icon: 'screen',
        group: 'Voix',
        keywords: 'stream fps images definition jeu texte',
        run: () =>
          setMedia('screenPriority', media.screenPriority === 'motion' ? 'detail' : 'motion'),
      },
    );

    list.push(
      {
        id: 'action:amis',
        label: 'Ajouter un ami',
        icon: 'user-plus',
        group: 'Actions',
        keywords: 'ami demande contact inviter quelqu un',
        run: () => showDirectMessages(),
      },
      {
        id: 'action:dm',
        label: 'Nouvelle conversation privee',
        icon: 'send',
        group: 'Actions',
        keywords: 'message prive dm ecrire',
        run: () => openModal({ kind: 'new-dm' }),
      },
      {
        id: 'action:profil',
        label: 'Modifier mon profil',
        hint: 'Photo, banniere, pseudo',
        icon: 'edit',
        group: 'Actions',
        keywords: 'avatar bio pseudo banniere',
        run: () => openModal({ kind: 'edit-profile' }),
      },
      {
        id: 'statut:enligne',
        label: 'Me mettre en ligne',
        icon: 'check-circle',
        group: 'Statut',
        keywords: 'disponible actif',
        run: () => void setStatus('online'),
      },
      {
        id: 'statut:absent',
        label: 'Me mettre absent',
        icon: 'moon',
        group: 'Statut',
        keywords: 'inactif pause',
        run: () => void setStatus('idle'),
      },
      {
        id: 'statut:dnd',
        label: 'Ne pas deranger',
        hint: 'Coupe sonnerie et notifications',
        icon: 'bell-off',
        group: 'Statut',
        keywords: 'silence occupe concentration',
        run: () => void setStatus('dnd'),
      },
      {
        id: 'statut:invisible',
        label: 'Passer invisible',
        icon: 'shield-off',
        group: 'Statut',
        keywords: 'hors ligne cache discret',
        run: () => void setStatus('offline'),
      },
      {
        id: 'reglages:voix',
        label: 'Reglages : voix et video',
        icon: 'mic',
        group: 'Reglages',
        keywords: 'micro camera peripherique test',
        run: () => openSettings('voix'),
      },
      {
        id: 'reglages:apparence',
        label: 'Reglages : apparence',
        icon: 'sun',
        group: 'Reglages',
        keywords: 'theme couleur densite transparence',
        run: () => openSettings('apparence'),
      },
      {
        id: 'reglages:notifications',
        label: 'Reglages : notifications',
        icon: 'bell',
        group: 'Reglages',
        keywords: 'sons alertes mentions',
        run: () => openSettings('notifications'),
      },
      {
        id: 'reglages:confidentialite',
        label: 'Reglages : confidentialite',
        icon: 'shield',
        group: 'Reglages',
        keywords: 'donnees blocage securite',
        run: () => openSettings('confidentialite'),
      },
      {
        id: 'reglages:accessibilite',
        label: 'Reglages : accessibilite',
        icon: 'sliders',
        group: 'Reglages',
        keywords: 'contraste animation taille texte',
        run: () => openSettings('accessibilite'),
      },
      {
        id: 'reglages:raccourcis',
        label: 'Voir les raccourcis clavier',
        icon: 'keyboard',
        group: 'Reglages',
        keywords: 'touches combinaisons',
        run: () => openSettings('raccourcis'),
      },
      {
        id: 'reglages:avance',
        label: 'Reglages : avance',
        hint: 'Version et mises a jour',
        icon: 'sliders',
        group: 'Reglages',
        keywords: 'version maj mise a jour',
        run: () => openSettings('avance'),
      },
    );

    if (activeSpaceId) {
      list.push(
        {
          id: 'espace:inviter',
          label: 'Inviter du monde dans cet espace',
          icon: 'link',
          group: 'Espaces',
          keywords: 'invitation lien code partager',
          run: () => openModal({ kind: 'invite', spaceId: activeSpaceId }),
        },
        {
          id: 'espace:salon',
          label: 'Creer un salon',
          icon: 'plus',
          group: 'Espaces',
          keywords: 'nouveau canal vocal texte',
          run: () => openModal({ kind: 'create-channel', spaceId: activeSpaceId }),
        },
        {
          id: 'espace:reglages',
          label: 'Reglages de cet espace',
          hint: 'Membres, salons, roles',
          icon: 'settings',
          group: 'Espaces',
          keywords: 'serveur parametres roles membres categories',
          run: () => openModal({ kind: 'space-settings', spaceId: activeSpaceId }),
        },
      );
    }

    return list;
  }, [
    spaces,
    channels,
    profiles,
    preferences,
    ranks,
    activeSpaceId,
    selectSpace,
    selectChannel,
    setPanel,
    openModal,
    setPreference,
    setSearchQuery,
    signOut,
  ]);

  /**
   * Filtrage par sous-sequence : « gnl » trouve « general ». C'est plus
   * permissif qu'une simple inclusion et evite d'avoir a taper le mot exact.
   */
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return commands.slice(0, 24);

    const scored = commands
      .map((command) => {
        const haystack = `${command.label} ${command.hint ?? ''} ${command.keywords ?? ''}`.toLowerCase();

        const direct = haystack.indexOf(needle);
        if (direct !== -1) return { command, score: 1000 - direct };

        let cursor = 0;
        let gaps = 0;
        for (const character of needle) {
          const found = haystack.indexOf(character, cursor);
          if (found === -1) return null;
          gaps += found - cursor;
          cursor = found + 1;
        }
        return { command, score: 500 - gaps };
      })
      .filter((entry): entry is { command: Command; score: number } => entry !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);

    return scored.map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => setHighlighted(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  if (!open) return null;

  const choose = (command: Command) => {
    command.run();
    setOpen(false);
  };

  let lastGroup = '';

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="palette surface" role="dialog" aria-modal="true" aria-label="Palette de commandes">
        <div className="palette__input-row">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            className="palette__input"
            value={query}
            placeholder="Aller a un salon, une personne, une action…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlighted((index) => (index + 1) % Math.max(1, results.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlighted(
                  (index) => (index - 1 + results.length) % Math.max(1, results.length),
                );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const chosen = results[highlighted];
                if (chosen) choose(chosen);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
              }
            }}
            aria-label="Commande"
          />
          <span className="kbd">Echap</span>
        </div>

        <ul className="palette__list scroll" ref={listRef}>
          {results.length === 0 ? (
            <li className="palette__empty">Rien ne correspond a « {query} ».</li>
          ) : (
            results.map((command, index) => {
              const showGroup = command.group !== lastGroup;
              lastGroup = command.group;
              const profileId = command.id.startsWith('profile:')
                ? command.id.slice('profile:'.length)
                : null;

              return (
                <li key={command.id}>
                  {showGroup ? <p className="palette__group">{command.group}</p> : null}
                  <button
                    type="button"
                    className={'palette__item' + (index === highlighted ? ' is-highlighted' : '')}
                    data-highlighted={index === highlighted}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => choose(command)}
                  >
                    {profileId ? (
                      <Avatar profile={profiles[profileId]} size={20} />
                    ) : (
                      <Icon name={command.icon} size={16} />
                    )}
                    <span className="palette__label truncate">{command.label}</span>
                    {command.hint ? (
                      <span className="palette__hint truncate">{command.hint}</span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <footer className="palette__footer">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> naviguer
          </span>
          <span>
            <span className="kbd">Entree</span> ouvrir
          </span>
          <span>
            <span className="kbd">Ctrl</span>
            <span className="kbd">K</span> fermer
          </span>
        </footer>
      </div>
    </div>
  );
}
