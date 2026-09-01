/**
 * Partage d'une fenetre seule, decoupee dans l'image de l'ecran.
 *
 * Le moteur web impose sa fenetre de selection a chaque `getDisplayMedia`.
 * Pour l'eviter, l'application de bureau demande a Chromium de choisir seul
 * l'ecran entier — voir `desactiver_selecteur_webview` cote Rust. La capture
 * porte donc toujours sur tout l'ecran.
 *
 * Partager une fenetre consiste alors a n'en emettre qu'une decoupe. Sans cela,
 * choisir une fenetre dans notre selecteur diffuserait tout l'ecran sans le
 * dire — un piege, pas une fonctionnalite.
 *
 * Ce que la decoupe ne sait pas faire, et il faut le savoir : ce qui recouvre
 * la fenetre est diffuse avec elle. Le systeme ne nous donne que l'image finale
 * de l'ecran ; distinguer les fenetres au-dessus demanderait de les capturer
 * separement, ce que seule une capture native permettrait.
 */

/** Position de la source a l'ecran, telle que le systeme la donne. */
interface Zone {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  visible: boolean;
}

/** Intervalle de suivi. Assez court pour qu'un deplacement ne traine pas,
 *  assez long pour ne pas interroger le systeme soixante fois par seconde. */
const SUIVI = 250;

export interface Decoupe {
  /** Nulle si l'ecran n'a rendu aucune piste : le partage n'a alors pas lieu. */
  piste: MediaStreamTrack | undefined;
  arreter: () => void;
  /** Vrai quand la fenetre choisie n'etait pas sur l'ecran principal : c'est
   *  alors l'ecran entier qui part, et il faut le dire. */
  horsEcranPrincipal?: boolean;
  /** Vrai quand l'ecran demande n'est pas celui que le moteur a capture : on
   *  n'emet alors rien du tout, plutot que le mauvais ecran. */
  mauvaisEcran?: boolean;
}

/**
 * Produit une piste video limitee a la zone de la source choisie.
 *
 * `sourceId` est l'identifiant rendu par `sources_partageables`. Un ecran n'a
 * rien a decouper : la fonction rend alors la piste d'origine, sans passer par
 * un canevas — un aller-retour par le processeur pour recopier l'image entiere
 * couterait cher et n'apporterait rien.
 */
export async function decouperSource(
  ecran: MediaStream,
  sourceId: string,
  images: number,
): Promise<Decoupe> {
  const [pisteEcran] = ecran.getVideoTracks();
  if (!pisteEcran) return { piste: undefined, arreter: () => {} };

  const { invoke } = await import('@tauri-apps/api/core');

  /*
   * Un ecran choisi doit etre CELUI qu'on capture.
   *
   * La selection automatique du moteur vise toujours la premiere source, soit
   * l'ecran principal. Choisir « Ecran 2 » dans notre selecteur diffuserait
   * donc l'ecran 1 sans le dire — exactement le genre de silence qui fait
   * montrer a une reunion ce qu'on croyait garder pour soi.
   *
   * On compare l'origine de l'ecran demande a celle du bureau : le moniteur
   * principal commence a (0, 0) sous Windows, les autres non. Une difference
   * signifie qu'on n'a pas ce qu'on a demande, et l'on prefere ne rien
   * diffuser plutot que de diffuser autre chose.
   */
  if (sourceId.startsWith('ecran:')) {
    const cible = await invoke<Zone>('zone_source', { id: sourceId });

    if (cible.visible && (cible.x !== 0 || cible.y !== 0)) {
      pisteEcran.stop();
      return { piste: undefined, arreter: () => {}, mauvaisEcran: true };
    }

    return { piste: pisteEcran, arreter: () => {} };
  }

  let zone = await invoke<Zone>('zone_source', { id: sourceId });
  if (!zone.visible || zone.largeur <= 0) {
    // La fenetre a disparu entre le choix et le demarrage : mieux vaut
    // diffuser l'ecran que rien du tout, et l'interface le dira.
    return { piste: pisteEcran, arreter: () => {} };
  }

  /*
   * L'ecran est lu dans une balise video hors document.
   *
   * `MediaStreamTrackProcessor` serait plus direct, mais il n'existe pas
   * partout et le repli devrait de toute facon etre ecrit. Une balise video
   * suffit : le decodage reste dans le moteur, on ne fait que recopier.
   */
  const video = document.createElement('video');
  video.srcObject = new MediaStream([pisteEcran]);
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => undefined);

  const canevas = document.createElement('canvas');

  /*
   * `desynchronized` : le canevas n'a pas a suivre le rythme de l'affichage.
   *
   * Il ne sert a personne a l'ecran — il n'est meme pas dans le document — et
   * l'attendre au rythme du moniteur ajoute une image de retard a chaque etape.
   */
  const pinceau = canevas.getContext('2d', { alpha: false, desynchronized: true });
  if (!pinceau) return { piste: pisteEcran, arreter: () => {} };

  /*
   * Repere : celui de l'ecran principal.
   *
   * La selection automatique porte sur « l'ecran entier », c'est-a-dire le
   * moniteur principal, dont le coin haut-gauche est l'origine du bureau sous
   * Windows. Les coordonnees d'une fenetre posee dessus se lisent donc telles
   * quelles.
   *
   * Une fenetre sur un second ecran a des coordonnees hors de cette image :
   * la decouper donnerait un rectangle noir. On prefere alors diffuser l'ecran
   * entier — ce que l'interface annonce — plutot qu'une image vide.
   */
  if (
    zone.x < 0 ||
    zone.y < 0 ||
    zone.x + zone.largeur > window.screen.width ||
    zone.y + zone.hauteur > window.screen.height
  ) {
    return { piste: pisteEcran, arreter: () => {}, horsEcranPrincipal: true };
  }

  let vivant = true;

  /*
   * Le canevas travaille dans le repere de l'IMAGE CAPTUREE, pas dans celui de
   * l'ecran.
   *
   * Un ecran 1440p partage en 1080p arrive deja reduit. Dessiner la decoupe a
   * la taille qu'a la fenetre a l'ecran reviendrait a agrandir cette image
   * reduite, puis a encoder le resultat : on paierait deux fois, avec une image
   * plus floue que la source et un encodage a une definition qu'aucun pixel ne
   * justifie. Ce surcout ne se voit pas sur un texte fixe ; il se voit dans un
   * jeu, sous forme de saccades, parce que l'encodeur n'a plus le temps.
   */
  const ajuster = () => {
    const facteur = video.videoWidth > 0 ? video.videoWidth / window.screen.width : 1;

    // Un canevas de taille nulle ne rend aucune image : le minimum evite qu'une
    // fenetre reduite fige le partage jusqu'a sa reouverture.
    const largeur = Math.max(2, Math.round(zone.largeur * facteur));
    const hauteur = Math.max(2, Math.round(zone.hauteur * facteur));

    // Redimensionner remet le contenu a zero : on ne le fait qu'au changement.
    if (canevas.width !== largeur || canevas.height !== hauteur) {
      canevas.width = largeur;
      canevas.height = hauteur;
    }

    return facteur;
  };

  ajuster();

  const suivre = window.setInterval(() => {
    void invoke<Zone>('zone_source', { id: sourceId })
      .then((suivante) => {
        if (!vivant || !suivante.visible || suivante.largeur <= 0) return;
        zone = suivante;
      })
      .catch(() => undefined);
  }, SUIVI);

  // `requestVideoFrameCallback` cale le dessin sur les images reellement
  // recues : dessiner plus souvent recopierait deux fois la meme image, moins
  // souvent perdrait de la fluidite.
  // Le type l'annonce comme toujours present ; les moteurs, non. On garde donc
  // le repli, et l'annotation dit explicitement qu'il peut manquer.
  const parImage: ((rappel: () => void) => number) | undefined =
    typeof video.requestVideoFrameCallback === 'function'
      ? video.requestVideoFrameCallback.bind(video)
      : undefined;

  /*
   * Le canevas n'emet que sur demande, une image pour une image.
   *
   * Lui donner une cadence — `captureStream(60)` — le fait echantillonner le
   * canevas a intervalle fixe, sans aucun rapport avec le moment ou l'on y
   * dessine. Quand la source tourne elle aussi a soixante images, les deux
   * horloges derivent l'une par rapport a l'autre : certaines images sont
   * prises deux fois, d'autres jamais. Le resultat n'est pas un ralentissement
   * — le compte y est — mais un battement, une saccade reguliere d'autant plus
   * visible que l'image bouge vite. C'est exactement ce qu'on voit dans un jeu.
   *
   * `captureStream(0)` supprime cette seconde horloge : chaque dessin produit
   * une image, et une seule.
   */
  const surDemande =
    typeof (
      window as unknown as {
        CanvasCaptureMediaStreamTrack?: { prototype?: { requestFrame?: unknown } };
      }
    ).CanvasCaptureMediaStreamTrack?.prototype?.requestFrame === 'function';

  const cadence = parImage && surDemande ? 0 : images;
  const flux = canevas.captureStream(cadence);
  const [piste] = flux.getVideoTracks();

  // Un canevas rend toujours une piste ; le typage ne le sait pas.
  if (!piste) {
    window.clearInterval(suivre);
    return { piste: pisteEcran, arreter: () => {} };
  }

  const demanderImage =
    cadence === 0
      ? (piste as MediaStreamTrack & { requestFrame?: () => void }).requestFrame?.bind(piste)
      : undefined;

  const dessiner = () => {
    if (!vivant) return;

    // L'image capturee peut etre plus petite que l'ecran si le systeme applique
    // une mise a l'echelle : on ramene les coordonnees dans le repere de la
    // video plutot que de supposer qu'ils coincident.
    const facteur = ajuster();

    pinceau.drawImage(
      video,
      zone.x * facteur,
      zone.y * facteur,
      zone.largeur * facteur,
      zone.hauteur * facteur,
      0,
      0,
      canevas.width,
      canevas.height,
    );

    demanderImage?.();
  };

  let boucle = 0;

  if (parImage) {
    const suite = () => {
      dessiner();
      if (vivant) parImage(suite);
    };
    parImage(suite);
  } else {
    boucle = window.setInterval(dessiner, 1000 / images);
  }

  return {
    piste,
    arreter: () => {
      vivant = false;
      window.clearInterval(suivre);
      if (boucle) window.clearInterval(boucle);
      piste.stop();
      video.srcObject = null;
    },
  };
}
