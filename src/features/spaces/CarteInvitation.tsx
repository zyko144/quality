import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Icon } from '@/components/Icon';
import { CaseHumaine } from '@/features/onboarding/CaseHumaine';

/**
 * Ce qu'on voit d'un serveur avant d'y entrer.
 *
 * Un lien d'invitation s'envoie presque toujours DANS Echow. Ce qu'on voyait
 * alors etait une adresse nue : un nom de domaine et douze caracteres au
 * hasard. Rien ne disait de quel serveur il s'agissait — ni son nom, ni son
 * image, ni combien de gens s'y trouvaient — et l'on cliquait, ou non, sans
 * savoir.
 *
 * La carte sert aux DEUX bouts du lien : sous un message, et a l'arrivee quand
 * on vient d'en ouvrir un. Le meme composant, parce que c'est la meme question
 * — « est-ce que j'entre ici ? » — et qu'y repondre deux fois de deux facons
 * differentes serait deroutant.
 *
 * L'apercu vient d'une fonction dediee, `apercu_invitation`, et non d'une
 * lecture de la table : les espaces ne sont lisibles que de leurs membres, et
 * celui a qui l'on envoie une invitation ne l'est pas encore. Voir la
 * migration, qui dit ce que la fonction rend et ce qu'elle ne rend pas.
 */

interface Apercu {
  nom: string;
  icone_url: string | null;
  banniere_url: string | null;
  membres: number;
  expire: boolean;
}

type Etat =
  | { phase: 'chargement' }
  | { phase: 'introuvable' }
  | { phase: 'pret'; apercu: Apercu };

export function CarteInvitation({
  code,
  onRejoindre,
  /** Vrai quand on est deja dans cet espace : la carte le dit au lieu d'inviter. */
  dejaMembre = false,
}: {
  code: string;
  onRejoindre?: (code: string) => void | Promise<void>;
  dejaMembre?: boolean;
}) {
  const [etat, setEtat] = useState<Etat>({ phase: 'chargement' });
  const [humain, setHumain] = useState(false);

  /** Vrai une fois « Rejoindre » clique : c'est la que la porte parait. */
  const [verification, setVerification] = useState(false);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    let annule = false;
    setEtat({ phase: 'chargement' });

    void (async () => {
      const { data, error } = await supabase.rpc('apercu_invitation', { p_code: code });
      if (annule) return;

      const ligne = (data as Apercu[] | null)?.[0];

      /*
       * Une erreur et une absence donnent la meme carte.
       *
       * La fonction peut ne pas exister — base pas encore migree — ou le code
       * ne mener nulle part. Dans les deux cas, il n'y a rien a montrer, et
       * distinguer les deux devant quelqu'un qui a juste recu un lien ne lui
       * apprendrait rien d'utile.
       */
      setEtat(error || !ligne ? { phase: 'introuvable' } : { phase: 'pret', apercu: ligne });
    })();

    return () => {
      annule = true;
    };
  }, [code]);

  if (etat.phase === 'chargement') {
    return (
      <div className="invitation invitation--attente">
        <span className="skeleton invitation__squelette" />
      </div>
    );
  }

  if (etat.phase === 'introuvable') {
    return (
      <div className="invitation invitation--morte">
        <Icon name="alert-triangle" size={16} />
        <span>Cette invitation ne mene nulle part. Demandez-en une autre.</span>
      </div>
    );
  }

  const { apercu } = etat;

  return (
    <div className="invitation">
      {/*
        La banniere, quand il y en a une.

        Elle n'est pas indispensable : un serveur sans banniere garde une carte
        entiere, avec son icone et son nom. Reserver la place ferait un vide en
        haut de la carte, qu'on prendrait pour une image qui n'a pas charge.
      */}
      {apercu.banniere_url ? (
        <img className="invitation__banniere" src={apercu.banniere_url} alt="" loading="lazy" />
      ) : null}

      <div className="invitation__corps">
        <span className="invitation__icone" aria-hidden="true">
          {apercu.icone_url ? (
            <img src={apercu.icone_url} alt="" loading="lazy" />
          ) : (
            <span className="invitation__initiale">{apercu.nom.slice(0, 1).toUpperCase()}</span>
          )}
        </span>

        <span className="invitation__texte">
          <span className="invitation__sur">Invitation a rejoindre</span>
          <strong className="invitation__nom truncate">{apercu.nom}</strong>
          <span className="invitation__membres">
            {apercu.membres} membre{apercu.membres > 1 ? 's' : ''}
          </span>
        </span>
      </div>

      {apercu.expire ? (
        <p className="invitation__note">Ce lien a expire. Demandez-en un nouveau.</p>
      ) : dejaMembre ? (
        <p className="invitation__note">Vous etes deja dans ce serveur.</p>
      ) : onRejoindre ? (
        /*
          Deux temps : on demande a entrer, puis on prouve qu'on est la.
          
          La case vivait a cote du bouton, qui restait inerte tant qu'elle
          n'etait pas cochee. C'etait l'ordre inverse de celui qu'on a en tete :
          on veut d'abord DECIDER d'entrer, et la verification vient ensuite,
          comme une porte qu'on pousse — pas comme une condition a remplir avant
          d'avoir dit ce qu'on voulait.
          
          Elle avait aussi un defaut pratique : un bouton grise sans qu'on
          comprenne pourquoi. La case etait a cote, mais rien ne la reliait au
          bouton.
        */
        <div className="invitation__entree">
          {verification ? (
            <>
              <CaseHumaine
                coche={humain}
                onChange={(coche) => {
                  setHumain(coche);

                  /*
                   * Cocher suffit : on entre.
                   *
                   * Un second bouton apres la case ferait deux gestes pour une
                   * seule decision, celle-ci ayant deja ete prise en cliquant
                   * « Rejoindre ». La case n'est pas un choix, c'est une porte.
                   */
                  if (!coche || enCours) return;

                  setEnCours(true);
                  void Promise.resolve(onRejoindre(code)).finally(() => setEnCours(false));
                }}
              />

              {enCours ? <span className="spinner" /> : null}
            </>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setVerification(true)}
            >
              <Icon name="plus" size={14} />
              Rejoindre
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
