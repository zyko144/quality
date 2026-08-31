import { useEffect, useMemo, useState } from 'react';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { useUI } from '@/store/ui';
import { useVoice } from './useVoice';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { startRing, stopRing } from '@/lib/sounds';
import type { UUID } from '@/types/db';

/**
 * Appel entrant : une sonnerie, et de quoi decrocher.
 *
 * Une conversation privee est un salon vocal comme un autre. Quand quelqu'un y
 * entre alors qu'on n'y est pas, c'est un appel — il n'existe pas d'autre
 * raison d'y aller seul.
 *
 * La detection repose sur la presence, deja ecoutee pour afficher qui discute
 * ou. Rien de nouveau ne transite : ce qui manquait n'etait pas l'information,
 * c'etait le bruit qui la rend impossible a manquer.
 *
 * La sonnerie se tait toute seule dans trois cas : on decroche, l'autre
 * renonce, ou l'on refuse. Le refus vaut pour cet appel et pas pour les
 * suivants — refuser une fois ne doit pas rendre quelqu'un injoignable.
 */
export function Sonnerie() {
  const profile = useSession((state) => state.profile);
  const channels = useChat((state) => state.channels);
  const profiles = useChat((state) => state.profiles);
  const selectChannel = useUI((state) => state.selectChannel);

  const participantsParSalon = useVoice((state) => state.participantsByChannel);
  const salonRejoint = useVoice((state) => state.channelId);
  const connecting = useVoice((state) => state.connecting);
  const join = useVoice((state) => state.join);
  const refuserAppel = useVoice((state) => state.refuserAppel);

  const [refuses, setRefuses] = useState<UUID[]>([]);

  const appel = useMemo(() => {
    if (!profile || salonRejoint) return null;

    for (const channel of channels) {
      // Les conversations privees seules : dans un serveur, entrer en vocal
      // n'appelle personne.
      if (channel.space_id !== null) continue;
      if (refuses.includes(channel.id)) continue;

      const presents = participantsParSalon[channel.id] ?? [];
      if (presents.length === 0) continue;
      if (presents.some((entree) => entree.user_id === profile.id)) continue;

      return { channel, appelant: presents[0]!.user_id };
    }

    return null;
  }, [channels, participantsParSalon, profile, salonRejoint, refuses]);

  useEffect(() => {
    if (!appel) {
      stopRing();
      return;
    }

    startRing();
    return () => stopRing();
  }, [appel]);

  /*
   * Le refus s'oublie des que l'appel cesse.
   *
   * Sans cela, la liste grandirait sans fin et un salon refuse une fois ne
   * sonnerait plus jamais — ce qui est exactement ce qu'on ne veut pas.
   */
  useEffect(() => {
    if (refuses.length === 0) return;

    const encoreEnCours = refuses.filter(
      (id) => (participantsParSalon[id] ?? []).length > 0,
    );
    if (encoreEnCours.length !== refuses.length) setRefuses(encoreEnCours);
  }, [participantsParSalon, refuses]);

  if (!appel) return null;

  const qui = profiles[appel.appelant];

  return (
    <div className="sonnerie" role="alert">
      <span className="sonnerie__halo" aria-hidden="true">
        <Avatar profile={qui} size={44} />
      </span>

      <div className="sonnerie__corps">
        <p className="sonnerie__titre">{qui?.display_name ?? 'Quelqu’un'}</p>
        <p className="sonnerie__note">vous appelle</p>
      </div>

      <button
        type="button"
        className="btn btn--sm btn--primary sonnerie__repondre"
        disabled={connecting}
        onClick={() => {
          stopRing();
          selectChannel(appel.channel.id);
          void join(appel.channel.id, profile!.id);
        }}
      >
        {connecting ? <span className="spinner" /> : <Icon name="phone" size={15} />}
        Repondre
      </button>

      <button
        type="button"
        className="btn btn--sm btn--danger"
        onClick={() => {
          stopRing();
          // L'appelant est prevenu : sans cela il restait seul dans un salon
          // vide, sans savoir si l'on arrivait ou si l'on avait dit non.
          refuserAppel(appel.channel.id, appel.appelant);
          setRefuses((liste) => [...liste, appel.channel.id]);
        }}
        title="Refuser"
        aria-label="Refuser l’appel"
      >
        <Icon name="phone-off" size={15} />
      </button>
    </div>
  );
}
