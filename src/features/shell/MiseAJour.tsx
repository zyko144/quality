import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { lireLesNotes } from './notes';
import { journal } from '@/lib/journal';

/**
 * Mises a jour, sans reinstaller.
 *
 * L'application se met a jour toute seule : elle telecharge une archive signee
 * et remplace ses fichiers. Plus besoin de repasser par l'installateur complet
 * a chaque correction.
 *
 * Elle ne se relance jamais d'elle-meme. On peut etre en pleine conversation,
 * ou en train de partager son ecran : couper pour installer serait pire que le
 * defaut qu'on corrige. La bannière propose, et attend.
 *
 * Au redemarrage suivant, ce qui a change est resume une fois. Une note de
 * version qu'il faut aller chercher n'est jamais lue.
 */

const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Ce que la derniere recherche a donne.
 *
 * Range a part pour que les reglages puissent l'afficher sans dupliquer la
 * logique de recherche, et pour qu'une recherche lancee a la main mette a jour
 * la meme information que celle du demarrage.
 */
export const useMajEtat = create<{
  etat: 'inconnu' | 'a-jour' | 'disponible' | 'installee' | 'echec';
  detail: string | null;
  /** Version proposee, quand il y en a une. */
  version: string | null;
  /** Heure de la derniere reponse, ou `null` si l'on n'a pas encore cherche. */
  verifie: number | null;
  signaler: (
    detail: string | null,
    etat?: 'a-jour' | 'disponible' | 'installee',
    version?: string | null,
  ) => void;
  /** Oublie la derniere reponse, le temps d'en chercher une nouvelle. */
  chercher: () => void;
}>((set) => ({
  etat: 'inconnu',
  detail: null,
  version: null,
  verifie: null,
  signaler: (detail, etat, version) =>
    set({
      etat: etat ?? (detail ? 'echec' : 'inconnu'),
      detail,
      ...(version === undefined ? {} : { version }),
      // Horodatee, parce que la reponse a souvent l'air identique a la
      // precedente : sans cela, chercher a nouveau ne change rien a l'ecran.
      verifie: Date.now(),
    }),
  chercher: () => set({ etat: 'inconnu', detail: null }),
}));

/**
 * Relance l'application.
 *
 * Exposee hors du composant : les reglages en ont besoin, et la dupliquer
 * ferait exister deux facons de redemarrer qui pourraient diverger.
 */
export async function relancerApplication(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/**
 * Derniere version dont les nouveautes ont ete montrees.
 *
 * Une cle neuve : l'ancienne contenait un objet, et la relire produirait une
 * comparaison de version contre du JSON.
 */
const CLE_VUE = 'quality:version-vue';

interface Disponible {
  version: string;
  notes: string;
  installer: () => Promise<void>;
}

export function MiseAJour() {
  const [disponible, setDisponible] = useState<Disponible | null>(null);

  /*
   * Fermer replie le bandeau, ne l'efface pas.
   *
   * Il disparaissait pour de bon, et rien ne le rappelait : on cliquait
   * « plus tard » une fois, et l'on restait sur une ancienne version sans plus
   * jamais rien voir. Deux personnes se sont ainsi retrouvees a cinq versions
   * d'ecart, et la moitie des defauts qu'elles constataient venait de la.
   *
   * Replie, il devient une pastille dans le meme coin. Elle ne prend pas de
   * place, elle ne demande rien, mais elle est la — et un clic la redeploie.
   */
  const [replie, setReplie] = useState(false);
  const [installation, setInstallation] = useState<'attente' | 'cours' | 'prete'>('attente');
  const [nouveautes, setNouveautes] = useState<{ version: string; notes: string } | null>(null);

  /** Derniere version proposee, pour ne redeployer que sur du nouveau. */
  const disponibleRef = useRef<string | null>(null);

  /*
   * Ce qui a change depuis la derniere fois.
   *
   * On compare la version qui tourne a la derniere vue, et les notes sont
   * embarquees dans le binaire — voir `NOUVEAUTES.md` et `vite.config.ts`.
   *
   * La version precedente rangeait les notes AU MOMENT de l'installation, dans
   * le bouton « Installer ». C'etait le defaut : qui met a jour en lancant le
   * setup a la main ne passe jamais par ce bouton, si bien que rien n'etait
   * range et que le message ne s'affichait jamais. Or c'est exactement ainsi
   * que les premieres versions ont ete installees.
   *
   * Comparer les versions marche quel que soit le chemin emprunte, y compris
   * une reinstallation complete.
   */
  useEffect(() => {
    if (!__APP_NOTES__.trim()) return;

    try {
      const vue = localStorage.getItem(CLE_VUE);

      /*
       * Absence de cle : premier lancement, ou premiere version a savoir la
       * poser ?
       *
       * Les deux se ressemblent et demandent l'inverse l'une de l'autre. Sans
       * distinction, la version qui introduit ce mecanisme se prend pour une
       * premiere installation et n'affiche rien — il faudrait attendre la
       * suivante pour voir le message, ce qui est precisement le defaut qu'on
       * corrige.
       *
       * La presence d'autres reglages tranche : quelqu'un qui ouvre
       * l'application pour la premiere fois n'a rien enregistre.
       */
      if (vue === null) {
        const dejaVenu = Object.keys(localStorage).some(
          (cle) => cle.startsWith('quality:') || cle.startsWith('orbit:'),
        );

        localStorage.setItem(CLE_VUE, __APP_VERSION__);
        if (!dejaVenu) return;

        setNouveautes({ version: __APP_VERSION__, notes: __APP_NOTES__ });
        return;
      }

      if (vue === __APP_VERSION__) return;

      setNouveautes({ version: __APP_VERSION__, notes: __APP_NOTES__ });
      localStorage.setItem(CLE_VUE, __APP_VERSION__);
    } catch {
      // Stockage indisponible : on se passe du message plutot que d'echouer.
    }
  }, []);

  useEffect(() => {
    if (!DANS_TAURI) return;

    let annule = false;

    const chercher = async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const mise = await check();

        if (!mise) {
          // A jour : on le note, pour que le bouton des reglages puisse le dire
          // au lieu de rester muet.
          useMajEtat.getState().signaler(null, 'a-jour', null);
          journal.info('mise-a-jour', 'Aucune version plus recente', {
            installee: __APP_VERSION__,
          });
          return;
        }

        if (annule) return;

        useMajEtat.getState().signaler(null, 'disponible', mise.version);

        /*
         * La recherche est journalisee, succes comme echec.
         *
         * Deux personnes se sont retrouvees a cinq versions d'ecart sans que
         * rien ne le signale, et la moitie des defauts qu'elles constataient
         * venaient de la : elles ne faisaient pas tourner le meme code. Sans
         * cette trace, « la mise a jour ne se propose plus » ne se distingue
         * pas de « elle se propose et personne ne clique ».
         */
        journal.info('mise-a-jour', 'Version disponible', {
          installee: __APP_VERSION__,
          proposee: mise.version,
        });

        // Une version qu'on n'avait pas encore vue redeploie le bandeau : la
        // pastille dit « il y a quelque chose », elle ne dit pas quoi.
        setReplie((etait) => etait && disponibleRef.current === mise.version);
        disponibleRef.current = mise.version;

        setDisponible({
          version: mise.version,
          notes: mise.body ?? '',
          installer: async () => {
            setInstallation('cours');
            await mise.downloadAndInstall();

            // Rien a ranger : la version installee porte ses propres notes, et
            // les montrera d'elle-meme au prochain lancement.
            setInstallation('prete');
            useMajEtat.getState().signaler(null, 'installee', mise.version);
            journal.info('mise-a-jour', 'Installee, en attente de relance', {
              proposee: mise.version,
            });
          },
        });
      } catch (cause) {
        /*
         * Un echec ne doit pas disparaitre.
         *
         * Il n'y a pas de quoi interrompre qui que ce soit — l'application
         * marche tres bien sans se mettre a jour — mais l'avaler completement
         * rend la panne indiscernable du cas normal : on ne sait pas si l'on
         * est a jour ou si la recherche a echoue. La console le dit, et le
         * bouton des reglages le repete a qui va le chercher.
         */
        console.error('Recherche de mise a jour :', cause);
        useMajEtat.getState().signaler(String(cause));
        journal.erreur('mise-a-jour', 'Recherche impossible', {
          installee: __APP_VERSION__,
          cause: String(cause),
        });
      }
    };

    void chercher();

    /*
     * On cherche aussi pendant que l'application tourne.
     *
     * Une seule recherche au demarrage suffit a qui redemarre souvent. Pour
     * une application qu'on laisse ouverte des journees entieres — c'est le
     * cas d'une messagerie — elle revient a n'annoncer une version que le
     * lendemain. Un quart d'heure entre deux essais est indolore : la
     * requete pese quelques centaines d'octets.
     */
    const minuterie = window.setInterval(() => {
      // Inutile d'interrompre une installation deja proposee.
      if (annule) return;
      void chercher();
    }, 15 * 60 * 1000);

    return () => {
      annule = true;
      window.clearInterval(minuterie);
    };
  }, []);

  const relancer = () => void relancerApplication();

  return (
    <>
      {disponible && replie ? (
        <button
          type="button"
          className={
            'maj-pastille' + (installation === 'prete' ? ' is-prete' : '')
          }
          onClick={() => setReplie(false)}
          title={
            installation === 'prete'
              ? 'Mise a jour prete — relancer'
              : `Echow ${disponible.version} est disponible`
          }
        >
          <Icon name={installation === 'prete' ? 'refresh' : 'arrow-down'} size={15} />
          {disponible.version}
        </button>
      ) : null}

      {disponible && !replie ? (
        <div className="maj" role="status">
          <span className="maj__marque" aria-hidden="true">
            <Icon name="arrow-down" size={16} />
          </span>

          <div className="maj__corps">
            <p className="maj__titre">
              {installation === 'prete'
                ? 'Mise a jour prete'
                : `Echow ${disponible.version} est disponible`}
            </p>
            <p className="maj__note">
              {installation === 'prete'
                ? 'Elle s’appliquera au prochain lancement.'
                : 'Elle s’installe sans reinstaller l’application.'}
            </p>
          </div>

          {installation === 'prete' ? (
            <>
              <button type="button" className="btn btn--sm btn--primary" onClick={relancer}>
                Relancer
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setReplie(true)}
              >
                Plus tard
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--sm btn--primary"
                disabled={installation === 'cours'}
                onClick={() => void disponible.installer()}
              >
                {installation === 'cours' ? <span className="spinner" /> : null}
                {installation === 'cours' ? 'Telechargement…' : 'Installer'}
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={installation === 'cours'}
                onClick={() => setReplie(true)}
              >
                Plus tard
              </button>
            </>
          )}
        </div>
      ) : null}

      <Modal
        open={nouveautes !== null}
        title={`Quoi de neuf en ${nouveautes?.version ?? ''}`}
        description="Les changements notables depuis votre derniere version."
        onClose={() => setNouveautes(null)}
        width={520}
        footer={
          <button type="button" className="btn btn--primary" onClick={() => setNouveautes(null)}>
            Compris
          </button>
        }
      >
        {/*
          Rangees par nature : ce qui est repare, ce qui est nouveau, ce qui a
          change. Une liste plate obligeait a lire chaque ligne pour savoir si
          elle concernait un defaut qu'on avait rencontre ou une fonctionnalite
          qu'on ne connaissait pas. La categorie repond avant la lecture, et sa
          couleur avant la categorie.
        */}
        <div className="maj__categories">
          {lireLesNotes(nouveautes?.notes ?? '').map((categorie) => (
            <section
              className="maj__categorie"
              data-genre={categorie.genre}
              key={categorie.titre}
            >
              <h3 className="maj__categorie-titre">
                <span className="maj__categorie-pastille" aria-hidden="true">
                  <Icon name={categorie.icone} size={13} />
                </span>
                {categorie.titre}
              </h3>

              <ul className="maj__liste">
                {categorie.lignes.slice(0, 8).map((ligne) => (
                  <li key={ligne}>{ligne}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Modal>
    </>
  );
}
