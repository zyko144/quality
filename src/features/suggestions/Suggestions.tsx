import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useSuggestions,
  COMMANDE,
  SUGGESTION_MIN,
  SUGGESTION_MAX,
} from '@/store/suggestions';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { useUI } from '@/store/ui';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { formatRelative } from '@/lib/time';
import { RetourMobile } from '@/components/RetourMobile';

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
 * On propose ici, et nulle part ailleurs.
 *
 * La commande `/suggestion` repondait depuis n'importe quel salon. L'idee etait
 * qu'ecrire une commande demande d'avoir voulu proposer — mais elle partait
 * alors d'une conversation ou plus personne ne la reverrait, vers une page que
 * son auteur decouvrait au moment de l'envoi. On proposait sans voir ou l'on
 * posait, ni ce qui avait deja ete propose.
 *
 * Cet espace est donc devenu un salon : la liste au-dessus, le champ en bas,
 * comme partout ailleurs. On lit avant d'ecrire, ce qui est la seule facon
 * d'eviter les doublons — et la commande ne repond plus qu'ici, ou elle n'est
 * d'ailleurs plus necessaire.
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

  const proposer = useSuggestions((state) => state.proposer);

  const [aRetirer, setARetirer] = useState<string | null>(null);
  const [texte, setTexte] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [avis, setAvis] = useState<string | null>(null);

  const champRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void charger();
  }, [charger]);

  /*
   * Le champ grandit avec le texte.
   *
   * Une suggestion tient en six cents caracteres : sur une seule ligne, on
   * relirait la sienne par la fenetre d'un mot. La hauteur reste bornee, sans
   * quoi le champ finirait par manger la liste qu'il sert a alimenter.
   */
  const redimensionner = useCallback(() => {
    const champ = champRef.current;
    if (!champ) return;

    champ.style.height = 'auto';
    champ.style.height = `${Math.min(champ.scrollHeight, 180)}px`;
  }, []);

  useEffect(redimensionner, [texte, redimensionner]);

  const envoyer = useCallback(async () => {
    if (envoi) return;

    /*
     * Un `/suggestion` en tete est retire, pas refuse.
     *
     * La commande a longtemps ete la seule porte d'entree, et elle reste dans
     * les doigts de ceux qui s'en servaient. Ici elle ne veut plus rien dire —
     * on est deja dans l'espace des suggestions — mais la refuser punirait une
     * habitude que nous avions nous-memes installee.
     */
    const idee = texte.trim().replace(COMMANDE, '').trim();

    if (idee.length < SUGGESTION_MIN) {
      setAvis(`Une suggestion tient en ${SUGGESTION_MIN} caracteres au moins.`);
      return;
    }

    if (idee.length > SUGGESTION_MAX) {
      setAvis(`Une suggestion tient en ${SUGGESTION_MAX} caracteres.`);
      return;
    }

    setEnvoi(true);
    const pose = await proposer(idee);
    setEnvoi(false);

    if (!pose) {
      setAvis('La suggestion n’a pas pu etre enregistree.');
      return;
    }

    setTexte('');
    setAvis(null);
    champRef.current?.focus();
  }, [envoi, texte, proposer]);

  return (
    <div className="suggestions">
      <div className="suggestions__fil scroll">
      <header className="suggestions__entete" data-tauri-drag-region>
        <RetourMobile label="Revenir aux conversations" />
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
          Le champ est en bas de la page : on le dit, parce qu'une liste longue
          le pousse hors de vue, et qu'on ne cherche pas ce qu'on ignore.
        */}
        <p className="suggestions__commande">
          Pour proposer, ecrivez votre idee dans le champ en bas de cette page.
          C&rsquo;est le seul endroit d&rsquo;ou l&rsquo;on propose.
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
            La premiere sera la votre : ecrivez ce qui vous manque, en bas.
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

      {/*
        Le champ est hors de la zone qui defile.
        Dans le flux, il descendrait avec la liste, et il faudrait derouler
        cinquante suggestions pour proposer la cinquante-et-unieme.
      */}
      <div className="suggestions__composeur">
        <div className="suggestions__champ">
          <textarea
            ref={champRef}
            className="suggestions__saisie"
            rows={1}
            value={texte}
            maxLength={SUGGESTION_MAX}
            placeholder="Proposez une idee"
            aria-label="Proposer une suggestion"
            disabled={envoi}
            onChange={(event) => {
              setTexte(event.target.value);
              if (avis) setAvis(null);
            }}
            onKeyDown={(event) => {
              // Entree envoie, Maj+Entree passe a la ligne : c'est ce que fait
              // le composeur des salons, et deux conventions dans la meme
              // application vaudraient pire qu'une mauvaise.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void envoyer();
              }
            }}
          />

          <button
            type="button"
            className="suggestions__envoyer"
            onClick={() => void envoyer()}
            disabled={envoi || texte.trim().length === 0}
            title="Proposer"
            aria-label="Proposer"
          >
            {envoi ? <span className="spinner" /> : <Icon name="send" size={17} />}
          </button>
        </div>

        <p className={'suggestions__avis' + (avis ? ' is-alerte' : '')} role="status">
          {avis ??
            `${texte.trim().length} / ${SUGGESTION_MAX} caracteres. Entree envoie, Maj+Entree passe a la ligne.`}
        </p>
      </div>
    </div>
  );
}
