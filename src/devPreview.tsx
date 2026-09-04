import type { ReactNode } from 'react';
import { FriendsPage } from '@/features/friends/FriendsPage';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { useChat } from '@/store/chat';
import { ProfileEditor } from '@/features/profile/ProfileEditor';
import { useSession } from '@/store/session';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useUI, type SettingsSection } from '@/store/ui';
import { RetourScreen } from '@/features/maintenance/RetourScreen';
import { MaintenanceScreen } from '@/features/maintenance/MaintenanceScreen';
import { BadgesPage } from '@/features/badges/BadgesPage';
import { useBadges, type Badge } from '@/store/badges';
import { useComptesLies } from '@/store/comptesLies';
import { LinkPreviews } from '@/features/messages/LinkPreview';

/**
 * Apercu d'un ecran isole, en developpement seulement.
 *
 * Les pages des amis et des parametres ne s'atteignent qu'une fois connecte :
 * verifier leur mise en page demanderait un compte a chaque retouche de style.
 * `?preview=amis` ou `?preview=parametres:voix` les affiche a vide.
 *
 * Les magasins ne sont pas alimentes : ce sont les etats vides que l'on voit,
 * ce qui est justement le cas le plus facile a laisser se degrader.
 *
 * Ce module n'est importe que sous `import.meta.env.DEV`, valeur figee a la
 * compilation : rien de tout cela ne part dans le paquet livre.
 */
export function devPreview(name: string): ReactNode | null {
  if (name === 'amis') return <FriendsPage />;

  /*
   * L'ecran de retour ne s'atteint qu'une fois : a la levee de la maintenance,
   * et seulement pour qui ne l'a pas deja vu. Le verifier en vrai demanderait
   * de basculer le drapeau, de publier, puis de vider son stockage a chaque
   * retouche.
   */
  if (name === 'retour') return <RetourScreen onEntrer={() => {}} />;

  // L'ecran rouge, pour verifier que la mise en variables de sa palette ne l'a
  // pas abime : c'est la meme feuille qui sert aux deux.
  if (name === 'maintenance') return <MaintenanceScreen />;

  /*
   * Les apercus de liens, hors conversation.
   *
   * Leur couleur vient du domaine vise : la verifier demanderait sinon
   * d'ecrire six messages dans un vrai salon, a chaque retouche de style.
   */
  if (name === 'apercus') {
    const liens = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://twitch.tv/zyko682',
      'https://open.spotify.com/album/1234567890',
      'https://github.com/zyko144/quality',
      'https://fr.wikipedia.org/wiki/Echo',
      'https://un-site-inconnu.example/page/interne',
    ].join(' ');

    return (
      <div style={{ maxWidth: 520, margin: '32px auto' }}>
        <LinkPreviews content={liens} limite={6} />
      </div>
    );
  }

  if (name === 'badges') {
    /*
     * Les badges, avec un catalogue pose a la main.
     *
     * C'est le seul ecran dont l'apparence depend de donnees qu'aucun etat vide
     * ne represente : un badge se dessine d'apres sa cle et sa teinte, et son
     * eclat d'apres qu'on le possede ou non. A vide, la page ne montre rien du
     * tout — donc pas ce qu'il faut regarder.
     *
     * L'echantillon couvre les cinq paliers d'eclat et les deux etats, parce
     * que ce qui se verifie ici est justement leur DIFFERENCE : un catalogue
     * ou tout brille ne recompense plus rien, et cela ne se voit qu'en mettant
     * cote a cote ce qu'on a et ce qu'on n'a pas.
     */
    const echantillon: Badge[] = [
      ['pionnier', '100 premiers soutiens', 'Parmi les cent premiers comptes ouverts sur Echow.', 'soutien', '#f59e0b', 100, 1],
      ['premiere-heure', 'Premiere heure', 'Present le jour de l’ouverture. Ne pourra plus jamais etre obtenu.', 'soutien', '#ec4899', null, 2],
      ['equipe', 'Equipe Echow', 'Membre de l’equipe qui construit Echow.', 'equipe', '#6366f1', null, 3],
      ['rapporteur', 'Bug Hunter', 'A signale un defaut qui a ete corrige.', 'succes', '#10b981', null, 4],
      ['espace-100', 'Batisseur — 100', 'A cree un espace qui compte au moins cent membres.', 'succes', '#22c55e', null, 10],
      ['espace-1m', 'Batisseur — 1M', 'A cree un espace qui compte au moins un million de membres.', 'succes', '#f43f5e', null, 13],
      ['messages-10k', 'Plume — 10 000', 'A ecrit dix mille messages.', 'succes', '#38bdf8', null, 20],
      ['messages-500k', 'Plume — 500 000', 'A ecrit cinq cent mille messages.', 'succes', '#f97316', null, 23],
      ['messages-1m', 'Plume — 1 million', 'A ecrit un million de messages.', 'succes', '#ec4899', null, 24],
      ['messages-100k', 'Plume — 100 000', 'A ecrit cent mille messages.', 'succes', '#a855f7', null, 22],
      ['espace-10k', 'Batisseur — 10 000', 'A cree un espace qui compte au moins dix mille membres.', 'succes', '#06b6d4', null, 11],
      ['espace-100k', 'Batisseur — 100 000', 'A cree un espace qui compte au moins cent mille membres.', 'succes', '#8b5cf6', null, 12],
      ['anciennete-3ans', 'Veteran — 3 ans', 'Compte ouvert depuis plus de trois ans.', 'anciennete', '#f59e0b', null, 41],
      ['anciennete-7ans', 'Veteran — 7 ans', 'Compte ouvert depuis plus de sept ans.', 'anciennete', '#e11d48', null, 43],
      ['anciennete-10ans', 'Veteran — 10 ans', 'Compte ouvert depuis plus de dix ans.', 'anciennete', '#8b5cf6', null, 44],
      ['vocal-50', 'Voix — 50 h', 'A passe cinquante heures en salon vocal.', 'succes', '#a855f7', null, 310],
      ['vocal-150', 'Voix — 150 h', 'A passe cent cinquante heures en salon vocal.', 'succes', '#7c3aed', null, 320],
      ['vocal-1000', 'Voix — 1 000 h', 'A passe mille heures en salon vocal.', 'succes', '#eab308', null, 340],
      ['vocal-5000', 'Voix — 5 000 h', 'A passe cinq mille heures en salon vocal.', 'succes', '#d946ef', null, 360],
      ['anciennete-1an', 'Veteran — 1 an', 'Compte ouvert depuis plus d’un an.', 'anciennete', '#94a3b8', null, 40],
      ['anciennete-5ans', 'Veteran — 5 ans', 'Compte ouvert depuis plus de cinq ans.', 'anciennete', '#3b82f6', null, 42],
    ].map(([cle, nom, description, famille, teinte, limite, rang]) => ({
      cle, nom, description, famille, teinte, limite, rang,
    })) as Badge[];

    const moi = '00000000-0000-4000-8000-000000000003';
    useSession.setState({ profile: { id: moi } as never });
    useBadges.setState({
      catalogue: echantillon,
      // Deux badges possedes, de deux paliers differents : un mythique et un
      // epique. C'est a eux qu'on compare les mythiques et epiques d'en bas.
      parProfil: {
        [moi]: [
          { badge_cle: 'pionnier', position: 1, obtenu_le: '2026-08-26T00:12:00.000Z' },
          { badge_cle: 'vocal-150', position: null, obtenu_le: '2026-09-01T09:00:00.000Z' },
        ],
      },
      compte: { pionnier: 1, 'vocal-150': 4 },
      chargement: false,
      // `charger` ecraserait l'echantillon des le montage.
      charger: async () => {},
    });

    return <BadgesPage />;
  }

  if (name === 'profil' || name === 'profil:moi') {
    // Un profil rempli, pose directement dans le magasin : la carte se lit mal
    // a vide, or c'est justement la version pleine — banniere, bio, liens,
    // espaces en commun — qu'il faut regarder quand on retouche sa mise en
    // page.
    const faux = {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'lumine',
      display_name: 'Lumine',
      avatar_url: null,
      banner_url: null,
      bio: "Je lis plus que je n'ecris. Ping-moi si quelque chose brule.",
      pronouns: 'elle',
      custom_status: 'Au calme jusqu’a jeudi',
      status: 'online',
      theme_hue: 268,
      links: [
        // Un lien nomme, un lien sans nom, un lien colore : les trois formes.
        { label: 'Mon portfolio', url: 'https://lumine.example', couleur: '#f59e0b' },
        { url: 'https://exemple.fr/une/page/assez/longue' },
      ],
      status_couleur: '#5865f2',
      status_opacite: 0.85,
      username_chosen: true,
      created_at: '2025-03-14T10:00:00.000Z',
    };

    useChat.setState((state) => ({ profiles: { ...state.profiles, [faux.id]: faux as never } }));

    /*
     * Quelques badges, sinon la ligne du nom se verifie a vide.
     *
     * C'est justement leur place a cote du nom qu'on regarde ici, et une fiche
     * sans badge ne montre pas ce qu'on cherche : comment un nom long cohabite
     * avec plusieurs dessins, et ce qui se passe quand la ligne deborde.
     */
    useBadges.setState({
      catalogue: [
        ['pionnier', '100 premiers soutiens', 'Parmi les cent premiers comptes ouverts sur Echow.', 'soutien', '#f59e0b', 100, 1],
        ['premiere-heure', 'Premiere heure', 'Present le jour de l’ouverture.', 'soutien', '#ec4899', null, 2],
        ['rapporteur', 'Bug Hunter', 'A signale un defaut qui a ete corrige.', 'succes', '#10b981', null, 4],
        ['messages-100k', 'Plume — 100 000', 'A ecrit cent mille messages.', 'succes', '#a855f7', null, 22],
        ['anciennete-3ans', 'Veteran — 3 ans', 'Compte ouvert depuis plus de trois ans.', 'anciennete', '#f59e0b', null, 41],
      ].map(([cle, nom, description, famille, teinte, limite, rang]) => ({
        cle, nom, description, famille, teinte, limite, rang,
      })) as Badge[],
      parProfil: {
        [faux.id]: [
          { badge_cle: 'pionnier', position: 7, obtenu_le: '2026-08-26T00:20:00.000Z' },
          { badge_cle: 'premiere-heure', position: null, obtenu_le: '2026-08-26T00:20:00.000Z' },
          { badge_cle: 'rapporteur', position: null, obtenu_le: '2026-08-30T10:00:00.000Z' },
          { badge_cle: 'messages-100k', position: null, obtenu_le: '2026-09-01T10:00:00.000Z' },
          { badge_cle: 'anciennete-3ans', position: null, obtenu_le: '2026-09-01T10:00:00.000Z' },
        ],
      },
      chargement: false,
      charger: async () => {},
    });

    /*
     * Des comptes lies, sinon le bloc « A propos » se verifie a vide.
     *
     * C'est leur mise en page qu'on regarde ici : comment plusieurs cartes se
     * rangent sous la bio, et ce que devient un nom de compte trop long.
     */
    useComptesLies.setState({
      parProfil: {
        [faux.id]: [
          { service: 'twitch', identifiant: 'lumine', nom_affiche: 'lumine', visible: true },
          { service: 'spotify', identifiant: 'lumine', nom_affiche: 'Lumine', visible: true },
          { service: 'github', identifiant: 'lumine', nom_affiche: 'lumine-dev', visible: true },
          {
            service: 'steam',
            identifiant: 'lumine',
            nom_affiche: 'un nom de compte vraiment tres long',
            visible: true,
          },
        ],
      },
      charger: async () => {},
    });

    /*
     * `?preview=profil:moi` ouvre sa PROPRE fiche.
     *
     * C'est un autre rendu : l'avatar y est enveloppe dans un bouton, la
     * banniere porte « Changer », et les onglets communs disparaissent. Ce
     * chemin n'etait couvert par aucun apercu, et c'est precisement celui que
     * l'on voit tous les jours.
     */
    if (name.endsWith(':moi')) useSession.setState({ profile: faux as never });

    // La largeur de la boite qui l'accueille dans l'application : sans elle,
    // la carte s'etale sur tout l'ecran et sa mise en page n'a plus rien a
    // voir avec ce que l'on verra.
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <ProfileCard userId={faux.id} />
      </div>
    );
  }

  if (name === 'editeur' || name.startsWith('parametres')) {
    // Ces ecrans ne s'ouvrent qu'une fois connecte. Sans profil dans le
    // magasin, « Mon compte » ne rend rien du tout — soit exactement l'ecran
    // qu'on cherche a verifier.
    const faux = {
      id: '00000000-0000-4000-8000-000000000002',
      username: 'zyko682',
      display_name: 'ex',
      avatar_url: null,
      /*
       * Une banniere, ici, plutot que `null`.
       *
       * Le reglage de cadrage n'apparait qu'avec une image — sans elle, il n'a
       * rien a montrer ni rien a regler. Un apercu sans banniere ne permettrait
       * donc jamais de le voir, ce qui est precisement l'inverse de ce que cet
       * ecran sert a faire.
       */
      banner_url: '/quality_logo.png',
      banner_frame: null,
      bio: null,
      pronouns: null,
      custom_status: null,
      status: 'online',
      theme_hue: null,
      links: [],
      username_chosen: true,
      created_at: '2026-03-14T10:00:00.000Z',
    };

    useSession.setState({ profile: faux as never });

    if (name === 'editeur') return <ProfileEditor open onClose={() => {}} />;

    const section = name.split(':')[1] ?? 'compte';
    useUI.getState().openSettings(section as SettingsSection);
    return <SettingsPage />;
  }

  return null;
}
