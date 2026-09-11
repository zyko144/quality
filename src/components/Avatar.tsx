import { useState } from 'react';
import { hueFor, initialsFor } from '@/constants';
import { AnimatedImage, isAnimatable } from '@/components/AnimatedImage';
import { useSession } from '@/store/session';
import { etatReel } from '@/lib/presence';
import type { PresenceStatus, Profile } from '@/types/db';

const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: 'En ligne',
  idle: 'Absent',
  dnd: 'Ne pas deranger',
  offline: 'Hors ligne',
};

interface AvatarProps {
  /*
   * Le profil porte aussi, quand on l'a, son dernier signe de vie.
   *
   * C'est ce qui permet de corriger la pastille ICI plutot qu'a la trentaine
   * d'endroits qui affichent un avatar. Les deux champs sont optionnels : bien
   * des appelants ne passent qu'un extrait du profil, et la pastille retombe
   * alors sur ce qui lui est donne.
   */
  profile:
    | (Pick<Profile, 'id' | 'display_name' | 'avatar_url'> &
        Partial<Pick<Profile, 'status' | 'derniere_presence'>>)
    | undefined;
  size?: number;
  status?: PresenceStatus;
  /** Affiche la pastille de presence. */
  showStatus?: boolean;
}

/**
 * Avatar avec repli sur les initiales.
 *
 * La couleur vient du profil et non d'un hachage calcule a l'affichage : elle
 * est donc identique partout, y compris entre deux appareils, ce qui aide a
 * reconnaitre quelqu'un du coin de l'oeil.
 */
export function Avatar({ profile, size = 38, status, showStatus = false }: AvatarProps) {
  const animate = useSession((state) => state.preferences.animateAvatars);
  const name = profile?.display_name ?? '?';
  // La teinte vient de l'identifiant et non du nom : renommer quelqu'un ne
  // change donc pas la nuance a laquelle on l'a associe.
  const seed = profile?.id ?? name;

  /*
   * L'adresse qui a echoue, et elle seule.
   *
   * Une photo que le moteur refuse de charger — adresse morte, hote que la
   * politique de securite de l'application n'autorise pas — laissait une
   * balise d'image vide dans un rond sombre : un trou noir a la place d'un
   * visage. C'est ce qu'ont vu tous les comptes Discord a leur retour dans
   * l'application de bureau, dont la politique n'autorisait pas encore
   * `cdn.discordapp.com`.
   *
   * On retombe alors sur les initiales, comme pour un profil sans photo.
   * L'echec est retenu PAR ADRESSE : une nouvelle photo est retentee d'elle-
   * meme, sans rien a effacer.
   */
  const [adresseEnEchec, setAdresseEnEchec] = useState<string | null>(null);
  const photo =
    profile?.avatar_url && profile.avatar_url !== adresseEnEchec ? profile.avatar_url : null;

  /*
   * La pastille dit ce qui est mesure, pas ce qui a ete declare.
   *
   * « En ligne » etait pose a la connexion et retire par une requete envoyee
   * pendant que la page disparait : une veille, un plantage, une coupure, et
   * l'on restait affiche en ligne indefiniment. La regle vit dans
   * `lib/presence.ts`, et l'appliquer ici la fait valoir partout d'un coup.
   */
  const presence = etatReel(status ?? profile?.status, profile?.derniere_presence);

  return (
    /*
     * Les quatre mesures, pas seulement deux.
     *
     * `width` et `height` seules se laissent contredire : un parent en flex
     * comprime la largeur sans toucher a la hauteur, un parent en grille
     * etire ou serre selon la colonne. On obtient un ovale, et la cause
     * change d'un ecran a l'autre — ce qui rend le defaut penible a
     * poursuivre. Les bornes minimales et maximales ferment la question une
     * fois pour toutes, quel que soit le mode de mise en page du parent.
     */
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        maxWidth: size,
        maxHeight: size,
      }}
    >
      {photo ? (
        // Le composant anime ne sert que pour un format qui peut l'etre :
        // pour un PNG il ajouterait un canevas et un rendu pour rien.
        isAnimatable(photo) ? (
          <AnimatedImage
            className="avatar__image"
            src={photo}
            alt=""
            mode={animate}
            onError={() => setAdresseEnEchec(photo)}
          />
        ) : (
          <img
            className="avatar__image"
            src={photo}
            alt=""
            loading="lazy"
            onError={() => setAdresseEnEchec(photo)}
          />
        )
      ) : (
        <span
          className="avatar__initials"
          style={{
            background: hueFor(seed),
            color: '#fff',
            fontSize: Math.max(9, Math.round(size * 0.36)),
          }}
          aria-hidden="true"
        >
          {initialsFor(name)}
        </span>
      )}

      {showStatus && presence ? (
        <span
          className={`avatar__status avatar__status--${presence}`}
          // Un quart plutot qu'un tiers : a trente pour cent, sur un grand
          // avatar, la pastille prenait plus de place que le visage n'en perd.
          style={{ width: Math.max(8, size * 0.24), height: Math.max(8, size * 0.24) }}
          title={STATUS_LABEL[presence]}
        >
          <span className="visually-hidden">{STATUS_LABEL[presence]}</span>
        </span>
      ) : null}
    </span>
  );
}

/** Pile d'avatars, pour les participants d'un fil ou d'un salon vocal. */
export function AvatarStack({
  profiles,
  size = 22,
  max = 4,
}: {
  profiles: (Profile | undefined)[];
  size?: number;
  max?: number;
}) {
  const shown = profiles.filter(Boolean).slice(0, max);
  const extra = profiles.filter(Boolean).length - shown.length;

  return (
    <span className="avatar-stack">
      {shown.map((profile, index) => (
        <span
          key={profile?.display_name ?? index}
          className="avatar-stack__item"
          style={{ marginLeft: index === 0 ? 0 : -size * 0.32 }}
        >
          <Avatar profile={profile} size={size} />
        </span>
      ))}
      {extra > 0 ? (
        <span className="avatar-stack__extra" style={{ height: size, marginLeft: 4 }}>
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
