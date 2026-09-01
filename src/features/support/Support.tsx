import { useEffect, useMemo, useState } from 'react';
import {
  useSupport,
  CATEGORIES,
  LIBELLES_STATUT,
  SUJET_MIN,
  SUJET_MAX,
  MESSAGE_MIN,
  MESSAGE_MAX,
  REPONSE_MAX,
  type CategorieDemande,
} from '@/store/support';
import { Icon } from '@/components/Icon';
import { formatRelative } from '@/lib/time';

/**
 * Demander de l'aide a l'equipe.
 *
 * Une page a part, et non une conversation privee avec un compte « support ».
 * Une demande d'aide a un sujet, un etat et une fin ; rangee parmi les
 * conversations, elle glisse vers le bas des qu'un ami ecrit, et l'on ne sait
 * plus laquelle attend encore une reponse.
 *
 * Ce qui est ecrit ici n'est lu que par son auteur et par l'equipe — c'est dit
 * sur la page, pas seulement applique dans les politiques RLS. Quelqu'un qui
 * signale un compte pirate ou conteste une sanction a besoin de le savoir
 * avant d'ecrire, pas apres.
 *
 * En rouge, la ou les suggestions sont en ambre : les deux pages s'adressent a
 * l'equipe, mais on n'y vient pas dans le meme etat d'esprit, et il ne faut pas
 * les confondre en parcourant la liste.
 */
export function Support() {
  const liste = useSupport((etat) => etat.liste);
  const ouverte = useSupport((etat) => etat.ouverte);
  const echanges = useSupport((etat) => etat.echanges);
  const chargement = useSupport((etat) => etat.chargement);
  const envoi = useSupport((etat) => etat.envoi);
  const erreur = useSupport((etat) => etat.erreur);

  const charger = useSupport((etat) => etat.charger);
  const deposer = useSupport((etat) => etat.deposer);
  const ouvrir = useSupport((etat) => etat.ouvrir);
  const fermer = useSupport((etat) => etat.fermer);
  const repondre = useSupport((etat) => etat.repondre);
  const resoudre = useSupport((etat) => etat.resoudre);
  const ecouter = useSupport((etat) => etat.ecouter);

  const [redaction, setRedaction] = useState(false);
  const [sujet, setSujet] = useState('');
  const [categorie, setCategorie] = useState<CategorieDemande>('technique');
  const [message, setMessage] = useState('');
  const [reponse, setReponse] = useState('');

  useEffect(() => {
    void charger();
  }, [charger]);

  // Le flux temps reel fait paraitre la reponse de l'equipe sans rien
  // rafraichir. Debranche a la sortie : une page fermee n'a pas a garder une
  // connexion ouverte.
  useEffect(() => ecouter(), [ecouter]);

  const demande = useMemo(
    () => liste.find((entree) => entree.id === ouverte) ?? null,
    [liste, ouverte],
  );

  const titre = sujet.trim();
  const corps = message.trim();
  const depotPossible =
    titre.length >= SUJET_MIN &&
    titre.length <= SUJET_MAX &&
    corps.length >= MESSAGE_MIN &&
    corps.length <= MESSAGE_MAX &&
    !envoi;

  async function envoyerDemande(): Promise<void> {
    if (!depotPossible) return;
    const pose = await deposer(titre, categorie, corps);
    if (!pose) return;

    setSujet('');
    setMessage('');
    setCategorie('technique');
    setRedaction(false);
  }

  async function envoyerReponse(): Promise<void> {
    if (!demande) return;
    const texte = reponse.trim();
    if (texte.length === 0 || texte.length > REPONSE_MAX || envoi) return;

    const envoye = await repondre(demande.id, texte);
    if (envoye) setReponse('');
  }

  return (
    <div className="support">
      <header className="support__entete" data-tauri-drag-region>
        <h1 className="support__titre">
          <span className="support__marque" aria-hidden="true">
            <Icon name="mail" size={18} />
          </span>
          Support
        </h1>

        <p className="support__accroche">
          Un probleme, une question, un signalement&nbsp;: ecrivez-le ici.
          L&rsquo;equipe repond dans la demande elle-meme, et vous verrez la
          reponse arriver sans rien rafraichir.
        </p>

        {/*
          Dit sur la page, et pas seulement applique en base.
          Quelqu'un qui hesite a decrire un incident a besoin de savoir qui le
          lira avant d'ecrire.
        */}
        <p className="support__confidentialite">
          <Icon name="shield" size={15} />
          Vos demandes ne sont visibles que de vous et de l&rsquo;equipe. Aucun
          autre membre d&rsquo;Echow ne peut les lire, pas meme les
          proprietaires des espaces que vous frequentez.
        </p>
      </header>

      {erreur ? (
        <p className="support__erreur" role="alert">
          {erreur}
        </p>
      ) : null}

      {demande ? (
        /* ------------------------------------------------------------------
           Une demande ouverte, avec tout l'echange
           ------------------------------------------------------------------ */
        <section className="support__detail" aria-label={`Demande : ${demande.sujet}`}>
          <button type="button" className="support__retour" onClick={fermer}>
            <Icon name="arrow-left" size={15} />
            Toutes mes demandes
          </button>

          <div className="support__fiche">
            <div className="support__fiche-tete">
              <h2 className="support__fiche-sujet">{demande.sujet}</h2>
              <span className={'support__statut is-' + demande.statut}>
                {LIBELLES_STATUT[demande.statut]}
              </span>
            </div>

            <p className="support__fiche-meta">
              <span>{libelleCategorie(demande.categorie)}</span>
              <span aria-hidden="true">·</span>
              <span>Ouverte {formatRelative(demande.created_at)}</span>
            </p>
          </div>

          <ol className="support__echange">
            <li className="support-message support-message--moi">
              <span className="support-message__qui">Vous</span>
              <p className="support-message__texte">{demande.message}</p>
              <span className="support-message__quand">
                {formatRelative(demande.created_at)}
              </span>
            </li>

            {(echanges[demande.id] ?? []).map((ligne) => (
              <li
                key={ligne.id}
                className={
                  'support-message' +
                  (ligne.de_l_equipe ? ' support-message--equipe' : ' support-message--moi')
                }
              >
                <span className="support-message__qui">
                  {ligne.de_l_equipe ? 'Equipe Echow' : 'Vous'}
                </span>
                <p className="support-message__texte">{ligne.message}</p>
                <span className="support-message__quand">
                  {formatRelative(ligne.created_at)}
                </span>
              </li>
            ))}
          </ol>

          {demande.statut === 'resolue' ? (
            <p className="support__close">
              Cette demande est marquee comme resolue. Repondez pour la rouvrir.
            </p>
          ) : null}

          <div className="support__repondre">
            <label className="support__label" htmlFor="support-reponse">
              Repondre
            </label>
            <textarea
              id="support-reponse"
              className="support__zone"
              rows={4}
              maxLength={REPONSE_MAX}
              value={reponse}
              placeholder="Ajoutez une precision, ou repondez a l’equipe."
              onChange={(evenement) => setReponse(evenement.target.value)}
            />

            <div className="support__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={reponse.trim().length === 0 || envoi}
                onClick={() => void envoyerReponse()}
              >
                <Icon name="send" size={14} />
                Envoyer
              </button>

              {demande.statut === 'resolue' ? null : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void resoudre(demande.id)}
                >
                  <Icon name="check" size={14} />
                  Je n&rsquo;ai plus besoin d&rsquo;aide
                </button>
              )}
            </div>
          </div>
        </section>
      ) : (
        /* ------------------------------------------------------------------
           La liste, et le depot d'une nouvelle demande
           ------------------------------------------------------------------ */
        <>
          {redaction ? (
            <section className="support__formulaire" aria-label="Nouvelle demande">
              <label className="support__label" htmlFor="support-sujet">
                Sujet
              </label>
              <input
                id="support-sujet"
                className="support__champ"
                value={sujet}
                maxLength={SUJET_MAX}
                placeholder="En une ligne : ce qui ne va pas."
                onChange={(evenement) => setSujet(evenement.target.value)}
              />

              <label className="support__label" htmlFor="support-categorie">
                Categorie
              </label>
              <select
                id="support-categorie"
                className="support__champ"
                value={categorie}
                onChange={(evenement) =>
                  setCategorie(evenement.target.value as CategorieDemande)
                }
              >
                {CATEGORIES.map((entree) => (
                  <option key={entree.valeur} value={entree.valeur}>
                    {entree.libelle}
                  </option>
                ))}
              </select>
              <p className="support__aide">{aideCategorie(categorie)}</p>

              <label className="support__label" htmlFor="support-message">
                Ce qui s&rsquo;est passe
              </label>
              <textarea
                id="support-message"
                className="support__zone"
                rows={7}
                maxLength={MESSAGE_MAX}
                value={message}
                placeholder="Ce que vous faisiez, ce que vous attendiez, ce qui est arrive a la place."
                onChange={(evenement) => setMessage(evenement.target.value)}
              />

              {/*
                Le compte est affiche avant l'envoi, pas apres le refus : un
                message trop court renvoye par la base ferait retaper ce qui
                pouvait etre corrige sur place.
              */}
              <p className="support__compte">
                {corps.length} / {MESSAGE_MAX} caracteres, {MESSAGE_MIN} au
                minimum.
              </p>

              <div className="support__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!depotPossible}
                  onClick={() => void envoyerDemande()}
                >
                  <Icon name="send" size={14} />
                  Envoyer la demande
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setRedaction(false)}
                >
                  Annuler
                </button>
              </div>
            </section>
          ) : (
            <div className="support__barre">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setRedaction(true)}
              >
                <Icon name="plus" size={14} />
                Nouvelle demande
              </button>
            </div>
          )}

          {chargement && liste.length === 0 ? (
            <p className="support__vide">
              <span className="spinner" />
              Chargement…
            </p>
          ) : liste.length === 0 ? (
            <div className="support__vide">
              <p>Aucune demande pour l&rsquo;instant.</p>
              <p className="support__vide-note">
                C&rsquo;est bon signe. Si quelque chose cloche, dites-le
                ici&nbsp;: personne d&rsquo;autre que l&rsquo;equipe ne le lira.
              </p>
            </div>
          ) : (
            <ul className="support__liste">
              {liste.map((entree) => (
                <li key={entree.id}>
                  <button
                    type="button"
                    className={
                      'support-demande' +
                      (entree.derniere_reponse_de_l_equipe ? ' is-repondue' : '')
                    }
                    onClick={() => void ouvrir(entree.id)}
                  >
                    <span className={'support__statut is-' + entree.statut}>
                      {LIBELLES_STATUT[entree.statut]}
                    </span>

                    <span className="support-demande__corps">
                      <span className="support-demande__sujet truncate">
                        {entree.sujet}
                      </span>
                      <span className="support-demande__meta">
                        <span>{libelleCategorie(entree.categorie)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRelative(entree.updated_at)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {entree.reponses === 0
                            ? 'Pas encore de reponse'
                            : entree.reponses === 1
                              ? '1 reponse'
                              : `${entree.reponses} reponses`}
                        </span>
                      </span>
                    </span>

                    {/* La pastille ne dit pas « non lu » — le magasin ne sait
                        pas ce qui a ete lu — mais « l'equipe a parle en
                        dernier », ce qui est l'information utile. */}
                    {entree.derniere_reponse_de_l_equipe ? (
                      <span className="support-demande__neuf">Reponse</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="support__limites">
            Sujet de {SUJET_MIN} a {SUJET_MAX} caracteres, message de{' '}
            {MESSAGE_MIN} a {MESSAGE_MAX}. Un probleme par demande&nbsp;: deux
            sujets dans le meme fil obligent a les resoudre ensemble.
          </p>
        </>
      )}
    </div>
  );
}

function libelleCategorie(valeur: CategorieDemande): string {
  return CATEGORIES.find((entree) => entree.valeur === valeur)?.libelle ?? 'Autre';
}

function aideCategorie(valeur: CategorieDemande): string {
  return CATEGORIES.find((entree) => entree.valeur === valeur)?.aide ?? '';
}
