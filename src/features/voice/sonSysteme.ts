/**
 * Le son de l'ordinateur, sans la fenetre de Windows.
 *
 * Le probleme
 * -----------
 * `getDisplayMedia` n'accorde le son que si la case « partager aussi le son »
 * a ete cochee — et cette case vit dans la fenetre de selection du systeme,
 * celle que nous supprimons precisement pour afficher la notre. On ne pouvait
 * donc avoir que l'un des deux : notre selecteur, ou le son.
 *
 * Rendre la fenetre de Windows n'est pas une solution : c'est exactement ce
 * qu'on avait entrepris de retirer.
 *
 * Le detour
 * ---------
 * Chromium expose une seconde voie, anterieure a `getDisplayMedia` et toujours
 * en place : les contraintes `chromeMediaSource` de `getUserMedia`. Avec
 * `desktop` sur une demande audio seule, il rend la sortie du systeme — le
 * bouclage WASAPI sous Windows — sans afficher quoi que ce soit. C'est la voie
 * qu'emploient les applications Electron pour la meme raison.
 *
 * Elle n'est ni standard ni garantie : ces contraintes ne figurent dans aucune
 * specification, et rien n'oblige le moteur a les conserver. D'ou le traitement
 * reserve aux echecs — on essaie, et si cela ne donne rien, le partage part
 * sans le son comme avant, ce qui n'est pas pire qu'aujourd'hui.
 *
 * Ce qu'elle ne fait pas
 * ----------------------
 * Elle capture la sortie ENTIERE de l'ordinateur, pas celle d'une fenetre.
 * Impossible de faire autrement par ce chemin : le bouclage est global. En
 * pratique cela revient au meme dans le cas qui nous occupe — on partage un
 * jeu, et le jeu est ce qui fait du bruit.
 *
 * Il faut aussi savoir qu'elle capte notre propre sortie, donc les voix des
 * autres participants si elles passent par les haut-parleurs. Au casque, le
 * probleme ne se pose pas ; sur des haut-parleurs, les autres s'entendent
 * revenir. C'est la contrepartie du bouclage, et elle vaut d'etre dite.
 */

/** Contraintes non standard, absentes des types du DOM. */
interface ContraintesHeritees {
  mandatory?: Record<string, string>;
}

/**
 * Tente de capturer la sortie du systeme.
 *
 * Rend `null` des que le moteur refuse, sans distinguer les causes : aucune
 * n'appelle une reaction differente, et toutes reviennent a « pas de son ».
 */
export async function capturerSonSysteme(): Promise<MediaStream | null> {
  try {
    const flux = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
        },
      } as ContraintesHeritees as MediaTrackConstraints,
      video: false,
    });

    // Un flux sans piste n'est pas un succes : certains moteurs rendent un
    // objet vide plutot que de rejeter.
    if (flux.getAudioTracks().length === 0) {
      for (const piste of flux.getTracks()) piste.stop();
      return null;
    }

    return flux;
  } catch {
    return null;
  }
}
