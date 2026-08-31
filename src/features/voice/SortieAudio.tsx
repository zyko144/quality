import { useEffect, useRef } from 'react';
import { useVoice } from './useVoice';
import { useDevices, applySink } from '@/store/devices';
import { useUserAudio, gainDepuisPosition } from '@/store/userAudio';
import type { UUID } from '@/types/db';

/**
 * Le son des autres, monte au-dessus de la navigation.
 *
 * Les elements audio vivent ici plutot que dans la scene vocale : celle-ci est
 * demontee des qu'on change de salon, et le son mourait avec elle — on
 * n'entendait plus personne des qu'on allait lire un message ailleurs.
 *
 * Deux sortes de son, et c'est nouveau : la voix, et le son de ce qui est
 * partage. Ils arrivaient auparavant dans le meme casier, ou le dernier
 * effacait le premier — d'ou un son de partage qui n'arrivait jamais, ou une
 * voix qui disparaissait quand son auteur partageait son ecran.
 */
export function SortieAudio() {
  const remoteAudio = useVoice((state) => state.remoteAudio);
  const remoteScreenAudio = useVoice((state) => state.remoteScreenAudio);
  const deafened = useVoice((state) => state.deafened);

  return (
    <>
      {Object.entries(remoteAudio).map(([userId, stream]) => (
        <Flux key={`voix-${userId}`} userId={userId} stream={stream} sourd={deafened} genre="voix" />
      ))}

      {Object.entries(remoteScreenAudio).map(([userId, stream]) => (
        <Flux
          key={`partage-${userId}`}
          userId={userId}
          stream={stream}
          sourd={deafened}
          genre="partage"
        />
      ))}
    </>
  );
}

/**
 * Contexte partage pour l'amplification.
 *
 * Un `<audio>` ne monte pas au-dessus de son volume d'origine : `volume` est
 * borne a un. Pour depasser cent pour cent — utile pour quelqu'un dont le micro
 * est trop discret — il faut passer par le graphe audio.
 *
 * Un seul contexte pour tout le monde : en ouvrir un par personne couterait un
 * fil audio par personne, pour un reglage que la plupart ne touchent jamais.
 */
let contexteCommun: AudioContext | null = null;

function contexte(): AudioContext | null {
  if (contexteCommun) return contexteCommun;

  const Constructeur =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructeur) return null;

  try {
    contexteCommun = new Constructeur();
    return contexteCommun;
  } catch {
    return null;
  }
}

function Flux({
  userId,
  stream,
  sourd,
  genre,
}: {
  userId: UUID;
  stream: MediaStream | undefined;
  sourd: boolean;
  genre: 'voix' | 'partage';
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const gainRef = useRef<GainNode | null>(null);

  const speakerId = useDevices((state) => state.media.speakerId);
  const outputVolume = useDevices((state) => state.media.outputVolume);
  const volumeVoix = useUserAudio((state) => state.getVolume(userId));
  const volumePartage = useUserAudio((state) => state.getStreamVolume(userId));
  const coupePersonne = useUserAudio((state) => state.isMuted(userId));

  const position = genre === 'voix' ? volumeVoix : volumePartage;

  useEffect(() => {
    const node = ref.current;
    if (!node || !stream) return;

    node.srcObject = stream;
    // Un flux qui arrive pendant que la fenetre est en arriere-plan ne demarre
    // pas toujours seul ; le refus est sans consequence ici.
    void node.play().catch(() => undefined);
  }, [stream]);

  /*
   * L'amplification passe par le graphe, le reste par l'element.
   *
   * Sous cent pour cent, `volume` suffit et evite d'ouvrir un contexte audio.
   * Au-dessus, on branche un gain — et l'element est alors mis a un, sans quoi
   * les deux se multiplieraient.
   *
   * Si le contexte refuse de demarrer, on reste sur l'element : le son est
   * alors plafonne a cent pour cent, ce qui est une limite, pas un silence.
   */
  useEffect(() => {
    const node = ref.current;
    if (!node || !stream) return;

    const gain = gainDepuisPosition(position) * outputVolume;

    if (gain <= 1) {
      node.volume = Math.max(0, gain);
      return;
    }

    const ctx = contexte();
    if (!ctx) {
      node.volume = 1;
      return;
    }

    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    if (!gainRef.current) {
      try {
        const source = ctx.createMediaStreamSource(stream);
        const noeud = ctx.createGain();
        source.connect(noeud).connect(ctx.destination);
        gainRef.current = noeud;
      } catch {
        node.volume = 1;
        return;
      }
    }

    // L'element se tait : c'est le graphe qui produit le son a present, et le
    // laisser jouer ferait entendre les deux chemins a la fois.
    node.volume = 0;
    gainRef.current.gain.value = gain;
  }, [position, outputVolume, stream]);

  useEffect(
    () => () => {
      gainRef.current?.disconnect();
      gainRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const node = ref.current;
    if (!node || !speakerId) return;
    void applySink(node, speakerId);
  }, [speakerId]);

  /*
   * Se rendre sourd coupe tout, le partage comme la voix.
   *
   * Couper quelqu'un en particulier coupe aussi son partage : c'est le meme
   * geste, dirige contre la meme personne — on ne coupe pas quelqu'un pour
   * continuer d'entendre son jeu.
   */
  return <audio ref={ref} autoPlay muted={sourd || coupePersonne} />;
}
