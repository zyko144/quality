/**
 * Qui passe pendant la maintenance.
 *
 * L'application entiere est derriere un ecran de maintenance : c'est voulu, et
 * cela vaut pour les comptes existants comme pour les nouveaux. Mais il faut
 * bien que quelqu'un puisse entrer pour verifier ce qu'on repare — sinon la
 * maintenance se fait a l'aveugle, et l'on ne decouvre qu'a sa levee que rien
 * ne marche.
 *
 * La liste est ecrite en dur, et c'est le bon endroit : elle doit valoir avant
 * toute requete a la base, y compris quand la base est justement ce qu'on est
 * en train de reparer. Une liste rangee en base serait inaccessible au moment
 * ou l'on en a le plus besoin.
 *
 * Ce n'est pas un controle de securite et ne pretend pas l'etre : les
 * politiques de la base restent seules a decider ce que chacun peut lire et
 * ecrire. C'est un aiguillage d'affichage — qui voit l'application, qui voit
 * l'ecran de maintenance.
 */

/**
 * Les adresses qui traversent la maintenance.
 *
 * En minuscules, comparees en minuscules : une adresse ne distingue pas la
 * casse, et « Zyko682@… » doit passer comme « zyko682@… ».
 */
const AUTORISES = new Set([
  'zyko682@gmail.com',
  'noambcqt@gmail.com',
]);

/**
 * Vrai si cette adresse peut utiliser l'application malgre la maintenance.
 *
 * Une adresse absente ou vide ne passe pas : pendant une maintenance, le doute
 * profite a la maintenance.
 */
export function traverseLaMaintenance(courriel: string | null | undefined): boolean {
  if (!courriel) return false;
  return AUTORISES.has(courriel.trim().toLowerCase());
}

/**
 * Vrai tant que l'application est en maintenance.
 *
 * Levee le 2 septembre 2026. La liste ci-dessus reste en place : une prochaine
 * maintenance n'aura qu'a remettre ce drapeau a `true`, sans avoir a retrouver
 * qui doit pouvoir entrer pendant qu'elle dure.
 *
 * Ce drapeau decide aussi de l'ecran de retour — voir `retour.ts`. Il ne parait
 * qu'a ceux qui ont vu l'ecran de maintenance, et une seule fois.
 */
export const EN_MAINTENANCE = false;
