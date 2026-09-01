import { create } from 'zustand';
import { setCueVolume } from '@/lib/sounds';

/**
 * Choix de micro, de haut-parleur et de camera.
 *
 * Separe du magasin vocal parce que ces reglages se modifient hors de tout
 * appel — c'est meme le cas le plus courant, depuis les parametres. Les
 * fusionner obligerait a charger la machinerie WebRTC pour afficher une liste
 * deroulante.
 *
 * Les identifiants d'appareils sont persistes, mais restent des voeux : un
 * casque debranche entre deux sessions rendrait l'identifiant caduc. On repasse
 * alors sur l'appareil par defaut plutot que d'echouer.
 */

export interface MediaPreferences {
  /** Identifiant du micro, ou `null` pour l'appareil par defaut du systeme. */
  microphoneId: string | null;
  speakerId: string | null;
  cameraId: string | null;

  /** Traitements du navigateur sur le micro. */
  echoCancellation: boolean;
  noiseSuppression: boolean;
  /**
   * Isolation de la voix.
   *
   * Retire ce qui n'est pas une voix — clavier, chien, conversation a cote —
   * la ou la reduction de bruit ordinaire ne s'attaque qu'aux bruits continus.
   * Ignoree par les moteurs qui ne la connaissent pas.
   */
  voiceIsolation: boolean;
  autoGainControl: boolean;

  /**
   * Porte de bruit : coupe le micro entre les phrases.
   *
   * La reduction de bruit du moteur travaille pendant qu'on parle ; elle ne
   * fait rien du fond sonore qui reste entre les mots — or c'est celui-la que
   * les autres entendent toute la journee. Voir `porte.ts`.
   */
  noiseGate: boolean;

  /**
   * Masquer son adresse IP aux autres participants.
   *
   * Une liaison directe suppose que les deux machines connaissent leurs
   * adresses : dans un salon vocal ordinaire, la votre est donc visible des
   * autres. La seule facon de la masquer est de faire passer tout le trafic
   * par un relais, ce qui coute de la latence et demande un serveur TURN.
   *
   * Le reglage reste sans effet tant qu'aucun relais n'est configure —
   * l'imposer sans relais ne masquerait rien, cela empecherait simplement
   * toute connexion. Voir `reseau.ts` et `SECURITE.md`.
   */
  masquerIp: boolean;

  /**
   * Qualite du son de la voix.
   *
   * WebRTC ouvre Opus a environ trente kilobits par seconde — un reglage pense
   * pour la telephonie sur des reseaux incertains, et qui s'entend : les voix
   * graves passent mal, les consonnes bavent. Sur une connexion domestique,
   * doubler ce budget ne coute rien de perceptible et change beaucoup.
   *
   * `musique` monte a cent vingt-huit kilobits en stereo, et coupe les
   * traitements du micro : l'annulation d'echo et la reduction de bruit sont
   * faites pour la parole, et massacrent un instrument ou un morceau.
   */
  audioQuality: 'voix' | 'haute' | 'musique';

  /** Volume applique aux voix distantes, de 0 a 1. */
  outputVolume: number;
  /** Sensibilite du detecteur de parole, en dB (de -100 a 0). */
  speakingThreshold: number;

  /** Definition demandee a la camera. */
  videoQuality: '480p' | '720p' | '1080p';
  /** Definition demandee au partage d'ecran. */
  screenQuality: '720p' | '1080p' | 'source';
  /** Images par seconde du partage d'ecran. */
  screenFrameRate: 15 | 30 | 60;
  /**
   * Ce qu'on privilegie quand le reseau ne suit plus.
   *
   * `motion` garde la fluidite et laisse la nettete baisser — ce qu'il faut
   * pour un jeu ou une video. `detail` fait l'inverse : le texte d'un editeur
   * reste lisible, au prix de saccades.
   */
  screenPriority: 'motion' | 'detail';
  /** Volume des signaux sonores — micro coupe, arrivee, depart. */
  cueVolume: number;
  /**
   * Envoie le son de ce qui est partage, en plus de l'image.
   *
   * Windows le permet pour un ecran entier comme pour un onglet ; sur d'autres
   * systemes la capture est refusee et le partage part sans son, sans echouer.
   */
  shareSystemAudio: boolean;

  /**
   * Sortie dont on capture le son pour le partage. `null` = celle de Windows.
   *
   * Ce reglage existe a cause d'un cas qui n'a rien d'exotique : sur une
   * machine equipee d'un routeur audio virtuel — Voicemeeter, VB-Cable, ceux
   * qu'installent la plupart de ceux qui streament — la sortie par defaut de
   * Windows est une entree virtuelle sur laquelle rien ne joue. Le bouclage
   * s'ouvre alors sans erreur et ne transporte que du silence, ce que rien ne
   * distingue d'un partage muet.
   *
   * Sans ce choix, la seule facon d'avoir du son etait de changer le
   * peripherique par defaut de Windows — pour toute la machine, et pour toutes
   * les applications.
   */
  loopbackDeviceId: string | null;
}

const DEFAULTS: MediaPreferences = {
  microphoneId: null,
  speakerId: null,
  cameraId: null,
  echoCancellation: true,
  noiseSuppression: true,
  voiceIsolation: true,
  autoGainControl: true,
  noiseGate: true,
  // Actif par defaut : sans relais configure il ne fait rien, et le jour ou
  // l'on en pose un, la protection s'applique sans avoir a y penser.
  masquerIp: true,
  // « haute » par defaut : le debit double celui de WebRTC sans mettre en peril
  // une connexion ordinaire, et c'est la difference que l'on entend le plus.
  audioQuality: 'haute',
  outputVolume: 1,
  speakingThreshold: -50,
  videoQuality: '720p',
  screenQuality: '1080p',
  screenFrameRate: 60,
  /*
   * La fluidite, par defaut.
   *
   * Les deux reglages sacrifient quelque chose, et il faut choisir lequel :
   * « nettete » tient la definition et laisse tomber des images, « fluidite »
   * fait l'inverse. Le premier a ete essaye et se paie cash — un partage annonce
   * a soixante images en rend visiblement trente, ce qui saute aux yeux sur un
   * jeu ou une video, c'est-a-dire sur l'essentiel de ce qu'on partage.
   *
   * Le flou que « nettete » evitait tenait surtout a un plafond de debit trop
   * bas ; il est passe a douze megabits, ce qui laisse de quoi tenir les deux
   * la plupart du temps. Reste le choix dans le selecteur, pour partager un
   * document plein de texte.
   */
  screenPriority: 'motion',
  cueVolume: 0.6,
  shareSystemAudio: true,
  loopbackDeviceId: null,
};

const STORAGE_KEY = 'orbit:media';

const VIDEO_SIZES: Record<MediaPreferences['videoQuality'], { width: number; height: number }> = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

const SCREEN_SIZES: Record<MediaPreferences['screenQuality'], { width: number; height: number } | null> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  source: null,
};

function load(): MediaPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<MediaPreferences>) };
  } catch {
    return DEFAULTS;
  }
}

function persist(preferences: MediaPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Navigation privee : les reglages valent pour la session en cours.
  }
}

export interface DeviceOption {
  deviceId: string;
  label: string;
}

interface DeviceState {
  media: MediaPreferences;

  microphones: DeviceOption[];
  speakers: DeviceOption[];
  cameras: DeviceOption[];

  /** Vrai une fois l'autorisation obtenue : avant, les noms sont vides. */
  labelled: boolean;
  enumerating: boolean;
  error: string | null;

  setMedia: <K extends keyof MediaPreferences>(key: K, value: MediaPreferences[K]) => void;
  /** Recense les appareils. `prompt` demande l'autorisation pour lire les noms. */
  refreshDevices: (prompt?: boolean) => Promise<void>;
  watchDevices: () => () => void;
}

/**
 * Sans autorisation, `enumerateDevices` renvoie des entrees anonymes : le
 * nombre d'appareils est connu, pas leur nom. Une liste de « Micro », « Micro 2 »
 * serait inutilisable, d'ou la demande explicite avant le recensement.
 */
async function enumerate(prompt: boolean): Promise<{
  microphones: DeviceOption[];
  speakers: DeviceOption[];
  cameras: DeviceOption[];
  labelled: boolean;
}> {
  if (prompt) {
    // Le flux n'est demande que pour obtenir les noms : il est relache aussitot.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  const pick = (kind: MediaDeviceKind, fallback: string): DeviceOption[] =>
    devices
      .filter((device) => device.kind === kind)
      // Sur Chrome, un appareil « default » double une entree reelle : le
      // garder afficherait deux fois le meme micro.
      .filter((device) => device.deviceId !== 'default' && device.deviceId !== 'communications')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `${fallback} ${index + 1}`,
      }));

  return {
    microphones: pick('audioinput', 'Micro'),
    speakers: pick('audiooutput', 'Sortie'),
    cameras: pick('videoinput', 'Camera'),
    labelled: devices.some((device) => device.label !== ''),
  };
}

export const useDevices = create<DeviceState>((set, get) => ({
  media: load(),
  microphones: [],
  speakers: [],
  cameras: [],
  labelled: false,
  enumerating: false,
  error: null,

  setMedia: (key, value) => {
    const media = { ...get().media, [key]: value };
    set({ media });
    persist(media);

    // Le generateur de signaux vit hors du magasin : il faut le tenir informe,
    // sinon le curseur bouge sans que rien ne change a l'oreille.
    if (key === 'cueVolume') setCueVolume(media.cueVolume);
  },

  refreshDevices: async (prompt = false) => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      set({ error: 'Ce navigateur ne donne pas acces aux peripheriques audio et video.' });
      return;
    }

    set({ enumerating: true, error: null });

    try {
      const result = await enumerate(prompt);
      set({ ...result, enumerating: false });
    } catch (failure) {
      const denied = failure instanceof DOMException && failure.name === 'NotAllowedError';
      set({
        enumerating: false,
        error: denied
          ? "Acces au micro refuse. Autorisez-le dans la barre d'adresse pour voir vos appareils."
          : 'Impossible de lire la liste des peripheriques.',
      });
    }
  },

  /**
   * Suit les branchements a chaud. Un casque connecte pendant un appel doit
   * apparaitre sans avoir a rouvrir les parametres.
   */
  watchDevices: () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return () => {};

    const onChange = () => void get().refreshDevices(false);
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  },
}));

/* -------------------------------------------------------------------------- */
/* Contraintes derivees                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Contraintes du micro, telles que `getUserMedia` les attend.
 *
 * `exact` sur l'appareil serait une erreur : un micro retire ferait echouer
 * l'entree en vocal au lieu de basculer sur un autre. On l'exprime donc en
 * preference.
 */
/**
 * Contraintes du micro.
 *
 * `voiceIsolation` va plus loin que `noiseSuppression` : la seconde attenue les
 * bruits stationnaires — ventilateur, souffle, bourdonnement — la premiere
 * isole la voix de tout le reste, y compris d'un clavier, d'un chien ou d'une
 * conversation voisine. Le traitement se fait dans le moteur, en amont de
 * l'encodage, donc sans cout pour la qualite de ce qui reste.
 *
 * Elle est demandee en `ideal` et non en `exact` : les moteurs qui ne la
 * connaissent pas l'ignorent au lieu de refuser le micro, et l'on retombe alors
 * sur la reduction de bruit ordinaire.
 */
export function audioConstraints(media: MediaPreferences): MediaTrackConstraints {
  /*
   * Le mode musique coupe la chaine de traitement.
   *
   * Ce n'est pas un raffinement : l'annulation d'echo de Chromium ramene le
   * signal en mono et lui applique un filtrage taille pour la parole. Laisser
   * ces traitements en place tout en demandant du stereo a cent vingt-huit
   * kilobits reviendrait a promettre une qualite que le moteur a deja detruite
   * en amont de l'encodeur.
   */
  const musique = media.audioQuality === 'musique';

  return {
    ...(media.microphoneId ? { deviceId: { ideal: media.microphoneId } } : {}),
    echoCancellation: musique ? false : media.echoCancellation,
    noiseSuppression: musique ? false : media.noiseSuppression,
    autoGainControl: musique ? false : media.autoGainControl,
    ...(media.voiceIsolation && !musique ? { voiceIsolation: { ideal: true } } : {}),
    // 48 kHz est le taux natif d'Opus : le demander evite un reechantillonnage
    // de plus entre le micro et l'encodeur.
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: musique ? 2 : 1 },
  } as MediaTrackConstraints;
}

/** Debit vise pour la voix, en bits par seconde. */
export function audioBitrate(media: MediaPreferences): number {
  return media.audioQuality === 'musique' ? 128_000 : media.audioQuality === 'haute' ? 64_000 : 32_000;
}

/**
 * Impose un debit a la voix sortante.
 *
 * Distinct de `applyEncoding` : `degradationPreference` et
 * `scaleResolutionDownBy` n'ont aucun sens pour du son, et certains moteurs
 * rejettent l'objet entier si on les leur donne sur une piste audio.
 */
export async function applyAudioEncoding(sender: RTCRtpSender, bitrate: number): Promise<boolean> {
  try {
    const parameters = sender.getParameters();
    if (!parameters.encodings || parameters.encodings.length === 0) return false;

    for (const encoding of parameters.encodings) encoding.maxBitrate = bitrate;

    await sender.setParameters(parameters);
    return true;
  } catch {
    return false;
  }
}

/**
 * Demande a l'autre bout de mieux nous parler.
 *
 * `setParameters` regle ce que l'on emet ; les parametres Opus de la SDP
 * reglent ce que l'on accepte de recevoir. Les deux sont necessaires, et c'est
 * la seconde moitie qui manquait : chacun s'appliquait a bien emettre pendant
 * que son pair, faute d'avoir ete prevenu, continuait d'encoder au debit de
 * telephone.
 *
 * `usedtx=0` merite un mot : la detection de silence coupe l'emission entre
 * deux mots pour economiser du debit. Elle fonctionne, mais on entend le fond
 * sonore apparaitre et disparaitre a chaque phrase, ce qui fatigue plus qu'un
 * fond continu.
 */
export function ameliorerOpus(sdp: string, media: MediaPreferences): string {
  const stereo = media.audioQuality === 'musique' ? 1 : 0;

  const reglages = [
    `stereo=${stereo}`,
    `sprop-stereo=${stereo}`,
    `maxaveragebitrate=${audioBitrate(media)}`,
    'maxplaybackrate=48000',
    'useinbandfec=1',
    'usedtx=0',
  ];

  const connus = /^(stereo|sprop-stereo|maxaveragebitrate|maxplaybackrate|useinbandfec|usedtx)=/;

  /*
   * Chaque section media est traitee separement.
   *
   * La version precedente cherchait le premier `a=rtpmap: … opus` de la SDP et
   * s'arretait la. Cela suffisait tant qu'il n'y avait qu'une piste sonore, le
   * micro. Depuis que le partage emporte le son de l'ordinateur, il y en a
   * deux — et la seconde, celle qui porte le jeu ou la musique, restait aux
   * reglages par defaut du moteur : mono, trente-deux kilobits. C'est-a-dire
   * la qualite d'un telephone pour ce qu'on partage justement pour le faire
   * entendre.
   *
   * Pire, les deux sections declarent en general le MEME type de charge utile
   * pour Opus. Un `replace` non global posait donc les reglages sur la
   * premiere et laissait la seconde nue, sans que rien ne le signale.
   */
  const sections = sdp.split(/^(?=m=)/m);

  return sections
    .map((section) => {
      if (!section.startsWith('m=audio')) return section;

      const rtpmap = section.match(/^a=rtpmap:(\d+) opus\/48000\/2/m);
      if (!rtpmap) return section;

      const pt = rtpmap[1];
      const fmtp = new RegExp(`^a=fmtp:${pt} (.*)$`, 'm');

      if (fmtp.test(section)) {
        // Les autres parametres negocies par le moteur sont conserves : on ne
        // remplace que ceux dont on a une opinion.
        return section.replace(fmtp, (_ligne, existant: string) => {
          const garde = existant
            .split(';')
            .map((part) => part.trim())
            .filter((part) => part.length > 0 && !connus.test(part));
          return `a=fmtp:${pt} ${[...garde, ...reglages].join(';')}`;
        });
      }

      // Le saut de ligne est ecrit en echappement : une vraie coupure dans un
      // gabarit serait normalisee en simple LF, alors que la SDP se lit en CRLF.
      return section.replace(rtpmap[0], `${rtpmap[0]}\r\na=fmtp:${pt} ${reglages.join(';')}`);
    })
    .join('');
}

export function videoConstraints(media: MediaPreferences): MediaTrackConstraints {
  const size = VIDEO_SIZES[media.videoQuality];
  return {
    ...(media.cameraId ? { deviceId: { ideal: media.cameraId } } : {}),
    width: { ideal: size.width },
    height: { ideal: size.height },
    frameRate: { ideal: 30 },
  };
}

export function screenConstraints(media: MediaPreferences): MediaTrackConstraints {
  const size = SCREEN_SIZES[media.screenQuality];
  return {
    ...(size ? { width: { ideal: size.width }, height: { ideal: size.height } } : {}),
    frameRate: { ideal: media.screenFrameRate, max: media.screenFrameRate },
  };
}

/* -------------------------------------------------------------------------- */
/* Debit                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Debit vise pour un partage d'ecran, en bits par seconde.
 *
 * Sans consigne, WebRTC s'installe autour de deux megabits : correct pour une
 * webcam, franchement mauvais pour un 1080p a soixante images — le texte bave
 * et les aplats se pixellisent des qu'il y a du mouvement. C'est la difference
 * la plus visible entre un partage qui parait « propre » et un autre non.
 *
 * Ce sont des plafonds, pas des reservations : la couche de congestion
 * descend d'elle-meme si la liaison ne suit pas.
 */
export function screenBitrate(media: MediaPreferences): number {
  const hauteur =
    media.screenQuality === '720p' ? 720 : media.screenQuality === '1080p' ? 1080 : 1440;

  const base = hauteur >= 1440 ? 16_000_000 : hauteur >= 1080 ? 12_000_000 : 6_000_000;

  // Doubler les images par seconde ne double pas le debit necessaire : deux
  // images consecutives se ressemblent, et l'encodeur ne transmet que l'ecart.
  const facteur = media.screenFrameRate >= 60 ? 1 : media.screenFrameRate >= 30 ? 0.65 : 0.4;

  /*
   * Un jeu rapide demande plus que le compte.
   *
   * Le raisonnement ci-dessus — deux images consecutives se ressemblent —
   * s'effondre precisement la ou l'on en aurait le plus besoin : dans un jeu
   * ou l'on tourne la camera, TOUTE l'image change d'une trame a l'autre, et
   * l'encodeur n'a plus d'ecart a transmettre, seulement des images entieres.
   * Un plafond calcule pour du bureau donne alors une bouillie de blocs des
   * qu'on bouge, ce qui est le moment ou l'on regarde.
   *
   * La majoration ne vaut qu'a soixante images et en priorite fluidite : c'est
   * la signature d'un partage de jeu. Un partage de document a soixante images
   * n'existe pas en pratique.
   *
   * C'est un plafond, pas une reservation : la couche de congestion descend
   * d'elle-meme si la liaison ne suit pas. Le risque d'etre trop genereux est
   * donc faible ; celui d'etre trop avare se voit a l'oeil nu.
   */
  /*
   * La majoration passe de 1,4 a 1,9.
   *
   * A soixante images en priorite fluidite, un plafond de 16,8 Mb/s laissait
   * l'encodeur serrer la qualite dans chaque image des que la scene bougeait
   * partout a la fois — ce qui est la definition d'un jeu. Le resultat n'est
   * pas une definition plus basse mais une image plus sale, ce qui se decrit
   * de la meme facon et se corrige autrement.
   *
   * C'est un plafond, pas une reservation : sur une liaison qui ne suit pas, la
   * couche de congestion descend d'elle-meme en quelques secondes, et le
   * journal dit alors `limite: bandwidth`. Le risque d'etre trop genereux est
   * donc borne ; celui d'etre trop avare se voit a l'oeil nu et ne se corrige
   * jamais tout seul.
   */
  const jeu = media.screenFrameRate >= 60 && media.screenPriority === 'motion' ? 1.9 : 1;

  return Math.round(base * facteur * jeu);
}

/** Debit vise pour la camera. Une webcam n'a pas besoin du meme budget. */
export function cameraBitrate(media: MediaPreferences): number {
  return media.videoQuality === '1080p' ? 2_500_000 : media.videoQuality === '720p' ? 1_500_000 : 800_000;
}

/**
 * Impose debit et arbitrage a un flux sortant.
 *
 * `setParameters` echoue si l'emetteur n'a pas encore d'encodage — cela arrive
 * quand la negociation n'est pas terminee. On abandonne alors sans bruit :
 * la qualite reste celle par defaut, ce qui est desagreable mais pas casse.
 */
export async function applyEncoding(
  sender: RTCRtpSender,
  bitrate: number,
  priority: 'motion' | 'detail',
): Promise<boolean> {
  try {
    const parameters = sender.getParameters();

    // Juste apres `addTrack`, la liste d'encodages est encore vide : elle n'est
    // remplie qu'une fois la description locale posee. C'est precisement le
    // moment ou l'on veut regler le debit, d'ou l'echec signale a l'appelant
    // plutot qu'avale — il rappellera plus tard.
    if (!parameters.encodings || parameters.encodings.length === 0) return false;

    for (const encoding of parameters.encodings) {
      encoding.maxBitrate = bitrate;
      encoding.maxFramerate = undefined;

      /*
       * La definition demandee est tenue. Dans les deux modes.
       *
       * Une version precedente laissait le moteur reduire l'image en mode
       * fluidite, pour repondre a des saccades dans les jeux rapides. C'etait
       * une supposition, et elle etait fausse : les saccades venaient du
       * canevas de decoupe, qui echantillonnait a une cadence sans rapport
       * avec celle de la source et agrandissait une image deja reduite avant
       * de l'encoder. Ces deux causes-la sont corrigees dans `decoupe.ts`.
       *
       * L'autorisation, elle, etait restee — et Chrome s'en servait. Un
       * partage annonce en 1080p sortait a 540p au premier a-coup, sans que
       * rien ne le dise, et sans jamais y revenir tant que la source bougeait.
       * On corrigeait une saccade en rendant l'image meconnaissable.
       *
       * `1` interdit toute reduction. Sous contrainte, le moteur repond
       * desormais par ce que `degradationPreference` autorise : des images
       * perdues en fluidite, une definition tenue en nettete. Les deux se
       * voient, mais aucune des deux ne transforme un 1080p en bouillie.
       */
      encoding.scaleResolutionDownBy = 1;
    }

    parameters.degradationPreference =
      priority === 'motion' ? 'maintain-framerate' : 'maintain-resolution';

    await sender.setParameters(parameters);
    return true;
  } catch {
    // Etat transitoire, ou navigateur qui refuse : l'appelant reessaiera.
    return false;
  }
}

/**
 * Insiste jusqu'a ce que le reglage passe.
 *
 * Une seule tentative echouait presque toujours : elle arrive avant que la
 * negociation ait rempli la liste d'encodages, et le partage repartait alors au
 * debit par defaut de WebRTC — environ deux megabits, ce qui donne un 1080p
 * baveux. C'est la cause la plus probable d'un partage « qui pixellise ».
 */
export async function applyEncodingWithRetry(
  sender: RTCRtpSender,
  bitrate: number,
  priority: 'motion' | 'detail',
): Promise<boolean> {
  for (const attente of [0, 120, 400, 1200, 3000]) {
    if (attente > 0) await new Promise((resoudre) => setTimeout(resoudre, attente));

    // Une piste retiree entre-temps n'a plus rien a regler.
    if (!sender.track) return false;
    if (await applyEncoding(sender, bitrate, priority)) return true;
  }
  return false;
}

/**
 * Dirige un element audio vers le haut-parleur choisi.
 *
 * `setSinkId` n'existe pas partout — Firefox le garde derriere un reglage. On
 * echoue alors en silence : la voix sort par la sortie par defaut, ce qui reste
 * preferable a une erreur remontee a l'utilisateur pour un choix secondaire.
 */
export async function applySink(element: HTMLAudioElement, speakerId: string | null): Promise<void> {
  if (!speakerId) return;

  const sinkable = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof sinkable.setSinkId !== 'function') return;

  try {
    await sinkable.setSinkId(speakerId);
  } catch {
    // Appareil disparu ou permission absente.
  }
}

/* -------------------------------------------------------------------------- */
/* Codec                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Impose un codec video au transceiver d'un partage.
 *
 * Sans consigne, le navigateur negocie souvent VP8 : il est partout, mais a
 * debit egal il rend nettement moins bien qu'AV1 ou VP9 sur du texte et des
 * aplats — c'est-a-dire sur un ecran partage. La difference se voit surtout
 * dans les zones fines, ou VP8 fait baver les caracteres.
 *
 * L'ordre exprime une preference, pas une exigence : si le pair d'en face ne
 * sait decoder que VP8, la negociation retombe dessus. Rien ne casse.
 */
/**
 * Impose un ordre de codecs a l'emission.
 *
 * H264 passe devant, malgre une compression moins efficace que VP9 ou AV1 : il
 * est le seul que toutes les cartes graphiques encodent en materiel. Les deux
 * autres retombent souvent sur le processeur, qui ne tient pas un 1080p a
 * soixante images en temps reel — Chrome divise alors la definition pour ne pas
 * prendre de retard, et l'on obtient une image bien pire qu'avec un codec
 * theoriquement moins bon. Mieux vaut un codec moyen encode correctement qu'un
 * excellent codec qui n'y arrive pas.
 */
export function preferVideoCodec(
  transceiver: RTCRtpTransceiver,
  ordre: readonly string[] = ['video/H264', 'video/VP9', 'video/AV1', 'video/VP8'],
): void {
  try {
    const disponibles = RTCRtpSender.getCapabilities('video')?.codecs;
    if (!disponibles || typeof transceiver.setCodecPreferences !== 'function') return;

    const rang = (codec: RTCRtpCodec) => {
      const index = ordre.indexOf(codec.mimeType);
      // Les codecs hors liste passent apres, dans leur ordre d'origine.
      return index === -1 ? ordre.length : index;
    };

    const classes = [...disponibles].sort((a, b) => rang(a) - rang(b));
    transceiver.setCodecPreferences(classes);
  } catch {
    // Navigateur qui refuse, ou negociation deja engagee : on garde le choix
    // par defaut plutot que d'interrompre le partage.
  }
}
