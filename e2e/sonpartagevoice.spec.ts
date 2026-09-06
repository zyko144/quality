import { test, expect } from '@playwright/test';
import { sourceDuSon, SON_DE_L_APPLICATION } from '../src/features/voice/sonPartage';

/**
 * De quel programme part le son d'un partage.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que ce fichier protege : la regle a deja change une fois sans que rien ne
 * le dise, et le defaut qui en est sorti — « des fois on entend pas le son du
 * stream quand on met juste sur la page youtube » — n'a rien qui le signale.
 * La capture s'ouvre, aucune erreur n'est levee, les paquets partent, et le
 * silence arrive au bout. On ne peut le voir qu'en ecoutant, sur la machine de
 * quelqu'un d'autre.
 *
 * Les cas ci-dessous sont donc ecrits du point de vue de celui qui partage :
 * ce qu'il a regle, ce qu'il partage, ce qu'on doit demander a Windows.
 */

test.describe('la source du son suit le reglage', () => {
  test('sans reglage, on prend tout l’ordinateur', () => {
    // Le defaut, et la raison d'etre du changement : ce qui s'entend toujours.
    expect(sourceDuSon('fenetre:1234', null)).toBe(null);
    expect(sourceDuSon(undefined, null)).toBe(null);
  });

  test('la consigne suit la fenetre du jour, pas celle du reglage', () => {
    /*
     * C'est tout l'interet de la consigne : elle est rangee une fois et vaut
     * pour les partages suivants. Un identifiant de fenetre range tel quel
     * designerait, la semaine d'apres, une fenetre fermee — ou pire, une autre.
     */
    expect(sourceDuSon('fenetre:1234', SON_DE_L_APPLICATION)).toBe('fenetre:1234');
    expect(sourceDuSon('fenetre:9', SON_DE_L_APPLICATION)).toBe('fenetre:9');
  });

  test('la consigne ne veut rien dire sur un ecran entier', () => {
    /*
     * Un ecran n'a pas d'application derriere. Rendre la consigne telle quelle
     * ferait demander a Windows le son du processus « application », qui
     * n'existe pas : la capture s'ouvrirait sur rien.
     */
    expect(sourceDuSon(undefined, SON_DE_L_APPLICATION)).toBe(null);
    expect(sourceDuSon('ecran:0', SON_DE_L_APPLICATION)).toBe(null);
  });

  test('une application nommee est suivie, meme si l’on partage autre chose', () => {
    /*
     * Le cas de celui qui s'entend en double : un routeur audio virtuel rejoue
     * sa voix depuis SON processus, et prendre tout l'ordinateur la reprend
     * avec le reste. Designer l'application est la seule issue, et elle doit
     * valoir aussi en partageant un ecran — c'est meme la que le probleme se
     * pose.
     */
    expect(sourceDuSon(undefined, 'fenetre:42')).toBe('fenetre:42');
    expect(sourceDuSon('ecran:1', 'fenetre:42')).toBe('fenetre:42');
    // Et une fenetre partagee n'ecrase pas le choix.
    expect(sourceDuSon('fenetre:7', 'fenetre:42')).toBe('fenetre:42');
  });

  test('la consigne ne peut pas etre confondue avec une fenetre', () => {
    /*
     * Les identifiants du selecteur sont tous de la forme `fenetre:N`. Si la
     * consigne en prenait la forme, elle serait passee telle quelle a Windows
     * le jour ou quelqu'un partagerait un ecran.
     */
    expect(SON_DE_L_APPLICATION.startsWith('fenetre:')).toBe(false);
  });
});
