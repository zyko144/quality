import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { playCue } from '@/lib/sounds';
import {
  useDevices,
  audioConstraints,
  videoConstraints,
  screenConstraints,
  screenBitrate,
  cameraBitrate,
  audioBitrate,
  applyAudioEncoding,
  ameliorerOpus,
  applyEncodingWithRetry,
  preferVideoCodec,
} from '@/store/devices';
import { useChat } from '@/store/chat';
import { useSpacePrefs } from '@/store/spacePrefs';
import { ouvrirPorte, type Porte } from './porte';
import { serveursIce, comporteUnRelais } from './reseau';
import type { UUID, VoiceParticipant, VoiceSignal } from '@/types/db';

/**
 * Role d'un flux video.
 *
 * Camera et partage d'ecran arrivent tous deux comme des pistes `video` :
 * rien dans WebRTC ne les distingue. Chaque emetteur annonce donc le role de
 * son flux par son identifiant, et le recepteur fait la correspondance.
 */
type StreamPurpose = 'camera' | 'screen';

interface StreamInfo {
  kind: 'stream-info';
  from: UUID;
  to: UUID;
  streamId: string;
  purpose: StreamPurpose;
}

/**
 * Demande de deconnexion, envoyee par la moderation.
 *
 * RESERVE, et elle est entiere : c'est une demande, pas une contrainte. Le
 * client de la personne visee la recoit et quitte le salon de lui-meme. Un
 * client modifie pourrait l'ignorer et rester.
 *
 * L'imposer demanderait que le serveur tienne la liste des presents et refuse
 * la connexion — or la presence de Realtime est declarative, chaque client
 * annonce la sienne. Ce serait un autre transport, pas un correctif.
 *
 * Cela suffit pour ce a quoi cela sert : sortir quelqu'un d'un salon ou il
 * gene, entre gens qui utilisent le meme logiciel.
 */
interface Deconnexion {
  kind: 'deconnexion';
  from: UUID;
  to: UUID;
}

/**
 * Refus d'un appel.
 *
 * Envoye par quelqu'un qui n'est pas dans le salon — c'est tout l'interet :
 * sans lui, refuser ne faisait taire que sa propre sonnerie, et l'appelant
 * restait seul dans un salon vide sans savoir si l'autre arrivait, n'avait rien
 * vu, ou avait dit non.
 *
 * Il passe par le canal du salon, auquel on est deja abonne pour savoir qui s'y
 * trouve. Rien de nouveau a ouvrir.
 */
interface Refus {
  kind: 'refus';
  from: UUID;
  to: UUID;
}

/**
 * Demande de deplacement vers un autre salon.
 *
 * Meme nature que `Deconnexion` — une demande, pas une contrainte — et meme
 * reserve : un client modifie peut l'ignorer. Elle porte simplement le salon
 * d'arrivee, faute de quoi la personne se retrouverait dehors sans savoir ou
 * aller.
 */
interface Deplacement {
  kind: 'deplacement';
  from: UUID;
  to: UUID;
  salon: UUID;
}

type VoiceMessage = VoiceSignal | StreamInfo | Deconnexion | Refus | Deplacement;

/**
 * Salons vocaux en WebRTC maille.
 *
 * Chaque participant ouvre une connexion directe vers chacun des autres. Le
 * serveur ne voit jamais l'audio : il ne relaie que la signalisation, via un
 * canal Broadcast de Supabase. La latence est donc celle d'un lien direct, et
 * la conversation reste chiffree de bout en bout par construction.
 *
 * Contrepartie a connaitre : en maillage, chacun envoie son flux a tous les
 * autres. Le cout monte au carre du nombre de personnes, ce qui reste
 * confortable jusqu'a six ou huit participants et devient lourd au-dela.
 * Passer cette limite demanderait un serveur de melange (SFU), qui n'a pas sa
 * place dans une architecture sans backend.
 */

/**
 * Serveurs de decouverte et de relais.
 *
 * Voir `reseau.ts` : ils sont demandes au serveur a l'entree dans un salon,
 * de facon a pouvoir porter des identifiants temporaires. Ce qui est compile
 * dans le binaire ne sert plus que de repli.
 *
 * Retenus pour la duree du salon : changer de serveurs entre deux pairs du
 * meme salon donnerait des chemins incoherents.
 */
let serveursDuSalon: RTCIceServer[] = [];

/**
 * Le trafic passe-t-il obligatoirement par un relais ?
 *
 * C'est la seule facon de masquer son adresse aux autres participants. Decide
 * a l'entree, une fois pour toutes : le changer en cours de salon ne toucherait
 * que les connexions ouvertes ensuite, et l'on serait masque pour les uns, pas
 * pour les autres — le genre de demi-protection qui vaut moins que rien,
 * puisqu'on la croit acquise.
 */
let relaisImpose = false;

interface VoiceState {
  channelId: UUID | null;
  userId: UUID | null;
  connecting: boolean;
  error: string | null;

  muted: boolean;
  deafened: boolean;
  sharing: boolean;

  localStream: MediaStream | null;
  /** Flux de partage d'ecran local, distinct du micro. */
  localScreen: MediaStream | null;
  /** Flux de camera local. */
  localCamera: MediaStream | null;
  /** Camera activee. */
  cameraOn: boolean;
  /** Flux de camera distants. */
  remoteCameras: Record<UUID, MediaStream>;
  /** Partage affiche en grand, s'il y en a un. */
  focusedShare: UUID | null;

  /**
   * Partages que l'on a choisi de regarder.
   *
   * Recevoir un flux ne coute presque rien ; le decoder coute cher. Une
   * definition 1080p a soixante images par seconde occupe un coeur entier sur
   * une machine modeste — imposee a chacun, y compris a qui n'a aucune envie de
   * regarder. Rien ne se decode donc avant un clic.
   */
  watchedShares: Record<UUID, boolean>;
  /** Flux audio distants, indexes par identifiant d'utilisateur. */
  remoteAudio: Record<UUID, MediaStream>;
  /**
   * Son des partages d'ecran, range a part de la voix.
   *
   * Les deux arrivaient dans le meme casier, et le dernier ecrasait le premier :
   * partager son ecran avec le son faisait disparaitre la voix de qui partage,
   * ou le son du partage n'arrivait jamais — selon l'ordre des pistes. C'est
   * pourquoi « il n'y a pas le son du stream ».
   *
   * Range a part, chacun garde son volume : on baisse un jeu sans baisser la
   * personne qui commente.
   */
  remoteScreenAudio: Record<UUID, MediaStream>;
  /** Flux de partage d'ecran distants, indexes de la meme facon. */
  remoteScreens: Record<UUID, MediaStream>;
  /** Personnes qui parlent, detectees par analyse du niveau sonore. */
  speaking: Record<UUID, boolean>;

  participantsByChannel: Record<UUID, VoiceParticipant[]>;

  /**
   * Ou en est le masquage d'adresse, constate a la derniere entree.
   *
   * `sans-relais` n'est pas une erreur : c'est un souhait qu'aucune
   * infrastructure ne permet encore d'exaucer. Voir `reseau.ts`.
   */
  masquageActif: 'inconnu' | 'oui' | 'coupe' | 'sans-relais';

  /** Mesures du partage sortant, relevees toutes les deux secondes. */
  outboundStats: {
    width: number;
    height: number;
    fps: number;
    /** Debit reellement emis, en kilobits par seconde. */
    kbps: number;
  } | null;

  join: (channelId: UUID, userId: UUID) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  /** `sourceId` vient de notre selecteur natif ; absent, le moteur choisit. */
  toggleScreenShare: (sourceId?: string) => Promise<void>;
  toggleCamera: () => Promise<void>;
  focusShare: (userId: UUID | null) => void;
  /** Demande a quelqu'un de quitter le salon. Voir `Deconnexion`. */
  deconnecter: (userId: UUID) => void;
  /** Ecoute la presence des salons vocaux donnes, sans y entrer. */
  observerSalons: (channelIds: UUID[]) => void;
  /** Dit non a un appel : l'appelant raccroche. Voir `Refus`. */
  refuserAppel: (channelId: UUID, appelant: UUID) => void;
  /** Demande a quelqu'un de passer dans un autre salon. Voir `Deplacement`. */
  deplacer: (userId: UUID, salon: UUID) => void;
  /** Ouvre ou ferme le partage de quelqu'un. Ferme, il n'est plus decode. */
  toggleWatch: (userId: UUID) => void;
}

/* -------------------------------------------------------------------------- */
/* Ressources hors etat React                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Fin du suivi des reglages du micro, ou `null` hors salon.
 *
 * Voir `suivreReglagesMicro` : les traitements du micro ne se changent pas sur
 * une piste deja ouverte, il faut la recapturer.
 */
let arretSuiviMicro: (() => void) | null = null;

/**
 * Micro brut et porte de bruit en cours.
 *
 * Ce qu'on emet n'est plus forcement ce que le systeme nous donne : quand la
 * porte est active, on emet sa sortie. Le flux brut doit rester sous la main —
 * c'est lui qu'il faudra fermer, la porte ne le tenant pas.
 */
let microBrut: MediaStream | null = null;
let porteEnCours: Porte | null = null;

/**
 * Le serveur de ce salon autorise-t-il le signal d'arrivee ?
 *
 * Les conversations privees n'ont pas de serveur : elles sonnent toujours,
 * quelqu'un qui arrive dans une privee etant precisement ce qu'on attend.
 */
function sonVocalActif(channelId: UUID | null): boolean {
  if (!channelId) return true;

  const salon = useChat.getState().channels.find((item) => item.id === channelId);
  if (!salon?.space_id) return true;

  return useSpacePrefs.getState().pour(salon.space_id).sonVocal;
}

/** Ferme la porte et le micro brut, dans cet ordre. */
function relacherMicro(): void {
  porteEnCours?.arreter();
  porteEnCours = null;

  for (const piste of microBrut?.getTracks() ?? []) piste.stop();
  microBrut = null;
}

/**
 * Capture le micro, porte comprise.
 *
 * Le reste du magasin ne voit qu'un `MediaStream` : que la voix passe ou non
 * par la porte ne change rien a ce qu'on en fait ensuite.
 */
async function capturerMicro(): Promise<MediaStream> {
  const media = useDevices.getState().media;
  const brut = await capturer({ audio: audioConstraints(media), video: false });

  // Le mode musique coupe la porte : elle est faite pour la parole, et
  // avalerait la fin des notes tenues.
  if (!media.noiseGate || media.audioQuality === 'musique') {
    microBrut = brut;
    return brut;
  }

  // Le seuil de la porte suit celui du detecteur de parole, deja regle par
  // l'utilisateur : deux curseurs pour la meme question se contrediraient.
  //
  // L'attente est courte — charger un module de worklet — et elle est du bon
  // cote : mieux vaut trois cents millisecondes de plus a l'entree qu'un micro
  // emis sans la porte, puis remplace une seconde apres.
  const porte = await ouvrirPorte(brut, media.speakingThreshold);
  if (!porte) {
    microBrut = brut;
    return brut;
  }

  microBrut = brut;
  porteEnCours = porte;
  return porte.flux;
}

/**
 * Canaux ecoutes sans y entrer, un par salon vocal visible.
 *
 * On y lit la presence sans jamais publier la sienne : c'est ce qui permet de
 * voir qui discute dans un salon ou l'on n'est pas, et de le voir avant de
 * decider d'y aller. Le salon qu'on a rejoint, lui, a deja son propre canal —
 * il est exclu de la liste pour ne pas ouvrir deux abonnements au meme endroit.
 */
const observateurs = new Map<UUID, RealtimeChannel>();

/** Derniere liste demandee. Voir `reconcilierObservateurs`. */
let salonsVoulus: UUID[] = [];

/** Minuterie d'un second essai, quand un sujet etait encore occupe. */
let reconciliation: number | null = null;

/** Tout ce qu'il faut retenir d'un pair pour negocier avec lui. */
interface Peer {
  connection: RTCPeerConnection;
  /**
   * Cote « poli » de la negociation parfaite : en cas de collision entre deux
   * offres simultanees, c'est lui qui cede. Le depart est tranche par la
   * comparaison des identifiants, connue des deux cotes sans echange.
   */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  micSender: RTCRtpSender | null;
  screenSender: RTCRtpSender | null;
  /** Son du partage, quand la source en fournit un. */
  screenAudioSender: RTCRtpSender | null;
  cameraSender: RTCRtpSender | null;
}

let room: RealtimeChannel | null = null;
const peers = new Map<UUID, Peer>();

/**
 * Role de chaque flux distant, indexe par identifiant de flux.
 *
 * L'annonce et la piste voyagent par deux canaux differents et arrivent dans
 * un ordre imprevisible : on garde donc les deux, et l'on resout des que les
 * deux moities sont la.
 */
const streamPurposes = new Map<string, StreamPurpose>();
/** Pistes recues avant leur annonce, a reclasser une fois celle-ci arrivee. */
const pendingStreams = new Map<string, { peerId: UUID; stream: MediaStream }>();
let audioContext: AudioContext | null = null;
let speechTimer: number | null = null;
const analysers = new Map<UUID, AnalyserNode>();

/**
 * Cadence maximale des annonces d'etat vocal.
 *
 * Deux cents millisecondes : imperceptible a l'usage, et bien en deca de la
 * limite de Realtime meme en enchainant les clics.
 */
const INTERVALLE_PUBLICATION = 200;

let publicationDifferee: number | null = null;
let etatEnAttente = false;
let publicationEnVol = false;
let instantArrivee = 0;

/** Le pont natif n'existe que dans l'application de bureau. */
const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Etat du micro avant la sourdine, pour le retablir en sortant. */
let mutedBeforeDeafen = false;

/** Arret de la decoupe en cours, s'il y en a une. */
let arreterDecoupe: (() => void) | null = null;

/**
 * Vrai pendant qu'un partage demarre ou s'arrete.
 *
 * L'operation dure plusieurs secondes : ouvrir la capture, negocier avec chaque
 * pair, installer la decoupe. Rien n'empechait un second clic de partir pendant
 * ce temps. Deux captures se retrouvaient alors en vol, la seconde ecrasait
 * l'arret de la premiere — dont le canevas continuait de tourner dans le vide —
 * et les emetteurs poses par l'une remplacaient ceux de l'autre sans les
 * retirer. Le partage se disait actif, et plus personne ne recevait rien.
 */
let basculePartageEnCours = false;

/** Plage couverte par `getByteFrequencyData`, de l'octet 0 a l'octet 255. */
export const ANALYSER_FLOOR = -100;
export const ANALYSER_CEILING = -20;

/** Repasse une valeur d'octet en decibels, dans la plage ci-dessus. */
export function byteToDecibels(value: number): number {
  return ANALYSER_FLOOR + (value / 255) * (ANALYSER_CEILING - ANALYSER_FLOOR);
}

function send(message: VoiceMessage): void {
  if (!room) return;
  void room.send({ type: 'broadcast', event: 'voice-signal', payload: message });
}

function teardownPeers(): void {
  for (const peer of peers.values()) {
    peer.connection.onicecandidate = null;
    peer.connection.ontrack = null;
    peer.connection.onnegotiationneeded = null;
    peer.connection.onconnectionstatechange = null;
    peer.connection.close();
  }
  peers.clear();
  analysers.clear();
}

/**
 * Traduit un echec de capture en phrase utile.
 *
 * `getUserMedia` echoue pour des raisons tres differentes, et le message
 * generique — « Camera inaccessible » — les melangeait toutes : refus de
 * l'utilisateur, peripherique absent, ou simplement encore tenu par le salon
 * qu'on vient de quitter. Le dernier cas est le plus frequent en changeant de
 * salon, et c'est le seul ou il n'y a rien a corriger : il suffit d'attendre.
 */
function messageDeCapture(cause: unknown, quoi: 'micro' | 'camera'): string {
  const nom = cause instanceof DOMException ? cause.name : '';
  const article = quoi === 'micro' ? 'Le micro' : 'La camera';

  if (nom === 'NotAllowedError' || nom === 'SecurityError') {
    return quoi === 'micro'
      ? "Acces au micro refuse. Autorisez-le dans les reglages du site, puis reessayez."
      : "Acces a la camera refuse. Autorisez-le dans les reglages du site, puis reessayez.";
  }

  if (nom === 'NotFoundError' || nom === 'OverconstrainedError') {
    return quoi === 'micro'
      ? "Aucun micro detecte. Branchez-en un, ou choisissez-en un autre dans les parametres."
      : "Aucune camera detectee. Branchez-en une, ou choisissez-en une autre dans les parametres.";
  }

  if (nom === 'NotReadableError' || nom === 'AbortError') {
    return `${article} est utilise par une autre application. Fermez-la, puis reessayez.`;
  }

  return `${article} n'a pas pu demarrer. Reessayez dans un instant.`;
}

/**
 * Capture, avec une seconde tentative.
 *
 * En changeant de salon, le systeme n'a pas toujours fini de rendre le
 * peripherique que la session precedente tenait. L'echec est alors temporaire
 * et se resout tout seul : une deuxieme demande, une demi-seconde plus tard,
 * aboutit. Sans elle on affichait une erreur pour un probleme deja passe.
 */
async function capturer(contraintes: MediaStreamConstraints): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(contraintes);
  } catch (cause) {
    const recuperable =
      cause instanceof DOMException &&
      (cause.name === 'NotReadableError' || cause.name === 'AbortError');

    if (!recuperable) throw cause;

    await new Promise((resoudre) => setTimeout(resoudre, 500));
    return navigator.mediaDevices.getUserMedia(contraintes);
  }
}

/**
 * Une tuile par personne, portant son etat le plus recent.
 *
 * La presence de Realtime associe a chaque cle une *liste* d'entrees, une par
 * connexion. Une meme personne peut donc y figurer plusieurs fois : deux
 * onglets ouverts, mais surtout une connexion precedente dont le serveur n'a
 * pas encore constate la disparition — navigateur ferme sans prevenir, mise en
 * veille, reseau coupe. L'entree survit jusqu'a l'expiration du socket.
 *
 * En laissant passer les doublons, on affichait deux tuiles pour la meme
 * personne, dont une figee dans l'etat ou sa connexion s'est perdue.
 *
 * On garde l'entree arrivee en dernier : `joined_at` est fige a l'arrivee, donc
 * la plus grande valeur designe la connexion la plus recente.
 */
function dedupliquer(entrees: VoiceParticipant[]): VoiceParticipant[] {
  const parPersonne = new Map<UUID, VoiceParticipant>();

  for (const entree of entrees) {
    const connue = parPersonne.get(entree.user_id);
    if (!connue || entree.joined_at >= connue.joined_at) parPersonne.set(entree.user_id, entree);
  }

  return [...parPersonne.values()].sort((a, b) => a.joined_at - b.joined_at);
}

export const useVoice = create<VoiceState>((set, get) => {
  /**
   * Publie l'etat vocal, au plus une fois par intervalle.
   *
   * Chaque bascule declenchait un envoi. Enchainer les clics sur le micro
   * depassait la limite de Realtime, les envois suivants etaient abandonnes, et
   * l'anneau des participants restait fige sur un etat perime — c'est le defaut
   * qu'on observe en spammant le bouton.
   *
   * Le dernier etat est toujours emis : ce qui est ecarte, ce sont les etats
   * intermediaires, que personne n'a besoin de voir passer.
   */
  function publishState(): void {
    const state = get();
    if (!room || !state.channelId || !state.userId) return;

    etatEnAttente = true;

    // Un envoi est en cours, ou une fenetre est ouverte : l'etat courant sera
    // pris a la fin de l'un ou de l'autre. Rien a faire de plus.
    if (publicationEnVol || publicationDifferee !== null) return;

    void emettre();
  }

  /**
   * Emet l'etat, puis rouvre une fenetre.
   *
   * `track()` n'est jamais appele tant que le precedent n'a pas repondu. Deux
   * publications qui se chevauchaient laissaient la seconde sans reponse : sa
   * promesse ne se resolvait plus, et l'etat cessait d'etre annonce — l'anneau
   * de la personne restait fige sur son avant-derniere valeur, au bout de trois
   * bascules environ. Le symptome etait d'autant plus deroutant qu'il ne
   * demandait pas de cliquer vite.
   */
  async function emettre(): Promise<void> {
    publicationDifferee = null;
    if (!etatEnAttente) return;

    const courant = get();
    if (!room || !courant.channelId || !courant.userId) return;

    etatEnAttente = false;
    publicationEnVol = true;

    try {
      await room.track({
        user_id: courant.userId,
        channel_id: courant.channelId,
        muted: courant.muted,
        deafened: courant.deafened,
        sharing: courant.sharing,
        video: courant.cameraOn,
        // L'instant d'arrivee, fige : le reactualiser a chaque envoi ferait
        // paraitre chaque mise a jour comme une nouvelle arrivee.
        joined_at: instantArrivee,
      } satisfies VoiceParticipant);
    } catch {
      // Un envoi perdu n'est pas grave en soi : le suivant portera l'etat
      // complet, puisque c'est l'etat courant qui est publie, non un delta.
    } finally {
      publicationEnVol = false;
    }

    // Une fenetre s'ouvre : un changement survenu pendant l'envoi part a sa
    // fermeture, sans qu'on ait a l'emettre aussitot.
    if (room) publicationDifferee = window.setTimeout(() => void emettre(), INTERVALLE_PUBLICATION);
  }

  /**
   * Analyse le niveau sonore d'un flux pour allumer l'indicateur « parle ».
   * Le seuil est volontairement haut afin qu'un bruit de clavier ne declenche
   * pas le halo.
   */
  /*
   * Les reglages du micro s'appliquent en cours d'appel.
   *
   * C'est le defaut que l'on prenait pour « la reduction de bruit ne marche
   * pas » : elle marchait, mais seulement pour qui la reglait avant d'entrer.
   * Une fois la piste ouverte, cocher la case ne changeait plus rien — ni tout
   * de suite, ni au salon suivant tant qu'on n'avait pas quitte l'application.
   *
   * `applyConstraints` ne suffit pas : les moteurs acceptent l'appel puis
   * ignorent l'annulation d'echo et la reduction de bruit, qui sont posees a
   * l'ouverture du peripherique. On recapture donc le micro et on echange la
   * piste dans les connexions en cours — `replaceTrack` le fait sans
   * renegocier, donc sans coupure audible pour personne.
   */
  function suivreReglagesMicro(): void {
    const interessant = (media: ReturnType<typeof useDevices.getState>['media']) =>
      [
        media.microphoneId,
        media.echoCancellation,
        media.noiseSuppression,
        media.voiceIsolation,
        media.autoGainControl,
        media.audioQuality,
        media.noiseGate,
        media.speakingThreshold,
      ].join('|');

    let precedent = interessant(useDevices.getState().media);

    arretSuiviMicro = useDevices.subscribe((etat) => {
      const suivant = interessant(etat.media);
      if (suivant === precedent) return;
      precedent = suivant;
      void reprendreLeMicro();
    });
  }

  async function reprendreLeMicro(): Promise<void> {
    const { channelId, userId, localStream, muted, deafened } = get();
    if (!channelId || !userId) return;

    const media = useDevices.getState().media;

    // L'ancienne porte et l'ancien micro tombent avec la piste qu'ils
    // alimentaient — mais seulement une fois la nouvelle en place, pour ne pas
    // laisser un silence pendant la bascule.
    const ancienneP = porteEnCours;
    const ancienBrut = microBrut;
    porteEnCours = null;
    microBrut = null;

    let remplacant: MediaStream;
    try {
      remplacant = await capturerMicro();
    } catch {
      porteEnCours = ancienneP;
      microBrut = ancienBrut;
      // Le micro precedent continue de servir : mieux vaut un reglage qui ne
      // prend pas qu'un salon devenu muet.
      return;
    }

    // Le salon a pu se fermer pendant la capture.
    if (get().channelId !== channelId) {
      relacherMicro();
      porteEnCours = ancienneP;
      microBrut = ancienBrut;
      return;
    }

    const piste = remplacant.getAudioTracks()[0];
    if (!piste) return;

    // L'etat du micro se transporte : reprendre la parole parce qu'on a coche
    // une case serait une mauvaise surprise.
    piste.enabled = !muted && !deafened;

    const debit = audioBitrate(media);
    for (const peer of peers.values()) {
      if (!peer.micSender) continue;
      void peer.micSender.replaceTrack(piste);
      void applyAudioEncoding(peer.micSender, debit);
    }

    set({ localStream: remplacant });
    attachAnalyser(userId, remplacant);

    ancienneP?.arreter();
    for (const piste of ancienBrut?.getTracks() ?? []) piste.stop();
    for (const ancienne of localStream?.getTracks() ?? []) ancienne.stop();
  }

  /**
   * Ouvre ce qui manque, ferme ce qui n'a plus lieu d'etre.
   *
   * Un detail a coute cher : `supabase.channel(sujet)` ne cree pas toujours un
   * canal neuf — il rend celui qui porte deja ce sujet. Poser un ecouteur sur
   * un canal deja souscrit leve une exception, et comme l'appel partait d'un
   * effet React, elle emportait toute l'interface : ecran noir en quittant un
   * salon, au moment precis ou l'on reouvrait l'ecoute de celui qu'on venait
   * de laisser, sa fermeture n'etant pas encore terminee.
   *
   * On laisse donc passer les sujets occupes, et l'on repasse un peu plus tard.
   */
  function reconcilierObservateurs(): void {
    const rejoint = get().channelId;
    const voulus = new Set(salonsVoulus.filter((id) => id !== rejoint));

    for (const [id, canal] of observateurs) {
      if (voulus.has(id)) continue;
      void supabase.removeChannel(canal);
      observateurs.delete(id);

      set((state) => {
        const participantsByChannel = { ...state.participantsByChannel };
        delete participantsByChannel[id];
        return { participantsByChannel };
      });
    }

    let aReessayer = false;

    /*
     * Les adhesions sont etalees dans le temps.
     *
     * Realtime limite le rythme auquel un client peut rejoindre des canaux. En
     * ouvrir vingt d'un coup — ce qui arrive au demarrage, ou en rejoignant un
     * espace bien fourni — sature ce budget, et la seule adhesion qui compte
     * vraiment, celle du salon ou l'on parle, se retrouve en concurrence avec
     * dix-neuf autres qui ne servent qu'a colorer une pastille.
     *
     * Quatre-vingts millisecondes entre deux suffisent a lisser la rafale sans
     * que l'affichage paraisse arriver en retard.
     */
    let rang = 0;

    for (const id of voulus) {
      if (observateurs.has(id)) continue;

      const sujet = `orbit:voice:${id}`;

      // Sujet deja pris : par le salon qu'on vient de quitter, le temps que sa
      // fermeture aboutisse. On repassera.
      if (supabase.getChannels().some((canal) => canal.topic.endsWith(sujet))) {
        aReessayer = true;
        continue;
      }

      const canal = supabase.channel(sujet);
      observateurs.set(id, canal);

      try {
        canal
          .on('presence', { event: 'sync' }, () => {
            const participants = dedupliquer(
              Object.values(canal.presenceState<VoiceParticipant>())
                .flat()
                .filter((entry): entry is VoiceParticipant & { presence_ref: string } =>
                  Boolean(entry && typeof entry === 'object' && 'user_id' in entry),
                ),
            );

            set((state) => ({
              participantsByChannel: { ...state.participantsByChannel, [id]: participants },
            }));
          })
          ;

        // Le premier part tout de suite, les suivants s'echelonnent.
        const attente = rang * 80;
        rang += 1;

        if (attente === 0) {
          canal.subscribe();
        } else {
          window.setTimeout(() => {
            // Le salon a pu etre rejoint ou ferme entre-temps : on ne
            // s'abonne qu'a ce qui est encore voulu.
            if (observateurs.get(id) === canal) canal.subscribe();
          }, attente);
        }
      } catch {
        // Ceinture et bretelles : savoir qui discute ou est un confort, jamais
        // une raison de faire tomber l'application.
        observateurs.delete(id);
        void supabase.removeChannel(canal);
        aReessayer = true;
      }
    }

    if (!aReessayer || reconciliation !== null) return;

    reconciliation = window.setTimeout(() => {
      reconciliation = null;
      reconcilierObservateurs();
    }, 800);
  }

  function attachAnalyser(peerId: UUID, stream: MediaStream): void {
    try {
      audioContext ??= new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      // Bornes fixees explicitement : sans cela elles varient selon le
      // navigateur, et le seuil regle dans les parametres ne voudrait pas dire
      // la meme chose d'une machine a l'autre.
      analyser.minDecibels = ANALYSER_FLOOR;
      analyser.maxDecibels = ANALYSER_CEILING;
      source.connect(analyser);
      analysers.set(peerId, analyser);
    } catch {
      // L'analyse du son est un confort : son echec ne doit pas couper l'appel.
    }
  }

  function startSpeechDetection(): void {
    if (speechTimer !== null) return;

    const buffer = new Uint8Array(256);
    speechTimer = window.setInterval(() => {
      if (analysers.size === 0) return;

      const threshold = useDevices.getState().media.speakingThreshold;

      const speaking: Record<UUID, boolean> = {};
      for (const [peerId, analyser] of analysers) {
        analyser.getByteFrequencyData(buffer);

        // Le pic plutot que la moyenne : la voix n'occupe qu'une partie du
        // spectre, et la moyenne sur des bandes vides la diluerait au point que
        // le seuil ne correspondrait plus a rien d'audible.
        let peak = 0;
        for (let index = 0; index < buffer.length; index += 1) {
          if (buffer[index]! > peak) peak = buffer[index]!;
        }

        speaking[peerId] = byteToDecibels(peak) > threshold;
      }
      set({ speaking });
    }, 220);
  }

  /*
   * Releve de la qualite reellement emise.
   *
   * Les chiffres viennent de WebRTC lui-meme, pas de ce qu'on a demande : c'est
   * la seule facon de savoir si le debit demande est effectivement atteint. Un
   * partage annonce en 1080p60 qui sort a deux megabits se voit ici, alors
   * qu'a l'oeil on hesite entre « le reseau » et « le code ».
   */
  let statsTimer: number | null = null;
  let dernierOctets = 0;
  let dernierInstant = 0;

  function startStats(): void {
    if (statsTimer !== null) return;

    statsTimer = window.setInterval(() => {
      const emetteur = [...peers.values()].find((pair) => pair.screenSender)?.screenSender;
      if (!emetteur) {
        set({ outboundStats: null });
        return;
      }

      void emetteur.getStats().then((rapport) => {
        for (const entree of rapport.values()) {
          if (entree.type !== 'outbound-rtp' || entree.kind !== 'video') continue;

          const octets = entree.bytesSent ?? 0;
          const instant = entree.timestamp ?? performance.now();
          const ecart = (instant - dernierInstant) / 1000;

          // Le premier releve n'a rien a quoi se comparer : on l'utilise comme
          // point de depart plutot que d'afficher un debit fantaisiste.
          const kbps =
            dernierInstant > 0 && ecart > 0
              ? Math.round(((octets - dernierOctets) * 8) / ecart / 1000)
              : 0;

          dernierOctets = octets;
          dernierInstant = instant;

          set({
            outboundStats: {
              width: entree.frameWidth ?? 0,
              height: entree.frameHeight ?? 0,
              fps: Math.round(entree.framesPerSecond ?? 0),
              kbps,
            },
          });
          return;
        }
      });
    }, 2000);
  }

  function stopStats(): void {
    if (statsTimer !== null) {
      window.clearInterval(statsTimer);
      statsTimer = null;
    }
    dernierOctets = 0;
    dernierInstant = 0;
    set({ outboundStats: null });
  }

  function stopSpeechDetection(): void {
    if (speechTimer !== null) {
      window.clearInterval(speechTimer);
      speechTimer = null;
    }
    set({ speaking: {} });
  }

  /** Fait savoir a un pair a quoi correspond un flux qu'on lui envoie. */
  function announceStream(peerId: UUID, streamId: string, purpose: StreamPurpose): void {
    const me = get().userId;
    if (!me) return;
    send({ kind: 'stream-info', from: me, to: peerId, streamId, purpose });
  }

  function dropPeer(peerId: UUID): void {
    const peer = peers.get(peerId);
    if (peer) {
      peer.connection.close();
      peers.delete(peerId);
    }
    analysers.delete(peerId);

    set((state) => {
      const remoteAudio = { ...state.remoteAudio };
      const remoteScreenAudio = { ...state.remoteScreenAudio };
      const remoteScreens = { ...state.remoteScreens };
      const remoteCameras = { ...state.remoteCameras };
      delete remoteAudio[peerId];
      delete remoteScreenAudio[peerId];
      delete remoteScreens[peerId];
      delete remoteCameras[peerId];
      return {
        remoteAudio,
        remoteScreenAudio,
        remoteScreens,
        remoteCameras,
        focusedShare: state.focusedShare === peerId ? null : state.focusedShare,
      };
    });
  }

  /**
   * Range un flux video recu dans la bonne categorie.
   *
   * Si l'annonce n'est pas encore arrivee, le flux est mis en attente plutot
   * que devine : classer une camera comme partage d'ecran l'afficherait en
   * grand au milieu de la fenetre.
   */
  function placeVideoStream(peerId: UUID, stream: MediaStream): void {
    const purpose = streamPurposes.get(stream.id);

    if (!purpose) {
      pendingStreams.set(stream.id, { peerId, stream });
      return;
    }

    pendingStreams.delete(stream.id);

    if (purpose === 'screen') {
      /*
       * Un partage arrive ferme.
       *
       * Le decodage ne demarre qu'au clic sur « Regarder ». Sans cela, ouvrir
       * un salon ou trois personnes diffusent lancait trois decodages
       * simultanes, que l'on veuille les regarder ou non — de quoi rendre
       * l'application inutilisable sur une machine modeste, sans que rien
       * n'explique pourquoi.
       */
      const regarde = get().watchedShares[peerId] === true;
      for (const piste of stream.getVideoTracks()) piste.enabled = regarde;

      set((state) => ({ remoteScreens: { ...state.remoteScreens, [peerId]: stream } }));
    } else {
      set((state) => ({ remoteCameras: { ...state.remoteCameras, [peerId]: stream } }));
    }
  }

  /**
   * Cree la connexion vers un pair et cable la negociation parfaite.
   *
   * `onnegotiationneeded` remplace les offres declenchees a la main : ajouter ou
   * retirer une piste de partage d'ecran suffit alors a relancer la
   * negociation, sans code specifique a chaque cas.
   */
  function createPeer(peerId: UUID, localStream: MediaStream): Peer {
    const existing = peers.get(peerId);
    if (existing) return existing;

    const me = get().userId ?? '';
    const connection = new RTCPeerConnection({
      iceServers: serveursDuSalon,
      // `relay` interdit au moteur de proposer l'adresse locale et l'adresse
      // publique : il ne presente que celle du relais. C'est ce qui masque
      // l'adresse, et rien d'autre ne le fait.
      ...(relaisImpose ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {}),
    });

    const peer: Peer = {
      connection,
      polite: me > peerId,
      makingOffer: false,
      ignoreOffer: false,
      micSender: null,
      screenSender: null,
      screenAudioSender: null,
      cameraSender: null,
    };

    for (const track of localStream.getAudioTracks()) {
      peer.micSender = connection.addTrack(track, localStream);

      // La voix a droit au meme soin que l'image. Sans ce reglage, Opus reste
      // au debit de telephone que WebRTC lui donne par defaut, et l'on entend
      // surtout cela quand on trouve que « le son est mauvais ».
      const sender = peer.micSender;
      void (async () => {
        for (const attente of [0, 120, 400, 1200]) {
          if (attente > 0) await new Promise((r) => setTimeout(r, attente));
          if (!sender.track) return;
          if (await applyAudioEncoding(sender, audioBitrate(useDevices.getState().media))) return;
        }
      })();
    }

    // Si un partage ou une camera sont deja actifs, le nouvel arrivant doit
    // les recevoir, et connaitre leur role.
    const screen = get().localScreen;
    const screenTrack = screen?.getVideoTracks()[0];
    if (screen && screenTrack) {
      peer.screenSender = connection.addTrack(screenTrack, screen);
      // Un pair qui arrive en cours de partage doit recevoir la meme qualite
      // que les autres : sans cela il herite du debit par defaut.
      void applyEncodingWithRetry(
        peer.screenSender,
        screenBitrate(useDevices.getState().media),
        useDevices.getState().media.screenPriority,
      );
      announceStream(peerId, screen.id, 'screen');
    }

    const camera = get().localCamera;
    const cameraTrack = camera?.getVideoTracks()[0];
    if (camera && cameraTrack) {
      peer.cameraSender = connection.addTrack(cameraTrack, camera);
      void applyEncodingWithRetry(peer.cameraSender, cameraBitrate(useDevices.getState().media), 'detail');
      announceStream(peerId, camera.id, 'camera');
    }

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      const self = get().userId;
      if (self) {
        send({ kind: 'ice', from: self, to: peerId, candidate: event.candidate.toJSON() });
      }
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;

      // Audio et video du meme pair arrivent sur des flux distincts. Les
      // ranger ensemble ferait qu'un partage d'ecran remplacerait la voix.
      if (event.track.kind === 'video') {
        placeVideoStream(peerId, stream);

        event.track.addEventListener('ended', () => {
          streamPurposes.delete(stream.id);
          pendingStreams.delete(stream.id);
          set((state) => {
            const remoteScreens = { ...state.remoteScreens };
            const remoteCameras = { ...state.remoteCameras };
            delete remoteScreens[peerId];
            delete remoteCameras[peerId];
            return {
              remoteScreens,
              remoteCameras,
              focusedShare: state.focusedShare === peerId ? null : state.focusedShare,
            };
          });
        });
      } else {
        /*
         * Voix ou son de partage ?
         *
         * Le micro est emis seul : son flux ne porte que de l'audio. Un partage
         * d'ecran avec le son, lui, emet ses deux pistes sur un meme flux —
         * c'est `addTrack(piste, display)` des deux cotes. La presence d'une
         * piste video dans le flux suffit donc a trancher.
         *
         * Ce test remplace une lecture de `streamPurposes`, qui dependait de
         * l'ordre d'arrivee : l'annonce du partage voyage par le canal de
         * signalisation, la piste par la connexion media, et rien ne garantit
         * laquelle arrive d'abord. Quand l'audio precedait l'annonce, il etait
         * pris pour une voix et ecrasait le micro — le son du partage
         * n'arrivait pas, et la voix de qui partage disparaissait avec.
         *
         * `streamPurposes` reste consulte en second : un partage sans son n'a
         * pas de piste audio, mais une camera avec micro pourrait un jour en
         * avoir une.
         */
        const porteDeLaVideo = stream.getVideoTracks().length > 0;

        if (porteDeLaVideo || streamPurposes.get(stream.id) === 'screen') {
          set((state) => ({
            remoteScreenAudio: { ...state.remoteScreenAudio, [peerId]: stream },
          }));

          event.track.addEventListener('ended', () => {
            set((state) => {
              const remoteScreenAudio = { ...state.remoteScreenAudio };
              delete remoteScreenAudio[peerId];
              return { remoteScreenAudio };
            });
          });

          return;
        }

        set((state) => ({ remoteAudio: { ...state.remoteAudio, [peerId]: stream } }));

        // Seule la voix alimente le detecteur de parole : un jeu bruyant
        // allumerait la pastille de qui ne dit rien.
        attachAnalyser(peerId, stream);
      }
    };

    connection.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await connection.setLocalDescription();
        const self = get().userId;
        if (self && connection.localDescription?.sdp) {
          send({
            kind: 'offer',
            from: self,
            to: peerId,
            sdp: ameliorerOpus(connection.localDescription.sdp, useDevices.getState().media),
          });
        }
      } catch {
        // Une negociation avortee sera relancee par le prochain changement.
      } finally {
        peer.makingOffer = false;
      }
    };

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (state === 'failed' || state === 'closed') dropPeer(peerId);
    };

    peers.set(peerId, peer);
    return peer;
  }

  /** Traite un message de signalisation qui nous est adresse. */
  async function handleSignal(signal: VoiceMessage): Promise<void> {
    const localStream = get().localStream;
    if (!localStream) return;

    // La deconnexion est traitee a la reception, avant d'arriver ici : la voir
    // dans le type sert seulement a ce que le compilateur nous rappelle de la
    // couvrir si un nouveau chemin l'oublie.
    if ('kind' in signal && signal.kind === 'deconnexion') return;
    if ('kind' in signal && signal.kind === 'refus') return;
    if ('kind' in signal && signal.kind === 'deplacement') return;

    // Annonce du role d'un flux : on l'enregistre, puis on reclasse la piste
    // si elle etait deja arrivee.
    if (signal.kind === 'stream-info') {
      streamPurposes.set(signal.streamId, signal.purpose);
      const waiting = pendingStreams.get(signal.streamId);
      if (waiting) placeVideoStream(waiting.peerId, waiting.stream);
      return;
    }

    const peer = createPeer(signal.from, localStream);
    const { connection } = peer;

    try {
      if (signal.kind === 'offer' || signal.kind === 'answer') {
        const description: RTCSessionDescriptionInit = {
          type: signal.kind,
          sdp: signal.sdp,
        };

        // Collision : les deux cotes ont emis une offre en meme temps. Le cote
        // impoli garde la sienne et ignore celle d'en face ; le cote poli
        // abandonne la sienne par un rollback implicite.
        const offerCollision =
          signal.kind === 'offer' &&
          (peer.makingOffer || connection.signalingState !== 'stable');

        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;

        await connection.setRemoteDescription(description);

        if (signal.kind === 'offer') {
          await connection.setLocalDescription();
          const self = get().userId;
          if (self && connection.localDescription?.sdp) {
            send({
              kind: 'answer',
              from: self,
              to: signal.from,
              sdp: ameliorerOpus(connection.localDescription.sdp, useDevices.getState().media),
            });
          }
        }
        return;
      }

      await connection.addIceCandidate(signal.candidate);
    } catch {
      // Un candidat arrive avant sa description distante est sans consequence :
      // les suivants le remplaceront.
    }
  }

  /** Ouvre les connexions manquantes et ferme celles des partis. */
  function syncPeers(participants: VoiceParticipant[]): void {
    const me = get().userId;
    const localStream = get().localStream;
    if (!me || !localStream) return;

    const others = participants.filter((participant) => participant.user_id !== me);
    const present = new Set(others.map((participant) => participant.user_id));

    for (const peerId of [...peers.keys()]) {
      if (!present.has(peerId)) {
        dropPeer(peerId);
        playCue('peer-leave');
      }
    }

    for (const participant of others) {
      const peerId = participant.user_id;
      if (peers.has(peerId)) continue;

      // Le signal d'arrivee se coupe par serveur : precieux a trois, penible
      // a deux cents.
      if (sonVocalActif(get().channelId)) playCue('peer-join');

      // Un seul cote amorce, sinon les deux negocient en meme temps. La
      // comparaison des identifiants donne un arbitre stable ; l'autre attend
      // l'offre. `onnegotiationneeded` se declenche a l'ajout des pistes.
      if (me < peerId) createPeer(peerId, localStream);
    }
  }

  return {
    channelId: null,
    userId: null,
    connecting: false,
    error: null,

    muted: false,
    deafened: false,
    sharing: false,

    localStream: null,
    localScreen: null,
    localCamera: null,
    cameraOn: false,
    remoteAudio: {},
    remoteScreenAudio: {},
    remoteScreens: {},
    remoteCameras: {},
    focusedShare: null,
    watchedShares: {},
    speaking: {},
    participantsByChannel: {},
    masquageActif: 'inconnu',
    outboundStats: null,

    join: async (channelId, userId) => {
      if (get().channelId === channelId) return;

      set({ connecting: true, error: null });

      if (get().channelId) {
        await get().leave();
        // Le systeme ne rend pas le micro instantanement : le redemander
        // aussitot echoue avec « peripherique inaccessible », surtout quand un
        // logiciel de routage audio est en jeu. Une image d'attente suffit a
        // laisser la liberation aboutir.
        await new Promise((resoudre) => setTimeout(resoudre, 120));
      }

      /*
       * Le micro s'ouvre pendant qu'on libere le sujet, pas apres.
       *
       * Les deux attentes n'ont rien a voir l'une avec l'autre : demander le
       * micro au systeme prend de cent a cinq cents millisecondes, fermer et
       * rouvrir un canal Realtime autant, et on les payait l'une apres l'autre.
       * Menees de front, on ne paie plus que la plus longue.
       *
       * Precapturer le micro AVANT le clic aurait supprime la premiere
       * entierement, mais au prix du voyant d'enregistrement allume en
       * permanence — un micro ouvert en permanence pour gagner un tiers de
       * seconde est un mauvais echange.
       *
       * La promesse est lancee ici, et attendue plus bas : entre les deux, le
       * reste du travail avance.
       */
      const captureEnCours = capturerMicro();

      /*
       * Les serveurs reseau, demandes pendant que le micro s'ouvre.
       *
       * Encore une attente qui n'a rien a voir avec les autres : autant la
       * mener de front. Voir `reseau.ts` pour ce qu'on y gagne — des
       * identifiants qui ne trainent pas dans le binaire.
       */
      const serveursEnCours = serveursIce();
      serveursEnCours.catch(() => undefined);

      // Une promesse rejetee sans personne pour l'ecouter fait un
      // « unhandled rejection ». L'echec est traite au moment ou on l'attend ;
      // ce gestionnaire ne sert qu'a le signaler comme deja pris en charge.
      captureEnCours.catch(() => undefined);

      /*
       * Le sujet doit etre libre AVANT d'ouvrir le salon.
       *
       * On ecoutait peut-etre ce salon de loin. `supabase.channel(sujet)` ne
       * cree pas un canal neuf quand il en existe deja un sur ce sujet : il rend
       * l'ancien. Poser un ecouteur dessus leve alors une exception, la
       * signalisation ne s'installe jamais, et l'on se retrouve « connecte »
       * dans un salon ou personne ne s'entend — le defaut se voyait surtout en
       * conversation privee, ou l'on appelle depuis un salon qu'on ecoutait a
       * l'instant meme.
       *
       * D'ou l'attente : `removeChannel` est un aller-retour, et le lancer sans
       * l'attendre laissait la course ouverte.
       */
      const observateur = observateurs.get(channelId);
      if (observateur) {
        observateurs.delete(channelId);
        await supabase.removeChannel(observateur);
      }

      // Ceinture : un canal sur ce sujet peut venir d'ailleurs — un salon
      // precedent mal referme, une reconciliation en vol.
      for (const reste of supabase.getChannels()) {
        if (!reste.topic.endsWith(`orbit:voice:${channelId}`)) continue;
        await supabase.removeChannel(reste);
      }

      let localStream: MediaStream;
      try {
        localStream = await captureEnCours;
      } catch (cause) {
        set({ connecting: false, error: messageDeCapture(cause, 'micro') });
        return;
      }

      serveursDuSalon = await serveursEnCours.catch(() => []);

      /*
       * Le masquage n'est applique que s'il peut l'etre.
       *
       * Sans relais joignable, `iceTransportPolicy: 'relay'` n'aboutit a aucune
       * connexion : on serait « protege » et muet. Le reglage reste donc sans
       * effet tant qu'aucun serveur TURN n'est configure, et l'interface le dit
       * plutot que de laisser croire le contraire.
       */
      const veutMasquer = useDevices.getState().media.masquerIp;
      relaisImpose = veutMasquer && comporteUnRelais(serveursDuSalon);

      if (veutMasquer && !relaisImpose) {
        set({
          error:
            'Aucun relais n\u2019est configure : votre adresse reste visible des autres participants. Voir SECURITE.md.',
        });
      }

      instantArrivee = Date.now();
      set({ channelId, userId, localStream, connecting: false });

      // Son propre micro passe par le meme analyseur que ceux des autres.
      // Sans cela, la pastille de parole ne s'allumait jamais pour soi : on
      // voyait les autres parler, jamais soi, et rien n'indiquait si le micro
      // captait quoi que ce soit.
      attachAnalyser(userId, localStream);
      startSpeechDetection();
      suivreReglagesMicro();

      playCue('join');

      room = supabase.channel(`orbit:voice:${channelId}`, {
        config: { presence: { key: userId }, broadcast: { self: false } },
      });

      room
        .on('broadcast', { event: 'voice-signal' }, ({ payload }) => {
          const message = payload as VoiceMessage;
          if (message.to !== userId) return;

          if ('kind' in message && message.kind === 'deconnexion') {
            set({ error: 'Vous avez ete deconnecte du salon vocal.' });
            void get().leave();
            return;
          }

          if ('kind' in message && message.kind === 'deplacement') {
            const moi = get().userId;
            if (moi) void get().join(message.salon, moi);
            return;
          }

          if ('kind' in message && message.kind === 'refus') {
            // Rester seul dans le salon apres un refus n'a aucun sens : on
            // raccroche, en disant pourquoi.
            set({ error: 'Votre appel a ete refuse.' });
            void get().leave();
            return;
          }

          void handleSignal(message as VoiceSignal);
        })
        .on('presence', { event: 'sync' }, () => {
          if (!room) return;
          const participants = dedupliquer(
            Object.values(room.presenceState<VoiceParticipant>())
              .flat()
              .filter((entry): entry is VoiceParticipant & { presence_ref: string } =>
                Boolean(entry && typeof entry === 'object' && 'user_id' in entry),
              ),
          );

          set((state) => ({
            participantsByChannel: { ...state.participantsByChannel, [channelId]: participants },
          }));
          syncPeers(participants);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') publishState();
        });

      startSpeechDetection();
    },

    leave: async () => {
      if (get().channelId) playCue('leave');
      const { localStream, localScreen, localCamera, channelId } = get();

      // La publication differee doit s'arreter avec le salon : sinon elle
      // tenterait d'annoncer un etat sur un canal deja ferme.
      if (publicationDifferee !== null) {
        window.clearTimeout(publicationDifferee);
        publicationDifferee = null;
      }
      etatEnAttente = false;

      stopSpeechDetection();
      stopStats();
      arretSuiviMicro?.();
      arretSuiviMicro = null;
      teardownPeers();
      // Le salon qu'on laisse redevient un salon comme un autre : on veut y
      // voir qui reste. Sa fermeture n'est pas finie, d'ou le report.
      window.setTimeout(reconcilierObservateurs, 800);
      streamPurposes.clear();
      pendingStreams.clear();

      relacherMicro();
      for (const track of localStream?.getTracks() ?? []) track.stop();
      for (const track of localScreen?.getTracks() ?? []) track.stop();
      for (const track of localCamera?.getTracks() ?? []) track.stop();

      /*
       * Le canal est ferme sans attendre.
       *
       * `untrack` puis `removeChannel` sont deux allers-retours reseau. Les
       * attendre avant de vider l'etat laissait l'interface figee une seconde
       * ou deux apres le clic sur « Quitter » — on croyait que rien ne s'etait
       * passe et on recliquait.
       *
       * Rien ne depend de leur reponse : les pistes sont deja coupees, et la
       * presence expire d'elle-meme a la fermeture du socket.
       */
      if (room) {
        const ferme = room;
        room = null;

        void (async () => {
          try {
            await ferme.untrack();
            await supabase.removeChannel(ferme);
          } catch {
            // Le socket se refermera seul ; la presence expirera avec lui.
          }
        })();
      }

      set((state) => {
        const participantsByChannel = { ...state.participantsByChannel };
        if (channelId) delete participantsByChannel[channelId];
        return {
          channelId: null,
          localStream: null,
          localScreen: null,
          localCamera: null,
          cameraOn: false,
          remoteAudio: {},
          remoteScreens: {},
          remoteCameras: {},
          focusedShare: null,
          speaking: {},
          sharing: false,
          muted: false,
          deafened: false,
          participantsByChannel,
        };
      });
    },

    toggleMute: () => {
      const { localStream, muted } = get();
      const next = !muted;

      for (const track of localStream?.getAudioTracks() ?? []) {
        track.enabled = !next;
      }
      // Reactiver le micro alors qu'on est sourd n'aurait pas de sens : on
      // retablit le son en meme temps.
      set({ muted: next, deafened: next ? get().deafened : false });
      playCue(next ? 'mute' : 'unmute');
      publishState();
    },

    /**
     * Sourdine.
     *
     * Se rendre sourd coupe aussi le micro, comme partout ailleurs. Le
     * retablir doit rendre le micro tel qu'il etait avant — et non le laisser
     * coupe, ce qui obligeait a un second clic sans qu'on comprenne pourquoi,
     * et se voyait surtout apres plusieurs bascules d'affilee.
     */
    toggleDeafen: () => {
      const { deafened, muted, localStream } = get();
      const next = !deafened;

      // L'etat du micro est retenu au moment ou l'on devient sourd, pas apres :
      // ensuite il vaut forcement « coupe » et l'information est perdue.
      if (next) mutedBeforeDeafen = muted;

      const nextMuted = next ? true : mutedBeforeDeafen;

      for (const track of localStream?.getAudioTracks() ?? []) {
        track.enabled = !nextMuted;
      }

      set({ deafened: next, muted: nextMuted });
      playCue(next ? 'deafen' : 'undeafen');
      publishState();
    },

    toggleScreenShare: async (sourceId) => {
      // Un clic de plus pendant l’installation ne fait rien : le premier
      // ira au bout, et l’etat sera coherent pour le suivant.
      if (basculePartageEnCours) return;
      basculePartageEnCours = true;

      try {
        const { sharing, localScreen } = get();

        if (sharing) {
          for (const peer of peers.values()) {
            if (peer.screenSender) {
              // `removeTrack` declenche `onnegotiationneeded` : la renegociation
              // part toute seule, sans offre construite a la main.
              peer.connection.removeTrack(peer.screenSender);
              peer.screenSender = null;
            }
          }
          for (const track of localScreen?.getTracks() ?? []) track.stop();

          // La decoupe tient un canevas, une balise video et deux minuteurs :
          // les laisser tourner apres l'arret consommerait un coeur pour dessiner
          // dans le vide.
          arreterDecoupe?.();
          arreterDecoupe = null;

          set({ sharing: false, localScreen: null });
          stopStats();
          playCue('share-stop');
          publishState();
          return;
        }

        let display: MediaStream;
        try {
          display = await navigator.mediaDevices.getDisplayMedia({
            video: {
              ...screenConstraints(useDevices.getState().media),
              // Le selecteur s'ouvre sur l'ecran entier, ce qu'on partage le
              // plus souvent.
              displaySurface: 'monitor',
            },

            // Le son de ce qui est partage part avec l'image. Sans lui, montrer
            // une video ou un jeu revient a mimer. Les traitements du micro sont
            // desactives : ils sont faits pour une voix, et ils ecraseraient de
            // la musique.
            audio: useDevices.getState().media.shareSystemAudio
              ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
              : false,

            // Notre propre fenetre est retiree de la liste : la partager
            // afficherait le partage a l'interieur de lui-meme, en miroir sans
            // fin. C'est une erreur qu'on ne fait qu'une fois, mais qu'on fait.
            selfBrowserSurface: 'exclude',

            // On peut changer de source sans couper : sinon il faut arreter,
            // rouvrir le selecteur, et tout le monde voit l'ecran disparaitre.
            surfaceSwitching: 'include',
          } as DisplayMediaStreamOptions);
        } catch {
          // Selecteur de fenetre annule : rien a signaler.
          return;
        }

        /*
         * Decoupe, quand une fenetre precise a ete choisie.
         *
         * Sur le bureau, la selection du moteur web est court-circuitee : il
         * prend toujours l'ecran entier. Choisir une fenetre dans notre
         * selecteur revient donc a n'emettre que la portion correspondante —
         * sans quoi on diffuserait tout l'ecran en croyant l'inverse.
         */
        let videoTrack = display.getVideoTracks()[0];

        if (sourceId) {
          try {
            const { decouperSource } = await import('./decoupe');
            const decoupe = await decouperSource(
              display,
              sourceId,
              useDevices.getState().media.screenFrameRate,
            );

            arreterDecoupe = decoupe.arreter;
            if (decoupe.piste) videoTrack = decoupe.piste;

            if (decoupe.horsEcranPrincipal) {
              set({
                error:
                  "Cette fenetre est sur un second ecran : c'est l'ecran entier qui est partage.",
              });
            }
          } catch {
            // Decoupe impossible : on partage l'ecran plutot que rien, et
            // l'utilisateur le voit dans sa propre vignette.
          }
        }

        if (!videoTrack) return;

        /*
         * La barre du moteur est masquee.
         *
         * Chromium pose une fenetre flottante « http://tauri.localhost partage
         * votre ecran » pendant toute la duree du partage. Aucune API ne la
         * retire, et elle annonce une adresse interne qui ne veut rien dire.
         * Notre interface annonce deja le partage et propose de l'arreter, a
         * trois endroits.
         *
         * Sans attendre : la fenetre met un instant a paraitre, et la commande
         * la guette d'elle-meme pendant deux secondes.
         */
        if (DANS_TAURI) {
          void import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke('masquer_barre_partage'))
            .catch(() => undefined);
        }

        // L'indice de contenu oriente l'encodeur avant meme la negociation :
        // « motion » lui dit de sacrifier la nettete plutot que la fluidite.
        // Sans lui, un 1080p a soixante images est traite comme une webcam.
        videoTrack.contentHint =
          useDevices.getState().media.screenPriority === 'motion' ? 'motion' : 'detail';

        // Le partage s'arrete aussi depuis la barre du navigateur. Sans suivre cet
        // evenement, l'interface afficherait un partage qui n'existe plus.
        videoTrack.addEventListener('ended', () => {
          for (const peer of peers.values()) {
            if (peer.screenSender) {
              peer.connection.removeTrack(peer.screenSender);
              peer.screenSender = null;
            }
            if (peer.screenAudioSender) {
              peer.connection.removeTrack(peer.screenAudioSender);
              peer.screenAudioSender = null;
            }
          }
          set({ sharing: false, localScreen: null });
          publishState();
        });

        const media = useDevices.getState().media;

        // Le son du partage, quand la source en fournit. Il voyage dans le meme
        // flux que l'image : le separer obligerait a resynchroniser a l'arrivee.
        const [audioTrack] = display.getAudioTracks();

        for (const [peerId, peer] of peers) {
          peer.screenSender = peer.connection.addTrack(videoTrack, display);

          // Le codec se choisit sur le transceiver, pas sur l'emetteur : c'est
          // lui qui porte la negociation.
          const transceiver = peer.connection
            .getTransceivers()
            .find((t) => t.sender === peer.screenSender);
          if (transceiver) preferVideoCodec(transceiver);

          void applyEncodingWithRetry(peer.screenSender, screenBitrate(media), media.screenPriority);

          if (audioTrack) {
            peer.screenAudioSender = peer.connection.addTrack(audioTrack, display);
          }

          announceStream(peerId, display.id, 'screen');
        }

        set({ sharing: true, localScreen: display });
        startStats();
        playCue('share-start');
        publishState();
      } finally {
        basculePartageEnCours = false;
      }
    },

    /**
     * Camera.
     *
     * Le flux part sur une piste distincte de celle du partage d'ecran, et son
     * role est annonce a chaque pair : sans cela, le recepteur ne saurait pas
     * lequel des deux flux video afficher en vignette et lequel en grand.
     */
    toggleCamera: async () => {
      const { cameraOn, localCamera } = get();

      if (cameraOn) {
        for (const peer of peers.values()) {
          if (peer.cameraSender) {
            // `removeTrack` declenche `onnegotiationneeded` : la renegociation
            // part seule.
            peer.connection.removeTrack(peer.cameraSender);
            peer.cameraSender = null;
          }
        }
        for (const track of localCamera?.getTracks() ?? []) track.stop();

        set({ cameraOn: false, localCamera: null });
        publishState();
        return;
      }

      let camera: MediaStream;
      try {
        camera = await capturer({
          video: videoConstraints(useDevices.getState().media),
          audio: false,
        });
      } catch (cause) {
        set({ error: messageDeCapture(cause, 'camera') });
        return;
      }

      const [videoTrack] = camera.getVideoTracks();
      if (!videoTrack) return;

      // Un visage bouge peu : la nettete prime sur la fluidite.
      videoTrack.contentHint = 'detail';

      // La camera peut etre coupee depuis le systeme : sans suivre cet
      // evenement, l'interface afficherait une video qui n'existe plus.
      videoTrack.addEventListener('ended', () => {
        for (const peer of peers.values()) {
          if (peer.cameraSender) {
            peer.connection.removeTrack(peer.cameraSender);
            peer.cameraSender = null;
          }
        }
        set({ cameraOn: false, localCamera: null });
        publishState();
      });

      for (const [peerId, peer] of peers) {
        peer.cameraSender = peer.connection.addTrack(videoTrack, camera);
        void applyEncodingWithRetry(peer.cameraSender, cameraBitrate(useDevices.getState().media), 'detail');
        announceStream(peerId, camera.id, 'camera');
      }

      set({ cameraOn: true, localCamera: camera });
      publishState();
    },

    /*
     * Ecoute les salons vocaux d'un espace sans y entrer.
     *
     * La presence n'etait lue que pour le salon rejoint : partout ailleurs la
     * liste paraissait vide, et l'on ne pouvait savoir si quelqu'un attendait
     * dans un salon qu'en s'y connectant — c'est-a-dire en faisant du bruit
     * pour rien.
     *
     * L'appelant redonne la liste entiere a chaque changement ; on n'ouvre que
     * ce qui manque et on ferme ce qui n'y est plus.
     */
    /*
     * Refuse un appel sans jamais entrer dans le salon.
     *
     * Le message part par le canal deja ouvert pour observer ce salon. On ne
     * s'y connecte pas : refuser un appel ne doit pas allumer son micro, ne
     * serait-ce qu'une seconde.
     */
    /*
     * Deplace quelqu'un vers un autre salon vocal.
     *
     * Le message passe par le canal du salon d'ou l'on part — celui ou les deux
     * se trouvent. Le client vise rejoint le salon d'arrivee, ce qui le fait
     * quitter le premier au passage : `join` s'occupe deja de la sortie.
     */
    deplacer: (userId, salon) => {
      const moi = get().userId;
      if (!moi || userId === moi) return;

      send({ kind: 'deplacement', from: moi, to: userId, salon });
    },

    refuserAppel: (channelId, appelant) => {
      const moi = get().userId;
      const canal = observateurs.get(channelId);
      if (!moi || !canal) return;

      void canal.send({
        type: 'broadcast',
        event: 'voice-signal',
        payload: { kind: 'refus', from: moi, to: appelant } satisfies Refus,
      });
    },

    observerSalons: (channelIds) => {
      salonsVoulus = channelIds;
      reconcilierObservateurs();
    },

    focusShare: (userId) => set({ focusedShare: userId }),

    /*
     * Demande a quelqu'un de quitter le salon vocal.
     *
     * Le message passe par le meme canal que la negociation : tout le monde y
     * est deja, et il n'y a rien a ouvrir de plus. Voir `Deconnexion` pour ce
     * que cette demande garantit — et surtout ce qu'elle ne garantit pas.
     */
    deconnecter: (userId) => {
      const moi = get().userId;
      if (!moi || userId === moi) return;

      send({ kind: 'deconnexion', from: moi, to: userId });
    },

    /*
     * Regarder, ou ne pas regarder.
     *
     * Couper `enabled` sur la piste recue suffit a arreter le decodage : le
     * navigateur jette les images sans les developper. Le flux continue
     * d'arriver — c'est la bande passante, pas le processeur, et c'est le
     * processeur qui faisait ramer les machines modestes. Le rouvrir est
     * instantane, sans renegociation.
     */
    toggleWatch: (userId) => {
      const suivant = !get().watchedShares[userId];

      const flux = get().remoteScreens[userId];
      for (const piste of flux?.getVideoTracks() ?? []) piste.enabled = suivant;

      set((state) => ({
        watchedShares: { ...state.watchedShares, [userId]: suivant },
        // Fermer un partage qu'on avait agrandi le reduit aussi : le laisser
        // « agrandi » alors qu'il ne s'affiche plus n'aurait pas de sens.
        focusedShare: suivant ? state.focusedShare : null,
      }));
    },
  };
});
