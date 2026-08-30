import { useEffect, useRef } from 'react';
import { useVoice } from './useVoice';
import { useDevices, applySink } from '@/store/devices';
import { useUserAudio } from '@/store/userAudio';
import type { UUID } from '@/types/db';

/**
 * Le son des autres, independamment de ce qu'on regarde.
 *
 * Les balises audio vivaient dans la scene vocale. Quitter le salon vocal des
 * yeux — ouvrir #general, lire un fil, repondre a un message — demontait le
 * composant et emportait les balises avec lui : on n'entendait plus personne
 * alors qu'on etait toujours connecte. Le seul remede etait de revenir sur la
 * scene, ce qui n'a aucun sens quand on veut precisement parler en faisant
 * autre chose.
 *
 * Ce composant est monte une fois pour toutes, au-dessus de la navigation. Il
 * ne dessine rien.
 */

export function SortieAudio() {
  const remoteAudio = useVoice((state) => state.remoteAudio);
  const deafened = useVoice((state) => state.deafened);

  return (
    <>
      {Object.entries(remoteAudio).map(([userId, stream]) => (
        <Flux key={userId} userId={userId} stream={stream} sourd={deafened} />
      ))}
    </>
  );
}

function Flux({
  userId,
  stream,
  sourd,
}: {
  userId: UUID;
  stream: MediaStream | undefined;
  sourd: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const speakerId = useDevices((state) => state.media.speakerId);
  const outputVolume = useDevices((state) => state.media.outputVolume);
  const volumePersonne = useUserAudio((state) => state.getVolume(userId));
  const coupePersonne = useUserAudio((state) => state.isMuted(userId));

  useEffect(() => {
    const node = ref.current;
    if (!node || !stream) return;

    node.srcObject = stream;
    // Un flux qui arrive pendant que l'onglet est en arriere-plan ne demarre
    // pas toujours seul ; le refus est sans consequence ici.
    void node.play().catch(() => undefined);
  }, [stream]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Le volume general et celui de la personne se multiplient : baisser l'un
    // ou l'autre doit produire le meme resultat, et les additionner donnerait
    // des valeurs hors de l'echelle.
    node.volume = Math.min(1, Math.max(0, outputVolume * volumePersonne));
  }, [outputVolume, volumePersonne]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !speakerId) return;
    void applySink(node, speakerId);
  }, [speakerId]);

  return <audio ref={ref} autoPlay muted={sourd || coupePersonne} />;
}
