import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { lireArrivee } from '../src/lib/lienDArrivee';

/**
 * Les liens qui arrivent de l'exterieur.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * L'application produit trois sortes de liens et n'en recevait aucune : le
 * routeur ne connaissait que trois adresses fixes, et tout le reste retombait
 * sur la presentation. Le defaut etait invisible des deux cotes — celui qui
 * envoyait voyait un lien normal, copie par un bouton prevu pour cela ; celui
 * qui cliquait arrivait sur l'application sans comprendre.
 *
 * Ces cas portent sur du texte venu du dehors. Chacun doit rendre « je ne sais
 * pas » plutot que d'emmener quelque part au hasard : une adresse bricolee ne
 * doit pas pouvoir faire rejoindre un espace.
 */

const HOTE = 'https://echow.app';
const ID = '3733e57e-ed79-46bb-9c2b-91273b914ec1';

test.describe('Liens d arrivee', () => {
  test('une invitation est reconnue', () => {
    // La forme exacte que produit le bouton « copier le lien ».
    expect(lireArrivee(`${HOTE}/invite/abc123`)).toEqual({
      genre: 'invitation',
      code: 'abc123',
    });

    // Un code colle avec sa casse d'origine : les codes sont compares en
    // minuscules cote base.
    expect(lireArrivee(`${HOTE}/invite/ABC123`)).toEqual({
      genre: 'invitation',
      code: 'abc123',
    });
  });

  test('un lien de salon et un lien de message sont reconnus', () => {
    /*
     * Ceux-la vivent APRES le croisillon — c'est ainsi que les menus
     * contextuels les produisent. Ne lire que le chemin les manquerait tous
     * les deux, ce qui etait exactement le cas.
     */
    expect(lireArrivee(`${HOTE}/#/salon/${ID}`)).toEqual({ genre: 'salon', id: ID });
    expect(lireArrivee(`${HOTE}/#/message/${ID}`)).toEqual({ genre: 'message', id: ID });
  });

  test('les adresses ordinaires ne menent nulle part', () => {
    // Ouvrir l'application normalement ne doit rien declencher.
    expect(lireArrivee(`${HOTE}/`)).toBeNull();
    expect(lireArrivee(`${HOTE}/app`)).toBeNull();
    expect(lireArrivee(`${HOTE}/connexion`)).toBeNull();
  });

  test('ce qui ne peut pas etre un identifiant est refuse', () => {
    /*
     * Le point important : une adresse bricolee a la main ne doit pas emmener
     * quelque part au hasard. Un identifiant qui n'en est pas un vaut « je ne
     * sais pas », et l'application le dit plutot que d'ouvrir n'importe quoi.
     */
    expect(lireArrivee(`${HOTE}/#/salon/pas-un-identifiant`)).toBeNull();
    expect(lireArrivee(`${HOTE}/#/message/12345`)).toBeNull();
    expect(lireArrivee(`${HOTE}/#/salon/`)).toBeNull();
    expect(lireArrivee(`${HOTE}/invite/`)).toBeNull();

    // Trop court, trop long, ou des caracteres qu'un code ne porte jamais.
    expect(lireArrivee(`${HOTE}/invite/ab`)).toBeNull();
    expect(lireArrivee(`${HOTE}/invite/${'x'.repeat(40)}`)).toBeNull();
    expect(lireArrivee(`${HOTE}/invite/pas de code`)).toBeNull();
  });

  test('une remontee de chemin est deja resolue par l adresse', () => {
    /*
     * `URL` normalise le chemin avant qu'on le lise : `/invite/abc/../autre`
     * devient `/invite/autre`. Il n'y a donc pas d'ambiguite a lever ici, et
     * le code retenu — « autre » — sera simplement introuvable cote base.
     *
     * Ce cas est garde parce qu'on pourrait etre tente de decouper l'adresse a
     * la main : on retrouverait alors deux segments la ou le navigateur n'en
     * voit qu'un, et l'on croirait avoir besoin d'une defense qui n'a pas lieu
     * d'etre.
     */
    expect(lireArrivee(`${HOTE}/invite/abc/../autre`)).toEqual({
      genre: 'invitation',
      code: 'autre',
    });
  });

  test('une adresse illisible ne fait pas tomber la lecture', () => {
    // Elle vient du dehors : elle peut etre n'importe quoi.
    expect(lireArrivee('pas une adresse')).toBeNull();
    expect(lireArrivee('')).toBeNull();
  });

  test('un lien reste lisible avec une requete ou un port', () => {
    // Le developpement tourne sur un port, et les liens partages traversent
    // parfois un traqueur qui ajoute ses parametres.
    expect(lireArrivee('http://localhost:4173/invite/abc123?src=discord')).toEqual({
      genre: 'invitation',
      code: 'abc123',
    });
  });
});

/**
 * Les liens qui partent vers l'exterieur.
 *
 * Dans l'application de bureau, un clic sur un lien ne faisait RIEN. Ni erreur,
 * ni fenetre, ni navigation : rien. La cause tenait a une permission Tauri, et
 * elle est de celles qu'on ne voit pas en lisant le code qui l'utilise.
 *
 * `opener:allow-open-url` autorise la COMMANDE et ne dit rien des adresses. Sa
 * portee, laissee vide, les refusait donc toutes. Il y manquait
 * `opener:allow-default-urls`, qui ouvre `http` et `https`.
 *
 * Ce cas lit le fichier de permissions plutot que le code : c'est la que vivait
 * le defaut, et une permission retiree par megarde redonnerait exactement le
 * meme silence.
 */
test.describe('Liens sortants', () => {
  test('la permission d ouvrir un lien porte aussi sur les adresses', () => {
    const permissions: string[] = JSON.parse(
      readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'),
    ).permissions;

    expect(permissions).toContain('opener:allow-open-url');

    // Sans celle-ci, la precedente n'ouvre rien du tout.
    expect(permissions).toContain('opener:allow-default-urls');
  });
});
