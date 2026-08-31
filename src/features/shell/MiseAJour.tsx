import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';

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
  etat: 'inconnu' | 'a-jour' | 'disponible' | 'echec';
  detail: string | null;
  /** Heure de la derniere reponse, ou `null` si l'on n'a pas encore cherche. */
  verifie: number | null;
  signaler: (detail: string | null, etat?: 'a-jour' | 'disponible') => void;
  /** Oublie la derniere reponse, le temps d'en chercher une nouvelle. */
  chercher: () => void;
}>((set) => ({
  etat: 'inconnu',
  detail: null,
  verifie: null,
  signaler: (detail, etat) =>
    set({
      etat: etat ?? (detail ? 'echec' : 'inconnu'),
      detail,
      // Horodatee, parce que la reponse a souvent l'air identique a la
      // precedente : sans cela, chercher a nouveau ne change rien a l'ecran.
      verifie: Date.now(),
    }),
  chercher: () => set({ etat: 'inconnu', detail: null }),
}));

/** Version pour laquelle les nouveautes ont deja ete montrees. */
const CLE_VUE = 'quality:notes-vues';

interface Disponible {
  version: string;
  notes: string;
  installer: () => Promise<void>;
}

export function MiseAJour() {
  const [disponible, setDisponible] = useState<Disponible | null>(null);
  const [installation, setInstallation] = useState<'attente' | 'cours' | 'prete'>('attente');
  const [nouveautes, setNouveautes] = useState<{ version: string; notes: string } | null>(null);

  /*
   * Ce qui a change depuis la derniere fois.
   *
   * Les notes sont rangees au moment de l'installation, et relues au demarrage
   * suivant : c'est le seul instant ou l'on est disponible pour les lire.
   */
  useEffect(() => {
    try {
      const brut = localStorage.getItem(CLE_VUE);
      if (!brut) return;

      const range = JSON.parse(brut) as { version: string; notes: string; montre: boolean };
      if (range.montre || !range.notes.trim()) return;

      setNouveautes({ version: range.version, notes: range.notes });
      localStorage.setItem(CLE_VUE, JSON.stringify({ ...range, montre: true }));
    } catch {
      // Stockage indisponible : on se passe des notes plutot que d'echouer.
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
          useMajEtat.getState().signaler(null, 'a-jour');
          return;
        }

        if (annule) return;

        useMajEtat.getState().signaler(null, 'disponible');

        setDisponible({
          version: mise.version,
          notes: mise.body ?? '',
          installer: async () => {
            setInstallation('cours');
            await mise.downloadAndInstall();

            // Rangees maintenant : au prochain lancement, l'application les
            // trouvera et les montrera.
            try {
              localStorage.setItem(
                CLE_VUE,
                JSON.stringify({ version: mise.version, notes: mise.body ?? '', montre: false }),
              );
            } catch {
              // Sans stockage, on perd les notes. Rien de plus.
            }

            setInstallation('prete');
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

  const relancer = async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  };

  return (
    <>
      {disponible ? (
        <div className="maj" role="status">
          <span className="maj__marque" aria-hidden="true">
            <Icon name="arrow-down" size={16} />
          </span>

          <div className="maj__corps">
            <p className="maj__titre">
              {installation === 'prete'
                ? 'Mise a jour prete'
                : `Quality ${disponible.version} est disponible`}
            </p>
            <p className="maj__note">
              {installation === 'prete'
                ? 'Elle s’appliquera au prochain lancement.'
                : 'Elle s’installe sans reinstaller l’application.'}
            </p>
          </div>

          {installation === 'prete' ? (
            <>
              <button type="button" className="btn btn--sm btn--primary" onClick={() => void relancer()}>
                Relancer
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setDisponible(null)}
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
                onClick={() => setDisponible(null)}
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
        <ul className="maj__liste">
          {(nouveautes?.notes ?? '')
            .split('\n')
            .map((ligne) => ligne.replace(/^[-*\s]+/, '').trim())
            .filter((ligne) => ligne.length > 0)
            .slice(0, 12)
            .map((ligne) => (
              <li key={ligne}>{ligne}</li>
            ))}
        </ul>
      </Modal>
    </>
  );
}
