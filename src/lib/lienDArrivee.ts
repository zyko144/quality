/**
 * Ce qu'on fait d'un lien qui arrive de l'exterieur.
 *
 * Trois sortes de liens sont produites par l'application — une invitation a un
 * espace, un lien vers un salon, un lien vers un message — et AUCUNE des trois
 * n'etait recue. Le routeur ne connaissait que trois adresses fixes, et tout le
 * reste retombait sur la presentation.
 *
 * Le resultat, du point de vue de qui cliquait : « les liens ne marchent pas ».
 * Du point de vue de qui l'envoyait : rien du tout — le lien avait l'air
 * normal, il etait meme copie par un bouton prevu pour cela.
 *
 * La lecture vit ici, seule et sans effet, parce qu'elle porte sur des chaines
 * venues du dehors : un lien tronque, un code colle avec un espace, une adresse
 * bricolee a la main. Chacun de ces cas doit rendre « je ne sais pas » plutot
 * que d'emmener quelque part au hasard.
 */

export type Arrivee =
  | { genre: 'invitation'; code: string }
  | { genre: 'salon'; id: string }
  | { genre: 'message'; id: string };

/** Un identifiant tel que la base les produit. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un code d'invitation.
 *
 * Volontairement large : le code est engendre par la base et sa forme peut
 * changer. On refuse ce qui ne peut pas en etre un — trop court, trop long, des
 * caracteres qui n'y figurent jamais — plutot que d'imposer une forme exacte
 * qu'une migration rendrait fausse.
 */
const CODE = /^[a-z0-9-]{4,32}$/i;

/**
 * Lit une adresse et dit ou elle mene.
 *
 * Les deux moities de l'adresse sont examinees : l'invitation vit dans le
 * chemin — `/invite/abc` — tandis que les liens vers un salon ou un message
 * vivent apres le croisillon — `/#/salon/<id>`. C'est ainsi qu'ils sont
 * produits, et il vaut mieux lire ce qui est ecrit que reecrire les deux.
 */
export function lireArrivee(href: string): Arrivee | null {
  let adresse: URL;
  try {
    adresse = new URL(href);
  } catch {
    return null;
  }

  const invitation = decouper(adresse.pathname);
  if (invitation[0] === 'invite' && invitation[1]) {
    const code = invitation[1].trim();
    return CODE.test(code) ? { genre: 'invitation', code: code.toLowerCase() } : null;
  }

  // `hash` porte le croisillon : on le retire avant de decouper.
  const apres = decouper(adresse.hash.replace(/^#/, ''));

  if (apres[0] === 'salon' && apres[1] && UUID.test(apres[1])) {
    return { genre: 'salon', id: apres[1].toLowerCase() };
  }

  if (apres[0] === 'message' && apres[1] && UUID.test(apres[1])) {
    return { genre: 'message', id: apres[1].toLowerCase() };
  }

  return null;
}

/** Decoupe un chemin en segments non vides. */
function decouper(chemin: string): string[] {
  return chemin.split('/').filter((morceau) => morceau.length > 0);
}

/**
 * Efface l'adresse d'arrivee sans recharger.
 *
 * Sans cela, recharger la page rejouerait l'arrivee : on redemanderait a
 * rejoindre un espace qu'on a peut-etre quitte entre-temps, et l'on ne pourrait
 * plus jamais ouvrir l'application ailleurs qu'a cet endroit.
 */
export function oublierArrivee(): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', '/app');
}

/**
 * L'adresse de depart, retenue avant que quoi que ce soit ne la change.
 *
 * Ce n'est pas une precaution de principe : `App` redirige vers `/app` des
 * qu'une session est ouverte, et cette redirection part AVANT que le composant
 * qui traite l'arrivee ne soit monte. Sans cette capture faite au chargement du
 * module — donc avant tout rendu — le lien serait efface avant d'avoir ete lu,
 * et l'on retomberait exactement sur le defaut qu'on repare.
 */
const AU_DEPART: Arrivee | null =
  typeof window === 'undefined' ? null : lireArrivee(window.location.href);

/** Ce vers quoi pointait l'adresse au lancement, s'il y avait quelque chose. */
export function arriveeDuDepart(): Arrivee | null {
  return AU_DEPART;
}
