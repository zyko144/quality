import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { useDevices } from '@/store/devices';

/**
 * Notre propre selecteur de partage.
 *
 * Les sources viennent du systeme, pas du moteur web : une commande Rust
 * enumere les ecrans et les fenetres, apercu compris. C'est ce que le
 * navigateur ne nous laisse pas faire, et ce qu'une application de bureau a le
 * droit de faire.
 *
 * Ce que l'apercu montre
 * ----------------------
 * La fenetre elle-meme, et non le rectangle d'ecran qu'elle occupe. La
 * difference n'est pas cosmetique : l'ancienne vignette recopiait l'ecran a
 * l'endroit de la fenetre, si bien qu'une fenetre derriere une autre montrait
 * celle de devant. On choisissait Steam et l'on voyait le navigateur pose
 * dessus — d'ou l'impression, tres juste, de partager l'ecran entier.
 *
 * Les fenetres reduites
 * ---------------------
 * Elles figurent dans la liste. « Toutes mes applications ouvertes » comprend
 * celles qu'on vient de ranger dans la barre des taches, et les taire donnait
 * le sentiment que le selecteur en oubliait la moitie. Elles n'ont pas
 * d'apercu — une fenetre reduite ne dessine rien, et rien ne peut le lui faire
 * faire — et les choisir les rouvre, sans voler le focus.
 */

interface Source {
  id: string;
  titre: string;
  genre: 'fenetre' | 'ecran';
  largeur: number;
  hauteur: number;
  x: number;
  y: number;
  vignette: string;
  /** La fenetre est rangee dans la barre des taches. */
  reduite: boolean;
}

/*
 * Le second ecran ne depend plus que de la capture native.
 *
 * Sans elle, on demandait au moteur web l'ecran entier — toujours le premier —
 * et l'on decoupait dedans : tout ce qui vivait ailleurs etait hors d'atteinte,
 * et le proposer aurait ete promettre ce qu'on ne peut pas tenir.
 *
 * Windows sait capturer n'importe quel moniteur. La restriction ne vaut donc
 * plus que pour le repli, et c'est ce que dit cette fonction — au lieu de
 * refuser un ecran qui marche tres bien.
 */
function indisponible(source: Source, natif: boolean): boolean {
  return source.genre === 'ecran' && !natif && !(source.x === 0 && source.y === 0);
}

const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function SourcePicker({
  open,
  onClose,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (source: Source | null) => void;
}) {

  const media = useDevices((state) => state.media);
  const setMedia = useDevices((state) => state.setMedia);

  // Lu une fois : ce que le moteur sait faire ne change pas en cours de route.
  const [natif, setNatif] = useState(false);

  const [sources, setSources] = useState<Source[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<'ecran' | 'fenetre'>('ecran');
  const [choisie, setChoisie] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !DANS_TAURI) return;

    let annule = false;
    setSources(null);
    setErreur(null);
    setChoisie(null);

    void (async () => {
      try {
        const [{ invoke }, { captureNativeDisponible }] = await Promise.all([
          import('@tauri-apps/api/core'),
          import('./imageSysteme'),
        ]);

        const liste = await invoke<Source[]>('sources_partageables');
        if (annule) return;

        setNatif(captureNativeDisponible());
        setSources(liste);
      } catch (cause) {
        if (!annule) setErreur(String(cause));
      }
    })();

    return () => {
      annule = true;
    };
  }, [open]);

  const visibles = (sources ?? []).filter((source) => source.genre === onglet);
  const selection = (sources ?? []).find((source) => source.id === choisie) ?? null;

  return (
    <Modal
      open={open}
      title="Partager votre ecran"
      description="Choisissez ce que les autres verront."
      onClose={onClose}
      width={880}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={selection === null}
            onClick={() => onStart(selection)}
          >
            <Icon name="screen" size={15} />
            Partager
          </button>
        </>
      }
    >
      <div className="picker">
        <nav className="picker__tabs" aria-label="Type de source">
          {(
            [
              { id: 'ecran', label: 'Ecran entier', icone: 'monitor' },
              { id: 'fenetre', label: 'Applications', icone: 'square' },
            ] as const
          ).map((entree) => (
            <button
              key={entree.id}
              type="button"
              className={'picker__tab' + (onglet === entree.id ? ' is-active' : '')}
              aria-current={onglet === entree.id ? 'page' : undefined}
              onClick={() => setOnglet(entree.id)}
            >
              <Icon name={entree.icone} size={15} />
              {entree.label}
            </button>
          ))}
        </nav>

        {!DANS_TAURI ? (
          <p className="picker__note">
            Cette liste vient du systeme : elle n&rsquo;existe que dans
            l&rsquo;application de bureau. Dans un navigateur, c&rsquo;est lui qui
            demande ce que vous voulez partager.
          </p>
        ) : erreur ? (
          <p className="picker__note picker__note--erreur">
            Les sources n&rsquo;ont pas pu etre listees : {erreur}
          </p>
        ) : sources === null ? (
          <div className="picker__grid">
            {[0, 1, 2, 3].map((index) => (
              <span className="skeleton picker__squelette" key={index} />
            ))}
          </div>
        ) : visibles.length === 0 ? (
          <p className="picker__note">
            {onglet === 'fenetre'
              ? 'Aucune fenetre partageable.'
              : 'Aucun ecran detecte.'}
          </p>
        ) : (
          <ul className="picker__grid">
            {visibles.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  className={
                    'picker__source' +
                    (choisie === source.id ? ' is-active' : '') +
                    (indisponible(source, natif) ? ' is-indisponible' : '')
                  }
                  disabled={indisponible(source, natif)}
                  onClick={() => setChoisie(source.id)}
                  aria-pressed={choisie === source.id}
                  title={
                    indisponible(source, natif)
                      ? 'Seul l’ecran principal peut etre partage sur cette machine.'
                      : source.reduite
                        ? `${source.titre} — reduite, elle se rouvrira`
                        : source.titre
                  }
                >
                  <span className="picker__apercu">
                    {source.vignette ? (
                      <img src={source.vignette} alt="" />
                    ) : (
                      <span className="picker__apercu-vide" aria-hidden="true">
                        {/* Une fenetre reduite n'est pas une capture ratee :
                            elle ne dessine rien, et le signe le dit. */}
                        <Icon name={source.reduite ? 'arrow-down' : 'monitor'} size={22} />
                      </span>
                    )}
                  </span>
                  <span className="picker__titre truncate">{source.titre}</span>
                  <span className="picker__taille">
                    {indisponible(source, natif)
                      ? 'Indisponible sur cette machine'
                      : source.reduite
                        ? 'Reduite — elle se rouvrira'
                        : `${source.largeur} × ${source.hauteur}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="picker__reglages">
          <div className="picker__reglage">
            <span className="picker__etiquette">Definition</span>
            <div className="picker__choix">
              {(['720p', '1080p', 'source'] as const).map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  className={
                    'picker__pastille' + (media.screenQuality === valeur ? ' is-active' : '')
                  }
                  onClick={() => setMedia('screenQuality', valeur)}
                >
                  {valeur === 'source' ? 'Source' : valeur}
                </button>
              ))}
            </div>
          </div>

          <div className="picker__reglage">
            <span className="picker__etiquette">Images</span>
            <div className="picker__choix">
              {([30, 60] as const).map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  className={
                    'picker__pastille' + (media.screenFrameRate === valeur ? ' is-active' : '')
                  }
                  onClick={() => setMedia('screenFrameRate', valeur)}
                >
                  {valeur} i/s
                </button>
              ))}
            </div>
          </div>

          {/*
            Ce qu'on sacrifie quand la liaison ne suit pas.
            A debit egal on ne peut pas tout garder : soit les pixels, soit les
            images. Le dire ici evite de decouvrir le choix apres coup, en
            regardant un partage qui parait a trente images alors qu'on en a
            demande soixante.
          */}
          <div className="picker__reglage">
            <span className="picker__etiquette">Si ca coince</span>
            <div className="picker__choix">
              {(
                [
                  { valeur: 'motion', label: 'Garder la fluidite' },
                  { valeur: 'detail', label: 'Garder la nettete' },
                ] as const
              ).map((option) => (
                <button
                  key={option.valeur}
                  type="button"
                  className={
                    'picker__pastille' +
                    (media.screenPriority === option.valeur ? ' is-active' : '')
                  }
                  onClick={() => setMedia('screenPriority', option.valeur)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/*
            Le son du systeme, dans notre selecteur.

            Il a longtemps vecu dans la fenetre de Windows que nous supprimons
            pour afficher celle-ci — et c'est pour cela que le partage partait
            muet : Chromium n'accorde la piste audio que si SA case a ete
            cochee, ce qui n'arrive jamais quand sa fenetre n'existe pas.

            Ce n'est plus le cas. Le son est capture par le systeme lui-meme,
            hors du moteur web, et arrive par une connexion locale — voir
            `sonSysteme.ts`. Cette bascule commande donc reellement quelque
            chose, ce qui n'etait pas vrai des versions precedentes.

            Elle est posee en bas, seule et en pleine largeur : c'est le
            reglage qu'on vient chercher, pas un detail parmi d'autres.
          */}
          <label className="picker__son">
            <span className="picker__son-icone" aria-hidden="true">
              {/* Le jeu d'icones n'a pas de « volume barre » : le micro coupe
                  porte deja le meme sens — un son qui ne part pas. */}
              <Icon name={media.shareSystemAudio ? 'volume' : 'mic-off'} size={17} />
            </span>

            <span className="picker__son-corps">
              <span className="picker__son-titre">Partager l&rsquo;audio systeme</span>
              <span className="picker__son-detail">
                Le jeu, la musique, les videos — tout ce que joue cet ordinateur.
              </span>
            </span>

            <input
              type="checkbox"
              className="visually-hidden"
              checked={media.shareSystemAudio}
              onChange={(event) => setMedia('shareSystemAudio', event.target.checked)}
            />

            <span
              className={'picker__son-piste' + (media.shareSystemAudio ? ' is-on' : '')}
              aria-hidden="true"
            >
              <span className="picker__son-bouton" />
            </span>
          </label>
        </div>
      </div>
    </Modal>
  );
}
