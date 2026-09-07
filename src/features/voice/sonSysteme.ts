/**
 * Le son de l'ordinateur, capture par la partie native.
 *
 * Deux impasses ont precede celle-ci, et il vaut la peine de les nommer pour
 * qu'on n'y revienne pas.
 *
 * **Rendre la fenetre de selection de Windows.** `getDisplayMedia` n'accorde le
 * son que si la case « partager aussi l'audio » a ete cochee, et cette case vit
 * dans la fenetre qu'on supprime justement pour afficher la notre. Un reglage
 * avait ete propose pour choisir entre les deux : c'etait reprendre ce qu'on
 * avait entrepris de retirer, titre « http://tauri.localhost » compris.
 *
 * **Les contraintes heritees de Chromium.** `mandatory.chromeMediaSource` rend
 * la sortie du systeme sans rien afficher — mais seulement avec un identifiant
 * de source obtenu par `desktopCapturer`, propre a Electron. Sans lui, WebView2
 * tient l'appel pour un message malforme et tue le processus de rendu :
 * `RESULT_CODE_KILLED_BAD_MESSAGE`, application a relancer, a chaque partage.
 *
 * Ce chemin-ci ne demande rien au moteur web. `son.rs` parle directement a
 * WASAPI et envoie les echantillons par un canal Tauri ; un `AudioWorklet` les
 * rejoue et en refait une piste, qui rejoint le partage comme si elle en venait.
 *
 * La source peut changer en cours de route
 * ----------------------------------------
 * Le contexte audio, le worklet et la piste qui part sur le reseau vivent du
 * debut a la fin du partage. Ce qui les alimente, non : une capture ciblee sur
 * une application peut se reveler muette, et l'on reprend alors tout
 * l'ordinateur sans que personne, en face, ne voie sa piste disparaitre.
 */

import sonWorkletUrl from './son-worklet.js?url';
import { journal } from '@/lib/journal';

const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface SonSysteme {
  /** Flux d'une piste, a joindre au partage. */
  flux: MediaStream;
  /** Arrete la capture et rend les ressources. */
  arreter: () => void;
}

/**
 * Ce que rend la capture : le son, ou la raison de son absence.
 *
 * La premiere version rendait `null` dans tous les cas d'echec. L'interface
 * affichait alors une phrase generale — « deux chemins ont ete essayes » —
 * quelle que soit la cause reelle, alors que la partie native produit des
 * raisons precises et differentes : peripherique introuvable, bouclage refuse,
 * format inconnu. On jetait exactement ce qu'il fallait lire.
 */
export type ResultatSon = { ok: true; son: SonSysteme } | { ok: false; raison: string };

interface FormatSon {
  frequence: number;
  canaux: number;
  /** Nom du peripherique dont on capture la sortie. */
  peripherique?: string;
  /** Port local ou le son coule. */
  port: number;
  /** Jeton exige a la connexion, tire a chaque partage. */
  jeton: string;
}

/** Duree d'ecoute avant de dire si le bouclage porte quelque chose. */
const ECOUTE_MS = 4000;

/**
 * Nombre de paquets sur lesquels on releve le niveau a l'entree du canal.
 *
 * Deux cents paquets couvrent les quatre secondes d'ecoute a la cadence
 * d'envoi. Au-dela, la mesure ne dirait rien de plus et se paierait a chaque
 * paquet pendant tout le partage.
 */
const PAQUETS_MESURES = 200;

/**
 * Ouvre la connexion locale et rend de quoi la lire.
 *
 * Rend `null` si elle ne repond pas. Le cas n'est pas theorique : la connexion
 * s'ouvre en meme temps que la capture, et l'interface peut arriver la premiere.
 * On reessaie donc brievement plutot que d'abandonner sur une course perdue de
 * quelques millisecondes.
 */
async function ouvrirFlux(
  format: FormatSon,
  arreterNatif: () => void,
): Promise<ReadableStreamDefaultReader<Uint8Array> | null> {
  const adresse = `http://127.0.0.1:${format.port}/${format.jeton}`;

  for (const attente of [0, 60, 200, 500]) {
    if (attente > 0) await new Promise((resoudre) => setTimeout(resoudre, attente));

    try {
      const reponse = await fetch(adresse, { cache: 'no-store' });
      if (reponse.ok && reponse.body) return reponse.body.getReader();
    } catch {
      // Pas encore en ecoute : on retente.
    }
  }

  arreterNatif();
  return null;
}

/**
 * Ecoute la capture quelques secondes et rend son niveau, en dBFS.
 *
 * Le maximum plutot que la moyenne : un jeu a des passages calmes, et une
 * moyenne sur quatre secondes de menu silencieux dirait « rien » alors que
 * tout fonctionne. Ce qu'on cherche a distinguer, c'est « jamais rien » de
 * « quelque chose, parfois ».
 *
 * Rend `0` — la pleine echelle — quand la mesure elle-meme echoue. La valeur
 * n'est pas arbitraire : c'est celle qui ne declenche rien. Une mesure qu'on
 * n'a pas pu prendre ne doit pas se lire comme un silence constate, sans quoi
 * un graphe audio recalcitrant ferait basculer la capture de quelqu'un dont le
 * son marchait tres bien.
 */
function mesurerNiveau(ctx: AudioContext, flux: MediaStream): Promise<number> {
  return new Promise((resoudre) => {
    let source: MediaStreamAudioSourceNode;
    let analyseur: AnalyserNode;

    try {
      source = ctx.createMediaStreamSource(flux);
      analyseur = ctx.createAnalyser();
      analyseur.fftSize = 2048;
      source.connect(analyseur);
    } catch {
      resoudre(0);
      return;
    }

    const echantillons = new Float32Array(analyseur.fftSize);
    let sommet = 0;

    const battement = window.setInterval(() => {
      analyseur.getFloatTimeDomainData(echantillons);
      for (const valeur of echantillons) sommet = Math.max(sommet, Math.abs(valeur));
    }, 200);

    window.setTimeout(() => {
      window.clearInterval(battement);

      try {
        source.disconnect();
      } catch {
        // Deja detache : rien a defaire.
      }

      // En decibels par rapport a la pleine echelle : -60 dB est deja tres bas,
      // le silence numerique exact donnerait -Infinity.
      resoudre(sommet > 0 ? Math.round(20 * Math.log10(sommet)) : -120);
    }, ECOUTE_MS);
  });
}

/** En dessous de ce niveau, il ne se joue rien : c'est du silence. */
const SILENCE_DBFS = -60;

/**
 * Une capture native branchee sur le fil audio, et de quoi la debrancher.
 *
 * Cet objet-la se remplace en cours de partage — c'est tout l'interet de lui
 * donner un nom. Le contexte audio et la piste qui part sur le reseau, eux,
 * traversent le partage entier : changer de source ne doit rien casser chez
 * ceux qui regardent.
 */
interface SourceNative {
  format: FormatSon;
  /**
   * Debranche.
   *
   * `natif` distingue les deux cas. A la fin d'un partage, on coupe tout. Au
   * moment d'un remplacement, la capture suivante est DEJA ouverte : elle a
   * pris la generation, et l'ancienne s'est arretee d'elle-meme. Redemander
   * l'arret tuerait alors celle qu'on vient d'ouvrir.
   */
  arreter: (natif: boolean) => void;
}

/**
 * Ouvre une capture native et fait couler ses echantillons vers `alimenter`.
 *
 * Tout ce qui se remplace tient ici : la commande native, la connexion locale,
 * et le recollage des trames. Le reste du chemin n'en sait rien.
 */
async function ouvrirSource(
  invoke: typeof import('@tauri-apps/api/core').invoke,
  peripherique: string | null,
  fenetre: string | null,
  alimenter: (bloc: ArrayBufferLike, octets: number) => void,
): Promise<{ ok: true; source: SourceNative } | { ok: false; raison: string }> {
  let format: FormatSon;

  try {
    format = await invoke<FormatSon>('demarrer_son_systeme', {
      peripherique: peripherique ?? null,
      fenetre: fenetre ?? null,
    });

    journal.info('partage', 'Bouclage ouvert', {
      peripherique: format.peripherique ?? null,
      frequence: format.frequence,
      canaux: format.canaux,
      application: fenetre,
    });
  } catch (cause) {
    /*
     * La raison vient de la partie native, en francais et deja formulee.
     *
     * La reecrire ici la remplacerait par une phrase generique au moment
     * precis ou l'on tient enfin l'explication. Le repli ne sert qu'au cas ou
     * la commande n'existe pas — c'est-a-dire une version installee plus
     * ancienne que ce code, ce qui se produit pendant une mise a jour.
     */
    return {
      ok: false,
      raison:
        typeof cause === 'string'
          ? cause
          : 'La capture n’a pas demarre. Cette version de l’application ne la connait peut-etre pas encore : reinstallez-la.',
    };
  }

  const arreterNatif = () => {
    void invoke('arreter_son_systeme').catch(() => undefined);
  };

  /*
   * Le son arrive par une connexion HTTP locale, pas par le canal Tauri.
   *
   * Le canal a ete essaye, et mesure : sur quatre cents paquets produits par
   * Windows, UN SEUL atteignait cette fonction. Au-dela d'un kilo-octet, il ne
   * transmet pas la donnee directement — il fait executer a la page un script
   * qui va la rechercher par une commande interne — et cinquante allers-retours
   * par seconde de ce genre ne passent pas. Rien n'echouait pour autant : la
   * capture s'ouvrait, les paquets partaient, et le silence arrivait au bout.
   *
   * Une seule connexion est ouverte ici pour toute la duree de la source, et
   * les echantillons y coulent sans etre annonces ni reassembles.
   */
  const lecteur = await ouvrirFlux(format, arreterNatif);

  if (!lecteur) {
    return { ok: false, raison: 'Le passage du son n’a pas pu s’ouvrir.' };
  }

  /*
   * Le reste d'une trame incomplete est reporte sur la lecture suivante.
   *
   * Une connexion ne rend pas les octets par paquets : elle les rend par
   * morceaux quelconques, qui coupent volontiers un echantillon en deux. Les
   * transmettre tels quels decalerait les canaux d'un demi-flottant et
   * transformerait la musique en bruit — un defaut qui s'entend tout de suite
   * mais ne se rattache a rien.
   */
  const octetsParTrame = format.canaux * 4;
  let reste = new Uint8Array(0);
  let vivante = true;

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await lecteur.read();
        if (done) break;

        /*
         * Une source remplacee ne pousse plus rien dans le fil audio.
         *
         * Deux captures qui alimentent le meme worklet melangeraient leurs
         * echantillons : on entendrait l'application ET tout l'ordinateur, la
         * premiere en double.
         */
        if (!vivante) break;
        if (!value || value.byteLength === 0) continue;

        const complet =
          reste.byteLength === 0
            ? value
            : (() => {
                const joint = new Uint8Array(reste.byteLength + value.byteLength);
                joint.set(reste, 0);
                joint.set(value, reste.byteLength);
                return joint;
              })();

        const utilisable = complet.byteLength - (complet.byteLength % octetsParTrame);

        if (utilisable > 0) {
          // La copie est necessaire : le tampon rendu par la lecture est
          // reutilise, et le transferer au fil audio le detacherait sous les
          // pieds de la lecture suivante.
          const bloc = complet.slice(0, utilisable);
          alimenter(bloc.buffer, utilisable);
        }

        reste = complet.slice(utilisable);
      }
    } catch {
      // Connexion fermee : c'est ainsi que se termine une source.
    }
  })();

  return {
    ok: true,
    source: {
      format,
      arreter: (natif: boolean) => {
        vivante = false;
        if (natif) arreterNatif();

        /*
         * La connexion est fermee de notre cote aussi.
         *
         * Couper la capture suffirait a la longue — le serveur voit sa
         * generation changer et referme — mais laisser une lecture en attente
         * garde le fil de lecture en vie jusque-la. Deux partages a la suite
         * en laisseraient deux.
         */
        void lecteur.cancel().catch(() => undefined);
      },
    },
  };
}

/**
 * Ouvre la capture.
 *
 * Rend toujours quelque chose : le son, ou la raison de son absence. Les causes
 * sont nombreuses — hors application de bureau, systeme sans bouclage, refus de
 * Windows, format inconnu — et elles n'appellent pas la meme reponse de celui
 * qui partage. Lui dire laquelle est le seul moyen qu'il puisse y faire quoi
 * que ce soit.
 *
 * Le repli, quand on suit une application
 * ---------------------------------------
 * Suivre une seule application est ce qu'il y a de plus juste — le jeu part,
 * les notifications d'a cote restent. Mais cela repose sur une hypothese que
 * Windows ne garantit pas : que l'application joue son son ELLE-MEME.
 * Beaucoup ne le font pas. Un navigateur confie le sien a un processus de
 * service, et une page YouTube partagee arrivait alors parfaitement muette ;
 * plusieurs lecteurs font de meme.
 *
 * On ne peut pas dresser la liste de ces applications : elle changerait a
 * chaque mise a jour de chacune d'elles. On CONSTATE donc, au lieu de prevoir.
 * Quatre secondes de silence complet sur une capture ciblee, et l'on reprend
 * tout l'ordinateur — ce qui s'entend, plutot qu'un silence exact que personne
 * ne sait expliquer.
 */
export async function capturerSonSysteme(
  peripherique?: string | null,
  surSilence?: (peripherique: string | null) => void,
  fenetre?: string | null,
): Promise<ResultatSon> {
  if (!DANS_TAURI) {
    return {
      ok: false,
      raison:
        'La capture du son du systeme n’existe que dans l’application de bureau.',
    };
  }

  let invoke: typeof import('@tauri-apps/api/core').invoke;

  try {
    invoke = (await import('@tauri-apps/api/core')).invoke;
  } catch {
    return { ok: false, raison: 'Le pont vers l’application n’a pas repondu.' };
  }

  const Contexte =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Contexte) {
    return { ok: false, raison: 'Ce moteur n’expose pas de contexte audio.' };
  }

  const cible = fenetre ?? null;

  let paquetsRecus = 0;
  let octetsRecus = 0;
  let sommetRecu = 0;

  /*
   * Le fil audio n'existe pas encore quand la premiere source s'ouvre.
   *
   * Il ne peut pas : sa frequence est celle du peripherique, et c'est la
   * capture qui l'annonce. Les tout premiers blocs sont donc perdus — quelques
   * millisecondes, le temps que le worklet soit monte — ce qui vaut mieux que
   * de les garder pour les rejouer plus tard, en retard sur l'image.
   */
  let lecture: AudioWorkletNode | null = null;

  const alimenter = (bloc: ArrayBufferLike, octets: number) => {
    paquetsRecus += 1;
    octetsRecus += octets;

    if (paquetsRecus <= PAQUETS_MESURES) {
      const vue = new Float32Array(bloc, 0, octets / 4);
      for (let k = 0; k < vue.length; k += 16) {
        const amplitude = Math.abs(vue[k]!);
        if (amplitude > sommetRecu && Number.isFinite(amplitude)) sommetRecu = amplitude;
      }
    }

    lecture?.port.postMessage(bloc, [bloc as ArrayBuffer]);
  };

  /*
   * Le format est demande AVANT d'ouvrir le contexte audio.
   *
   * Le peripherique impose sa frequence — 48 kHz le plus souvent, 44,1 parfois.
   * Ouvrir le contexte a une autre valeur ferait rejouer les echantillons trop
   * vite ou trop lentement : un son transpose, qu'on entend immediatement et
   * qu'on ne relie a rien.
   */
  const premiere = await ouvrirSource(invoke, peripherique ?? null, cible, alimenter);
  if (!premiere.ok) return premiere;

  let source = premiere.source;
  const format = source.format;

  let ctx: AudioContext;
  try {
    ctx = new Contexte({ sampleRate: format.frequence });
  } catch {
    source.arreter(true);
    return {
      ok: false,
      raison: `Le moteur refuse d’ouvrir un contexte audio a ${format.frequence} Hz.`,
    };
  }

  const abandonner = (raison: string): ResultatSon => {
    source.arreter(true);
    void ctx.close().catch(() => undefined);
    return { ok: false, raison };
  };

  if (!ctx.audioWorklet) return abandonner('Ce moteur n’a pas de fil audio dedie.');

  try {
    await ctx.audioWorklet.addModule(sonWorkletUrl);
  } catch {
    return abandonner('Le module de lecture du son n’a pas pu etre charge.');
  }

  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
  if (ctx.state !== 'running') {
    return abandonner('Le contexte audio est reste suspendu par le moteur.');
  }

  let sortie: MediaStreamAudioDestinationNode;

  try {
    /*
     * Les paquets vont directement au worklet.
     *
     * Ils ne passent pas par l'etat de React : ils arrivent des centaines de
     * fois par seconde, et chacun declencherait un rendu pour un tableau
     * d'octets que personne n'affiche.
     */
    lecture = new AudioWorkletNode(ctx, 'son-systeme', {
      numberOfInputs: 0,
      outputChannelCount: [Math.min(2, Math.max(1, format.canaux))],
      processorOptions: { canaux: format.canaux },
    });

    sortie = ctx.createMediaStreamDestination();
    lecture.connect(sortie);
  } catch {
    return abandonner('Le graphe audio n’a pas pu etre monte.');
  }

  let arrete = false;

  /*
   * On mesure ce que le bouclage porte vraiment, et l'on agit dessus.
   *
   * « La capture s'est ouverte » ne veut pas dire « il y a du son dedans ».
   * Deux causes tres differentes produisent le meme silence exact :
   *
   *  - l'application suivie ne joue pas son son elle-meme, et il faut alors
   *    reprendre tout l'ordinateur — c'est ce que fait le repli ci-dessous ;
   *  - le jeu joue sur un AUTRE peripherique que celui par defaut, et cela ne
   *    se corrige pas dans le code, seulement dans les reglages de Windows.
   *
   * Le repli passe donc en premier, et l'on ne previent qu'apres : quand il
   * n'a rien change, la cause est ailleurs et elle appelle un geste humain.
   */
  void (async () => {
    const niveau = await mesurerNiveau(ctx, sortie.stream);
    if (arrete || niveau > SILENCE_DBFS) return;

    if (cible !== null) {
      journal.info('partage', 'Capture ciblee muette : repli sur tout l’ordinateur', {
        application: cible,
        dbfs: niveau,
      });

      /*
       * L'ancienne est debranchee AVANT que la suivante ne s'ouvre.
       *
       * Ouvrir d'abord laisserait les deux lectures vivantes pendant que la
       * seconde s'installe — jusqu'a une demi-seconde, le temps des essais de
       * connexion — et ce qui restait en tampon dans la premiere se
       * melangerait au debut de la seconde.
       *
       * On ne perd rien a couper tout de suite : c'est precisement parce
       * qu'elle ne portait rien qu'on en est la. Et `false` parce que la
       * commande suivante coupera la capture native d'elle-meme, en prenant la
       * generation.
       */
      source.arreter(false);

      const remplacante = await ouvrirSource(invoke, peripherique ?? null, null, alimenter);

      if (arrete) {
        if (remplacante.ok) remplacante.source.arreter(true);
        return;
      }

      if (!remplacante.ok) {
        journal.info('partage', 'Repli impossible', { raison: remplacante.raison });
      } else if (remplacante.source.format.frequence !== format.frequence) {
        /*
         * La frequence doit etre la meme, sinon on ne remplace rien.
         *
         * Le contexte audio est deja ouvert a celle de la premiere capture, et
         * il ne se rouvre pas sans changer la piste qui part sur le reseau.
         * Rejouer des echantillons a la mauvaise cadence donnerait un son
         * transpose : plus penible qu'un silence, et bien plus difficile a
         * relier a sa cause.
         */
        remplacante.source.arreter(true);
        journal.info('partage', 'Repli refuse : frequence differente', {
          avant: format.frequence,
          apres: remplacante.source.format.frequence,
        });
      } else {
        source = remplacante.source;

        const apres = await mesurerNiveau(ctx, sortie.stream);
        if (arrete || apres > SILENCE_DBFS) return;
      }
    }

    /*
     * Le silence tient meme sans cible : la cause est hors de notre portee.
     *
     * L'interface le dit a qui partage — voir `VoiceStage`. Le journal seul ne
     * sert qu'a moi, et le probleme se corrige de son cote a lui.
     */
    journal.info('partage', 'Niveau du son capture', {
      dbfs: niveau,
      muet: true,
      peripherique: format.peripherique ?? null,
    });

    surSilence?.(format.peripherique ?? null);
  })();

  window.setTimeout(() => {
    void (async () => {
      let natif: Record<string, number> | null = null;

      try {
        natif = await invoke<Record<string, number>>('diagnostic_son');
      } catch {
        // Version plus ancienne du binaire : on journalise ce qu'on a.
      }

      /*
       * Qui fait du bruit, nomme.
       *
       * « Y a encore l'echo quand on met tout le son de l'ordi. » Deux
       * explications ont ete avancees et refutees par ces memes traces : pas de
       * routeur audio virtuel chez les personnes concernees, et l'exclusion de
       * notre arborescence bien active — `sansNosVoix: true` partout.
       *
       * Deviner une troisieme fois ne vaudrait rien. Ce releve dit quels
       * programmes produisent du son pendant le partage, avec leur niveau et
       * s'ils sont des notres. La prochaine fois, le journal nommera la source.
       */
      interface Session {
        programme: string;
        niveau: number;
        a_nous: boolean;
      }

      let sessions: Session[] = [];

      try {
        sessions = await invoke<Session[]>('sessions_sonores');
      } catch {
        // Idem : une version plus ancienne ne connait pas cette commande.
      }

      journal.info('partage', 'Trajet du son', {
        /*
         * Les programmes qui jouaient quelque chose pendant la capture.
         *
         * En une chaine plutot qu'en objets : le journal range un detail plat,
         * et une liste lisible d'un coup d'oeil vaut mieux qu'une structure
         * qu'il faudrait deplier. Le point d'exclamation marque ce qui est a
         * NOUS — donc ce que Windows aurait du ecarter.
         */
        sessions: sessions
          .map((s) => `${s.a_nous ? '!' : ''}${s.programme}:${s.niveau}`)
          .join(' '),
        natifPaquets: natif?.paquets ?? -1,
        natifTrames: natif?.trames ?? -1,
        natifSommet: natif?.sommet ?? -1,
        natifSilencieux: natif?.silencieux ?? -1,
        // Vrai quand la capture laisse nos propres voix de cote : les deux
        // routes se ressemblent du dehors, et seule celle-ci evite l'echo.
        sansNosVoix: (natif as unknown as { exclusion?: boolean } | null)?.exclusion ?? null,
        // « application », « sauf-nous » ou « tout » : c'est ce qui distingue
        // « il s'entend encore » de « il s'entend parce que Windows est trop
        // ancien », deux phrases qui n'appellent pas la meme reponse.
        modeSon: (natif as unknown as { mode?: string } | null)?.mode ?? null,
        fluxBlocs: paquetsRecus,
        fluxOctets: octetsRecus,
        fluxSommet: Math.round(sommetRecu * 1000),
      });
    })();
  }, ECOUTE_MS);

  return {
    ok: true,
    son: {
      flux: sortie.stream,
      arreter: () => {
        arrete = true;
        source.arreter(true);

        try {
          lecture?.port.postMessage('stop');
          lecture?.disconnect();
        } catch {
          // Deja detache : rien a defaire.
        }
        void ctx.close().catch(() => undefined);
      },
    },
  };
}
