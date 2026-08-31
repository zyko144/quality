import { useEffect, useState } from 'react';
import { useSuggestions, SUGGESTION_MIN, SUGGESTION_MAX } from '@/store/suggestions';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { useUI } from '@/store/ui';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { formatRelative } from '@/lib/time';

/**
 * Ce qui manque a Quality, dit par ceux qui s'en servent.
 *
 * Une idee lancee dans un salon se perd : celui qui la lit deux jours plus tard
 * ne sait ni si elle a deja ete proposee, ni si quelqu'un d'autre la voulait.
 * Ici elle reste, et le vote dit combien de personnes la partagent.
 *
 * Le vote est binaire, pour ou contre. Une echelle a un seul sens — des
 * « j'aime » — ne dirait que la moitie de ce qu'on veut savoir : une idee peut
 * deranger autant qu'elle plait, et c'est utile de le voir.
 *
 * On propose par la commande `/suggestion`, dans n'importe quel salon. C'est
 * une contrainte assumee : ecrire une commande demande d'avoir voulu proposer,
 * la ou un champ toujours ouvert recueille surtout des essais.
 */
export function Suggestions() {
  const liste = useSuggestions((state) => state.liste);
  const chargement = useSuggestions((state) => state.chargement);
  const erreur = useSuggestions((state) => state.erreur);
  const charger = useSuggestions((state) => state.charger);
  const voter = useSuggestions((state) => state.voter);
  const retirer = useSuggestions((state) => state.retirer);

  const profiles = useChat((state) => state.profiles);
  const moi = useSession((state) => state.profile);
  const openModal = useUI((state) => state.openModal);

  const [aRetirer, setARetirer] = useState<string | null>(null);

  useEffect(() => {
    void charger();
  }, [charger]);

  return (
    <div className="suggestions">
      <header className="suggestions__entete">
        <h1 className="suggestions__titre">
          <span className="suggestions__marque" aria-hidden="true">
            <Icon name="sparkles" size={18} />
          </span>
          Suggestions
        </h1>

        <p className="suggestions__accroche">
          Ce qui manque a Echow, propose par ceux qui s&rsquo;en servent. Les
          plus soutenues remontent.
        </p>

        {/*
          La commande est rappelee, avec sa forme exacte.
          Une fonctionnalite qui ne s'atteint que par une commande n'existe que
          pour qui connait la commande.
        */}
        <p className="suggestions__commande">
          Pour proposer, ecrivez <code>/suggestion</code> suivi de votre idee,
          dans n&rsquo;importe quel salon.
        </p>
      </header>

      {erreur ? (
        <p className="suggestions__erreur" role="alert">
          {erreur}
        </p>
      ) : null}

      {chargement && liste.length === 0 ? (
        <p className="suggestions__vide">
          <span className="spinner" />
          Chargement…
        </p>
      ) : liste.length === 0 ? (
        <div className="suggestions__vide">
          <p>Aucune suggestion pour l&rsquo;instant.</p>
          <p className="suggestions__vide-note">
            La premiere sera la votre : <code>/suggestion</code> suivi de ce qui
            vous manque.
          </p>
        </div>
      ) : (
        <ul className="suggestions__liste">
          {liste.map((entree) => {
            const auteur = profiles[entree.author_id];
            const mienne = entree.author_id === moi?.id;
            const score = entree.pour - entree.contre;

            return (
              <li className="suggestion" key={entree.id}>
                {/*
                  Le score au-dessus des deux boutons : c'est lui qu'on lit en
                  parcourant, les boutons ne servent qu'a celui qui s'arrete.
                */}
                <div className="suggestion__votes">
                  <button
                    type="button"
                    className={
                      'suggestion__vote suggestion__vote--pour' +
                      (entree.mon_vote === true ? ' is-choisi' : '')
                    }
                    onClick={() => void voter(entree.id, true)}
                    aria-pressed={entree.mon_vote === true}
                    title={entree.mon_vote === true ? 'Retirer mon soutien' : 'Je suis pour'}
                  >
                    <Icon name="check" size={16} />
                  </button>

                  <span
                    className={
                      'suggestion__score' +
                      (score > 0 ? ' is-positif' : score < 0 ? ' is-negatif' : '')
                    }
                  >
                    {score > 0 ? `+${score}` : score}
                  </span>

                  <button
                    type="button"
                    className={
                      'suggestion__vote suggestion__vote--contre' +
                      (entree.mon_vote === false ? ' is-choisi' : '')
                    }
                    onClick={() => void voter(entree.id, false)}
                    aria-pressed={entree.mon_vote === false}
                    title={entree.mon_vote === false ? 'Retirer mon opposition' : 'Je suis contre'}
                  >
                    <Icon name="x" size={16} />
                  </button>
                </div>

                <div className="suggestion__corps">
                  <p className="suggestion__contenu">{entree.contenu}</p>

                  <p className="suggestion__meta">
                    <button
                      type="button"
                      className="suggestion__auteur"
                      onClick={() => openModal({ kind: 'profile', userId: entree.author_id })}
                    >
                      <Avatar profile={auteur} size={18} />
                      {auteur?.display_name ?? 'Quelqu’un'}
                    </button>
                    <span aria-hidden="true">·</span>
                    <span>{formatRelative(entree.created_at)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {entree.pour} pour, {entree.contre} contre
                    </span>
                  </p>
                </div>

                {mienne ? (
                  aRetirer === entree.id ? (
                    <span className="suggestion__confirme">
                      <button
                        type="button"
                        className="btn btn--sm btn--danger"
                        onClick={() => {
                          setARetirer(null);
                          void retirer(entree.id);
                        }}
                      >
                        Retirer
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => setARetirer(null)}
                      >
                        Annuler
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn icon-btn--sm suggestion__retirer"
                      onClick={() => setARetirer(entree.id)}
                      title="Retirer ma suggestion"
                      aria-label="Retirer ma suggestion"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="suggestions__limites">
        Entre {SUGGESTION_MIN} et {SUGGESTION_MAX} caracteres. Une idee par
        suggestion : deux idees dans la meme ligne obligent a voter pour les
        deux ou aucune.
      </p>
    </div>
  );
}
