import { useEffect, useMemo } from 'react';
import { useChat } from '@/store/chat';
import { useVoice } from './useVoice';

/**
 * Ecoute la presence vocale de tout ce qui est joignable.
 *
 * Tous les serveurs, pas seulement celui qu'on regarde. C'est ce qui permet a
 * la pastille du rail d'annoncer que quelqu'un discute ailleurs — l'interet de
 * cette pastille etant precisement de le dire avant qu'on aille voir. Ecouter
 * le seul serveur ouvert revenait a ne l'afficher que la ou l'on etait deja.
 *
 * Les conversations privees en font partie : une privee est un salon vocal ou
 * l'on n'entre seul que pour appeler quelqu'un, et c'est cette meme ecoute qui
 * declenche la sonnerie.
 *
 * Monte une fois, au-dessus de la navigation, plutot que dans la barre
 * laterale : celle-ci se remonte en changeant de serveur, ce qui refermait puis
 * rouvrait tous les abonnements a chaque clic.
 */

/**
 * Plafond d'abonnements.
 *
 * Chacun est un canal Realtime ouvert en permanence. Une centaine de serveurs
 * en ferait autant, pour une pastille. Au-dela, on renonce aux derniers plutot
 * que de peser sur la connexion — la liste etant triee, ce sont les espaces les
 * plus anciens qui passent en premier.
 */
const PLAFOND = 40;

export function EcouteVocale() {
  const channels = useChat((state) => state.channels);
  const observerSalons = useVoice((state) => state.observerSalons);
  const salonRejoint = useVoice((state) => state.channelId);

  const salons = useMemo(
    () =>
      channels
        .filter((channel) => channel.kind === 'voice' || channel.space_id === null)
        .map((channel) => channel.id)
        .slice(0, PLAFOND),
    [channels],
  );

  useEffect(() => {
    observerSalons(salons);
    return () => observerSalons([]);
  }, [salons, salonRejoint, observerSalons]);

  return null;
}
