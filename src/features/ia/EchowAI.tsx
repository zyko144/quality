import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { useEchowAI, AMORCES } from '@/store/echowAI';
import { RetourMobile } from '@/components/RetourMobile';
import { useUI } from '@/store/ui';
import { QualityLogo } from '@/components/QualityLogo';

/**
 * Echow AI.
 *
 * Une fenetre de discussion posee au-dessus de l'application. Elle ne parle
 * jamais directement au modele : tout passe par une fonction du projet, qui
 * detient la cle et ne la rend jamais. Voir `store/echowAI.ts`.
 *
 * Ce qu'elle n'essaie pas d'etre
 * ------------------------------
 * Un assistant de programmation. La consigne le lui interdit, et ce n'est pas
 * une precaution de principe : une IA qui accepte de tout faire finit par etre
 * jugee sur ce qu'elle fait mal. Elle sert a se reperer dans Echow, et le dit.
 */
export function EchowAI() {
  const ouvert = useEchowAI((etat) => etat.ouvert);
  const echanges = useEchowAI((etat) => etat.echanges);
  const occupe = useEchowAI((etat) => etat.occupe);
  const erreur = useEchowAI((etat) => etat.erreur);
  const restant = useEchowAI((etat) => etat.restant);
  const fermer = useEchowAI((etat) => etat.fermer);
  const demander = useEchowAI((etat) => etat.demander);
  const effacer = useEchowAI((etat) => etat.effacer);

  const [saisie, setSaisie] = useState('');
  const filRef = useRef<HTMLDivElement>(null);
  const champRef = useRef<HTMLTextAreaElement>(null);

  // Le fil suit la derniere reponse : sans cela, on lit le debut d'une reponse
  // dont la fin est deja hors champ.
  useEffect(() => {
    filRef.current?.scrollTo({ top: filRef.current.scrollHeight, behavior: 'smooth' });
  }, [echanges]);

  useEffect(() => {
    if (ouvert) champRef.current?.focus();
  }, [ouvert]);

  useEffect(() => {
    if (!ouvert) return;

    const auClavier = (event: KeyboardEvent) => {
      if (event.key === 'Escape') fermer();
    };

    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [ouvert, fermer]);

  if (!ouvert) return null;

  const envoyer = () => {
    const texte = saisie.trim();
    if (!texte) return;
    setSaisie('');
    void demander(texte);
  };

  return (
    <div className="ia" role="dialog" aria-modal="true" aria-label="Echow AI">
      <header className="ia__tete">
        <RetourMobile label="Revenir aux conversations" />
        <MarqueIA taille={26} />

        <span className="ia__titre">
          Echow AI
          <span className="ia__sous-titre">Aide sur l&rsquo;application</span>
        </span>

        {/*
          Ce qu'il reste, dit sans dramatiser.

          Une limite existe — chaque question coute — et la decouvrir en la
          heurtant est desagreable. Affichee, elle se gere.
        */}
        {restant !== null ? (
          <span className="ia__restant" title="Questions restantes aujourd’hui">
            {restant}
          </span>
        ) : null}

        {echanges.length > 0 ? (
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            onClick={effacer}
            title="Effacer la conversation"
            aria-label="Effacer la conversation"
          >
            <Icon name="trash" size={15} />
          </button>
        ) : null}

        <button type="button" className="icon-btn" onClick={fermer} aria-label="Fermer">
          <Icon name="x" size={17} />
        </button>
      </header>

      <div className="ia__fil" ref={filRef}>
        {echanges.length === 0 ? (
          <div className="ia__accueil">
            <MarqueIA taille={44} />
            <p className="ia__accueil-texte">
              Je reponds aux questions sur Echow : ou trouver un reglage, comment
              faire une chose, pourquoi quelque chose se comporte ainsi.
            </p>

            <ul className="ia__amorces">
              {AMORCES.map((amorce) => (
                <li key={amorce}>
                  <button
                    type="button"
                    className="ia__amorce"
                    onClick={() => void demander(amorce)}
                  >
                    {amorce}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          echanges.map((tour, index) => (
            <div
              className={'ia__tour' + (tour.role === 'user' ? ' is-moi' : '')}
              key={`${index}-${tour.role}`}
            >
              {tour.role === 'model' ? <MarqueIA taille={20} /> : null}

              <div className="ia__bulle">
                {tour.enAttente ? (
                  <span className="ia__points" aria-label="Reflexion en cours">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  <TexteIA texte={tour.texte} />
                )}
              </div>
            </div>
          ))
        )}

        {erreur ? (
          <p className="ia__erreur" role="alert">
            <Icon name="alert-triangle" size={14} />
            {erreur}
          </p>
        ) : null}
      </div>

      <div className="ia__pied">
        <textarea
          ref={champRef}
          className="ia__champ"
          rows={1}
          value={saisie}
          placeholder="Posez votre question…"
          maxLength={2000}
          onChange={(event) => setSaisie(event.target.value)}
          onKeyDown={(event) => {
            // Entree envoie, Maj+Entree passe a la ligne : c'est ce que fait le
            // composeur de messages, et changer de regle entre deux champs de
            // la meme application serait deroutant.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              envoyer();
            }
          }}
        />

        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!saisie.trim() || occupe}
          onClick={envoyer}
        >
          <Icon name="send" size={15} />
        </button>
      </div>

      <p className="ia__mention">
        Echow AI peut se tromper. Pour un compte, un paiement ou une decision de
        moderation, passez par Reglages &rsaquo; Avance &rsaquo; Support.
      </p>
    </div>
  );
}

/**
 * Le texte d'une reponse, avec ses parties actives.
 *
 * L'assistant ne produit que du texte : il ne peut pas fabriquer de bouton. Il
 * pose donc un marqueur, `[[SUPPORT]]`, remplace ici par le vrai bouton, qui
 * ouvre le support la ou il se trouve REELLEMENT.
 *
 * C'est ce qui evite la faute qu'il commettait : il ecrivait « Reglages >
 * Avance > Support », un chemin ou le support n'a jamais ete. Une phrase apprise
 * par coeur vieillit avec l'application ; un marqueur pointe vers le code, qui
 * suit tout seul.
 *
 * Les adresses ecrites en clair deviennent cliquables au passage : une adresse
 * qu'on ne peut pas suivre oblige a la recopier a la main.
 */
function TexteIA({ texte }: { texte: string }) {
  const montrerSupport = useUI((state) => state.showSupport);
  const montrerBadges = useUI((state) => state.showWaves);
  const ouvrirReglages = useUI((state) => state.openSettings);

  const ACCES: Record<
    string,
    { label: string; icone: IconName; teinte: string; ouvrir: () => () => void }
  > = {
    '[[SUPPORT]]': {
      label: 'Contacter le support',
      icone: 'mail',
      teinte: 'rouge',
      ouvrir: () => montrerSupport,
    },
    '[[BADGES]]': {
      label: 'Voir les badges',
      icone: 'shield',
      teinte: 'or',
      ouvrir: () => montrerBadges,
    },
    '[[REGLAGES]]': {
      label: 'Ouvrir les reglages',
      icone: 'settings',
      teinte: 'accent',
      ouvrir: () => () => ouvrirReglages('compte'),
    },
  };

  /*
   * Un seul decoupage pour tout ce qui n'est pas du texte ordinaire.
   *
   * Les groupes de capture font que `split` RETOURNE les separateurs : chaque
   * morceau est donc soit du texte, soit une partie active, dans l'ordre. Un
   * second passage par partie eviterait de croiser les regles — mais il
   * demanderait de reassembler, et c'est en reassemblant qu'on perd l'ordre.
   */
  const morceaux = texte.split(
    /(\[\[(?:SUPPORT|BADGES|REGLAGES)\]\]|https?:\/\/[^\s<>"')]+|\*\*[^*]+\*\*|`[^`]+`)/g,
  );

  return (
    <>
      {morceaux.map((morceau, i) => {
        /*
         * Les marqueurs deviennent des boutons qui MENENT quelque part.
         *
         * L'assistant ne peut ecrire qu'un chemin, et un chemin vieillit — il en
         * donnait un vers les reglages ou le support n'a jamais ete. Un marqueur
         * pointe vers le code, qui suit tout seul quand une page demenage.
         *
         * Trois couleurs, trois destinations : le support est rouge parce qu'il
         * passe la main a un humain, les badges portent leur or, les reglages
         * l'accent ordinaire de l'application.
         */
        const raccourci = ACCES[morceau];
        if (raccourci) {
          return (
            <button
              key={i}
              type="button"
              className={`ia__acces ia__acces--${raccourci.teinte}`}
              onClick={raccourci.ouvrir()}
            >
              <Icon name={raccourci.icone} size={14} />
              {raccourci.label}
            </button>
          );
        }

        if (/^https?:\/\//.test(morceau)) {
          return (
            <a key={i} href={morceau} target="_blank" rel="noreferrer noopener">
              {morceau}
            </a>
          );
        }

        // Le gras porte la couleur d'accent : dans une reponse de quatre
        // phrases, c'est ce qui permet de trouver la reponse sans tout lire.
        if (morceau.startsWith('**') && morceau.endsWith('**') && morceau.length > 4) {
          return (
            <strong key={i} className="ia__fort">
              {morceau.slice(2, -2)}
            </strong>
          );
        }

        // Ce que l'on doit taper ou trouver mot pour mot : un nom de reglage,
        // un raccourci. Le detacher evite d'avoir a deviner ou il commence.
        if (morceau.startsWith('`') && morceau.endsWith('`') && morceau.length > 2) {
          return (
            <code key={i} className="ia__code">
              {morceau.slice(1, -1)}
            </code>
          );
        }

        return <span key={i}>{morceau}</span>;
      })}
    </>
  );
}

/**
 * La marque d'Echow AI : le logo de l'application.
 *
 * Elle etait DESSINEE, et pour une bonne raison a l'epoque : le logo d'alors
 * avait un fond, et le retirer laissait un halo sur les bords — visible des
 * que le fond de l'application changeait de teinte. Un trace vectoriel suivait
 * la couleur du texte et restait net partout.
 *
 * Le nouveau logo est fourni sans fond, proprement detoure. Le trace n'a plus
 * de raison d'exister, et il en avait un defaut : il IMITAIT le logo. Deux
 * dessins qui se ressemblent sans etre identiques finissent toujours par
 * diverger — celui-ci portait encore des ecouteurs et des barres de son que le
 * logo n'a plus.
 *
 * L'assistant porte donc la meme image que l'application, et il n'y a plus
 * qu'un seul endroit ou la changer.
 */
export function MarqueIA({ taille = 24 }: { taille?: number }) {
  return <QualityLogo size={taille} className="ia__marque" alt="" />;
}
