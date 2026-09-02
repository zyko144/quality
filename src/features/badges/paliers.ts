/**
 * Ce qu'un badge demande, lu dans sa cle.
 *
 * Les paliers etaient ecrits deux fois : une fois en SQL dans le catalogue, une
 * fois en TypeScript dans le code qui attribue. Les deux listes ont diverge des
 * la premiere modification — le catalogue proposait `espace-10` que le code
 * n'attribuait jamais, et le code visait `espace-100` qui n'existait pas. Deux
 * defauts inverses, aucun visible : le badge n'est simplement jamais donne, et
 * personne ne remarque l'absence de quelque chose.
 *
 * La cle porte deja le seuil. On la lit plutot que de la recopier : ajouter un
 * palier redevient une ligne de SQL, et le code suit tout seul.
 *
 * Ce module vit a part parce qu'il analyse du texte venu de la base, et que
 * chaque forme non prevue doit rendre « je ne sais pas » plutot qu'un nombre
 * approchant. Un seuil mal lu attribuerait un badge de mille heures a qui en a
 * passe dix.
 */

/** Ce qu'on sait mesurer. */
export type Mesure = 'vocal' | 'messages' | 'espace' | 'anciennete';

export interface Palier {
  mesure: Mesure;
  /** Heures pour `vocal`, messages pour `messages`, membres pour `espace`, annees pour `anciennete`. */
  seuil: number;
}

/**
 * Les suffixes d'echelle.
 *
 * `k` et `m` seulement : au-dela, un badge « mille milliards de messages »
 * n'aurait pas de sens, et accepter une echelle qu'on n'utilise pas revient a
 * accepter une faute de frappe.
 */
const ECHELLES: Record<string, number> = { k: 1_000, m: 1_000_000 };

/**
 * Lit le seuil d'un badge, ou rend `null` si sa cle n'en porte pas.
 *
 * `null` est la reponse normale pour les badges qui ne se calculent pas —
 * `pionnier`, `equipe`, `rapporteur`. Ils s'attribuent autrement, et les
 * confondre avec une cle mal formee ferait chercher un defaut inexistant.
 */
export function lirePalier(cle: string): Palier | null {
  const coupe = cle.indexOf('-');
  if (coupe === -1) return null;

  const famille = cle.slice(0, coupe);
  const reste = cle.slice(coupe + 1);

  if (famille === 'anciennete') {
    // `1an`, `3ans`, `10ans` : le pluriel varie, le nombre non.
    const annees = /^(\d+)ans?$/.exec(reste);
    return annees ? { mesure: 'anciennete', seuil: Number(annees[1]) } : null;
  }

  if (famille !== 'vocal' && famille !== 'messages' && famille !== 'espace') return null;

  const nombre = /^(\d+)([km])?$/.exec(reste);
  if (!nombre) return null;

  const base = Number(nombre[1]);
  const echelle = nombre[2] ? ECHELLES[nombre[2]] : 1;

  // Un nombre a rallonge ou une echelle inconnue : on refuse plutot que de
  // deviner. Voir l'en-tete — un seuil mal lu donne le mauvais badge.
  if (!Number.isSafeInteger(base) || base <= 0 || echelle === undefined) return null;

  return { mesure: famille, seuil: base * echelle };
}

/**
 * Ce qu'on a mesure de quelqu'un.
 *
 * Les champs sont facultatifs : une mesure absente n'attribue rien plutot que
 * de compter pour zero, ce qui reviendrait au meme ici mais cesserait d'etre
 * vrai le jour ou l'on ajouterait un badge « moins de X ».
 */
export interface Mesures {
  vocal?: number;
  messages?: number;
  espace?: number;
  anciennete?: number;
}

/**
 * Les cles a reclamer, parmi celles du catalogue.
 *
 * Ne rend que ce qui est merite ET pas encore obtenu : demander un badge qu'on
 * a deja coute un aller-retour pour rien, et il y en a une trentaine.
 */
export function badgesMerites(
  catalogue: { cle: string }[],
  mesures: Mesures,
  deja: Set<string>,
): string[] {
  return catalogue
    .filter((badge) => {
      if (deja.has(badge.cle)) return false;

      const palier = lirePalier(badge.cle);
      if (!palier) return false;

      const valeur = mesures[palier.mesure];
      return valeur !== undefined && valeur >= palier.seuil;
    })
    .map((badge) => badge.cle);
}

/**
 * Les mesures dont le catalogue a besoin.
 *
 * Sert a n'interroger la base que pour ce qui peut encore etre gagne : compter
 * les messages de quelqu'un qui a deja les cinq paliers est une requete pour
 * rien, et elle est faite a chaque ouverture de session.
 */
export function mesuresUtiles(catalogue: { cle: string }[], deja: Set<string>): Set<Mesure> {
  const besoins = new Set<Mesure>();

  for (const badge of catalogue) {
    if (deja.has(badge.cle)) continue;
    const palier = lirePalier(badge.cle);
    if (palier) besoins.add(palier.mesure);
  }

  return besoins;
}
