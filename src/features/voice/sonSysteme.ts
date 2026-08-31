/**
 * Le son de l'ordinateur : ce qui a ete essaye, et ce qu'il reste a faire.
 *
 * Ce module ne contient plus de code. Il garde la trace de deux impasses, pour
 * qu'on n'y revienne pas une troisieme fois.
 *
 * Premiere impasse : rendre la fenetre de Windows
 * ------------------------------------------------
 * `getDisplayMedia` n'accorde le son que si la case « partager aussi l'audio
 * systeme » a ete cochee, et cette case vit dans la fenetre de selection du
 * systeme — celle que le drapeau `--auto-select-desktop-capture-source`
 * supprime pour laisser place a la notre.
 *
 * Un reglage a donc ete propose pour choisir entre les deux. C'etait une
 * fausse solution : reprendre cette fenetre, c'est reprendre exactement ce
 * qu'on avait entrepris de retirer, titre « http://tauri.localhost » compris.
 * Le mecanisme a ete arrache.
 *
 * Seconde impasse : les contraintes heritees de Chromium
 * -------------------------------------------------------
 * `getUserMedia` accepte historiquement `mandatory.chromeMediaSource = 'desktop'`,
 * qui rend la sortie du systeme sans afficher quoi que ce soit. C'est ce
 * qu'emploient les applications Electron.
 *
 * Elle ne fonctionne pas ici, et pas d'une facon anodine : sans identifiant de
 * source — obtenu par `desktopCapturer`, une interface propre a Electron que
 * Tauri n'a pas — WebView2 tient l'appel pour un message malforme et tue le
 * processus de rendu. `RESULT_CODE_KILLED_BAD_MESSAGE` : page blanche,
 * application a relancer, a chaque tentative de partage.
 *
 * Il n'y avait pas de demi-mesure a chercher : l'appel est invalide par
 * construction, pas seulement refuse.
 *
 * Ce qui reste
 * ------------
 * Capturer la sortie audio cote natif, en Rust, par le bouclage WASAPI de
 * Windows, puis reinjecter les echantillons dans la vue web — par un canal
 * Tauri vers un `AudioWorklet`, qui les rend dans un `MediaStreamDestination`
 * dont la piste rejoint le partage.
 *
 * C'est la seule voie qui n'emprunte rien au moteur web, donc la seule qui ne
 * depende ni d'une fenetre qu'on veut supprimer, ni d'une interface qu'on n'a
 * pas.
 */

export {};
