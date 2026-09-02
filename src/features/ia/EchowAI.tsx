import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useEchowAI, AMORCES } from '@/store/echowAI';
import { RetourMobile } from '@/components/RetourMobile';
import { useUI } from '@/store/ui';

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

  const morceaux = texte.split(/(\[\[SUPPORT\]\]|https?:\/\/[^\s<>"')]+)/g);

  return (
    <>
      {morceaux.map((morceau, i) => {
        if (morceau === '[[SUPPORT]]') {
          return (
            <button key={i} type="button" className="ia__support" onClick={montrerSupport}>
              <Icon name="mail" size={14} />
              Contacter le support
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

        return <span key={i}>{morceau}</span>;
      })}
    </>
  );
}

/**
 * La marque d'Echow AI.
 *
 * Dessinee plutot que chargee : une image de fond a retirer laisse toujours un
 * halo sur les bords, visible des que le fond de l'application change de
 * teinte. Un trace suit la couleur du texte et reste net a toutes les tailles.
 *
 * La forme reprend celle du logo — une bulle, deux yeux, un sourire, et les
 * barres d'un son qui monte.
 */
export function MarqueIA({ taille = 24 }: { taille?: number }) {
  return (
    <svg
      className="ia__marque"
      width={taille}
      height={taille}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ia-degrade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>

      {/* Les ecouteurs, de part et d'autre. */}
      <rect x="3" y="18" width="7" height="13" rx="3.5" fill="url(#ia-degrade)" opacity="0.85" />
      <rect x="38" y="18" width="7" height="13" rx="3.5" fill="url(#ia-degrade)" opacity="0.85" />

      {/* La bulle, avec sa pointe en bas a gauche. */}
      <path
        d="M24 5c10.5 0 19 8.1 19 18.1 0 10-8.5 18.1-19 18.1-1.5 0-3-.2-4.4-.5l-6.3 4.2a1.4 1.4 0 0 1-2.2-1.4l1.4-5.6C7.6 34.6 5 29.2 5 23.1 5 13.1 13.5 5 24 5Z"
        stroke="url(#ia-degrade)"
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {/* Les yeux. */}
      <rect x="16" y="17" width="4" height="7" rx="2" fill="url(#ia-degrade)" />
      <rect x="26" y="17" width="4" height="7" rx="2" fill="url(#ia-degrade)" />

      {/* Le sourire. */}
      <path
        d="M19 29.5c1.3 1.6 3 2.4 5 2.4s3.7-.8 5-2.4"
        stroke="url(#ia-degrade)"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Les barres du son, en bas a droite. */}
      <rect x="29" y="31" width="2.6" height="4" rx="1.3" fill="url(#ia-degrade)" />
      <rect x="33" y="28.5" width="2.6" height="6.5" rx="1.3" fill="url(#ia-degrade)" />
    </svg>
  );
}
