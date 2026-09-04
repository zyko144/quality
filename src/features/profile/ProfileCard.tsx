import type React from 'react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { useUI } from '@/store/ui';
import { TiltCard } from '@/components/TiltCard';
import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { useBadges, badgesDe } from '@/store/badges';
import { useComptesLies, comptesVisibles, SERVICES } from '@/store/comptesLies';
import { LogoService } from '@/features/profile/ComptesLies';
import { hueFor } from '@/constants';
import { ROLE_LABEL, type Profile, type ProfileStats, type SpaceRole, type UUID } from '@/types/db';
import { AnimatedImage, isAnimatable } from '@/components/AnimatedImage';
import { BadgeVisual } from '@/components/BadgeVisual';
import { MemberRoles } from './MemberRoles';
import { lireCadrage, styleDeCadrage } from './cadrage';
import { useFriends } from '@/store/friends';

/**
 * Carte de profil.
 *
 * Elle ne montre aucun compteur d'activite. Le nombre de messages ecrits ne
 * renseigne sur personne, et place sous un visage il se lit comme une note.
 * Ce qu'on garde repond a la question qu'on se pose vraiment en ouvrant une
 * fiche : qui est cette personne, et d'ou est-ce que je la connais.
 */

/**
 * L'adresse, sans son `https://` ni son `www.`.
 *
 * C'est ce qu'on montre quand aucun nom n'a ete donne. Le protocole n'apprend
 * rien — tous les liens acceptes commencent par le meme — et il mange la
 * largeur d'une carte deja etroite.
 */
function sansProtocole(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

const ROLE_ICON: Record<SpaceRole, IconName> = {
  owner: 'sparkles',
  admin: 'settings',
  moderator: 'filter',
  member: 'users',
};

export function ProfileCard({ userId }: { userId: UUID }) {
  const profiles = useChat((state) => state.profiles);
  const openDm = useChat((state) => state.openDm);
  const me = useSession((state) => state.profile);
  const animate = useSession((state) => state.preferences.animateAvatars);
  const openModal = useUI((state) => state.openModal);
  const closeModal = useUI((state) => state.closeModal);
  const selectChannel = useUI((state) => state.selectChannel);
  const selectSpace = useUI((state) => state.selectSpace);
  const activeSpaceId = useUI((state) => state.activeSpaceId);
  const members = useChat((state) => state.members);
  const showDirectMessages = useUI((state) => state.showDirectMessages);
  const [opening, setOpening] = useState(false);

  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [onglet, setOnglet] = useState<'apropos' | 'espaces' | 'amis'>('apropos');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const mesAmis = useFriends((etat) => etat.friends);
  const mesDemandes = useFriends((etat) => etat.outgoing);
  const sendRequest = useFriends((etat) => etat.sendRequest);

  const dejaAmi = mesAmis.some((lien) => lien.user_id === userId);
  const demandeEnvoyee = mesDemandes.some((lien) => lien.user_id === userId);

  /*
   * Badges, comptes lies et activite du moment.
   *
   * Charges ici plutot qu'au demarrage de l'application : ils ne servent que
   * lorsqu'on regarde une fiche, et les charger pour tout le monde a l'ouverture
   * couterait trois requetes que personne ne regarde.
   */
  const catalogue = useBadges((etat) => etat.catalogue);
  const badgesParProfil = useBadges((etat) => etat.parProfil);
  const chargerBadges = useBadges((etat) => etat.charger);

  const comptesParProfil = useComptesLies((etat) => etat.parProfil);
  const activites = useComptesLies((etat) => etat.activites);
  const chargerComptes = useComptesLies((etat) => etat.charger);

  useEffect(() => {
    void chargerBadges();
    void chargerComptes([userId]);
  }, [userId, chargerBadges, chargerComptes]);
  const profile = profiles[userId] ?? (userId === me?.id ? me : undefined);

  useEffect(() => {
    setOnglet('apropos');
  }, [userId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.rpc('profile_stats', { p_user_id: userId });
      if (cancelled || !data) return;

      /*
       * La fonction SQL peut dater d'avant la migration qui a remplace les
       * compteurs par la liste des espaces communs. Elle renvoie alors un objet
       * sans `mutual_spaces`, et lire `.length` dessus ferait disparaitre toute
       * la fiche. On normalise plutot que de faire confiance a la forme.
       */
      const brut = data as Partial<ProfileStats>;
      setStats({
        joined_at: brut.joined_at ?? new Date().toISOString(),
        mutual_spaces: Array.isArray(brut.mutual_spaces) ? brut.mutual_spaces : [],
        mutual_friends: Array.isArray(brut.mutual_friends) ? brut.mutual_friends : [],
        roles: Array.isArray(brut.roles) ? brut.roles : [],
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!profile) {
    return (
      <div className="empty">
        <span className="empty__icon">
          <Icon name="users" size={26} />
        </span>
        <p className="empty__title">Profil introuvable</p>
        <p className="empty__body">
          Cette personne ne partage aucun espace avec vous, ou son compte a ete
          supprime.
        </p>
      </div>
    );
  }

  const isMe = profile.id === me?.id;

  // Ces champs viennent d'une migration qui peut ne pas encore etre appliquee :
  // `to_jsonb(profiles.*)` ne renvoie que les colonnes existantes, donc ils
  // arrivent alors en `undefined` plutot qu'en `null`.
  const hue = profile.theme_hue ?? null;
  const links = profile.links ?? [];
  const mesBadges = badgesDe(userId, badgesParProfil, catalogue);
  const sesComptes = comptesVisibles(comptesParProfil[userId], isMe);
  const activite = activites[userId] ?? null;

  const espaces = stats?.mutual_spaces ?? [];

  /*
   * Les roles appartiennent a un espace, pas a une personne : la meme fiche
   * ouverte depuis deux serveurs montre deux listes differentes. On prend donc
   * l'espace ou l'on se trouve.
   */
  const espaceCourant = activeSpaceId;
  const monRang = members.find(
    (membre) => membre.space_id === espaceCourant && membre.user_id === me?.id,
  )?.role;
  const peutGererRoles = monRang === 'owner' || monRang === 'admin';
  const amis = stats?.mutual_friends ?? [];

  /*
   * Les onglets communs n'existent que sur la fiche de quelqu'un d'autre.
   *
   * « Espaces en commun » avec soi-meme voudrait dire tous ses espaces, et
   * « amis en commun » tous ses amis : deux listes qu'on a deja ailleurs, et
   * qui n'apprennent rien ici.
   */
  const onglets = isMe
    ? ([{ id: 'apropos', label: 'A propos' }] as const)
    : ([
        { id: 'apropos', label: 'A propos' },
        { id: 'espaces', label: `Espaces (${espaces.length})` },
        { id: 'amis', label: `Amis (${amis.length})` },
      ] as const);
  // Le meme calcul que dans l'editeur : ce qu'on y a cadre est ce qui parait ici.
  const cadrage = lireCadrage(profile.banner_frame);

  const cardStyle =
    typeof hue === 'number' ? ({ '--hue-primary': hue } as React.CSSProperties) : undefined;

  return (
    <div className="profile" style={cardStyle}>
      {/*
        La banniere, floue, en fond de toute la fiche.
        Elle donne sa couleur a l'ensemble sans jamais disputer la lecture :
        floutee a ce point, il n'en reste que des masses colorees. Le texte
        passe dessus sur un voile sombre, jamais sur l'image nette.

        Le voile ne suit PAS le cadrage, et c'est voulu. Il porte un
        `scale(1.35)` en feuille de style, la pour cacher le lisere pale que
        laisse un flou de quarante-quatre pixels sur les quatre bords ; un
        cadrage a 1,1 ecraserait ce grossissement et ferait reparaitre le
        lisere. Rien n'est perdu : sous ce flou il ne reste que des masses
        colorees, ou aucun cadrage ne se percoit.
      */}
      <div className="profile__wash" aria-hidden="true">
        {profile.banner_url ? (
          <img src={profile.banner_url} alt="" className="profile__wash-image" />
        ) : (
          <span className="profile__wash-fallback" />
        )}
      </div>

      <TiltCard className="profile__card" glare>
        <div className="profile__grid">
          <div className="profile__aside">
            <div className="profile__banner">
              {profile.banner_url ? (
                isAnimatable(profile.banner_url) ? (
              <AnimatedImage
                src={profile.banner_url}
                alt=""
                className="profile__banner-image"
                style={styleDeCadrage(cadrage)}
                // Ouvrir une fiche est deja un geste delibere : la banniere
                // s'anime sans qu'il faille en plus la survoler.
                // « Jamais » reste respecte — c'est une demande, pas un
                // defaut.
                mode={animate === 'never' ? 'never' : 'always'}
              />
                ) : (
              <img
                src={profile.banner_url}
                alt=""
                className="profile__banner-image"
                style={styleDeCadrage(cadrage)}
              />
                )
              ) : (
                <span className="profile__banner-fallback" />
              )}

              {isMe ? (
                <button
              type="button"
              className="profile__banner-edit"
              onClick={() => openModal({ kind: 'edit-profile' })}
                >
              <Icon name="camera" size={15} />
              Changer
                </button>
              ) : null}
            </div>

            {/*
              La photo et la bulle de statut, cote a cote.

              Le statut etait une pastille posee sous le nom, sur le gris le
              plus sombre de la palette, large de toute la colonne. Il se lisait
              comme une ligne de plus dans une fiche qui en a deja beaucoup.

              A cote du visage, il se lit comme ce qu'il est : quelque chose que
              cette personne DIT, en ce moment. C'est la meme convention que
              partout ailleurs — une bulle attachee a qui parle — et elle ne
              demande aucune explication.
            */}
            <div className="profile__tete">
            <div className="profile__avatar">
              {isMe ? (
                <button
                  type="button"
                  className="profile__avatar-edit"
                  onClick={() => openModal({ kind: 'edit-profile' })}
                  aria-label="Changer ma photo de profil"
                >
                  <Avatar profile={profile} size={96} status={profile.status} showStatus />
                  <span className="profile__avatar-veil" aria-hidden="true">
                    <Icon name="camera" size={20} />
                  </span>
                </button>
              ) : (
                <Avatar profile={profile} size={96} status={profile.status} showStatus />
              )}
            </div>

            {profile.custom_status ? (
              <p
                className="profile__bulle"
                style={
                  {
                    '--bulle': profile.status_couleur ?? 'var(--accent)',
                    '--bulle-opacite': profile.status_opacite ?? 0.85,
                  } as React.CSSProperties
                }
                title={profile.custom_status}
              >
                {profile.custom_status}
              </p>
            ) : null}
            </div>

            <div className="profile__identity">
              {/*
                Les badges obtenus se rangent a droite du nom.

                Ils etaient plus bas, en pastilles portant leur nom en toutes
                lettres — une deuxieme liste sous celle des roles, qui poussait
                le statut et la suite de la fiche vers le bas et se lisait comme
                un inventaire. Un badge n'est pas une ligne d'inventaire : c'est
                une marque a cote du nom, et c'est la qu'on la cherche.

                Le nom du badge passe dans l'infobulle. A cette taille le dessin
                se reconnait sans etre nomme, et il en faut plusieurs sur une
                ligne.
              */}
              <div className="profile__ligne-nom">
                <h2 className="profile__name">{profile.display_name}</h2>

                {mesBadges.length > 0 ? (
                  <ul className="profile__fanions">
                    {mesBadges.map(({ badge, obtenu }) => (
                      <li
                        key={badge.cle}
                        title={
                          `${badge.nom} : ${badge.description}` +
                          (obtenu.position !== null ? ` (n°${obtenu.position})` : '')
                        }
                      >
                        <BadgeVisual
                          badgeCle={badge.cle}
                          nom={badge.nom}
                          teinte={badge.teinte}
                          size={19}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <p className="profile__handle">
                {/*
                  Le pseudo sans arobase.
                  
                  Elle sert a MENTIONNER quelqu'un — dans un message, dans une
                  recherche. Sur sa propre fiche il n'y a personne a mentionner :
                  elle ne fait qu'ajouter un caractere devant un nom qui se
                  suffit.
                */}
                {profile.username}
                {profile.pronouns ? (
                  <>
                    <span className="profile__dot" aria-hidden="true">
                      ·
                    </span>
                    {profile.pronouns}
                  </>
                ) : null}
              </p>
            </div>

            {stats && stats.roles.length > 0 ? (
              <ul className="profile__badges">
                {stats.roles.map((role) => (
                  <li key={role} className={`profile-badge profile-badge--${role}`}>
                    <Icon name={ROLE_ICON[role]} size={13} />
                    {ROLE_LABEL[role]}
                  </li>
                ))}
              </ul>
            ) : null}

            {/*
              Ce qui est ecoute ou diffuse en ce moment.

              Pose juste sous l'etat personnalise parce que c'en est un, en
              plus vrai : il n'a pas besoin d'etre tenu a jour a la main.
            */}
            {activite ? (
              <a
                className="profile__activite"
                href={activite.lien_url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                {activite.image_url ? (
                  <img className="profile__activite-image" src={activite.image_url} alt="" />
                ) : null}

                <span className="profile__activite-corps">
                  <span className="profile__activite-genre">
                    {activite.genre === 'ecoute'
                      ? 'Ecoute'
                      : activite.genre === 'direct'
                        ? 'En direct'
                        : 'Joue a'}
                  </span>
                  <span className="profile__activite-titre truncate">{activite.titre}</span>
                  {activite.detail ? (
                    <span className="profile__activite-detail truncate">{activite.detail}</span>
                  ) : null}
                </span>
              </a>
            ) : null}

            {isMe ? (
              <button
                type="button"
                className="btn btn--primary profile__action"
                onClick={() => openModal({ kind: 'edit-profile' })}
              >
                <Icon name="edit" size={15} />
                Modifier mon profil
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary profile__action"
                disabled={opening}
                onClick={() => {
                  setOpening(true);
                  void openDm(profile.id).then((channel) => {
                    setOpening(false);
                    if (!channel) return;
                    showDirectMessages();
                    selectChannel(channel.id);
                    closeModal();
                  });
                }}
              >
                {opening ? <span className="spinner" /> : <Icon name="send" size={15} />}
                Envoyer un message
              </button>
            )}

            {/*
              L'ajout en ami, depuis la fiche.
              
              Il n'existait qu'au clic droit — dans la liste des salons, dans le
              vocal. Or la fiche est justement l'endroit ou l'on decide si l'on
              veut connaitre quelqu'un : on vient d'y lire sa bio, ses liens, ses
              espaces en commun. Devoir la fermer pour aller le chercher ailleurs
              defaisait le geste au moment ou il etait le plus naturel.
              
              Trois etats, et aucun n'est cache : ajouter, attendre, ou rien
              parce que c'est deja fait. Un bouton qui disparait sans explication
              laisse chercher ce qu'on a mal fait.
            */}
            {!isMe && !dejaAmi ? (
              <button
                type="button"
                className="btn profile__action profile__ajouter"
                disabled={demandeEnvoyee || envoiEnCours}
                onClick={() => {
                  setEnvoiEnCours(true);
                  void sendRequest(profile.username).finally(() => setEnvoiEnCours(false));
                }}
              >
                {envoiEnCours ? (
                  <span className="spinner" />
                ) : (
                  <Icon name={demandeEnvoyee ? 'check' : 'user-plus'} size={15} />
                )}
                {demandeEnvoyee ? 'Demande envoyee' : 'Ajouter en ami'}
              </button>
            ) : null}

            <p className="profile__since">
              {stats
                ? `Parmi nous depuis le ${new Intl.DateTimeFormat('fr-FR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }).format(new Date(stats.joined_at))}`
                : ' '}
            </p>
          </div>

          {/*
            La colonne de droite change de contenu, la gauche jamais.
            Bio, espaces et amis ne se regardent pas en meme temps : les
            empiler faisait defiler une carte qui tient largement en hauteur.
          */}
          <div className="profile__main">
            <nav className="profile__tabs" aria-label="Sections du profil">
              {onglets.map((entree) => (
                <button
                  key={entree.id}
                  type="button"
                  className={'profile__tab' + (onglet === entree.id ? ' is-active' : '')}
                  aria-current={onglet === entree.id ? 'page' : undefined}
                  onClick={() => setOnglet(entree.id)}
                >
                  {entree.label}
                </button>
              ))}
            </nav>

            <div className="profile__panel">
              {onglet === 'apropos' ? (
                <>
                  {/*
                    Les roles se donnent ici : c'est en regardant quelqu'un
                    qu'on decide de lui confier quelque chose. Passer par les
                    reglages de l'espace obligerait a quitter la fiche, le
                    retrouver dans une seconde liste, et revenir.
                  */}
                  {espaceCourant && !isMe ? (
                    <MemberRoles
                      spaceId={espaceCourant}
                      userId={profile.id}
                      peutModifier={peutGererRoles}
                    />
                  ) : null}

                  {profile.bio ? (
                    <p className="profile__bio">{profile.bio}</p>
                  ) : (
                    <p className="profile__empty">
                      {isMe
                        ? "Vous n'avez encore rien ecrit sur vous."
                        : "Cette personne n'a rien ecrit sur elle."}
                    </p>
                  )}

                  {/*
                    Les comptes lies vivent ici, et non plus dans la colonne.

                    Ils y etaient coinces sous l'avatar, dans une bande etroite
                    qui coupait les noms a cent quatre-vingts pixels et les
                    posait sous le bouton d'action, la ou l'oeil ne va pas. « A
                    propos » est l'endroit ou l'on cherche qui est quelqu'un —
                    c'est la meme question que « ou le retrouver ailleurs ».

                    Ils passent AVANT les liens libres : un compte verifie vaut
                    mieux qu'une adresse tapee a la main, et l'ordre le dit.
                  */}
                  {sesComptes.length > 0 ? (
                    <section className="profile__bloc">
                      <h4 className="profile__bloc-titre">Comptes lies</h4>

                      <ul className="profile__comptes">
                        {sesComptes.map((compte) => (
                          <li key={compte.service}>
                            <a
                              className="profile__compte"
                              style={
                                {
                                  '--teinte': SERVICES[compte.service].teinte,
                                } as React.CSSProperties
                              }
                              href={SERVICES[compte.service].profil(compte.identifiant)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Ouvrir le profil ${SERVICES[compte.service].nom} de ${compte.nom_affiche}`}
                            >
                              <span className="profile__compte-marque" aria-hidden="true">
                                <LogoService service={compte.service} taille={18} />
                              </span>

                              {/*
                                Le nom du SERVICE, et rien d'autre.

                                Le pseudo tenait la seconde ligne. Il n'apprend
                                rien a qui regarde — on veut savoir « ou », pas
                                « sous quel nom », et le nom se lit de toute
                                facon en arrivant sur la page. Il obligeait en
                                revanche a une carte deux fois plus haute, et
                                se coupait des qu'il depassait.
                              */}
                              <span className="profile__compte-service">
                                {SERVICES[compte.service].nom}
                              </span>

                              <Icon name="link" size={13} aria-hidden="true" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {/*
                    Les liens libres, SOUS les comptes lies et sous leur propre
                    titre.

                    Ils suivaient les cartes de comptes sans separation : les
                    deux series se touchaient et se lisaient comme une seule,
                    alors qu'elles ne disent pas la meme chose — un compte lie
                    designe un service, un lien designe une page.

                    Sans nom, on montre l'adresse entiere. C'est ce qu'on aurait
                    tape de toute facon, et c'est plus honnete qu'un intitule
                    invente.
                  */}
                  {links.length > 0 ? (
                    <section className="profile__bloc">
                      <h4 className="profile__bloc-titre">Liens</h4>

                      <ul className="profile__links">
                        {links.map((link) => (
                          <li key={link.url}>
                            <a
                              className="profile-link"
                              style={
                                link.couleur
                                  ? ({ '--lien': link.couleur } as React.CSSProperties)
                                  : undefined
                              }
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              title={link.url}
                            >
                              <Icon name="link" size={13} />
                              <span className="truncate">
                                {link.label ?? sansProtocole(link.url)}
                              </span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </>
              ) : null}

              {onglet === 'espaces' ? (
                espaces.length === 0 ? (
                  <p className="profile__empty">
                    Vous ne partagez aucun espace. Cette fiche ne montre donc que
                    ce que cette personne a choisi d&rsquo;y ecrire.
                  </p>
                ) : (
                  <ul className="profile__mutual-list">
                    {espaces.map((space) => (
                      <li key={space.id}>
                        <button
                          type="button"
                          className="profile-mutual"
                          onClick={() => {
                            selectSpace(space.id);
                            closeModal();
                          }}
                        >
                          {space.icon_url ? (
                            <img src={space.icon_url} alt="" className="profile-mutual__icon" />
                          ) : (
                            <span
                              className="profile-mutual__icon profile-mutual__icon--letter"
                              style={{ background: hueFor(space.id) }}
                              aria-hidden="true"
                            >
                              {space.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span className="truncate">{space.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}

              {onglet === 'amis' ? (
                amis.length === 0 ? (
                  <p className="profile__empty">Aucune connaissance commune.</p>
                ) : (
                  <ul className="profile__mutual-list">
                    {amis.map((ami) => (
                      <li key={ami.id}>
                        <button
                          type="button"
                          className="profile-mutual"
                          onClick={() => openModal({ kind: 'profile', userId: ami.id })}
                        >
                          <Avatar profile={ami as Profile} size={32} />
                          <span className="truncate">{ami.display_name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          </div>
        </div>
      </TiltCard>
    </div>
  );
}

/** Vignette compacte, utilisee dans les listes de membres. */
export function ProfileTile({
  profile,
  role,
  onOpen,
}: {
  profile: Profile;
  role?: SpaceRole;
  onOpen: (id: UUID) => void;
}) {
  return (
    <button type="button" className="card card--interactive member-tile" onClick={() => onOpen(profile.id)}>
      <span
        className="member-tile__wash"
        style={{ background: hueFor(profile.id) }}
        aria-hidden="true"
      />
      <Avatar profile={profile} size={44} status={profile.status} showStatus />

      <span className="member-tile__body">
        <span className="member-tile__name truncate">{profile.display_name}</span>
        <span className="member-tile__handle truncate">
          {profile.custom_status ?? `@${profile.username}`}
        </span>
      </span>

      {role && role !== 'member' ? (
        <span className={`profile-badge profile-badge--${role}`}>
          <Icon name={ROLE_ICON[role]} size={12} />
          {ROLE_LABEL[role]}
        </span>
      ) : null}
    </button>
  );
}
