import { useEffect } from 'react';
import { useChat } from '@/store/chat';
import { useVoice } from '@/features/voice/useVoice';
import { useUI } from '@/store/ui';
import { useSession, markOfflineOnExit } from '@/store/session';
import { startRealtime } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import { SpaceRail } from './SpaceRail';
import { Sidebar } from './Sidebar';
import { SidePanel } from './SidePanel';
import { ChannelHeader } from '@/features/channels/ChannelHeader';
import { WindowControls } from '@/components/WindowControls';
import { MiseAJour } from './MiseAJour';
import { SortieAudio } from '@/features/voice/SortieAudio';
import { Sonnerie } from '@/features/voice/Sonnerie';
import { EcouteVocale } from '@/features/voice/EcouteVocale';
import { MessageList } from '@/features/messages/MessageList';
import { Composer } from '@/features/messages/Composer';
import { VoiceStage } from '@/features/voice/VoiceStage';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { Modals } from '@/features/settings/Modals';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { FriendsPage } from '@/features/friends/FriendsPage';
import { BadgesPage } from '@/features/badges/BadgesPage';
import { Suggestions } from '@/features/suggestions/Suggestions';
import { RaccourcisVocaux } from '@/features/voice/RaccourcisVocaux';
import { TiroirGlissant } from '@/features/shell/TiroirGlissant';
import { Battement } from '@/features/shell/Battement';
import { Arrivee } from '@/features/shell/Arrivee';
import { Visionneuse } from '@/features/messages/Visionneuse';
import { EchowAI } from '@/features/ia/EchowAI';
import { AttributionBadges } from '@/features/badges/Attribution';
import { TempsVocal } from '@/features/voice/TempsVocal';
import { Support } from '@/features/support/Support';
import { Conditions, CONDITIONS_VERSION } from '@/features/onboarding/Conditions';
import { useFriends } from '@/store/friends';
import { BATTEMENT } from '@/lib/presence';
import { Icon } from '@/components/Icon';
import { useIsMobile } from '@/lib/useMediaQuery';
import type { Profile } from '@/types/db';

export function Workspace() {
  const session = useSession((state) => state.session);
  const profile = useSession((state) => state.profile);
  const setProfile = useSession((state) => state.setProfile);
  const setStatus = useSession((state) => state.setStatus);

  const ready = useChat((state) => state.ready);
  const error = useChat((state) => state.error);
  const avertissement = useVoice((state) => state.avertissement);
  const spaces = useChat((state) => state.spaces);
  const channels = useChat((state) => state.channels);
  const bootstrapChat = useChat((state) => state.bootstrap);
  const resetChat = useChat((state) => state.reset);

  const view = useUI((state) => state.view);
  const friendsOpen = useUI((state) => state.friendsOpen);
  const wavesOpen = useUI((state) => state.wavesOpen);
  const suggestionsOpen = useUI((state) => state.suggestionsOpen);
  const supportOpen = useUI((state) => state.supportOpen);
  const settings = useUI((state) => state.settings);
  const activeSpaceId = useUI((state) => state.activeSpaceId);
  const activeChannelId = useUI((state) => state.activeChannelId);
  const sidebarCollapsed = useUI((state) => state.sidebarCollapsed);
  const navOpen = useUI((state) => state.navOpen);
  const closeNav = useUI((state) => state.closeNav);
  const isMobile = useIsMobile();
  const selectSpace = useUI((state) => state.selectSpace);
  const selectChannel = useUI((state) => state.selectChannel);
  const setPaletteOpen = useUI((state) => state.setPaletteOpen);
  const paletteOpen = useUI((state) => state.paletteOpen);
  const chatVocalOuvert = useUI((state) => state.voiceChatOpen);
  const togglePanel = useUI((state) => state.togglePanel);

  const userId = session?.user.id;

  /* --------------------------------------------------------------- Amorcage */

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    void (async () => {
      await bootstrapChat();
      if (cancelled) return;

      // Le profil vient de la meme charge utile : inutile de le redemander.
      const loaded = useChat.getState().profiles[userId];
      if (loaded) {
        setProfile(loaded);
      } else {
        const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
        if (data && !cancelled) setProfile(data as Profile);
      }
    })();

    const stop = startRealtime(userId);

    // Les amis sont charges ici et non dans leur page : la pastille des
    // demandes recues doit etre juste des l'ouverture de l'application, pas
    // seulement quand on pense a aller voir.
    void useFriends.getState().load();

    // Un abonnement qui echoue ne doit pas emporter l'application : sans cette
    // garde, une exception ici vide l'arbre React et l'ecran devient blanc,
    // alors que seule la pastille des demandes serait concernee.
    let stopFriends = () => {};
    try {
      stopFriends = useFriends.getState().subscribe(userId);
    } catch {
      // Les amis resteront charges au montage, sans mise a jour en direct.
    }

    return () => {
      cancelled = true;
      stop();
      stopFriends();
      resetChat();
      useFriends.getState().reset();
    };
  }, [userId, bootstrapChat, resetChat, setProfile]);

  /* ---------------------------------------- Sync profil → site portfolio */

  useEffect(() => {
    if (!profile) return;

    let isSubscribed = false;
    const channel = supabase.channel('public:presence');

    const sendPresence = (overrideStatus?: string) => {
      const p = useSession.getState().profile;
      if (!p) return;
      const currentStatus = overrideStatus || p.status || 'online';

      if (isSubscribed) {
        void channel.send({
          type: 'broadcast',
          event: 'user_presence',
          payload: {
            userId: p.id,
            username: p.username || 'vq',
            display_name: p.display_name || 'vq',
            avatar_url: p.avatar_url || null,
            status: currentStatus,
            custom_status: p.custom_status ?? null,
            timestamp: Date.now(),
          },
        });
      }
    };

    channel
      .on('broadcast', { event: 'presence_ping' }, () => {
        sendPresence();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          isSubscribed = true;
          sendPresence();
        }
      });

    /*
     * Le battement passe de trois secondes a une minute, et c'est ce qui a
     * fait exploser la facture Realtime.
     *
     * `public:presence` est un canal GLOBAL : tout le monde y est, et un
     * message diffuse est reexpedie a CHAQUE abonne. Le cout n'est donc pas
     * proportionnel au nombre de personnes mais a son carre.
     *
     *     N personnes x 20 messages par minute x N destinataires
     *
     * A onze personnes connectees, cela fait deux mille quatre cents messages
     * par minute, soit cent quarante-cinq mille par heure — pour annoncer que
     * rien n'a change. Le relevé de facturation le dit sans detour : 1 956 495
     * messages sur un plafond de 2 000 000, avec ONZE utilisateurs actifs dans
     * le mois.
     *
     * Une minute suffit, et ce n'est pas un chiffre choisi au hasard : c'est
     * `BATTEMENT`, la cadence que tout le reste de l'application utilise deja
     * pour dire « je suis la », avec `EXPIRATION` a deux battements et demi
     * pour tolerer ceux qu'on rate. Suivre la meme regle ici evite d'avoir
     * deux definitions concurrentes de « en ligne ».
     *
     * Rien n'est perdu cote fraicheur : le site qui consomme cette presence
     * peut la DEMANDER quand il en a besoin, par `presence_ping` ci-dessus, et
     * tout le monde repond aussitot. Un battement rapide envoyait vingt fois
     * par minute une reponse que personne n'avait demandee.
     */
    const heartbeat = setInterval(() => {
      sendPresence();
    }, BATTEMENT);

    const handleBeforeUnload = () => {
      if (isSubscribed) {
        sendPresence('offline');
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      sendPresence('offline');
      void supabase.removeChannel(channel);
    };
  }, [profile]);

  /* ------------------------------------------------- Selection par defaut */

  useEffect(() => {
    // En vue privee, l'absence d'espace actif est voulue : la remplir
    // renverrait l'utilisateur dans un espace a chaque rendu.
    if (view === 'direct') return;
    if (!ready || spaces.length === 0) return;
    if (activeSpaceId && spaces.some((space) => space.id === activeSpaceId)) return;
    selectSpace(spaces[0]!.id);
  }, [ready, spaces, activeSpaceId, selectSpace, view]);

  useEffect(() => {
    /*
     * La meme reserve qu'au-dessus, et pour la meme raison.
     *
     * Amis, Waves, Suggestions et Support vident le salon actif en passant en
     * vue privee. Sans ce test, cet effet voyait un espace ouvert sans salon
     * choisi et en rouvrait un aussitot — ce qui remettait la vue sur l'espace.
     * Depuis un espace, ces quatre pages s'ouvraient donc et se refermaient
     * dans le meme rendu : on cliquait, et rien ne se passait.
     *
     * Le defaut ne se voyait pas depuis la vue privee, ou aucun espace n'est
     * actif — c'est-a-dire partout ou l'on pense a essayer.
     */
    if (view === 'direct') return;
    if (!activeSpaceId) return;

    const inSpace = channels.filter((channel) => channel.space_id === activeSpaceId);
    if (activeChannelId && inSpace.some((channel) => channel.id === activeChannelId)) return;

    const firstText = inSpace.find((channel) => channel.kind === 'text') ?? inSpace[0];
    if (firstText) selectChannel(firstText.id);
  }, [activeSpaceId, activeChannelId, channels, selectChannel, view]);

  /* ------------------------------------------------------- Presence en ligne */

  useEffect(() => {
    if (!profile) return;

    // Passe en absent quand l'onglet reste cache, et revient en ligne au retour.
    const handleVisibility = () => {
      void setStatus(document.hidden ? 'idle' : 'online');
    };

    /*
     * Fermeture de la fenetre.
     *
     * Une requete ordinaire serait annulee par le dechargement : c'est ce qui
     * laissait le compte affiche « en ligne » apres avoir quitte. On passe
     * donc par une requete en mode `keepalive`, que le navigateur mene a
     * terme meme si le document disparait.
     *
     * Le salon vocal est quitte avant : la presence Realtime finirait par
     * expirer, mais entre-temps on reste affiche dans le vocal, comme un
     * fantome.
     */
    const handleUnload = () => {
      const jeton = useSession.getState().session?.access_token;
      const moi = useSession.getState().session?.user.id;

      if (useVoice.getState().channelId) void useVoice.getState().leave();
      if (jeton && moi) markOfflineOnExit(moi, jeton);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, [profile, setStatus]);

  /* ------------------------------------------------------ Raccourcis clavier */

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;

      if (event.key === 'Escape' && useUI.getState().navOpen) {
        event.preventDefault();
        useUI.getState().closeNav();
        return;
      }

      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }

      if (modifier && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        togglePanel('search');
        return;
      }

      // Les raccourcis sans modificateur ne doivent pas se declencher pendant
      // la frappe d'un message.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;

      if (typing) return;

      if (modifier && event.key === ',') {
        event.preventDefault();
        useUI.getState().openSettings();
        return;
      }

      /*
       * Les raccourcis du vocal ne sont plus lus ici.
       *
       * Ils vivent dans `RaccourcisVocaux`, avec les touches maintenues, et
       * pour une raison de fond : depuis que le systeme peut les surveiller
       * meme quand la fenetre n'a pas le focus, deux lecteurs du clavier
       * verraient la meme pression — la bascule s'appliquerait deux fois, donc
       * pas du tout. Un seul endroit lit le clavier pour le vocal.
       */

      // Navigation entre salons, sans quitter le clavier.
      if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        stepChannel(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (modifier && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        useUI.getState().showFriends();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paletteOpen, setPaletteOpen, togglePanel]);

  /**
   * Passe au salon suivant ou precedent de l'espace ouvert.
   *
   * Le parcours boucle : arrive au dernier, la touche suivante ramene au
   * premier, ce qui evite de buter sans rien comprendre.
   */
  const stepChannel = (pas: 1 | -1) => {
    const { activeSpaceId, activeChannelId } = useUI.getState();
    const liste = useChat
      .getState()
      .channels.filter((salon) => salon.space_id === activeSpaceId)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

    if (liste.length === 0) return;

    const index = liste.findIndex((salon) => salon.id === activeChannelId);
    const suivant = liste[(index + pas + liste.length) % liste.length];
    if (suivant) useUI.getState().selectChannel(suivant.id);
  };

  /* ---------------------------------------------------------------- Rendu */

  const channel = channels.find((item) => item.id === activeChannelId) ?? null;
  const voiceChannelId = useVoice((state) => state.channelId);

  /*
   * Rien tant que les espaces chargent — le voile d'origine est encore la.
   *
   * Un second ecran d'attente s'affichait ici, avec le meme logo et un texte
   * different. Ils se suivaient : le voile de `index.html` partait des que la
   * session etait connue, celui-ci prenait le relais pendant que les espaces
   * arrivaient. Deux chargements pour une seule attente, ce qui la fait
   * paraitre deux fois plus longue qu'elle n'est.
   *
   * C'est `main.tsx` qui leve le voile, maintenant qu'il attend aussi ce
   * drapeau.
   */
  if (!ready) return null;

  /*
   * Les regles passent avant tout le reste.
   *
   * Posees ici plutot que dans le parcours d'inscription : on arrive aussi par
   * Google, par un lien de recuperation, ou avec un compte cree avant que ces
   * regles existent. Un seul point de passage, celui par lequel tout le monde
   * finit — l'espace de travail — vaut mieux que trois chemins a maintenir en
   * accord.
   *
   * Le profil est deja charge a ce stade : `ready` en depend.
   */
  /*
   * La barriere s'active d'elle-meme quand la base est prete.
   *
   * Tant que la migration n'est pas appliquee, la colonne n'existe pas et le
   * profil ne porte pas la propriete — `undefined`, distinct de `null`. Traiter
   * les deux de la meme facon enfermerait tout le monde dehors : l'ecran
   * s'afficherait, et la fonction qui enregistre l'acceptation n'existerait pas
   * encore pour en sortir.
   *
   * `undefined` signifie donc « la question ne se pose pas encore », et `null`
   * « jamais accepte ». La difference vaut d'etre tenue : c'est elle qui evite
   * de livrer une version qui bloque l'application sur une base non migree.
   */
  const conditionsConnues = profile !== null && profile.terms_accepted_at !== undefined;

  if (
    conditionsConnues &&
    (profile.terms_accepted_at === null ||
      (profile.terms_version ?? 0) < CONDITIONS_VERSION)
  ) {
    return <Conditions />;
  }

  return (
    <div
      className={
        'workspace' +
        (sidebarCollapsed ? ' is-collapsed' : '') +
        (isMobile ? ' is-mobile' : '') +
        (navOpen ? ' is-nav-open' : '')
      }
    >
      {/* Reduire, agrandir, fermer — la barre du systeme est desactivee, ces
          commandes vivent maintenant dans l'application. Posees une seule fois
          et en position fixe : elles doivent rester atteignables quelle que
          soit la vue, y compris quand aucun salon n'est ouvert. */}
      <WindowControls />

      {/* La bannière de mise a jour flotte au-dessus de tout, sans deplacer
          quoi que ce soit : elle propose, elle n'interrompt pas. */}
      <MiseAJour />

      {/* Le son des autres, monte une fois pour toutes : il ne doit pas
          dependre de l'ecran qu'on regarde. */}
      <SortieAudio />
      <Sonnerie />
      <EcouteVocale />
      <RaccourcisVocaux />

      {/* Le signe de vie qui rend « en ligne » fiable. Voir `lib/presence.ts`. */}
      <Battement />

      {/* Les liens d'invitation, de salon et de message n'etaient recus par
          personne : le routeur ne connaissait que trois adresses fixes. */}
      <Arrivee />

      {/* L'image en grand, sans quitter la conversation. */}
      <Visionneuse />

      {/* L'assistant. La cle vit dans une fonction du projet, jamais ici. */}
      <EchowAI />

      {/* Ce qui attribue les badges. Sans lui, le catalogue est une decoration. */}
      <AttributionBadges />

      {/* Le temps passe en vocal, sans lequel ses paliers ne peuvent pas
          etre attribues. */}
      <TempsVocal />

      {/* Le tiroir suit le doigt depuis le bord gauche. Voir `glisse.ts` pour
          les seuils, qui sont ce qui rend le geste agreable ou penible. */}
      <TiroirGlissant actif={isMobile} />

      {/* Sur petit ecran, la navigation recouvre la conversation : il faut un
          voile pour la refermer, et l'ecarter des lecteurs d'ecran quand elle
          est fermee. */}
      {isMobile && navOpen ? (
        <button
          type="button"
          className="nav-scrim"
          onClick={closeNav}
          aria-label="Fermer la navigation"
        />
      ) : null}

      <div
        className="workspace__nav"
        inert={isMobile && !navOpen ? true : undefined}
      >
        <SpaceRail />
        <Sidebar />
      </div>

      <main className="main" id="conversation">
        {supportOpen && view === 'direct' ? (
          <Support />
        ) : suggestionsOpen && view === 'direct' ? (
          <Suggestions />
        ) : wavesOpen && view === 'direct' ? (
          <BadgesPage />
        ) : friendsOpen && view === 'direct' ? (
          <FriendsPage />
        ) : channel ? (
          <>
            <ChannelHeader channel={channel} />

            {/*
              Un appel prive occupe la place de la conversation.
              La scene vocale n'a rien de propre aux salons vocaux : elle prend
              un salon et en montre les participants. Une conversation privee en
              est un — sans espace — donc l'appel marche sans rien reecrire, et
              les messages reviennent des qu'on raccroche.
            */}
            {channel.kind === 'voice' || voiceChannelId === channel.id ? (
              /*
               * La scene, et son fil ecrit a cote quand on le demande.
               *
               * Cote a cote plutot que l'un a la place de l'autre : on ouvre
               * la discussion pendant qu'on parle, souvent pour y coller un
               * lien dont on discute justement. La masquer pour la lire n'a
               * pas de sens.
               */
              <div className={'scene' + (chatVocalOuvert ? ' scene--avec-fil' : '')}>
                <VoiceStage channel={channel} />

                {chatVocalOuvert ? (
                  <aside className="scene__fil" aria-label={`Discussion de ${channel.name}`}>
                    <MessageList channelId={channel.id} />
                    <Composer channelId={channel.id} />
                  </aside>
                ) : null}
              </div>
            ) : (
              <>
                <MessageList channelId={channel.id} />
                <Composer channelId={channel.id} autoFocus />
              </>
            )}
          </>
        ) : (
          <div className="main__empty">
            <span className="empty__icon">
              <Icon name={view === 'direct' ? 'thread' : 'hash'} size={26} />
            </span>

            {view === 'direct' ? (
              <>
                <h2>Aucune conversation ouverte</h2>
                <p>
                  Choisissez une conversation a gauche, ou demarrez-en une nouvelle.
                  Vous pouvez ecrire aux personnes avec qui vous partagez un espace.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => useUI.getState().openModal({ kind: 'new-dm' })}
                >
                  <Icon name="plus" size={15} />
                  Nouvelle conversation
                </button>
              </>
            ) : (
              <>
                <h2>Aucun salon selectionne</h2>
                <p>
                  Choisissez un salon a gauche, ou appuyez sur{' '}
                  <span className="kbd">Ctrl</span>
                  <span className="kbd">K</span> pour tout atteindre au clavier.
                </p>
              </>
            )}
          </div>
        )}
      </main>

      <SidePanel />
      <CommandPalette />
      <Modals />
      {settings ? <SettingsPage /> : null}

      {avertissement ? (
        <div className="toast is-avertissement" role="status">
          <Icon name="alert-triangle" size={14} />
          <span>{avertissement}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => useVoice.setState({ avertissement: null })}
            aria-label="Fermer"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="toast" role="alert">
          <Icon name="x" size={14} />
          <span>{error}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => useChat.setState({ error: null })}
            aria-label="Fermer"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
