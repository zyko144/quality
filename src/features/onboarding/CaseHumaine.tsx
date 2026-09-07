import { useRef, useState } from 'react';
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
 * La case est ce qu'on voit ; ce qu'on mesure est le GESTE. Deux conditions :
 *
 *  - l'evenement doit etre `isTrusted` — un `click()` appele par un script ne
 *    l'est pas, le navigateur le marque lui-meme ;
 *  - il doit s'ecouler un instant depuis l'affichage : un script coche des
 *    qu'il trouve la case, une personne la lit d'abord.
 *
 * Une troisieme condition existait, et elle CASSAIT tout : il fallait qu'un
 * mouvement de pointeur, une touche ou un contact ait ete observe depuis
 * l'affichage. Or une fenetre qui parait sous le curseur se coche sans que
 * rien ne bouge — on clique la ou l'on etait deja. La case refusait alors en
 * silence, indefiniment, et rien ne disait pourquoi.
 *
 * Le clic EST le geste. Un evenement de confiance porte deja tout ce que le
 * mouvement aurait apporte, et davantage. La condition est donc retiree.
 *
 * Un refus se voit
 * ----------------
 * Il ne se voyait pas, et c'est ce qui a rendu le defaut si desagreable : la
 * case se decochait toute seule, sans un mot. On ne dit pas POURQUOI — ce
 * serait donner la marche a suivre a ce qu'on ecarte — mais on dit qu'il faut
 * recommencer, ce qu'une personne fait alors avec succes.
 *
 * Cela n'arrete pas quelqu'un qui ecrit un script POUR ce site : rien de ce
 * qui vit dans le navigateur ne le fera, et le pretendre serait pire que de ne
 * rien poser. Cela arrete les robots generiques, qui sont l'immense majorite,
 * et cela ne coute rien a une personne.
 */

/** Temps minimal entre l'affichage et le clic. Un script n'attend pas. */
export const REFLEXION_MS = 400;

/**
 * La coche est-elle acceptee ?
 *
 * Sortie du composant pour etre eprouvee : la condition qui cassait tout — il
 * fallait un mouvement de pointeur PREALABLE — ne se voyait pas a la lecture,
 * et ne se voyait pas non plus a l'usage de qui l'ecrit. Il faut que la
 * fenetre paraisse pile sous le curseur, ce qui arrive tout le temps a l'usage
 * et jamais quand on teste a la main.
 */
export function accepteLaCoche(deConfiance: boolean, msDepuisAffichage: number): boolean {
  return deConfiance && msDepuisAffichage >= REFLEXION_MS;
}

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
  const [refuse, setRefuse] = useState(false);

  const accepte = (deConfiance: boolean) =>
    accepteLaCoche(deConfiance, Date.now() - depuis.current);

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

          if (!accepte(evenement.nativeEvent.isTrusted)) {
            /*
             * On ne dit pas pourquoi, mais on dit que ca n'a pas pris.
             *
             * Expliquer donnerait la marche a suivre a ce qu'on ecarte. Se
             * taire, en revanche, laisse quelqu'un cliquer dix fois sur une
             * case qui se decoche toute seule — et c'est exactement ce qui a
             * ete rapporte.
             */
            setRefuse(true);
            onChange(false);
            return;
          }

          setRefuse(false);
          onChange(true);
        }}
      />

      <span className="casehumaine__case" aria-hidden="true">
        {coche ? <Icon name="check" size={14} /> : null}
      </span>

      <span className="casehumaine__texte">
        {libelle}
        {refuse ? <span className="casehumaine__refus">Reessayez.</span> : null}
      </span>
    </label>
  );
}
