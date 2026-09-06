/**
 * De quel programme prendre le son, quand on partage.
 *
 * Deux lignes de code, et un fichier a elles seules — parce que la regle
 * qu'elles portent a change une fois, silencieusement, et que le defaut a mis
 * des semaines a etre nomme.
 *
 * L'ancienne regle
 * ----------------
 * Partager une FENETRE prenait le son de son application, sans laisser le
 * choix ; le reglage n'existait que pour le partage d'ecran. C'est le choix le
 * plus juste quand il marche : le jeu part, la conversation d'a cote reste, et
 * l'echo disparait pour de bon — un routeur audio virtuel comme Voicemeeter
 * rejoue notre son depuis SON processus, que Windows capte alors a bon droit,
 * et exclure le notre n'y peut rien.
 *
 * Pourquoi elle ne tient pas
 * --------------------------
 * Elle suppose que l'application joue son son ELLE-MEME. Windows ne le
 * garantit pas, et beaucoup ne le font pas : un navigateur confie le sien a un
 * processus de service. Partager l'onglet YouTube ouvrait donc une capture
 * parfaitement valide — aucune erreur, aucun avertissement — qui ne portait
 * rien. Et comme le reglage n'existait pas pour une fenetre, il n'y avait rien
 * a faire, pas meme comprendre.
 *
 * La regle vaut maintenant dans les deux cas, et le defaut prend tout
 * l'ordinateur : ce qui s'entend toujours. Suivre une application reste a un
 * clic pour qui veut isoler, ou pour qui s'entend en double.
 */

/**
 * La consigne « suis l'application partagee », telle qu'elle est rangee.
 *
 * Ce n'est pas un identifiant de fenetre, et c'est tout l'interet : celle
 * qu'on partagera demain n'est pas celle d'aujourd'hui, et le reglage doit
 * survivre au partage qui l'a vu naitre. Il se resout au demarrage, pas au
 * moment du choix.
 *
 * Aucune fenetre ne peut porter cette valeur : les identifiants du selecteur
 * sont tous de la forme `fenetre:N`.
 */
export const SON_DE_L_APPLICATION = 'application';

/**
 * Resout le reglage sur le partage en cours.
 *
 * `partage` est ce qui part a l'image — `fenetre:N`, ou `undefined` pour un
 * ecran entier. `choisie` est le reglage range : `null` pour tout
 * l'ordinateur, `SON_DE_L_APPLICATION` pour la consigne, un `fenetre:N` pour
 * une application nommee.
 *
 * Rend ce qu'il faut passer a la capture native : `null` veut dire « tout,
 * sauf nous ».
 */
export function sourceDuSon(partage: string | undefined, choisie: string | null): string | null {
  /*
   * La consigne ne vaut que s'il y a une application derriere.
   *
   * Un ecran entier n'en a pas. Rendre la consigne telle quelle ferait
   * demander a Windows le son du processus « application », qui n'existe pas :
   * on retombe donc sur tout l'ordinateur, qui est ce qu'on entend de toute
   * facon en partageant un ecran.
   */
  if (choisie === SON_DE_L_APPLICATION) {
    return partage?.startsWith('fenetre:') ? partage : null;
  }

  return choisie;
}
