/**
 * Ce qu'on a manque, et non seulement ce qui vient d'arriver.
 *
 * Le message de mise a jour ne montrait que la version courante. Or le cas le
 * plus frequent n'est pas « je viens d'installer la suivante » : c'est « j'ai
 * laisse passer trois versions et j'ouvre enfin l'application ». Ces
 * trois-la annoncaient chacune quelque chose, et deux disparaissaient sans
 * avoir jamais ete lues.
 *
 * Ce module rassemble donc tout ce qui separe la version vue de la version
 * installee. Il vit a part parce qu'il compare des numeros de version, et que
 * comparer des numeros de version est une des choses qu'on croit toujours
 * savoir faire : « 0.10.0 » vient apres « 0.9.0 », et toute comparaison de
 * chaines dit le contraire.
 */

export interface Notes {
  version: string;
  notes: string;
}

/**
 * Compare deux numeros, morceau par morceau.
 *
 * Rend un nombre negatif si `a` precede `b`, positif s'il le suit, zero s'ils
 * sont egaux. Un numero illisible est traite comme le plus ancien possible :
 * mieux vaut montrer une note de trop qu'en cacher une.
 */
export function comparerVersions(a: string, b: string): number {
  const decouper = (v: string) =>
    v.split('.').map((morceau) => {
      const nombre = Number.parseInt(morceau, 10);
      return Number.isNaN(nombre) ? -1 : nombre;
    });

  const gauche = decouper(a);
  const droite = decouper(b);
  const longueur = Math.max(gauche.length, droite.length);

  for (let i = 0; i < longueur; i += 1) {
    // Une version plus courte est completee par des zeros : « 1.2 » et
    // « 1.2.0 » designent la meme chose.
    const ecart = (gauche[i] ?? 0) - (droite[i] ?? 0);
    if (ecart !== 0) return ecart;
  }

  return 0;
}

/**
 * Les notes de tout ce qui separe `vue` de `installee`, la plus recente en tete.
 *
 * `vue` absente veut dire « on ne sait pas ce qui a ete lu » : on ne rend alors
 * que la version installee, pour ne pas derouler tout l'historique a quelqu'un
 * qui vient d'arriver.
 */
export function notesManquees(
  historique: Notes[],
  installee: string,
  vue: string | null,
): Notes[] {
  const retenues = historique.filter((entree) => {
    // Rien au-dela de ce qui tourne : une note d'une version qu'on n'a pas
    // encore promettrait ce qui n'est pas la.
    if (comparerVersions(entree.version, installee) > 0) return false;

    if (vue === null) return entree.version === installee;

    return comparerVersions(entree.version, vue) > 0;
  });

  return retenues.sort((a, b) => comparerVersions(b.version, a.version));
}

/**
 * De combien de versions parle-t-on.
 *
 * Sert au titre : « Quoi de neuf en 0.9.0 » quand il n'y en a qu'une, « Ce que
 * vous avez manque » quand il y en a plusieurs — la seconde formule serait
 * absurde pour une seule, la premiere mensongere pour quatre.
 */
export function resumerCumul(manquees: Notes[]): string {
  if (manquees.length === 0) return '';
  if (manquees.length === 1) return `Quoi de neuf en ${manquees[0]!.version}`;

  const derniere = manquees[0]!.version;
  const premiere = manquees[manquees.length - 1]!.version;
  return `Ce que vous avez manque — de ${premiere} a ${derniere}`;
}
