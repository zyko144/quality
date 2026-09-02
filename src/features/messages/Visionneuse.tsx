import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { useVisionneuse } from '@/store/visionneuse';

/**
 * L'image en grand, sans quitter la conversation.
 *
 * Cliquer une image ouvrait un onglet. Dans l'application de bureau il n'y a
 * pas d'onglet ou aller, et meme dans un navigateur on quittait la discussion
 * pour voir une image qu'on voulait seulement agrandir.
 *
 * Ce qu'elle fait, et pourquoi chaque chose y est
 * -----------------------------------------------
 * **Echap et le clic hors de l'image** ferment : ce sont les deux gestes que
 * tout le monde essaie, et n'en servir qu'un laisse la moitie des gens
 * coinces.
 *
 * **La molette agrandit** plutot que de faire defiler : dans une visionneuse,
 * il n'y a rien a faire defiler, et c'est le geste attendu.
 *
 * **Le fond est opaque et sombre**, pas seulement voile : une image claire sur
 * un voile transparent laisse lire la conversation derriere, et l'oeil ne sait
 * plus ou se poser.
 */
export function Visionneuse() {
  const image = useVisionneuse((etat) => etat.image);
  const echelle = useVisionneuse((etat) => etat.echelle);
  const fermer = useVisionneuse((etat) => etat.fermer);
  const zoomer = useVisionneuse((etat) => etat.zoomer);
  const reinitialiser = useVisionneuse((etat) => etat.reinitialiser);

  const fermerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!image) return;

    const auClavier = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        fermer();
        return;
      }

      // Les raccourcis d'agrandissement habituels, pour qui ne se sert pas de
      // la molette.
      if (event.key === '+' || event.key === '=') zoomer(0.5);
      if (event.key === '-') zoomer(-0.5);
      if (event.key === '0') reinitialiser();
    };

    /*
     * Le defilement de la page est retenu pendant qu'on regarde.
     *
     * Sans cela, la molette agrandit l'image ET fait defiler la conversation
     * derriere : en refermant, on ne retrouve plus l'endroit ou l'on etait.
     */
    const precedent = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    window.addEventListener('keydown', auClavier);
    fermerRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', auClavier);
      document.body.style.overflow = precedent;
    };
  }, [image, fermer, zoomer, reinitialiser]);

  if (!image) return null;

  return (
    <div
      className="visionneuse"
      role="dialog"
      aria-modal="true"
      aria-label={`Image : ${image.nom}`}
      onClick={fermer}
      onWheel={(event) => zoomer(event.deltaY < 0 ? 0.3 : -0.3)}
    >
      <header className="visionneuse__barre" onClick={(event) => event.stopPropagation()}>
        <span className="visionneuse__nom truncate">{image.nom}</span>

        <span className="visionneuse__echelle" aria-live="polite">
          {Math.round(echelle * 100)} %
        </span>

        <button
          type="button"
          className="icon-btn"
          onClick={() => zoomer(-0.5)}
          aria-label="Reduire"
        >
          <Icon name="minus" size={16} />
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={() => zoomer(0.5)}
          aria-label="Agrandir"
        >
          <Icon name="plus" size={16} />
        </button>

        {/*
          L'ouverture dans le navigateur reste offerte : c'est le seul chemin
          vers un enregistrement, que la visionneuse ne sait pas faire.
        */}
        <a
          className="icon-btn"
          href={image.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ouvrir dans le navigateur"
          title="Ouvrir dans le navigateur"
        >
          <Icon name="link" size={16} />
        </a>

        <button
          ref={fermerRef}
          type="button"
          className="icon-btn"
          onClick={fermer}
          aria-label="Fermer"
        >
          <Icon name="x" size={18} />
        </button>
      </header>

      <div className="visionneuse__scene">
        {/*
          Le clic sur l'image elle-meme ne ferme pas : on vient de l'ouvrir, et
          la refermer en voulant la deplacer serait la surprise la plus penible
          d'une visionneuse.
        */}
        <img
          className="visionneuse__image"
          src={image.url}
          alt={image.nom}
          style={{ transform: `scale(${echelle})` }}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={() => (echelle > 1 ? reinitialiser() : zoomer(1))}
          draggable={false}
        />
      </div>

      <p className="visionneuse__aide" onClick={(event) => event.stopPropagation()}>
        Molette pour agrandir · Double-clic pour revenir · Echap pour fermer
      </p>
    </div>
  );
}
