import { useMemo, useState } from 'react';
import { useChat } from '@/store/chat';
import { Icon } from '@/components/Icon';
import type { UUID } from '@/types/db';

/**
 * Les categories d'un espace, et ce qu'il y a dedans.
 *
 * Ce panneau ne faisait que les nommer : une liste de titres, un compteur de
 * salons, une corbeille. On voyait donc « 0 salon » sans aucun moyen d'en
 * mettre un — le compteur annoncait le probleme et n'en donnait pas la sortie.
 *
 * Pourquoi le contenu se voit ici et pas seulement dans l'onglet des salons
 * -------------------------------------------------------------------------
 * L'onglet des salons pose la question dans l'autre sens : pour chaque salon,
 * quelle categorie ? C'est le bon geste quand on part d'un salon precis, et le
 * mauvais quand on remplit une categorie qu'on vient de creer — il faudrait
 * parcourir toute la liste des salons en changeant une liste deroulante a
 * chaque ligne, sans jamais voir le resultat.
 *
 * Ici, une categorie montre ce qu'elle contient, et ce qui reste a placer est
 * juste en dessous. Les deux repondent a la meme question ; celle qu'on se
 * pose depend de ce qu'on avait en tete en ouvrant les parametres.
 */
export function CategoriesPanel({ spaceId }: { spaceId: UUID }) {
  const categories = useChat((etat) => etat.categories);
  const channels = useChat((etat) => etat.channels);
  const rangerSalon = useChat((etat) => etat.rangerSalon);
  const creerCategorie = useChat((etat) => etat.creerCategorie);
  const supprimerCategorie = useChat((etat) => etat.supprimerCategorie);

  const [nouvelle, setNouvelle] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const liste = useMemo(
    () =>
      categories
        .filter((categorie) => categorie.space_id === spaceId)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [categories, spaceId],
  );

  const salons = useMemo(
    () =>
      channels
        .filter((salon) => salon.space_id === spaceId)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [channels, spaceId],
  );

  const sansCategorie = salons.filter((salon) => salon.category_id === null);

  const ajouter = async () => {
    const nom = nouvelle.trim();
    if (!nom || occupe) return;

    setOccupe(true);
    const creee = await creerCategorie(spaceId, nom);
    setOccupe(false);

    if (!creee) {
      setErreur("La categorie n'a pas pu etre creee.");
      return;
    }

    setNouvelle('');
    setErreur(null);
  };

  const supprimer = async (categorie: UUID) => {
    const partie = await supprimerCategorie(categorie);
    setErreur(partie ? null : "La categorie n'a pas pu etre supprimee.");
  };

  /*
   * Ranger ne verrouille rien.
   *
   * Un verrou global le faisait : chaque liste deroulante et chaque corbeille
   * du panneau devenaient inertes le temps de l'aller-retour. Sur une liaison
   * lente, ranger trois salons demandait d'attendre entre chacun, sans savoir
   * ce qu'on attendait — et si une reponse se perdait, le panneau entier
   * restait mort jusqu'a sa fermeture.
   *
   * L'ecriture est deja optimiste et se defait toute seule en cas de refus ;
   * il n'y a rien a proteger.
   */
  const ranger = async (salon: UUID, categorie: UUID | null) => {
    const pose = await rangerSalon(salon, categorie);
    setErreur(pose ? null : "Le salon n'a pas pu changer de categorie.");
  };

  return (
    <>
      <p className="field__hint">
        Une categorie regroupe des salons dans la barre laterale. On peut aussi les
        y glisser directement, sans passer par ici. Supprimer une categorie ne
        supprime pas ses salons : ils remontent simplement en haut de la liste.
      </p>

      {erreur ? (
        <div className="mod-error" role="alert">
          <span>{erreur}</span>
        </div>
      ) : null}

      {liste.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="hash" size={22} />
          </span>
          <p className="empty__title">Aucune categorie</p>
          <p className="empty__body">
            Les salons apparaissent tous au meme niveau. Creez-en une pour les
            regrouper.
          </p>
        </div>
      ) : (
        <ul className="mod-list">
          {liste.map((categorie) => {
            const dedans = salons.filter((salon) => salon.category_id === categorie.id);

            /*
             * Ce qu'on peut encore y mettre : tout le reste.
             *
             * Pas seulement les salons sans categorie. Deplacer un salon d'une
             * categorie a une autre est le cas le plus courant une fois le
             * serveur range — et l'exclure obligerait a l'en sortir d'abord,
             * en deux gestes, pour un resultat identique.
             */
            const ailleurs = salons.filter((salon) => salon.category_id !== categorie.id);

            return (
              <li className="mod-row" key={categorie.id}>
                <div className="mod-row__head">
                  <Icon name="folder" size={15} />
                  <div className="mod-row__identity">
                    <span className="mod-row__name">{categorie.name}</span>
                    <span className="mod-row__handle">
                      {dedans.length === 0
                        ? 'Aucun salon'
                        : dedans.length === 1
                          ? '1 salon'
                          : `${dedans.length} salons`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    onClick={() => void supprimer(categorie.id)}
                    aria-label={`Supprimer la categorie ${categorie.name}`}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>

                {dedans.length > 0 ? (
                  <ul className="categorie__salons">
                    {dedans.map((salon) => (
                      <li className="categorie__salon" key={salon.id}>
                        <Icon name={salon.kind === 'voice' ? 'volume' : 'hash'} size={13} />
                        <span className="truncate">{salon.name}</span>
                        <button
                          type="button"
                          className="icon-btn icon-btn--sm"
                          title="Sortir de la categorie"
                          aria-label={`Sortir ${salon.name} de ${categorie.name}`}
                          onClick={() => void ranger(salon.id, null)}
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/*
                  La liste deroulante revient a vide apres chaque choix.

                  Elle ne represente pas un etat — « quel salon est dans cette
                  categorie » se lit au-dessus. C'est un geste : en garder la
                  trace laisserait croire qu'un salon y est attache d'une facon
                  particuliere, alors qu'il vient seulement de rejoindre les
                  autres.
                */}
                {ailleurs.length > 0 ? (
                  <select
                    className="input categorie__ajout"
                    value=""
                    aria-label={`Ajouter un salon a ${categorie.name}`}
                    onChange={(evenement) => {
                      const choisi = evenement.target.value as UUID;
                      evenement.target.value = '';
                      if (choisi) void ranger(choisi, categorie.id);
                    }}
                  >
                    <option value="">Ajouter un salon…</option>
                    {ailleurs.map((salon) => (
                      <option key={salon.id} value={salon.id}>
                        {salon.kind === 'voice' ? '🔊 ' : '# '}
                        {salon.name}
                        {salon.category_id
                          ? ` — ${liste.find((c) => c.id === salon.category_id)?.name ?? ''}`
                          : ''}
                      </option>
                    ))}
                  </select>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/*
        Ce qui n'est range nulle part.

        On ne le montre qu'a partir d'une categorie : sans categorie, TOUS les
        salons sont ici, et la liste ne dirait rien de plus que l'onglet des
        salons.
      */}
      {liste.length > 0 && sansCategorie.length > 0 ? (
        <div className="field">
          <span className="field__label">Hors categorie</span>
          <ul className="categorie__salons">
            {sansCategorie.map((salon) => (
              <li className="categorie__salon" key={salon.id}>
                <Icon name={salon.kind === 'voice' ? 'volume' : 'hash'} size={13} />
                <span className="truncate">{salon.name}</span>
                <select
                  className="categorie__vers"
                  value=""
                  aria-label={`Categorie de ${salon.name}`}
                  onChange={(evenement) => {
                    const choisie = evenement.target.value as UUID;
                    evenement.target.value = '';
                    if (choisie) void ranger(salon.id, choisie);
                  }}
                >
                  <option value="">Ranger dans…</option>
                  {liste.map((categorie) => (
                    <option key={categorie.id} value={categorie.id}>
                      {categorie.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="field">
        <label className="field__label" htmlFor="space-new-category">
          Nouvelle categorie
        </label>
        <div className="mod-actions__row">
          <input
            id="space-new-category"
            className="input"
            style={{ flex: 1, minWidth: '200px' }}
            value={nouvelle}
            maxLength={64}
            placeholder="Projets"
            onChange={(evenement) => setNouvelle(evenement.target.value)}
            onKeyDown={(evenement) => evenement.key === 'Enter' && void ajouter()}
          />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!nouvelle.trim() || occupe}
            onClick={() => void ajouter()}
          >
            <Icon name="plus" size={15} />
            Ajouter
          </button>
        </div>
      </div>
    </>
  );
}
