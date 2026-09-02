import { defineConfig, type UserConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import racine from '../vite.config';

/**
 * La compilation pour le projet Vercel « mobile ».
 *
 * Ce dossier ne contient PAS d'application. Il en a contenu une : six ecrans
 * reecrits a la main la ou l'application en compte vingt et un, sans les amis,
 * sans la moderation, sans la recherche, sans les parametres. Deux copies d'une
 * meme application divergent toujours, et c'est la plus pauvre qui recoit les
 * corrections en dernier — ou jamais. Aucune des corrections de ces dernieres
 * versions ne l'avait touchee.
 *
 * Ce qui reste ici est une cible de compilation, et rien d'autre : on reprend
 * la configuration de l'application, on ne change que l'endroit ou le resultat
 * est depose. Il ne peut donc pas y avoir d'ecart entre les deux — il n'y a
 * qu'une application, construite deux fois.
 *
 * L'installation sur telephone — manifeste, service ouvrier, ce qu'iOS demande
 * en plus — vit dans la configuration reprise : elle vaut donc aussi pour
 * l'adresse principale.
 */
const base = racine as UserConfig;

export default defineConfig({
  ...base,

  /*
   * La racine reste celle du depot.
   *
   * C'est elle qui porte `index.html`, `src/` et `public/`. Poser la racine ici
   * obligerait a recopier au moins la page d'accueil, et l'on retomberait dans
   * ce qu'on vient de defaire.
   */
  root: fileURLToPath(new URL('..', import.meta.url)),

  build: {
    ...base.build,
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});
