import { useEffect } from 'react';
import { Icon } from '@/components/Icon';
import { useBrouillon } from '@/store/brouillonReglages';
import { useDevices } from '@/store/devices';
import { useSession } from '@/store/session';
import { useRaccourcis } from '@/store/raccourcis';

/**
 * Le bandeau qui apparait des qu'un reglage a change.
 *
 * Les reglages s'appliquent sur-le-champ — voir `brouillonReglages.ts`, c'est
 * la seule facon de regler un micro en s'ecoutant. Ce bandeau ne retient donc
 * pas les changements : il dit qu'il y en a, et rend le retour possible.
 *
 * C'est le manque qu'il comble : rien n'indiquait qu'on avait touche a quelque
 * chose, et revenir en arriere demandait de se souvenir de ce qu'on avait
 * change — d'ou les « je n'ai rien change » quand quelque chose avait change.
 */
export function BarreEnregistrement() {
  const modifie = useBrouillon((etat) => etat.modifie);
  const insistance = useBrouillon((etat) => etat.insistance);
  const enregistrer = useBrouillon((etat) => etat.enregistrer);
  const annuler = useBrouillon((etat) => etat.annuler);

  /*
   * On surveille les trois magasins qui portent des reglages.
   *
   * Les abonnements sont poses une fois pour toutes et rendent la comparaison
   * au magasin de brouillon : aucun panneau de reglages n'a donc a se declarer,
   * et une section ajoutee plus tard est couverte du seul fait qu'elle ecrit
   * dans l'un de ces trois magasins.
   */
  useEffect(() => {
    const verifier = () => useBrouillon.getState().verifier();

    const arrets = [
      useDevices.subscribe(verifier),
      useSession.subscribe(verifier),
      useRaccourcis.subscribe(verifier),
    ];

    return () => {
      for (const arret of arrets) arret();
    };
  }, []);

  if (!modifie) return null;

  return (
    <div
      className="reglages-barre"
      role="status"
      /*
       * La cle change a chaque appel d'attention.
       *
       * React remonte alors l'element, ce qui rejoue l'animation. Sans cela,
       * une seconde tentative de fermeture ne produirait rien de visible — et
       * l'on croirait que le bouton de fermeture est casse.
       */
      key={insistance}
    >
      <span className="reglages-barre__icone" aria-hidden="true">
        <Icon name="alert-triangle" size={16} />
      </span>

      <span className="reglages-barre__texte">
        Vous avez des modifications non enregistrees.
      </span>

      <button type="button" className="btn btn--sm" onClick={annuler}>
        Tout annuler
      </button>

      <button type="button" className="btn btn--sm btn--primary" onClick={enregistrer}>
        <Icon name="check" size={14} />
        Enregistrer
      </button>
    </div>
  );
}
