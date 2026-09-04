import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import {
  deplacer,
  estLeCadrageParDefaut,
  styleDeCadrage,
  CADRAGE_PAR_DEFAUT,
  ZOOM_MAX,
  ZOOM_MIN,
  type Cadrage,
} from './cadrage';

/**
 * Le cadrage de la banniere, a la souris ou au doigt.
 *
 * On saisit l'image et on la tire, comme une carte sur une table. C'est le
 * geste que tout le monde connait, et il ne demande aucune explication — a la
 * difference de deux glissieres « horizontal » et « vertical », qui obligent a
 * traduire mentalement une intention en deux nombres.
 *
 * La glissiere ne sert qu'au grossissement, ou elle est a sa place : c'est une
 * grandeur a une seule dimension, sans direction a choisir.
 *
 * Ce que voit l'apercu est ce que verront les autres : le meme calcul de style
 * sert ici et sur la fiche, depuis `cadrage.ts`. Un apercu qui montre autre
 * chose que le resultat est pire que pas d'apercu du tout — on cadre
 * soigneusement pour un rendu qu'on ne verra jamais.
 */
export function CadrageBanniere({
  url,
  cadrage,
  onChange,
}: {
  url: string;
  cadrage: Cadrage;
  onChange: (cadrage: Cadrage) => void;
}) {
  const cadre = useRef<HTMLDivElement>(null);
  const depart = useRef<{ x: number; y: number } | null>(null);

  const commencer = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Le bouton droit ouvre un menu, le milieu colle : ni l'un ni l'autre ne
    // deplace quoi que ce soit.
    if (event.button !== 0) return;

    depart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const bouger = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origine = depart.current;
    const boite = cadre.current?.getBoundingClientRect();
    if (!origine || !boite || boite.width === 0 || boite.height === 0) return;

    /*
     * Le deplacement est rapporte a la taille du cadre, pas a des pixels.
     *
     * L'apercu de l'editeur, la fiche de profil et la page des reglages n'ont
     * pas la meme largeur. En pixels, un meme geste cadrerait differemment
     * selon l'endroit ou on l'a fait — et le reglage voyagerait mal d'un ecran
     * a l'autre. En pourcentage, il veut dire la meme chose partout.
     */
    onChange(
      deplacer(
        cadrage,
        ((event.clientX - origine.x) / boite.width) * 100,
        ((event.clientY - origine.y) / boite.height) * 100,
      ),
    );

    depart.current = { x: event.clientX, y: event.clientY };
  };

  const finir = (event: ReactPointerEvent<HTMLDivElement>) => {
    depart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  /*
   * Les fleches font la meme chose que le glissement.
   *
   * Sans elles, le cadrage serait la seule commande de cet editeur qu'on ne
   * puisse pas atteindre sans souris — et une banniere mal cadree resterait
   * mal cadree pour qui n'en a pas.
   */
  const auClavier = (event: KeyboardEvent<HTMLDivElement>) => {
    const pas = event.shiftKey ? 10 : 2;
    const gestes: Record<string, [number, number]> = {
      ArrowLeft: [pas, 0],
      ArrowRight: [-pas, 0],
      ArrowUp: [0, pas],
      ArrowDown: [0, -pas],
    };

    const geste = gestes[event.key];
    if (!geste) return;

    event.preventDefault();
    onChange(deplacer(cadrage, geste[0], geste[1]));
  };

  return (
    <div className="cadrage">
      <div
        ref={cadre}
        className="cadrage__cadre"
        onPointerDown={commencer}
        onPointerMove={bouger}
        onPointerUp={finir}
        onPointerCancel={finir}
        onKeyDown={auClavier}
        role="application"
        tabIndex={0}
        aria-label="Cadrer la banniere : glisser ou utiliser les fleches"
      >
        <img src={url} alt="" style={styleDeCadrage(cadrage)} draggable={false} />
        <span className="cadrage__indice" aria-hidden="true">
          <Icon name="move" size={14} />
          Glisser pour cadrer
        </span>
      </div>

      <div className="cadrage__reglages">
        <label className="cadrage__zoom">
          <Icon name="search" size={14} aria-hidden="true" />
          <span className="visually-hidden">Grossissement de la banniere</span>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.05}
            value={cadrage.zoom}
            onChange={(event) => onChange({ ...cadrage, zoom: Number(event.target.value) })}
          />
        </label>

        <button
          type="button"
          className="cadrage__reset"
          onClick={() => onChange(CADRAGE_PAR_DEFAUT)}
          disabled={estLeCadrageParDefaut(cadrage)}
        >
          Recentrer
        </button>
      </div>
    </div>
  );
}
