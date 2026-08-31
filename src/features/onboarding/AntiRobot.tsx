import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';

/**
 * Une question simple, avant de creer un compte ou de changer de mot de passe.
 *
 * Ce qu'elle fait, et ce qu'elle ne fait pas
 * -------------------------------------------
 * Elle est verifiee dans le navigateur. Elle arrete donc les robots qui
 * remplissent des formulaires sans les lire — l'immense majorite — et n'arrete
 * pas quelqu'un qui ecrit un script pour ce site precis : il lui suffit de
 * calculer la meme somme.
 *
 * Le dire franchement importe. Une protection dont on surestime la portee est
 * plus dangereuse que pas de protection du tout, parce qu'on cesse de chercher
 * la vraie. La vraie, ici, serait une verification cote serveur — un jeton
 * signe, delivre apres une epreuve que le client ne peut pas resoudre seul.
 * C'est un chantier a part, et Supabase propose deja une limitation de debit
 * sur l'inscription qui couvre l'essentiel du reste.
 *
 * Pourquoi un calcul plutot qu'une case
 * --------------------------------------
 * Une case a cocher est cochee par n'importe quel script en une ligne. Un
 * calcul demande de lire l'enonce et de repondre dans un champ, ce qui suffit a
 * ecarter les robots generiques. On reste sur des sommes et des suites qu'on
 * resout de tete : l'epreuve doit ecarter des programmes, pas des gens presses.
 */

interface Epreuve {
  enonce: string;
  reponse: number;
}

/** Un entier entre `min` et `max`, bornes comprises. */
function entier(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Fabrique une epreuve.
 *
 * Trois formes, pour qu'un script qui reconnaitrait un enonce fixe ne suffise
 * pas. Toutes se resolvent de tete : au-dela, on ecarterait des gens, ce qui
 * est exactement l'inverse du but.
 */
function fabriquer(): Epreuve {
  const forme = entier(1, 3);

  if (forme === 1) {
    const a = entier(3, 19);
    const b = entier(2, 9);
    return { enonce: `${a} + ${b}`, reponse: a + b };
  }

  if (forme === 2) {
    // Soustraction toujours positive : un resultat negatif ferait hesiter sur
    // la facon de l'ecrire, et l'hesitation n'est pas ce qu'on mesure.
    const a = entier(11, 29);
    const b = entier(2, 9);
    return { enonce: `${a} − ${b}`, reponse: a - b };
  }

  // Une suite arithmetique : le pas se voit, et la reponse se deduit.
  const depart = entier(2, 9);
  const pas = entier(2, 6);
  const suite = [depart, depart + pas, depart + 2 * pas, depart + 3 * pas];
  return {
    enonce: `${suite.join(', ')}, puis ?`,
    reponse: depart + 4 * pas,
  };
}

export function AntiRobot({
  onChange,
}: {
  /** Appele a chaque frappe avec la validite de la reponse. */
  onChange: (valide: boolean) => void;
}) {
  const [epreuve, setEpreuve] = useState<Epreuve>(() => fabriquer());
  const [saisie, setSaisie] = useState('');

  const valide = useMemo(
    () => saisie.trim() !== '' && Number(saisie.trim()) === epreuve.reponse,
    [saisie, epreuve],
  );

  const changer = (valeur: string) => {
    setSaisie(valeur);
    onChange(valeur.trim() !== '' && Number(valeur.trim()) === epreuve.reponse);
  };

  return (
    <div className="antirobot">
      <label className="field__label" htmlFor="antirobot">
        Verification — combien font <strong>{epreuve.enonce}</strong> ?
      </label>

      <div className="antirobot__ligne">
        <input
          id="antirobot"
          className="input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={saisie}
          onChange={(event) => changer(event.target.value)}
          placeholder="Votre reponse"
          aria-describedby="antirobot-aide"
        />

        {/* Changer d'enonce plutot que de rester bloque sur celui qu'on n'a pas
            compris : l'epreuve ecarte des programmes, pas des gens. */}
        <button
          type="button"
          className="icon-btn"
          title="Une autre question"
          aria-label="Une autre question"
          onClick={() => {
            setEpreuve(fabriquer());
            changer('');
          }}
        >
          <Icon name="refresh" size={15} />
        </button>

        {valide ? (
          <span className="antirobot__ok" aria-hidden="true">
            <Icon name="check" size={16} />
          </span>
        ) : null}
      </div>

      <p className="field__hint" id="antirobot-aide">
        Une question de tete, pour ecarter les inscriptions automatiques.
      </p>
    </div>
  );
}
