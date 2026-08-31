import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/store/session';
import { Icon } from '@/components/Icon';
import { QualityLogo } from '@/components/QualityLogo';

/**
 * Les regles, avant d'entrer.
 *
 * Elles ne sont pas un obstacle pose par principe : ce sont les seules choses
 * qu'on ne peut pas decouvrir en se servant de l'application, et les seules
 * dont l'ignorance se paie sur les autres.
 *
 * Le bouton n'apparait qu'une fois le texte parcouru jusqu'en bas. C'est une
 * exigence modeste et il faut etre honnete sur ce qu'elle vaut : elle ne
 * garantit pas la lecture, seulement le defilement. Ce qu'elle empeche, c'est
 * d'accepter sans avoir vu qu'il y avait quelque chose a lire — et c'est deja
 * la difference entre une case cochee par reflexe et un texte qu'on a eu sous
 * les yeux.
 *
 * Le texte reste court pour cette raison. Des pages de clauses garantiraient
 * que personne ne les lit, et rendraient l'exigence purement decorative.
 */

/**
 * Version des conditions.
 *
 * A incrementer quand le fond change, pas la ponctuation : chacun revoit alors
 * l'ecran une fois. Sans ce numero, il faudrait choisir entre redemander a
 * tout le monde a chaque correction, ou faire valoir une acceptation ancienne
 * pour un texte reecrit depuis.
 */
export const CONDITIONS_VERSION = 1;

interface Regle {
  titre: string;
  corps: string;
}

const REGLES: Regle[] = [
  {
    titre: 'Ce qui n’a pas sa place ici',
    corps:
      'Le harcelement, les menaces, les propos haineux visant une personne ou un groupe, les contenus sexuels impliquant des mineurs, l’incitation a la violence et le partage de donnees personnelles d’autrui sans son accord. Ces contenus sont retires et les comptes concernes fermes, sans avertissement prealable.',
  },
  {
    titre: 'Vous etes responsable de ce que vous publiez',
    corps:
      'Messages, images, fichiers, nom affiche, photo de profil : tout ce que vous envoyez vous engage. Ne publiez pas ce qui ne vous appartient pas, et ne confiez pas a un salon ce que vous ne confieriez pas a un hebergeur — les messages ecrits sont stockes de facon lisible par le service, c’est ce qui permet de les retrouver et de les rechercher.',
  },
  {
    titre: 'La voix et l’image vont directement d’une machine a l’autre',
    corps:
      'Les salons vocaux fonctionnent en pair-a-pair : nos serveurs ne voient jamais l’audio ni la video. La contrepartie est qu’une liaison directe suppose que les machines connaissent leurs adresses, et votre adresse IP peut donc etre visible des autres participants d’un salon vocal.',
  },
  {
    titre: 'Age minimum',
    corps:
      'Il faut avoir au moins 15 ans pour ouvrir un compte. En dessous, le consentement au traitement de vos donnees ne peut pas etre valablement donne seul.',
  },
  {
    titre: 'Moderation',
    corps:
      'Les proprietaires et administrateurs d’un espace peuvent y exclure, bannir ou reduire au silence. Ces decisions leur appartiennent : nous n’arbitrons pas les differends internes a un serveur, sauf lorsqu’un contenu enfreint les regles ci-dessus.',
  },
  {
    titre: 'Le service est fourni tel quel',
    corps:
      'Echow est en developpement. Des interruptions, des pertes de messages et des defauts sont possibles. N’en faites pas le seul depot de ce que vous ne pouvez pas perdre.',
  },
  {
    titre: 'Vos donnees',
    corps:
      'Compte, profil, messages et presence sont conserves pour faire fonctionner le service. Vous pouvez demander leur suppression depuis les reglages, ce qui efface le compte et les messages associes. Les conditions completes et la politique de confidentialite sont consultables sur le site.',
  },
];

export function Conditions() {
  const profile = useSession((state) => state.profile);
  const setProfile = useSession((state) => state.setProfile);

  const [enBas, setEnBas] = useState(false);
  const [accepte, setAccepte] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const zone = useRef<HTMLDivElement>(null);

  /*
   * Le fond est-il atteint ?
   *
   * La marge de quatre pixels evite qu'un arrondi de rendu — courant a certains
   * niveaux de zoom — rende le bas inatteignable. Sans elle, on defile jusqu'au
   * bout et le bouton reste refuse, sans rien pour dire pourquoi.
   */
  useEffect(() => {
    const noeud = zone.current;
    if (!noeud) return;

    const verifier = () => {
      const reste = noeud.scrollHeight - noeud.scrollTop - noeud.clientHeight;
      if (reste <= 4) setEnBas(true);
    };

    verifier();
    noeud.addEventListener('scroll', verifier);
    return () => noeud.removeEventListener('scroll', verifier);
  }, []);

  const valider = async () => {
    if (!accepte || envoi) return;

    setEnvoi(true);
    setErreur(null);

    const { error } = await supabase.rpc('accepter_conditions', {
      p_version: CONDITIONS_VERSION,
    });

    if (error) {
      setEnvoi(false);
      setErreur(
        'Impossible d’enregistrer votre acceptation. Verifiez votre connexion et reessayez.',
      );
      return;
    }

    // L'etat local suit, sans recharger : le profil complet reviendra a la
    // prochaine synchronisation.
    if (profile) {
      setProfile({
        ...profile,
        terms_accepted_at: new Date().toISOString(),
        terms_version: CONDITIONS_VERSION,
      });
    }
  };

  return (
    <div className="conditions" role="dialog" aria-modal="true" aria-label="Regles d’Echow">
      <div className="conditions__boite">
        <header className="conditions__entete">
          <span className="conditions__logo" aria-hidden="true">
            <QualityLogo size={40} />
          </span>
          <h1 className="conditions__titre">Avant d’entrer</h1>
          <p className="conditions__sous-titre">
            Sept points, deux minutes. Ce sont les seules choses qu’on ne peut
            pas decouvrir en se servant de l’application.
          </p>
        </header>

        <div className="conditions__texte" ref={zone} tabIndex={0}>
          {REGLES.map((regle, index) => (
            <section className="conditions__regle" key={regle.titre}>
              <h2>
                <span className="conditions__numero" aria-hidden="true">
                  {index + 1}
                </span>
                {regle.titre}
              </h2>
              <p>{regle.corps}</p>
            </section>
          ))}

          <p className="conditions__fin">
            Vous avez tout lu. Le bouton est maintenant actif.
          </p>
        </div>

        <footer className="conditions__pied">
          {!enBas ? (
            <p className="conditions__indice" role="status">
              <Icon name="chevron-down" size={14} />
              Faites defiler jusqu’en bas pour continuer
            </p>
          ) : (
            <label className="conditions__case">
              <input
                type="checkbox"
                checked={accepte}
                onChange={(event) => setAccepte(event.target.checked)}
              />
              <span>
                J’ai lu et j’accepte ces regles, les conditions d’utilisation et
                la politique de confidentialite.
              </span>
            </label>
          )}

          {erreur ? (
            <p className="conditions__erreur" role="alert">
              {erreur}
            </p>
          ) : null}

          <button
            type="button"
            className="btn btn--block conditions__bouton"
            disabled={!enBas || !accepte || envoi}
            onClick={() => void valider()}
          >
            {envoi ? <span className="spinner" /> : <Icon name="check" size={16} />}
            Accepter et continuer
          </button>
        </footer>
      </div>
    </div>
  );
}
