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
 * Deux sortes de son : la voix, et le son de ce qui est partage. Ils arrivaient
 * autrefois dans le meme casier, ou le dernier effacait le premier.
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
 * Contexte partage, ouvert seulement si quelqu'un depasse cent pour cent.
 *
 * Un `<audio>` ne monte pas au-dessus de son volume d'origine : `volume` est
 * borne a un. Amplifier demande donc de passer par le graphe audio — mais
 * l'ouvrir pour tout le monde couterait un fil audio par personne, pour un
 * reglage que la plupart ne touchent jamais.
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

  /*
   * Une seule valeur, d'ou tout decoule.
   *
   * Se rendre sourd et couper quelqu'un ne sont pas des etats a part : ce sont
   * des gains a zero. Les traiter separement etait la cause d'un defaut serieux
   * — voir plus bas.
   */
  const gain = sourd || coupePersonne ? 0 : gainDepuisPosition(position) * outputVolume;

  useEffect(() => {
    const node = ref.current;
    if (!node || !stream) return;

    node.srcObject = stream;
    void node.play().catch(() => undefined);
  }, [stream]);

  /*
   * Le son passe par un seul chemin a la fois, et l'autre est reduit au silence.
   *
   * La version precedente choisissait le chemin a chaque rendu, sans defaire le
   * precedent. Deux consequences, et ce sont exactement les defauts observes :
   *
   *  - Une fois le graphe ouvert pour amplifier quelqu'un, redescendre sous
   *    cent pour cent reprenait l'element sans debrancher le graphe : on
   *    entendait les deux, ou plus rien du tout selon les volumes.
   *
   *  - L'attribut `muted` de l'element ne coupe pas le graphe. Se rendre sourd
   *    laissait donc passer les voix amplifiees, et surtout : `volume` avait ete
   *    mis a zero au moment de brancher le graphe, si bien qu'en revenant a
   *    l'element on obtenait un silence definitif. C'est le « je me demute et
   *    c'est comme si j'etais encore en sourdine » — il fallait relancer
   *    l'application, puisque rien ne remettait ce zero a sa place.
   *
   * Desormais le graphe, une fois ouvert, garde la main pour de bon : deux
   * chemins qui se relaient sont deux occasions de ne pas s'accorder.
   */
  useEffect(() => {
    const node = ref.current;
    if (!node || !stream) return;

    // Le graphe tient deja la sortie : on ne repasse pas par l'element.
    if (gainRef.current) {
      gainRef.current.gain.value = Math.max(0, gain);
      node.volume = 0;
      return;
    }

    if (gain <= 1) {
      node.volume = Math.max(0, gain);
      return;
    }

    const ctx = contexte();
    if (!ctx) {
      // Sans graphe, le son plafonne a cent pour cent. C'est une limite, pas un
      // silence : mieux vaut entendre moins fort que ne rien entendre.
      node.volume = 1;
      return;
    }

    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    try {
      const source = ctx.createMediaStreamSource(stream);
      const noeud = ctx.createGain();
      source.connect(noeud).connect(ctx.destination);
      gainRef.current = noeud;
      noeud.gain.value = gain;
      node.volume = 0;
    } catch {
      node.volume = 1;
    }
  }, [gain, stream]);

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
   * `muted` reste pose, en plus du gain.
   *
   * Il ne suffit pas — il n'a aucune prise sur le graphe — mais il coupe
   * l'element sans attendre le rendu suivant, et c'est le chemin qu'emprunte la
   * quasi-totalite des flux. Deux verrous plutot qu'un, sur ce qui doit se
   * taire immediatement.
   */
  return <audio ref={ref} autoPlay muted={sourd || coupePersonne} />;
}
