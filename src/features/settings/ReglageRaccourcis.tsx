import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  useRaccourcis,
  ecrire,
  type ActionVocale,
  type Combinaison,
} from '@/store/raccourcis';

/**
 * Choisir ses touches.
 *
 * On appuie sur le bouton, puis sur la combinaison voulue : c'est le seul
 * moyen honnete de saisir un raccourci. Une liste deroulante obligerait a
 * nommer chaque touche d'avance, et se tromperait sur les claviers qui n'ont
 * pas la disposition attendue.
 *
 * Ce qui est enregistre est la touche PHYSIQUE, pas le caractere qu'elle
 * produit. Voir `raccourcis.ts` : une touche choisie en AZERTY reste la meme
 * touche si la disposition change.
 */
export function ReglageRaccourcis() {
  const liste = useRaccourcis((state) => state.liste);
  const definir = useRaccourcis((state) => state.definir);
  const conflit = useRaccourcis((state) => state.conflit);
  const reinitialiser = useRaccourcis((state) => state.reinitialiser);

  const [ecoute, setEcoute] = useState<ActionVocale | null>(null);
  const [remplace, setRemplace] = useState<string | null>(null);

  useEffect(() => {
    if (!ecoute) return;

    const capturer = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setEcoute(null);
        return;
      }

      /*
       * Une combinaison ne peut pas etre faite que de modificateurs.
       *
       * On les voit passer en premier quand on compose : sans ce filtre,
       * `Ctrl+Maj+M` serait capture des le `Ctrl`, et l'on n'atteindrait jamais
       * le M.
       *
       * Les touches de modification isolees restent choisissables pour parler
       * en maintenant — beaucoup preferent une touche laterale — d'ou le test
       * sur `event.key` plutot que sur `event.code`.
       */
      const seulementModificateur = ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key);
      if (seulementModificateur && (event.ctrlKey || event.shiftKey || event.altKey)) return;

      const combinaison: Combinaison = {
        code: event.code,
        ctrl: event.ctrlKey && event.key !== 'Control',
        shift: event.shiftKey && event.key !== 'Shift',
        alt: event.altKey && event.key !== 'Alt',
      };

      const pris = conflit(ecoute, combinaison);
      definir(ecoute, combinaison);
      setRemplace(pris ? pris.libelle : null);
      setEcoute(null);
    };

    // En phase de capture : on veut la touche avant que quoi que ce soit
    // d'autre ne l'intercepte, y compris les raccourcis de l'application.
    window.addEventListener('keydown', capturer, true);
    return () => window.removeEventListener('keydown', capturer, true);
  }, [ecoute, definir, conflit]);

  return (
    <section className="settings__group">
      <h2 className="settings__group-title">Raccourcis vocaux</h2>

      <p className="settings__hint">
        Cliquez sur une touche pour la changer, puis appuyez sur la combinaison
        voulue. Echap annule. Ces raccourcis ne repondent qu&rsquo;une fois
        connecte a un salon, et jamais pendant qu&rsquo;on ecrit.
      </p>

      {remplace ? (
        <p className="settings__hint" role="status">
          Cette combinaison etait prise par <strong>{remplace}</strong>, qui
          n&rsquo;a plus de raccourci. Deux actions sur la meme touche
          donneraient l&rsquo;une ou l&rsquo;autre sans qu&rsquo;on puisse
          prevoir laquelle.
        </p>
      ) : null}

      <ul className="raccourcis">
        {liste.map((entree) => (
          <li className="raccourcis__ligne" key={entree.action}>
            <span className="raccourcis__corps">
              <span className="raccourcis__libelle">{entree.libelle}</span>
              {entree.detail ? (
                <span className="raccourcis__detail">{entree.detail}</span>
              ) : null}
            </span>

            <button
              type="button"
              className={
                'raccourcis__touche' + (ecoute === entree.action ? ' is-ecoute' : '')
              }
              onClick={() => {
                setRemplace(null);
                setEcoute(ecoute === entree.action ? null : entree.action);
              }}
            >
              {ecoute === entree.action ? 'Appuyez…' : ecrire(entree.combinaison)}
            </button>

            {entree.combinaison ? (
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                onClick={() => definir(entree.action, null)}
                title="Retirer ce raccourci"
                aria-label={`Retirer le raccourci de « ${entree.libelle} »`}
              >
                <Icon name="x" size={14} />
              </button>
            ) : (
              // La place est tenue : sans elle, les lignes sans raccourci
              // decalent leur bouton et la colonne cesse d'etre une colonne.
              <span className="raccourcis__vide" aria-hidden="true" />
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="btn btn--sm"
        onClick={() => {
          reinitialiser();
          setRemplace(null);
        }}
      >
        <Icon name="refresh" size={14} />
        Revenir aux raccourcis par defaut
      </button>
    </section>
  );
}
