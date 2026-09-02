import { useEffect } from 'react';
import { Icon } from '@/components/Icon';
import { BadgeVisual } from '@/components/BadgeVisual';
import { useSession } from '@/store/session';
import { RetourMobile } from '@/components/RetourMobile';
import {
  useBadges,
  FAMILLES,
  badgesDe,
  placesRestantes,
  type Badge,
} from '@/store/badges';

/**
 * Les badges.
 *
 * Ils remplacent la page de l'abonnement, qui annoncait quelque chose
 * d'invendable aujourd'hui. Un badge, lui, existe des qu'on le donne.
 *
 * Ce qui fait leur valeur
 * -----------------------
 * Pas le dessin, meme s'il existe maintenant. Ce qui les rend desirables, c'est
 * de POUVOIR SE FERMER. « Parmi les cent premiers » ne vaut rien tant que la
 * centieme place est libre, et vaut tout une fois qu'elle est prise. Les places
 * restantes sont donc affichees sur chaque badge encore ouvert : c'est
 * l'information qui donne envie d'agir maintenant plutot que plus tard.
 *
 * Les familles sont separees parce qu'elles ne se meritent pas de la meme
 * facon : etre arrive tot n'est pas un succes, c'est une chance, et les melanger
 * devaloriserait les deux.
 *
 * Pourquoi « les votres » n'est pas une grille
 * -------------------------------------------
 * Elle l'a ete, et chaque badge possede apparaissait alors DEUX FOIS : une
 * carte en tete, la meme carte plus bas dans sa famille. Deux cartes identiques
 * a un ecran d'intervalle se lisent comme un defaut d'affichage, pas comme une
 * mise en avant.
 *
 * Retirer le badge de sa famille aurait ete pire : la serie « Voix » y perdrait
 * la marche qu'on vient de franchir, et une serie trouee ne se lit plus.
 *
 * C'est donc la tete qui change de forme. Une rangee de trophees — le dessin en
 * grand, le nom, le rang — dit « voici ce que vous avez » sans redire ce que
 * chaque badge signifie ; la description reste en bas, une seule fois, la ou
 * elle sert a ceux qui ne l'ont pas encore.
 */
export function BadgesPage() {
  const catalogue = useBadges((etat) => etat.catalogue);
  const parProfil = useBadges((etat) => etat.parProfil);
  const compte = useBadges((etat) => etat.compte);
  const charger = useBadges((etat) => etat.charger);
  const chargement = useBadges((etat) => etat.chargement);

  const moi = useSession((etat) => etat.profile?.id);

  useEffect(() => {
    void charger();
  }, [charger]);

  const miens = badgesDe(moi, parProfil, catalogue);
  const clesMiennes = new Set(miens.map((entree) => entree.badge.cle));

  return (
    <div className="badges-page">
      <header className="badges-page__tete">
        <RetourMobile label="Revenir aux conversations" />
        <div className="badges-page__marque" aria-hidden="true">
          <Icon name="shield" size={26} />
        </div>

        <div>
          <h1 className="badges-page__titre">Badges</h1>
          <p className="badges-page__sous-titre">
            Ils s&rsquo;obtiennent en faisant quelque chose, ou en etant arrive tot.
            Certains se fermeront definitivement : une fois la derniere place prise,
            plus personne ne pourra les avoir.
          </p>
        </div>
      </header>

      {/* Ce qu'on a deja, en tete : c'est ce qu'on vient regarder. */}
      <section className="badges-mien">
        <h2 className="badges-section__titre">
          Les votres
          <span className="badges-section__compte">{miens.length}</span>
        </h2>

        {miens.length === 0 ? (
          <p className="badges-vide">
            {chargement
              ? 'Chargement…'
              : 'Aucun pour l’instant. Les courses ouvertes sont plus bas — certaines se ferment vite.'}
          </p>
        ) : (
          <ul className="badges-trophees">
            {miens.map(({ badge, obtenu }) => (
              <li
                className="badge-trophee"
                key={badge.cle}
                style={{ '--teinte': badge.teinte } as React.CSSProperties}
              >
                <BadgeVisual
                  badgeCle={badge.cle}
                  nom={badge.nom}
                  teinte={badge.teinte}
                  size={52}
                />

                <span className="badge-trophee__nom">{badge.nom}</span>

                {obtenu.position !== null ? (
                  <span className="badge-trophee__rang" title="Votre rang d’obtention">
                    n&deg;{obtenu.position}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {FAMILLES.map((famille) => {
        const dedans = catalogue.filter((badge) => badge.famille === famille.cle);
        if (dedans.length === 0) return null;

        return (
          <section className="badges-famille" key={famille.cle}>
            <h2 className="badges-section__titre">{famille.titre}</h2>
            <p className="badges-famille__detail">{famille.detail}</p>

            <ul className="badges-grille">
              {dedans.map((badge) => (
                <li key={badge.cle}>
                  <Vignette
                    badge={badge}
                    possede={clesMiennes.has(badge.cle)}
                    places={placesRestantes(badge, compte)}
                    position={null}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {catalogue.length === 0 && !chargement ? (
        <p className="badges-vide">
          Les badges ne sont pas encore actifs sur ce serveur.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Une vignette de badge, dans le catalogue.
 *
 * Le dessin est allume ou eteint selon qu'on possede le badge ou non. Sans
 * cela, « Voix — 1 000 h » pulsait exactement comme le badge qu'on vient de
 * gagner, et la distinction disparaissait : un catalogue entier qui brille ne
 * recompense plus personne. Voir `badges.css`, section « eteint ».
 */
function Vignette({
  badge,
  possede,
  places,
  position,
}: {
  badge: Badge;
  possede: boolean;
  places: number | null;
  position: number | null;
}) {
  /*
   * Une course close se lit d'un coup d'oeil.
   *
   * C'est l'information qui donne sa valeur au badge — et, pour qui ne l'a pas,
   * celle qui evite de chercher comment l'obtenir alors que c'est impossible.
   */
  const close = places === 0 && !possede;

  return (
    <article
      className={
        'badge-vignette' +
        (possede ? ' is-obtenu' : '') +
        (close ? ' is-close' : '')
      }
      style={{ '--teinte': badge.teinte } as React.CSSProperties}
    >
      <BadgeVisual
        badgeCle={badge.cle}
        nom={badge.nom}
        teinte={badge.teinte}
        size={36}
        allume={possede}
        className="badge-vignette__visual"
      />

      <div className="badge-vignette__corps">
        <h3 className="badge-vignette__nom">
          {badge.nom}
          {position !== null ? (
            <span className="badge-vignette__rang" title="Votre rang d’obtention">
              n&deg;{position}
            </span>
          ) : null}
        </h3>

        <p className="badge-vignette__description">{badge.description}</p>

        {places !== null ? (
          <p className="badge-vignette__places">
            {places > 0
              ? `${places} place${places > 1 ? 's' : ''} restante${places > 1 ? 's' : ''}`
              : 'Course terminee'}
          </p>
        ) : null}
      </div>
    </article>
  );
}
