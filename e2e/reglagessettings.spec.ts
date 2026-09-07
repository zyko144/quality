import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

/**
 * Les reglages doivent survivre a une mise a jour.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Tout ce que quelqu'un regle a la main — raccourcis clavier, micro, volumes,
 * preferences d'espace — vit dans le `localStorage` de la fenetre. Il y survit
 * a une mise a jour sans rien faire de particulier : le dossier de donnees de
 * WebView2 est nomme d'apres l'IDENTIFIANT de l'application, pas d'apres sa
 * version.
 *
 * C'est donc l'identifiant, et lui seul, qui tient la promesse.
 *
 * Ce n'est pas theorique. Il a deja change deux fois, et l'on peut encore voir
 * les dossiers abandonnes sur la machine de developpement :
 *
 *     app.orbit.desktop     derniere ecriture le 28 aout
 *     app.quality.desktop   derniere ecriture le 1er septembre
 *     app.echow.desktop     en cours
 *
 * Chacun de ces renommages a efface, pour tout le monde, les raccourcis et les
 * reglages audio — sans message, sans trace, et sans qu'aucun test ne s'en
 * apercoive. Le seul symptome est « mes touches ne marchent plus », signale
 * par quelqu'un d'autre, longtemps apres.
 *
 * Ce cas-ci ne verifie pas que la sauvegarde fonctionne — les magasins s'en
 * chargent, et ils fusionnent tous sur leurs valeurs par defaut. Il verifie
 * qu'on ne coupe pas le fil par inadvertance.
 */

const IDENTIFIANT = 'app.echow.desktop';

test.describe('les reglages survivent aux mises a jour', () => {
  test('l’identifiant de l’application ne change pas', () => {
    const conf = JSON.parse(
      readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'),
    ) as { identifier?: string };

    /*
     * Si ce cas echoue, ce n'est pas lui qu'il faut corriger.
     *
     * Changer l'identifiant est possible — il faut alors reprendre les
     * reglages de l'ancien dossier au premier lancement, et c'est un travail
     * a part entiere. Le faire sans y penser coute a chaque utilisateur ses
     * raccourcis, et l'on ne s'en apercoit qu'apres la publication.
     */
    expect(conf.identifier).toBe(IDENTIFIANT);
  });

  test('l’installateur n’efface pas les donnees de l’utilisateur', () => {
    const conf = JSON.parse(
      readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'),
    ) as { bundle?: { windows?: { nsis?: { installMode?: string } } } };

    /*
     * `currentUser` installe pour la personne connectee, dans son profil.
     *
     * Passer a `perMachine` deplacerait l'installation et changerait le
     * contexte dans lequel la fenetre s'ouvre — donc, potentiellement, le
     * dossier ou vivent les reglages.
     */
    expect(conf.bundle?.windows?.nsis?.installMode).toBe('currentUser');
  });

  test('chaque magasin repart de ses valeurs par defaut', () => {
    /*
     * La seconde facon de perdre un reglage : ajouter une preference et lire
     * l'objet enregistre TEL QUEL. Les anciens enregistrements ne portent pas
     * la nouvelle cle, et tout ce qui la lit reçoit `undefined` — un micro
     * coupe, un volume a zero, un raccourci absent.
     *
     * La parade est partout la meme, et ce cas verifie qu'elle y est encore :
     * on part des defauts, et l'on n'ecrase que ce qui est enregistre.
     */
    const magasins = [
      ['src/store/devices.ts', /\.\.\.DEFAULTS,\s*\.\.\.\(JSON\.parse/],
      ['src/store/session.ts', /\.\.\.DEFAULT_PREFERENCES,\s*\.\.\.\(JSON\.parse/],
      ['src/store/spacePrefs.ts', /\.\.\.DEFAUTS,\s*\.\.\.\(get\(\)\.parEspace/],
    ] as const;

    for (const [chemin, motif] of magasins) {
      const source = readFileSync(join(process.cwd(), chemin), 'utf8');
      expect(motif.test(source), `${chemin} n'a plus de fusion sur les defauts`).toBe(true);
    }
  });

  test('les raccourcis ne s’effacent que sur demande', () => {
    const source = readFileSync(join(process.cwd(), 'src/store/raccourcis.ts'), 'utf8');

    /*
     * Un seul effacement, et il porte le nom du geste qui le declenche.
     *
     * Un `removeItem` ailleurs — dans une migration, un nettoyage au
     * demarrage, une gestion d'erreur trop large — retirerait les raccourcis
     * sans que personne ne l'ait demande.
     */
    const effacements = source.match(/localStorage\.removeItem/g) ?? [];
    expect(effacements).toHaveLength(1);

    const reinitialiser = source.slice(source.indexOf('reinitialiser:'));
    expect(reinitialiser).toContain('localStorage.removeItem');

    /*
     * Et un raccourci enregistre l'emporte sur son defaut, action par action.
     *
     * Repartir des defauts est ce qui permet d'AJOUTER une action sans que les
     * autres disparaissent ; encore faut-il que ce qui est enregistre soit
     * ensuite applique par-dessus.
     */
    expect(source).toContain('entree.action in ranges');
  });
});
