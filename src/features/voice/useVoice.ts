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
import { capturerSonSysteme, type SonSysteme } from './sonSysteme';
import { journal } from '@/lib/journal';
import { decider, etatPairsVide } from './pairs';
import { noter, etatMartelementVide } from './martelement';
import { ajuster } from './cadence';
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

  /**
   * Ce qu'on signale sans que ce soit une panne.
   *
   * Distinct de `error` : celui-ci decrit un echec, celui-la un usage qui va
   * se retourner contre soi. Les melanger ferait passer un conseil pour une
   * panne — et, pire, ferait disparaitre une vraie panne sous un conseil.
   */
  avertissement: string | null;

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
   * Le son du partage a ete demande mais refuse par le systeme.
   *
   * Ni une erreur ni un etat durable : une precision a donner a qui partage,
   * qui autrement n'a aucun moyen de distinguer un refus d'un jeu silencieux.
   */
  /** Vrai tant qu'on tient la touche « se taire ». Voir `PousserPour`. */
  pousseePourCouper: boolean;

  /** Annonce qu'on tient — ou qu'on lache — la touche « se taire ». */
  signalerPoussee: (tenue: boolean) => void;

  partageSansSon: boolean;

  /**
   * Pourquoi le partage part sans son, quand c'est le cas.
   *
   * Distinct de `partageSansSon` : le booleen dit qu'il faut prevenir, cette
   * chaine dit quoi. La partie native rend des raisons precises et differentes
   * — peripherique introuvable, bouclage refuse par Windows, format inconnu —
   * et les remplacer par une phrase unique revenait a jeter la seule chose
   * grace a laquelle on peut agir.
   */
  raisonSansSon: string | null;

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

/**
 * Capture du son de l'ordinateur en cours, ou `null`.
 *
 * Rangee hors de l'etat React : elle n'a rien a afficher, et sa piste vit
 * deja dans le flux du partage. Ce qu'on garde ici, c'est de quoi l'arreter.
 */
let sonNatif: SonSysteme | null = null;

/** Arrete la capture native s'il y en a une, et oublie la. */
function couperSonNatif() {
  sonNatif?.arreter();
  sonNatif = null;
}

/**
 * Capture d'image en cours, ou `null`.
 *
 * Rangee hors de l'etat React, comme celle du son : sa piste vit deja dans le
 * flux du partage, et ce qu'on garde ici n'est que de quoi l'arreter.
 */
let captureNative: import('./imageSysteme').ImageSysteme | null = null;

/** Arrete la capture d'image s'il y en a une, et oublie la. */
function couperCaptureNative() {
  captureNative?.arreter();
  captureNative = null;
}
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
/**
 * Delai avant de classer un flux sans attendre son annonce, en millisecondes.
 *
 * Assez long pour que l'annonce arrive dans le cas normal — elle prend quelques
 * dizaines de millisecondes — et assez court pour qu'un partage qu'on a demande
 * a voir n'ait pas le temps de paraitre casse.
 */
const REPLI_CLASSEMENT = 1500;

/**
 * Salon en cours de jonction, ou `null`.
 *
 * `channelId` n'est pose qu'une fois la jonction aboutie ; entre-temps, rien ne
 * disait qu'on visait ce salon. Voir `reconcilierObservateurs`, qui s'en sert
 * pour ne pas ouvrir un observateur sur le salon qu'on rejoint.
 */
let salonEnJonction: UUID | null = null;

/** Ce que la decision sur les pairs retient d'une synchronisation a l'autre. */
const etatPairs = etatPairsVide();

const streamPurposes = new Map<string, StreamPurpose>();
/** Pistes recues avant leur annonce, a reclasser une fois celle-ci arrivee. */
const pendingStreams = new Map<string, { peerId: UUID; stream: MediaStream }>();
let audioContext: AudioContext | null = null;
let speechTimer: number | null = null;
const analysers = new Map<UUID, AnalyserNode>();

/** Quel flux chaque analyseur ecoute. Voir `detacherAnalyseurDe`. */
const fluxAnalyses = new Map<UUID, MediaStream>();

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
  fluxAnalyses.clear();
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
 * De quelle application prendre le son.
 *
 * Partager une fenetre ne laisse pas le choix, et c'est voulu : le son suit
 * l'application partagee. Prendre tout l'ordinateur emporterait la musique et
 * les notifications d'a cote, et surtout : cela rouvrirait la porte a l'echo,
 * qu'un routeur audio virtuel provoque en rejouant notre son depuis son propre
 * processus.
 *
 * Partager un ecran n'a pas d'application derriere. On prend alors ce que la
 * personne a choisi — tout l'ordinateur par defaut, une application si elle
 * s'entend en double.
 */
function sourceDuSon(partage: string | undefined, choisie: string | null): string | null {
  if (partage?.startsWith('fenetre:')) return partage;
  return choisie;
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
  const martelement = etatMartelementVide();
  let effacementAvis: number | null = null;

  /**
   * Previent quand on enchaine les bascules plus vite qu'elles ne partent.
   *
   * Ce n'est pas une limite : la bascule est appliquee comme d'habitude. C'est
   * une explication, donnee au moment ou elle sert — sans quoi on voit un
   * bouton qui dit une chose, des gens qui en voient une autre, et l'on
   * recommence, ce qui ne fait qu'agrandir l'ecart.
   *
   * La mesure vit dans `martelement.ts`, avec ses cas : des seuils qu'on ne
   * peut pas eprouver sont des seuils qu'on regle au hasard.
   */
  function surveillerMartelement(): void {
    if (!noter(martelement, Date.now())) return;

    set({
      avertissement:
        'Doucement — vous changez d’etat plus vite que le salon ne peut l’annoncer. Attendez une seconde : ce que voient les autres va se remettre a jour.',
    });

    if (effacementAvis !== null) window.clearTimeout(effacementAvis);
    effacementAvis = window.setTimeout(() => {
      effacementAvis = null;
      set({ avertissement: null });
    }, 8000);
  }

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
      /*
       * L'envoi est borne dans le temps.
       *
       * `track` attend la reponse du serveur. Quand elle ne vient pas — socket
       * a demi ferme, reseau qui pend — la promesse ne se resout jamais, et le
       * drapeau qui empeche deux envois simultanes reste leve POUR TOUJOURS.
       * Plus rien n'est publie ensuite : l'anneau de la personne se fige sur
       * son avant-dernier etat, et la liste laterale la montre coupee alors
       * qu'elle parle. C'est exactement ce qui a ete rapporte.
       *
       * Trois secondes suffisent largement a un aller-retour ; au-dela, on
       * considere l'envoi perdu et l'on reessaie au tour suivant, ce que la
       * fenetre de publication fait deja.
       */
      await Promise.race([
        room.track({
        user_id: courant.userId,
        channel_id: courant.channelId,
        muted: courant.muted,
        deafened: courant.deafened,
        pousse_pour_couper: courant.pousseePourCouper,
        sharing: courant.sharing,
        video: courant.cameraOn,
        // Une piste sonore dans le flux du partage, ou rien. C'est la seule
        // reponse qui vaille : ce qu'on a demande ne dit pas ce qui part.
        son_partage: courant.sharing
          ? (courant.localScreen?.getAudioTracks().length ?? 0) > 0
          : false,
        // L'instant d'arrivee, fige : le reactualiser a chaque envoi ferait
        // paraitre chaque mise a jour comme une nouvelle arrivee.
          joined_at: instantArrivee,
        } satisfies VoiceParticipant),
        new Promise((_, rejeter) =>
          window.setTimeout(() => rejeter(new Error('publication expiree')), 3000),
        ),
      ]);
    } catch {
      /*
       * Un envoi perdu est remis dans la file, et c'etait le defaut le plus
       * couteux de tout le vocal.
       *
       * L'ancien commentaire disait vrai a moitie : le suivant porte bien
       * l'etat complet — mais il n'y a pas de suivant. La fenetre qui se rouvre
       * plus bas appelle `emettre`, laquelle rend la main aussitot quand rien
       * n'est en attente. Une seule publication perdue suffisait donc a ne plus
       * jamais rien publier.
       *
       * La consequence est severe et correspond mot pour mot a ce qui est
       * rapporte : la presence ne porte plus notre entree, on **disparait de la
       * liste du salon**, et personne n'ouvre de connexion vers quelqu'un qu'il
       * ne voit pas — donc plus personne ne nous entend. Rien dans l'interface
       * ne le laissait deviner, et relancer l'application etait la seule issue.
       */
      etatEnAttente = true;
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
    const { channelId, userId, localStream } = get();
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


    const debit = audioBitrate(media);
    for (const peer of peers.values()) {
      if (!peer.micSender) continue;
      void peer.micSender.replaceTrack(piste);
      void applyAudioEncoding(peer.micSender, debit);
    }

    set({ localStream: remplacant });

    // L'etat du micro se transporte : reprendre la parole parce qu'on a coche
    // une case serait une mauvaise surprise. Il est relu APRES l'ecriture,
    // pour ne pas se fier a la copie prise au debut de cette fonction.
    appliquerMicro();

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
    /*
     * Le salon qu'on rejoint est exclu, meme avant d'y etre.
     *
     * `channelId` n'est pose qu'a la FIN de `join`. Cette reconciliation, elle,
     * est programmee huit cents millisecondes apres avoir quitte — donc en
     * plein milieu d'une jonction si l'on rejoint aussitot, ce que fait tout
     * le monde apres avoir arrete un partage. Elle voyait alors « aucun salon
     * rejoint », ouvrait un observateur sur celui qu'on etait en train de
     * rejoindre, et `supabase.channel(sujet)` rendait ensuite CE canal-la —
     * deja souscrit. Poser un ecouteur dessus leve une exception.
     */
    const rejoint = get().channelId ?? salonEnJonction;
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
      fluxAnalyses.set(peerId, stream);
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

/**
 * Battement qui repasse sur l'etat des connexions.
 *
 * La synchronisation des pairs ne se declenche qu'a un changement de presence.
 * Or le rattrapage — rebatir une connexion dont l'offre n'est jamais venue — a
 * besoin de repasser APRES un delai, et rien ne garantit qu'un changement
 * survienne entre-temps. Dans un salon calme, la voix serait restee coupee
 * jusqu'a ce que quelqu'un entre ou sorte.
 */
let battementPairs: number | null = null;

/**
 * Quand on s'est vu soi-meme dans la presence pour la derniere fois.
 *
 * C'est la seule mesure de sante du canal qui ne se devine pas : notre entree
 * n'y figure que si le serveur l'a recue ET nous la renvoie.
 */
let derniereFoisVu = 0;

/** Un canal se rebatit a la fois. */
let reconstructionEnCours = false;

/** Silence au-dela duquel on considere le canal perdu. */
const SILENCE_CANAL = 12_000;

/**
 * Definition et cause de limitation du dernier releve, pour ce partage.
 *
 * Sert a n'ecrire que ce qui change : un partage stable ne dit rien, un partage
 * qui s'effondre le dit au moment ou il s'effondre.
 */
let derniereQualite: string | null = null;

/**
 * Cadence de capture en cours, qui n'est pas forcement celle demandee.
 *
 * Elle suit ce que l'encodeur arrive reellement a sortir. Voir `cadence.ts` :
 * fabriquer des images qu'il jettera coute deux millisecondes chacune a celui
 * qui partage, et n'apporte rien a personne.
 */
let cadenceCapture = 0;
  let dernierOctets = 0;
  let dernierInstant = 0;

  function startStats(): void {
    if (statsTimer !== null) return;
    derniereQualite = null;

    // Chaque partage repart de la cadence demandee : ce que la machine ne
    // tenait pas la derniere fois ne dit rien de ce qu'elle tiendra cette
    // fois-ci — on partage un jeu, puis une page de texte.
    cadenceCapture = 0;

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

          /*
           * Ce sont les CHANGEMENTS qui partent au journal, pas un instantane.
           *
           * `qualityLimitationReason` dit pourquoi le moteur se retient : `cpu`
           * s'il n'encode pas assez vite, `bandwidth` si la liaison ne suit
           * pas, `none` s'il ne se retient pas. Un unique releve pris cinq
           * secondes apres le debut annoncait toujours `none` — et ne disait
           * donc rien des creux de dix secondes constates en cours de partage,
           * qui sont precisement ce qu'on cherche.
           *
           * Un releve a chaque changement, et pas plus : la definition et la
           * cause de limitation ne bougent que lorsque quelque chose se passe,
           * si bien qu'un partage calme n'ecrit qu'une ligne.
           */
          const limite =
            (entree as { qualityLimitationReason?: string }).qualityLimitationReason ?? 'inconnu';
          const definition = `${entree.frameWidth ?? 0}x${entree.frameHeight ?? 0}`;
          const signature = `${definition}|${limite}`;

          /*
           * On cesse de fabriquer les images que l'encodeur jette.
           *
           * Uniquement quand la capture vient du systeme : le moteur web, lui,
           * ne nous laisse pas regler la cadence en cours de route.
           */
          if (captureNative) {
            const voulu = useDevices.getState().media.screenFrameRate;
            if (cadenceCapture === 0) cadenceCapture = voulu;

            const suite = ajuster(cadenceCapture, voulu, {
              images: Math.round(entree.framesPerSecond ?? 0),
              limite,
            });

            if (suite !== null) {
              journal.info('partage', 'Cadence de capture ajustee', {
                avant: cadenceCapture,
                apres: suite,
                demande: voulu,
                emises: Math.round(entree.framesPerSecond ?? 0),
                limite,
              });

              cadenceCapture = suite;
              void import('./imageSysteme').then(({ reglerCadence }) =>
                reglerCadence(suite),
              );
            }
          }

          if (dernierInstant > 0 && kbps > 0 && signature !== derniereQualite) {
            const precedente = derniereQualite;
            derniereQualite = signature;

            journal.info('partage', precedente ? 'Qualite changee' : 'Qualite emise', {
              definition,
              images: Math.round(entree.framesPerSecond ?? 0),
              kbps,
              limite,
              avant: precedente,
              encodeur:
                (entree as { encoderImplementation?: string }).encoderImplementation ?? null,
            });
          }

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

  /**
   * Range une piste sonore du cote de la voix ou du cote du partage.
   *
   * Le micro est emis seul : son flux ne porte que de l'audio. Un partage avec
   * le son emet ses deux pistes sur le MEME flux. La presence d'une piste video
   * dans le flux tranche donc — quand elle est deja la.
   *
   * Car les deux pistes n'arrivent pas ensemble, et rien n'impose que la video
   * precede. Quand le son arrivait le premier, le flux paraissait ne porter que
   * de l'audio : on le prenait pour une voix, il ecrasait le micro de la
   * personne, et le son du partage n'atteignait jamais son curseur — « Ce
   * partage n'envoie pas de son », alors qu'il en envoyait.
   *
   * D'ou le classement immediat, suivi d'une correction. Immediat parce qu'une
   * voix mise en attente une seconde et demie est une seconde et demie de
   * silence a chaque connexion ; corrige parce que l'ordre d'arrivee n'est pas
   * de notre ressort.
   */
  function placeAudioStream(peerId: UUID, stream: MediaStream): void {
    const partage =
      stream.getVideoTracks().length > 0 || streamPurposes.get(stream.id) === 'screen';

    /*
     * Ce classement est trace, parce qu'il se trompe sans bruit.
     *
     * Une piste rangee du mauvais cote ne leve aucune erreur : on entend
     * simplement le mauvais son, ou rien. Sans cette ligne, la seule facon de
     * savoir ce qui s'est passe chez quelqu'un d'autre est de le lui demander,
     * et il ne peut pas repondre — rien ne le lui montre.
     */
    journal.info('vocal', 'Piste sonore rangee', {
      pair: peerId,
      cote: partage ? 'partage' : 'voix',
      videoDansLeFlux: stream.getVideoTracks().length,
      annonce: streamPurposes.get(stream.id) ?? null,
      pistesAudio: stream.getAudioTracks().length,
    });

    if (partage) {
      set((state) => ({
        remoteScreenAudio: { ...state.remoteScreenAudio, [peerId]: stream },
      }));

      // La voix ne doit pas garder ce flux si elle l'avait pris pour elle.
      set((state) =>
        state.remoteAudio[peerId] === stream
          ? { remoteAudio: retirer(state.remoteAudio, peerId) }
          : {},
      );

      detacherAnalyseurDe(peerId, stream);
      return;
    }

    set((state) => ({ remoteAudio: { ...state.remoteAudio, [peerId]: stream } }));

    // Seule la voix alimente le detecteur de parole : un jeu bruyant allumerait
    // la pastille de qui ne dit rien.
    attachAnalyser(peerId, stream);
  }

  /** Rend une copie de `source` sans la cle demandee. */
  function retirer<T>(source: Record<UUID, T>, cle: UUID): Record<UUID, T> {
    const copie = { ...source };
    delete copie[cle];
    return copie;
  }

  /**
   * Coupe le detecteur de parole pour un flux qui s'avere etre un partage.
   *
   * Sans cela, la pastille de parole de la personne s'allumerait au rythme du
   * jeu qu'elle diffuse, et l'on chercherait longtemps pourquoi elle « parle »
   * sans rien dire.
   */
  function detacherAnalyseurDe(peerId: UUID, stream: MediaStream): void {
    /*
     * On ne coupe l'analyseur que s'il ecoutait CE flux.
     *
     * La premiere version comparait au flux range dans `remoteAudio`, ce qui
     * paraissait revenir au meme et n'y revenait pas du tout : quand le son
     * d'un partage arrivait, il differait forcement du micro range la, et l'on
     * supprimait l'analyseur de la VOIX de la personne. Sa pastille de parole
     * s'eteignait definitivement des qu'elle partageait son ecran avec le son.
     *
     * On retient donc le flux que chaque analyseur ecoute, et on ne defait que
     * ce qui correspond.
     */
    if (fluxAnalyses.get(peerId) !== stream) return;

    analysers.delete(peerId);
    fluxAnalyses.delete(peerId);
    set((state) => (state.speaking[peerId] ? { speaking: retirer(state.speaking, peerId) } : {}));
  }

  /**
   * Reprend les flux restes en attente et les range si l'on sait maintenant.
   *
   * C'EST LE POINT QUI MANQUAIT, et il explique un defaut qu'on ne savait pas
   * reproduire : « des fois je ne vois pas le partage de mon ami ».
   *
   * Le repli ne tentait le classement qu'une seule fois, une seconde apres
   * l'arrivee de la piste. Si la presence n'etait pas encore a jour a cet
   * instant precis — elle voyage par un autre chemin que la piste, et rien ne
   * les ordonne — le flux restait en attente POUR TOUJOURS. Aucune erreur,
   * aucune trace : on cliquait « Regarder » et rien n'apparaissait.
   *
   * Cela explique aussi les deux contournements trouves par tatonnement :
   * lancer son propre partage force une renegociation, donc une nouvelle
   * arrivee de piste et un nouvel essai ; quitter et revenir refait tout dans
   * le bon ordre.
   *
   * On repasse donc a chaque changement de presence et au battement : ce sont
   * exactement les moments ou la reponse a pu arriver.
   */
  function reclasserEnAttente(): void {
    if (pendingStreams.size === 0) return;

    for (const attente of [...pendingStreams.values()]) {
      const devine = classerParPresence(attente.peerId, attente.stream.id);
      if (!devine) continue;

      journal.alerte('vocal', 'Flux classe sans son annonce', {
        pair: attente.peerId,
        suppose: devine,
      });

      placeVideoStream(attente.peerId, attente.stream, devine);
    }
  }

  /**
   * Devine le role d'un flux a partir de ce que la presence annonce.
   *
   * Rend `null` des que la reponse est ambigue — personne introuvable, ou bien
   * partage ET camera en meme temps. Deviner faux afficherait une camera en
   * plein ecran a la place d'un jeu, ce qui est pire que d'attendre.
   */
  function classerParPresence(peerId: UUID, fluxId?: string): StreamPurpose | null {
    const salon = get().channelId;
    if (!salon) return null;

    const qui = (get().participantsByChannel[salon] ?? []).find(
      (participant) => participant.user_id === peerId,
    );

    if (!qui) return null;
    if (qui.sharing && !qui.video) return 'screen';
    if (qui.video && !qui.sharing) return 'camera';

    /*
     * Les deux a la fois : on tranche par elimination, si l'on peut.
     *
     * Quelqu'un qui montre sa camera ET son ecran envoie deux flux, et la
     * presence ne dit pas lequel est lequel. Mais si l'un des deux est deja
     * range, le second ne peut etre que l'autre — et c'est une deduction, pas
     * une supposition.
     *
     * Sans cela, ces deux flux restaient en attente indefiniment : le cas le
     * plus courant etant justement celui ou l'on regarde quelqu'un qui joue en
     * montrant sa tete.
     */
    if (qui.sharing && qui.video && fluxId) {
      const etat = get();
      const camera = etat.remoteCameras[peerId];
      const ecran = etat.remoteScreens[peerId];

      if (camera && camera.id !== fluxId && !ecran) return 'screen';
      if (ecran && ecran.id !== fluxId && !camera) return 'camera';
    }

    return null;
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
    fluxAnalyses.delete(peerId);

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
  function placeVideoStream(peerId: UUID, stream: MediaStream, repli?: StreamPurpose): void {
    const purpose = streamPurposes.get(stream.id) ?? repli;

    if (!purpose) {
      pendingStreams.set(stream.id, { peerId, stream });

      /*
       * L'annonce peut ne jamais venir. On ne reste pas bloque pour autant.
       *
       * Le role d'un flux voyage par le canal de signalisation, la piste par la
       * connexion media. Si l'annonce se perd — canal rouvert entre-temps,
       * message emis pendant que le destinataire se reabonnait — la piste reste
       * en attente pour toujours : on clique « Regarder », le bouton passe a
       * « Masquer », et rien n'apparait. C'est exactement ce qui a ete
       * rapporte, et c'etait invisible a l'emetteur, qui partageait bel et bien.
       *
       * La presence dit deja qui partage et qui montre sa camera. Quand une
       * seule des deux est vraie, elle repond a la question sans qu'on ait
       * besoin de l'annonce. Quand les deux le sont, elle ne tranche pas, et
       * l'on continue d'attendre — mieux vaut un flux en retard qu'une camera
       * affichee en grand a la place d'un jeu.
       */
      window.setTimeout(() => reclasserEnAttente(), REPLI_CLASSEMENT);

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

      /*
       * Le son du partage aussi.
       *
       * Il etait oublie ici : seule l'image partait vers un nouvel arrivant.
       * Celui qui etait deja la entendait le jeu, celui qui arrivait ensuite
       * ne voyait qu'une image muette — et rien ne le distinguait d'un partage
       * sans son, puisque le symptome est le meme.
       *
       * Cela se voit surtout dans un serveur, ou l'on entre et sort pendant
       * qu'une partie se joue.
       */
      const screenAudio = screen.getAudioTracks()[0];
      if (screenAudio) {
        peer.screenAudioSender = connection.addTrack(screenAudio, screen);
        void applyAudioEncoding(peer.screenAudioSender, audioBitrate(useDevices.getState().media));
      }

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

        /*
         * L'arrivee de l'image reclasse le son du meme flux.
         *
         * C'est le cas ou le son avait pris les devants : il avait ete range
         * du cote de la voix faute de video visible, et il faut le rendre au
         * partage maintenant qu'on sait.
         */
        if (get().remoteAudio[peerId] === stream) placeAudioStream(peerId, stream);

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
        placeAudioStream(peerId, stream);

        event.track.addEventListener('ended', () => {
          set((state) =>
            state.remoteScreenAudio[peerId] === stream
              ? { remoteScreenAudio: retirer(state.remoteScreenAudio, peerId) }
              : {},
          );
        });
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

      /*
       * L'annonce vaut aussi pour le son deja range du cote de la voix.
       *
       * Elle arrive parfois apres la piste. Sans ce rattrapage, un partage dont
       * le son precede l'image ET l'annonce resterait classe comme une voix
       * pour toute la seance.
       */
      if (signal.purpose === 'screen') {
        const voix = get().remoteAudio[signal.from];
        if (voix && voix.id === signal.streamId) placeAudioStream(signal.from, voix);
      }

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
  /**
   * Rend la piste du micro conforme a l'etat, quel qu'il soit.
   *
   * Chaque bascule posait `enabled` de son cote, a partir d'une copie de
   * l'etat prise avant sa propre ecriture. En cliquant vite sur « couper » et
   * « sourdine », deux bascules se croisaient : la seconde partait d'un etat
   * deja perime et remettait la piste dans la position que la premiere venait
   * d'annuler. L'interface disait « micro ouvert », la piste etait coupee, et
   * plus personne n'entendait plus personne.
   *
   * Il n'y a donc plus qu'un endroit qui touche a `enabled`, et il lit l'etat
   * apres son ecriture. Le meme raisonnement vaut pour `reprendreLeMicro`,
   * qui remplace la piste : il appelle ceci plutot que de deviner.
   */
  function appliquerMicro(): void {
    const { localStream, muted, deafened } = get();
    const actif = !muted && !deafened;

    for (const piste of localStream?.getAudioTracks() ?? []) {
      piste.enabled = actif;
    }
  }

  /**
   * Ouvre le canal du salon et pose tout ce qui l'ecoute.
   *
   * Rend `false` si le canal n'a pas pu s'ouvrir — l'appelant a deja ete
   * prevenu et le salon quitte.
   *
   * Sortie de `join` pour une raison precise : il faut pouvoir le REFAIRE sans
   * refaire le reste. Rouvrir le micro, renegocier les connexions et rejouer le
   * signal d'arrivee pour un canal a remplacer serait une coupure audible, la
   * ou seul le canal est en cause.
   */
  function ouvrirCanal(channelId: UUID, userId: UUID): boolean {
    /*
     * L'installation du canal ne doit jamais emporter l'interface.
     *
     * `supabase.channel(sujet)` rend un canal DEJA EXISTANT quand il en trouve
     * un sur ce sujet, et poser un ecouteur sur un canal souscrit leve une
     * exception. Elle partait d'ici, remontait jusqu'a React, et emportait tout
     * l'arbre : ecran noir, application inutilisable, et rien qui dise pourquoi.
     */
    try {
      room = supabase.channel(`orbit:voice:${channelId}`, {
        config: { presence: { key: userId }, broadcast: { self: false } },
      });
    } catch (cause) {
      journal.erreur('vocal', 'Canal du salon inutilisable', {
        salon: channelId,
        cause: String(cause),
      });

      room = null;
      set({
        connecting: false,
        error: 'Le salon vocal n’a pas pu s’ouvrir. Reessayez dans un instant.',
      });
      void get().leave();
      return false;
    }

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

        /*
         * Se voir soi-meme est le signe que le canal est vivant.
         *
         * C'est la seule preuve qui ne se devine pas : notre entree n'apparait
         * que si le serveur l'a bien recue ET nous la renvoie. Tant qu'on s'y
         * voit, la presence circule ; des qu'on n'y est plus, plus rien ne
         * circule — et personne d'autre ne s'y trouve non plus.
         */
        if (participants.some((participant) => participant.user_id === userId)) {
          derniereFoisVu = Date.now();
        }

        set((state) => ({
          participantsByChannel: { ...state.participantsByChannel, [channelId]: participants },
        }));
        syncPeers(participants);

        // La presence vient de parler : un flux qu'on ne savait pas classer
        // a peut-etre trouve sa reponse.
        reclasserEnAttente();
      })
      .subscribe((status) => {
        /*
         * TOUS les etats sont traites, et c'est la correction la plus lourde de
         * consequences de ce fichier.
         *
         * Seul `SUBSCRIBED` l'etait. Les trois autres — canal en erreur, delai
         * depasse, canal ferme — ne declenchaient RIEN : le canal restait mort,
         * la presence vide, et l'on se retrouvait seul dans un salon ou les
         * autres etaient pourtant la, chacun de son cote. Rien ne le disait, et
         * la seule issue etait de quitter et de revenir.
         *
         * C'est la meme cause pour toute une famille de defauts rapportes : « on
         * ne se voit pas », « on ne s'entend pas », « mon profil ne s'affiche
         * pas », « je dois quitter et revenir ».
         */
        journal.info('vocal', 'Canal du salon', { salon: channelId, etat: status });

        if (status === 'SUBSCRIBED') {
          derniereFoisVu = Date.now();
          publishState();
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // On ne rebatit pas ici : le client tente sa propre reconnexion, et
          // s'y superposer ouvrirait deux canaux sur le meme sujet. Le
          // battement s'en charge s'il ne revient pas.
          journal.alerte('vocal', 'Canal du salon perdu', { salon: channelId, etat: status });
        }
      });

    return true;
  }

  /**
   * Rebatit le canal quand il ne donne plus signe de vie.
   *
   * Le client de Realtime sait se reconnecter, mais pas toujours : un canal
   * laisse en erreur peut ne jamais revenir, et rien dans l'application ne s'en
   * apercevait. On mesure donc le seul fait qui compte — se voir soi-meme dans
   * la presence — et l'on refait le canal quand il cesse d'etre vrai.
   */
  async function reconstruireCanal(channelId: UUID, userId: UUID): Promise<void> {
    if (reconstructionEnCours) return;
    reconstructionEnCours = true;

    journal.alerte('vocal', 'Canal du salon rebati', {
      salon: channelId,
      silence: Date.now() - derniereFoisVu,
    });

    try {
      const ancien = room;
      room = null;

      // Le sujet doit etre libere avant d'etre repris : `supabase.channel` rend
      // un canal deja existant quand il en trouve un, et l'on rebatirait alors
      // sur le cadavre qu'on voulait remplacer.
      if (ancien) await supabase.removeChannel(ancien).catch(() => undefined);

      // Entre-temps on a pu quitter le salon.
      if (get().channelId !== channelId) return;

      // Le compteur repart : sans cela, le premier battement qui suit
      // rebatirait aussitot un canal qui n'a pas encore eu le temps de repondre.
      derniereFoisVu = Date.now();
      etatEnAttente = true;
      ouvrirCanal(channelId, userId);
    } finally {
      reconstructionEnCours = false;
    }
  }

  function syncPeers(participants: VoiceParticipant[]): void {
    const me = get().userId;
    const localStream = get().localStream;
    if (!me || !localStream) return;

    /*
     * La decision vit dans `pairs.ts`, seule et sans effet.
     *
     * Elle portait le defaut le plus couteux du vocal — une absence passagere
     * dans la presence detruisait une connexion, et un seul des deux cotes la
     * rebatissait — et un defaut de ce genre ne se corrige pas de facon
     * credible sans qu'on puisse l'eprouver. Huit cas le couvrent desormais.
     */
    const decision = decider(
      me,
      participants.map((participant) => participant.user_id),
      [...peers.keys()],
      etatPairs,
      Date.now(),
    );

    for (const pair of decision.retirer) {
      journal.info('vocal', 'Pair retire apres absence confirmee', { pair });
      dropPeer(pair);
      playCue('peer-leave');
    }

    for (const pair of decision.ouvrir) {
      // Le signal d'arrivee se coupe par serveur : precieux a trois, penible
      // a deux cents.
      if (sonVocalActif(get().channelId)) playCue('peer-join');
      createPeer(pair, localStream);
    }

    for (const pair of decision.rebatir) {
      journal.alerte('vocal', 'Connexion rebatie faute d’offre', { pair });
      createPeer(pair, localStream);
    }
  }

  return {
    channelId: null,
    userId: null,
    connecting: false,
    error: null,
    avertissement: null,

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
    pousseePourCouper: false,
    partageSansSon: false,
    raisonSansSon: null,
    outboundStats: null,

    join: async (channelId, userId) => {
      if (get().channelId === channelId) return;

      salonEnJonction = channelId;
      set({ connecting: true, error: null });

      /*
       * On enchaine sans pause.
       *
       * Une attente de cent vingt millisecondes se tenait ici, le temps que le
       * systeme rende le micro de la session precedente. Elle etait payee a
       * CHAQUE changement de salon pour un echec qui n'arrive presque jamais —
       * et quand il arrive, `capturer` reessaie deja de lui-meme une
       * demi-seconde plus tard.
       *
       * Autrement dit : on ralentissait tout le monde en permanence pour un
       * cas rare qui savait se rattraper seul.
       */
      if (get().channelId) await get().leave();

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
      const aFermer = new Set<ReturnType<typeof supabase.channel>>();

      const observateur = observateurs.get(channelId);
      if (observateur) {
        observateurs.delete(channelId);
        aFermer.add(observateur);
      }

      // Ceinture : un canal sur ce sujet peut venir d'ailleurs — un salon
      // precedent mal referme, une reconciliation en vol.
      for (const reste of supabase.getChannels()) {
        if (reste.topic.endsWith(`orbit:voice:${channelId}`)) aFermer.add(reste);
      }

      /*
       * Fermes de front, pas l'un apres l'autre.
       *
       * Chaque fermeture est un aller-retour vers le serveur. En file, deux
       * canaux restants coutaient deux fois le temps d'un ; menes ensemble, ils
       * ne coutent que le plus lent. C'est la meme raison qui fait ouvrir le
       * micro plus haut sans l'attendre.
       */
      await Promise.all([...aFermer].map((canal) => supabase.removeChannel(canal)));

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

      journal.info('vocal', 'Salon rejoint', {
        salon: channelId,
        // Le temps mis a ouvrir le micro est la moitie du delai ressenti a la
        // connexion : sans le mesurer, on ne discute que d'impressions.
        relais: relaisImpose,
        serveurs: serveursDuSalon.length,
      });

      // Son propre micro passe par le meme analyseur que ceux des autres.
      // Sans cela, la pastille de parole ne s'allumait jamais pour soi : on
      // voyait les autres parler, jamais soi, et rien n'indiquait si le micro
      // captait quoi que ce soit.
      attachAnalyser(userId, localStream);
      startSpeechDetection();
      suivreReglagesMicro();

      playCue('join');

      /*
       * On repasse sur les connexions toutes les trois secondes.
       *
       * C'est court devant les six secondes d'attente avant de rebatir, et
       * assez peu frequent pour ne rien couter : la fonction ne fait rien
       * quand tout est en place.
       */
      battementPairs = window.setInterval(() => {
        const salon = get().channelId;
        if (!salon) return;
        syncPeers(get().participantsByChannel[salon] ?? []);
        reclasserEnAttente();

        /*
         * Le canal donne-t-il encore signe de vie ?
         *
         * Douze secondes sans s'y voir soi-meme : c'est bien au-dela de tout
         * hoquet de reseau — la presence se resynchronise a chaque changement et
         * l'on se republie toutes les trois secondes — et bien en deca de ce
         * qu'on supporte a l'usage. Passe ce delai, le canal est mort et rien
         * ne le ressuscitera tout seul.
         */
        const moi = get().userId;
        if (moi && Date.now() - derniereFoisVu > SILENCE_CANAL) {
          void reconstruireCanal(salon, moi);
        }

        /*
         * On se re-annonce, meme sans rien avoir change.
         *
         * La presence de Realtime est declarative : elle ne vaut que tant que
         * le serveur en garde la trace. Une reconnexion du socket, un envoi
         * perdu, une coupure d'une seconde — et notre entree n'y est plus,
         * sans que rien ici ne s'en apercoive. On reste alors invisible dans
         * son propre salon, ce qui est exactement le defaut rapporte.
         *
         * Republier coute un message toutes les trois secondes, et c'est le
         * meme message que celui qu'on emet en changeant d'etat : cela ne
         * peut pas diverger de l'etat courant, puisque c'est l'etat courant
         * qui est envoye.
         */
        publishState();
      }, 3000);

      // Le canal, ses ecouteurs et sa reprise vivent dans `ouvrirCanal` : il
      // faut pouvoir le refaire sans refaire le micro ni les connexions.
      if (!ouvrirCanal(channelId, userId)) return;

      startSpeechDetection();
      salonEnJonction = null;
    },

    leave: async () => {
      salonEnJonction = null;

      if (get().channelId) {
        playCue('leave');
        journal.info('vocal', 'Salon quitte', { salon: get().channelId });
      }
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

      derniereFoisVu = 0;
      reconstructionEnCours = false;

      if (battementPairs !== null) {
        window.clearInterval(battementPairs);
        battementPairs = null;
      }
      arretSuiviMicro?.();
      arretSuiviMicro = null;
      teardownPeers();
      // Le salon qu'on laisse redevient un salon comme un autre : on veut y
      // voir qui reste. Sa fermeture n'est pas finie, d'ou le report.
      window.setTimeout(reconcilierObservateurs, 800);
      streamPurposes.clear();
      pendingStreams.clear();
      etatPairs.absences.clear();
      etatPairs.attentes.clear();

      relacherMicro();
      couperSonNatif();
      couperCaptureNative();
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

    /*
     * L'annonce est immediate, pas differee.
     *
     * Une touche tenue dure parfois moins d'une seconde. Passer par la fenetre
     * de publication ordinaire ferait apparaitre le signe apres qu'on a lache,
     * ou pas du tout — et un indicateur qui arrive en retard est pire que pas
     * d'indicateur : il decrit un present qui n'existe plus.
     */
    signalerPoussee: (tenue) => {
      if (get().pousseePourCouper === tenue) return;
      set({ pousseePourCouper: tenue });
      publishState();
    },

    toggleMute: () => {
      surveillerMartelement();
      const next = !get().muted;

      // Reactiver le micro alors qu'on est sourd n'aurait pas de sens : on
      // retablit le son en meme temps.
      set({ muted: next, deafened: next ? get().deafened : false });

      appliquerMicro();
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
      surveillerMartelement();
      const { deafened, muted } = get();
      const next = !deafened;

      // L'etat du micro est retenu au moment ou l'on devient sourd, pas apres :
      // ensuite il vaut forcement « coupe » et l'information est perdue.
      if (next) mutedBeforeDeafen = muted;

      set({ deafened: next, muted: next ? true : mutedBeforeDeafen });

      appliquerMicro();
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

          couperSonNatif();
          couperCaptureNative();

          set((etat) => {
            const moi = etat.userId;
            return {
              sharing: false,
              localScreen: null,
              partageSansSon: false,
              raisonSansSon: null,
              // On oublie qu'on le regardait, sinon le partage suivant
              // heriterait d'un choix pris pour un autre.
              watchedShares: moi ? retirer(etat.watchedShares, moi) : etat.watchedShares,
              focusedShare: etat.focusedShare === moi ? null : etat.focusedShare,
            };
          });
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

        let videoTrack = display.getVideoTracks()[0];

        if (sourceId) {
          /*
           * La source est capturee par le systeme, pas decoupee dans l'ecran.
           *
           * Le moteur web ne sait capturer qu'apres avoir ouvert sa propre
           * fenetre de selection — celle que nous supprimons pour afficher la
           * notre. On lui demandait donc l'ecran entier, toujours le premier,
           * et l'on decoupait. Trois defauts en decoulaient : ce qui recouvrait
           * la fenetre partait avec elle, le second ecran etait hors
           * d'atteinte, et une fenetre reduite n'avait plus rien a decouper.
           *
           * Windows sait capturer la source elle-meme. La decoupe reste en
           * repli — un vieux Windows, un moteur sans `MediaStreamTrackGenerator`
           * — parce qu'un partage imparfait vaut mieux qu'un partage absent.
           */
          const { captureNativeDisponible, capturerSource } = await import('./imageSysteme');

          if (captureNativeDisponible()) {
            const capture = await capturerSource(
              sourceId,
              useDevices.getState().media.screenFrameRate,
            );

            if (capture.ok) {
              captureNative = capture.image;
              const pisteNative = capture.image.flux.getVideoTracks()[0];

              if (pisteNative) {
                // L'image du moteur ne sert plus a rien : la garder ouverte
                // laisserait une capture d'ecran tourner pour personne.
                for (const piste of display.getVideoTracks()) piste.stop();
                display.removeTrack(videoTrack!);
                display.addTrack(pisteNative);
                videoTrack = pisteNative;
              }
            } else {
              journal.alerte('partage', 'Capture native refusee', {
                source: sourceId,
                raison: capture.raison,
              });
            }
          }

          if (!captureNative) {
            try {
              const { decouperSource } = await import('./decoupe');
              const decoupe = await decouperSource(
                display,
                sourceId,
                useDevices.getState().media.screenFrameRate,
                useDevices.getState().media.screenQuality,
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
          couperSonNatif();
          couperCaptureNative();
          set((etat) => {
            const moi = etat.userId;
            return {
              sharing: false,
              localScreen: null,
              partageSansSon: false,
              raisonSansSon: null,
              // On oublie qu'on le regardait, sinon le partage suivant
              // heriterait d'un choix pris pour un autre.
              watchedShares: moi ? retirer(etat.watchedShares, moi) : etat.watchedShares,
              focusedShare: etat.focusedShare === moi ? null : etat.focusedShare,
            };
          });
          publishState();
        });

        const media = useDevices.getState().media;

        // Le son du partage, quand la source en fournit. Il voyage dans le meme
        // flux que l'image : le separer obligerait a resynchroniser a l'arrivee.
        let [audioTrack] = display.getAudioTracks();
        let raisonNatif: string | null = null;

        /*
         * Sans son du moteur, on va le prendre a Windows.
         *
         * `getDisplayMedia` ne l'accorde que par une case a cocher qui vit dans
         * le selecteur du systeme — celui-la meme que nous sautons pour
         * afficher le notre. Deux contournements cote web ont echoue ; le
         * second, `chromeMediaSource`, tuait le processus de rendu a chaque
         * partage. Leur trace complete est dans `sonSysteme.ts`.
         *
         * Ce chemin-ci ne passe pas par le moteur : la partie native lit le
         * bouclage de WASAPI et nous rend une piste. Elle rejoint le flux du
         * partage, si bien que l'emission, l'annonce et l'arret la traitent
         * comme si elle en venait — sans un seul cas particulier plus loin.
         */
        if (!audioTrack && media.shareSystemAudio) {
          /*
           * Le rappel se declenche quelques secondes apres le debut, quand la
           * mesure a eu le temps d'ecouter. Il ne peut donc pas etre traite
           * comme un echec de capture : le partage est deja parti, et la piste
           * existe. Ce qu'on annonce n'est pas « pas de son » mais « du son
           * qui ne porte rien », ce qui appelle une autre reponse.
           */
          const resultat = await capturerSonSysteme(media.loopbackDeviceId, (nom) => {
            if (!get().sharing) return;

            set({
              partageSansSon: true,
              raisonSansSon:
                (nom
                  ? `Windows capture « ${nom} », ou rien ne joue.`
                  : 'Le peripherique capture ne joue rien.') +
                ' Choisissez la bonne sortie dans Parametres › Voix et video, ou changez la sortie par defaut de Windows.',
            });
          }, sourceDuSon(sourceId, media.loopbackSource));

          if (resultat.ok) {
            sonNatif = resultat.son;
            const pisteNative = resultat.son.flux.getAudioTracks()[0] ?? null;

            if (pisteNative) {
              display.addTrack(pisteNative);
              audioTrack = pisteNative;
              raisonNatif = null;
            } else {
              // Un flux sans piste ne devrait pas arriver ; s'il arrive, on le
              // dit plutot que de laisser croire a un jeu silencieux. L'image,
              // elle, n'a rien a voir avec cet echec et continue.
              couperSonNatif();
              raisonNatif = 'La capture s’est ouverte mais n’a rendu aucune piste.';
            }
          } else {
            raisonNatif = resultat.raison;
          }

          journal.info('partage', 'Son du systeme demande', {
            obtenu: Boolean(audioTrack),
            raison: raisonNatif,
          });
        }

        /*
         * Le son demande n'est pas toujours accorde, et cela ne se voit pas.
         *
         * Windows ne permet la capture du son que pour un ecran entier ou un
         * onglet, jamais pour une fenetre isolee. Nous sautons de plus le
         * selecteur du moteur — c'est ce qui nous permet d'avoir le notre —
         * or c'est dans ce selecteur que se coche « partager aussi le son ».
         *
         * Sans cette verification, l'echec est parfaitement muet : le partage
         * part, l'image arrive, et personne ne sait si le silence vient d'un
         * refus du systeme, d'un reglage oublie, ou d'un jeu qui ne fait pas
         * de bruit. On le dit donc, une fois, a qui partage.
         */
        set({
          partageSansSon: media.shareSystemAudio && !audioTrack,
          raisonSansSon: audioTrack ? null : raisonNatif,
        });

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

            /*
             * Le son du partage a droit au meme debit que la voix.
             *
             * Il ne l'avait pas : seul `micSender` etait regle, et le son du
             * jeu partait au debit par defaut de WebRTC. On l'entendait, mais
             * comprime comme une conversation telephonique — ce qui est le
             * pire traitement possible pour de la musique.
             */
            void applyAudioEncoding(
              peer.screenAudioSender,
              audioBitrate(useDevices.getState().media),
            );

            journal.info('partage', 'Son envoye a un pair', {
              pair: peerId,
              piste: audioTrack.id.slice(0, 8),
              actif: audioTrack.enabled,
              etat: audioTrack.readyState,
            });
          }

          announceStream(peerId, display.id, 'screen');
        }

        /*
         * Son propre partage s'ouvre deja regarde.
         *
         * Le clic « Regarder » existe pour epargner un DECODAGE : recevoir un
         * flux ne coute presque rien, le developper coute un coeur entier. Or
         * son propre partage ne se decode pas — c'est la capture elle-meme,
         * deja en memoire. Il n'y avait donc rien a epargner, et l'on devait
         * cliquer pour voir ce qu'on venait soi-meme de lancer.
         */
        set((etat) => {
          const moi = etat.userId;
          return {
            sharing: true,
            localScreen: display,
            watchedShares: moi ? { ...etat.watchedShares, [moi]: true } : etat.watchedShares,
          };
        });

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

      /*
       * Demander a voir un partage vaut classement.
       *
       * Si un flux de cette personne attend toujours son annonce, le clic leve
       * l'ambiguite mieux que n'importe quelle heuristique : on ne demande pas
       * a regarder le partage de quelqu'un qui n'en fait pas. Sans cela, il
       * fallait attendre le repli — et pendant ce temps, la vignette restait
       * vide sans rien expliquer.
       */
      if (suivant && !get().remoteScreens[userId]) {
        for (const [, attente] of pendingStreams) {
          if (attente.peerId !== userId) continue;
          placeVideoStream(userId, attente.stream, 'screen');
          break;
        }
      }

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
