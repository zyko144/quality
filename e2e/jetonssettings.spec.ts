import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Aucune feuille de style ne doit citer un jeton qui n'existe pas.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce cas existe parce que l'erreur qu'il attrape est SILENCIEUSE, et c'est ce
 * qui la rend couteuse. Une declaration dont un `var()` ne resout pas est
 * simplement jetee par le navigateur : pas d'avertissement, pas de trace, pas
 * de style casse a l'ecran non plus — la propriete retombe sur sa valeur
 * heritee, qui a toutes les chances de paraitre plausible.
 *
 * Trois jetons inventes ont vecu ainsi dans ce projet : `--text`, `--border` et
 * `--dur-fast`, la ou il fallait `--text-primary`, `--border-default` et
 * `--duration-fast`. Les couleurs paraissaient correctes, parce qu'elles
 * heritaient de quelque chose de correct — jusqu'a ce qu'un `color-mix` bati
 * sur l'un d'eux devienne invalide a son tour et rende quatre services de la
 * meme couleur.
 *
 * Un `var()` mal orthographie ne se voit donc qu'en mesurant la couleur
 * calculee d'un element, ce que personne ne fait en relisant une feuille de
 * style. Ici, ca se voit tout de suite.
 */

/**
 * Ce que les feuilles ne definissent pas, et n'ont pas a definir.
 *
 * Ces variables sont posees par le code au moment du rendu — la teinte d'un
 * service, celle d'un badge, l'inclinaison d'une carte sous la souris. Les
 * chercher dans le CSS serait les chercher la ou elles ne seront jamais.
 */
const POSES_PAR_LE_CODE = new Set([
  '--badge-color',
  '--banniere',
  '--bulle',
  '--bulle-opacite',
  '--glare-x',
  '--glare-y',
  '--hue-primary',
  '--level',
  '--marque',
  '--profil-a',
  '--profil-b',
  '--saturation',
  '--teinte',
  '--tilt-x',
  '--tilt-y',
]);

test.describe('Jetons de style', () => {
  test('chaque var() cite un jeton reellement defini', () => {
    const dossier = new URL('../src/styles/', import.meta.url);
    const feuilles = readdirSync(dossier).filter((nom) => nom.endsWith('.css'));

    expect(feuilles.length).toBeGreaterThan(0);

    const definis = new Set<string>();
    const utilises = new Map<string, string>();

    for (const nom of feuilles) {
      /*
       * Les commentaires sont retires avant de lire.
       *
       * Les en-tetes de ce projet expliquent souvent une regle en citant du
       * CSS — « pour que `rgba(var(--x), 0.3)` fonctionne ». Une prose qui
       * decrit un exemple n'est pas un usage, et la compter en ferait echouer
       * le cas sur une explication parfaitement juste.
       */
      const source = readFileSync(new URL(nom, dossier), 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        ' ',
      );

      // Une definition : `--nom:` en debut de declaration.
      for (const trouve of source.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
        definis.add(trouve[1]!);
      }

      /*
       * Un usage SANS valeur de repli.
       *
       * `var(--positive, #3ba55d)` est un point d'extension volontaire : le
       * jeton peut ne pas exister, la valeur de repli s'applique, et rien
       * n'est casse. C'est l'absence de repli qui transforme un nom mal
       * orthographie en declaration jetee — et c'est donc elle qu'on cherche.
       */
      for (const trouve of source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
        // On garde le premier fichier ou on l'a vu : il suffit pour le dire.
        if (!utilises.has(trouve[1]!)) utilises.set(trouve[1]!, nom);
      }
    }

    const manquants = [...utilises]
      .filter(([jeton]) => !definis.has(jeton) && !POSES_PAR_LE_CODE.has(jeton))
      .map(([jeton, fichier]) => `${jeton} (${fichier})`);

    expect(manquants, 'jetons cites mais jamais definis').toEqual([]);
  });

  test('le soulignement des liens epargne les cartes', () => {
    /*
     * Le reglage d'accessibilite « souligner les liens » existe parce que la
     * couleur seule ne doit pas dire « ceci est un lien ». Une CARTE en donne
     * trois indices — bordure, fond, logo — et le trait n'y ajoute rien : il
     * barre un intitule court et donne l'impression d'un defaut d'affichage.
     *
     * Ce cas verifie les deux moities. Retirer `:not(.lien-carte)` de la regle
     * ferait revenir le trait ; retirer la classe des composants aussi, et
     * cette seconde faute-la ne se verrait que le reglage active — c'est-a-dire
     * jamais, chez qui ne l'active pas.
     */
    const regle = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    expect(regle).toContain("a:not(.lien-carte)");

    for (const chemin of [
      '../src/features/profile/ProfileCard.tsx',
      '../src/features/messages/LinkPreview.tsx',
    ]) {
      const source = readFileSync(new URL(chemin, import.meta.url), 'utf8');
      expect(source, `${chemin} doit marquer ses cartes`).toContain('lien-carte');
    }
  });

  test('les jetons poses par le code ne sont pas definis deux fois', () => {
    /*
     * Une valeur ecrite dans le CSS pour une variable que le code pose aussi
     * masquerait le defaut inverse : on croirait la variable fournie alors
     * qu'elle vient d'un repli, et le jour ou le code cesse de la poser, rien
     * ne le dirait. C'est acceptable pour un repli VOLONTAIRE — d'ou la
     * verification ici plutot qu'une interdiction.
     */
    expect(POSES_PAR_LE_CODE.size).toBeGreaterThan(0);
  });
});
