import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { useDevices } from '@/store/devices';
import { SON_DE_L_APPLICATION } from './sonPartage';

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

  /*
   * Les applications ouvertes, pour le mode « une autre application ».
   *
   * Les fenetres reduites sont ecartees ici, alors qu'elles figurent bien dans
   * la liste du haut. La difference tient a ce qu'on en fait : choisir une
   * fenetre reduite la ROUVRE, et elle se met alors a jouer. Choisir son son
   * ne la rouvre pas — on ecouterait une application rangee, qui se tait.
   */
  const ouvertes = (sources ?? []).filter(
    (source) => source.genre === 'fenetre' && !source.reduite,
  );

  const modeChoisi: 'tout' | 'partagee' | 'autre' =
    media.loopbackSource === null
      ? 'tout'
      : media.loopbackSource === SON_DE_L_APPLICATION
        ? 'partagee'
        : 'autre';

  /*
   * Trois facons de repondre a « qu'est-ce qu'on entend », et leur prix.
   *
   * L'ordre n'est pas indifferent : le premier est le defaut, et c'est celui
   * qui marche toujours. Les deux autres sont plus fins et supposent quelque
   * chose — une fenetre choisie, une application qui joue son son elle-meme.
   */
  const modes = [
    {
      id: 'tout' as const,
      icone: 'monitor' as const,
      titre: 'Tout l’ordinateur',
      detail: 'Le jeu, la musique, les videos — tout ce qui joue.',
      empeche: undefined as string | undefined,
      valeur: () => null,
    },
    {
      id: 'partagee' as const,
      icone: 'square' as const,
      titre: 'L’application partagee',
      detail: 'Seulement ce que joue la fenetre choisie.',
      // Un ecran entier n'a pas d'application derriere : il n'y a rien a suivre.
      empeche:
        onglet === 'fenetre'
          ? undefined
          : 'Il faut partager une application, pas un ecran entier.',
      valeur: () => SON_DE_L_APPLICATION,
    },
    {
      id: 'autre' as const,
      icone: 'sliders' as const,
      titre: 'Une autre application',
      detail: 'Le son d’un programme, meme s’il n’est pas a l’image.',
      empeche: ouvertes.length === 0 ? 'Aucune application ouverte.' : undefined,
      // Deja dans ce mode : on garde l'application choisie plutot que de la
      // remplacer par la premiere de la liste a chaque clic sur la pastille.
      valeur: () =>
        modeChoisi === 'autre' ? media.loopbackSource : (ouvertes[0]?.id ?? null),
    },
  ];

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

          {/*
            D'ou vient le son.

            Ce reglage n'existait que pour le partage d'ECRAN : partager une
            fenetre prenait le son de son application, sans rien demander.
            C'etait le choix le plus juste — le jeu part, la conversation d'a
            cote reste — et il laissait sans recours ceux pour qui il ne marche
            pas.

            Car il suppose que l'application joue son son ELLE-MEME, ce que
            Windows ne garantit pas : un navigateur confie le sien a un
            processus de service, et partager l'onglet YouTube ouvrait une
            capture parfaitement valide qui ne portait rien. Rien dans
            l'interface ne permettait d'y remedier, ni meme de le comprendre.

            Le choix est donc rendu, dans les deux cas.
          */}
          {media.shareSystemAudio ? (
            <div className="picker__son-source">
              <span className="picker__etiquette">Quel son faire entendre</span>

              <div className="picker__sources">
                {modes.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={
                      'picker__source-son' + (modeChoisi === mode.id ? ' is-active' : '')
                    }
                    aria-pressed={modeChoisi === mode.id}
                    disabled={mode.empeche !== undefined}
                    title={mode.empeche}
                    onClick={() => setMedia('loopbackSource', mode.valeur())}
                  >
                    <span className="picker__source-son-icone" aria-hidden="true">
                      <Icon name={mode.icone} size={16} />
                    </span>
                    <span className="picker__source-son-titre">{mode.titre}</span>
                    <span className="picker__source-son-detail">
                      {mode.empeche ?? mode.detail}
                    </span>
                  </button>
                ))}
              </div>

              {/*
                La liste ne parait qu'au troisieme mode.

                La montrer toujours ferait croire qu'il faut y choisir quelque
                chose pour que les deux autres marchent, alors qu'ils s'en
                passent entierement.
              */}
              {modeChoisi === 'autre' ? (
                <label className="picker__reglage">
                  <span className="picker__etiquette">L&rsquo;application a suivre</span>
                  <select
                    className="picker__liste"
                    value={media.loopbackSource ?? ''}
                    onChange={(event) => setMedia('loopbackSource', event.target.value || null)}
                  >
                    {ouvertes.length === 0 ? <option value="">Aucune application ouverte</option> : null}
                    {ouvertes.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.titre}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {/*
                Le prix de chaque mode, dit avant qu'on le paie.

                Se decouvrir muet — ou en double — au milieu d'un partage, sans
                savoir lequel des deux reglages en est la cause, est
                exactement ce qui a rendu ce defaut si long a nommer.
              */}
              <p className="picker__note">
                {modeChoisi === 'tout'
                  ? 'Tout ce qui joue part, y compris ce qui n’est pas partage a l’image. Si vous vous entendez en double — un routeur audio comme Voicemeeter rejoue votre voix — suivez plutot une application.'
                  : 'Le son des autres programmes reste chez vous. Certaines applications, les navigateurs surtout, ne jouent pas leur son elles-memes : si rien ne s’entend au bout de quelques secondes, tout l’ordinateur est repris automatiquement.'}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
