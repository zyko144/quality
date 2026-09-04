import { test, expect } from '@playwright/test';
import { reductionVoulue, screenTargetHeight, screenBitrate } from '../src/store/devices';
import type { MediaPreferences } from '../src/store/devices';

/**
 * La definition reellement emise par un partage d'ecran.
 *
 * Nomme pour tomber dans le projet « authentifie ».
 *
 * Ce que ces cas protegent : l'accord entre TROIS choses qui vivaient chacune
 * de leur cote et pouvaient diverger sans que rien ne le dise.
 *
 *   1. la definition demandee dans les reglages ;
 *   2. le budget de debit, calcule sur cette definition ;
 *   3. ce que la capture rend vraiment.
 *
 * La capture native ne recoit pas de taille — `demarrer_image(source, images)`
 * cote Rust — et rend donc toujours l'ecran entier. Sur un ecran 1440p regle en
 * 1080p, on encodait 1,78 fois les pixels prevus avec le budget de 1080p, en
 * ayant par ailleurs interdit a l'encodeur de reduire quoi que ce soit. Il ne
 * lui restait qu'un levier, la cadence : les traces d'un partage montrent une a
 * sept images par seconde.
 *
 * Le defaut ne se voit pas en lisant l'un des trois endroits. Il ne se voit
 * qu'en les mettant cote a cote, ce que fait ce fichier.
 */

function reglages(patch: Partial<MediaPreferences>): MediaPreferences {
  return { screenQuality: '1080p', screenFrameRate: 60, screenPriority: 'motion', ...patch } as MediaPreferences;
}

test.describe('Definition du partage', () => {
  test('un ecran plus grand que la definition demandee est reduit', () => {
    // Le cas exact des traces : ecran 1440p, reglage 1080p.
    expect(reductionVoulue(1440, 1080)).toBeCloseTo(1.333, 3);
    expect(reductionVoulue(1440, 720)).toBe(2);
    expect(reductionVoulue(2160, 1080)).toBe(2);
  });

  test('on n agrandit jamais une source plus petite', () => {
    /*
     * Agrandir inventerait des pixels que la source n'a pas, au prix exact de
     * ceux qu'on aurait pu encoder proprement.
     */
    expect(reductionVoulue(720, 1080)).toBe(1);
    expect(reductionVoulue(1080, 1080)).toBe(1);
  });

  test('« source » laisse la definition telle quelle', () => {
    // C'est un choix explicite : on ne le contredit pas.
    expect(screenTargetHeight(reglages({ screenQuality: 'source' }))).toBeNull();
    expect(reductionVoulue(1440, null)).toBe(1);
  });

  test('une hauteur absurde ne fait pas exploser le calcul', () => {
    // `getSettings().height` peut manquer : la piste n'a pas encore de taille.
    expect(reductionVoulue(0, 1080)).toBe(1);
    expect(reductionVoulue(Number.NaN, 1080)).toBe(1);
    expect(reductionVoulue(1440, 0)).toBe(1);
  });

  test('le budget de debit vise la meme definition que la reduction', () => {
    /*
     * Le coeur du defaut : ces deux nombres doivent parler de la MEME image.
     *
     * Le budget montait avec la definition demandee pendant que la reduction
     * restait a 1 : on payait un 1080p pour envoyer un 1440p.
     */
    for (const qualite of ['720p', '1080p'] as const) {
      const media = reglages({ screenQuality: qualite });
      const cible = screenTargetHeight(media);

      expect(cible).not.toBeNull();

      // Reduite, la source arrive exactement a la hauteur que le budget vise.
      expect(1440 / reductionVoulue(1440, cible)).toBeCloseTo(cible as number, 6);
      expect(screenBitrate(media)).toBeGreaterThan(0);
    }
  });
});
