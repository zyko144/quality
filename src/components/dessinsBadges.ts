/**
 * Les dessins des badges, trouves par leur nom de fichier.
 *
 * Le lien entre un badge et son image est son NOM : `vocal-500.png` s'affiche
 * sur « Voix — 500 h ». Il n'y a pas de table de correspondance a tenir a jour,
 * et c'est voulu — une liste ecrite a la main a cote des fichiers finit toujours
 * par diverger d'eux, et rien ne le signale : le badge affiche simplement son
 * ancien dessin, ce que personne ne remarque.
 *
 * `import.meta.glob` est resolu a la compilation. Les fichiers sont donc
 * empreintes et mis en cache comme le reste, et un dessin absent ne coute pas
 * une requete perdue a l'execution : il n'existe pas, tout simplement.
 *
 * Un badge sans fichier garde son dessin vectoriel. Les deux coexistent le temps
 * que la serie se complete, ce qui evite d'avoir a tout livrer d'un coup.
 */

const FICHIERS = import.meta.glob('../assets/badges/*.{png,webp,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const DESSINS: Record<string, string> = Object.fromEntries(
  Object.entries(FICHIERS).map(([chemin, url]) => {
    const fichier = chemin.slice(chemin.lastIndexOf('/') + 1);
    return [fichier.replace(/\.[^.]+$/, ''), url];
  }),
);

/** Le dessin d'un badge, ou `undefined` s'il n'en a pas encore. */
export function dessinDe(cle: string): string | undefined {
  return DESSINS[cle];
}
