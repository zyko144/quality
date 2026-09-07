import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';

/**
 * Une case a cocher avant d'entrer quelque part.
 *
 * Ce qu'elle vaut, dit franchement
 * ---------------------------------
 * Une case a cocher est cochee par un script en une ligne. C'est la raison
 * pour laquelle `AntiRobot` — celle de l'inscription — pose un calcul plutot
 * qu'une case, et ce raisonnement reste juste.
 *
 * Une case a donc ete demandee en connaissance de cause, et elle a de bonnes
 * raisons d'exister ici : rejoindre un serveur n'est pas creer un compte. Le
 * compte a deja passe l'epreuve, la limitation de debit de Supabase couvre le
 * reste, et l'on ne veut pas poser une addition entre quelqu'un et le serveur
 * ou ses amis l'attendent.
 *
 * Ce qui est verifie n'est pas la case
 * -------------------------------------
 * La case est ce qu'on voit ; ce qu'on mesure est le GESTE. Trois conditions,
 * et aucune n'est devinable en lisant la page :
 *
 *  - l'evenement doit etre `isTrusted` — un `click()` appele par un script ne
 *    l'est pas, le navigateur le marque lui-meme ;
 *  - il doit s'ecouler un instant depuis l'affichage : un script coche des
 *    qu'il trouve la case, une personne la lit d'abord ;
 *  - le pointeur doit avoir bouge, ou une touche avoir ete pressee.
 *
 * Cela n'arrete pas quelqu'un qui ecrit un script POUR ce site — rien de ce
 * qui vit dans le navigateur ne le fera, et le pretendre serait pire que de ne
 * rien poser. Cela arrete les robots generiques, qui sont l'immense majorite,
 * et cela ne coute rien a une personne : elle coche, et c'est tout.
 */

/** Temps minimal entre l'affichage et le clic. Un script n'attend pas. */
const REFLEXION_MS = 400;

export function CaseHumaine({
  coche,
  onChange,
  libelle = 'Je ne suis pas un robot',
}: {
  coche: boolean;
  onChange: (valeur: boolean) => void;
  libelle?: string;
}) {
  const depuis = useRef(Date.now());
  const [geste, setGeste] = useState(false);

  /*
   * Un mouvement, une touche, un contact : n'importe lequel suffit.
   *
   * Trois sortes d'evenements plutot qu'une, parce qu'on ne se sert pas tous
   * d'une souris. Exiger un deplacement de pointeur ecarterait le clavier et
   * l'ecran tactile, c'est-a-dire des gens, pas des robots.
   */
  useEffect(() => {
    const noter = () => setGeste(true);

    window.addEventListener('pointermove', noter, { once: true, passive: true });
    window.addEventListener('keydown', noter, { once: true });
    window.addEventListener('touchstart', noter, { once: true, passive: true });

    return () => {
      window.removeEventListener('pointermove', noter);
      window.removeEventListener('keydown', noter);
      window.removeEventListener('touchstart', noter);
    };
  }, []);

  const pret = geste && Date.now() - depuis.current >= REFLEXION_MS;

  return (
    <label className={'casehumaine' + (coche ? ' is-cochee' : '')}>
      <input
        type="checkbox"
        className="visually-hidden"
        checked={coche}
        onChange={(evenement) => {
          // Decocher est toujours permis : on ne piege personne dans un etat.
          if (!evenement.target.checked) {
            onChange(false);
            return;
          }

          if (!evenement.nativeEvent.isTrusted || !pret) {
            // On ne dit pas pourquoi. L'expliquer donnerait la marche a suivre
            // a ce qu'on ecarte, et une personne, elle, reussit du premier coup.
            onChange(false);
            return;
          }

          onChange(true);
        }}
      />

      <span className="casehumaine__case" aria-hidden="true">
        {coche ? <Icon name="check" size={14} /> : null}
      </span>

      <span className="casehumaine__texte">{libelle}</span>
    </label>
  );
}
