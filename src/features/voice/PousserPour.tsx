import { useEffect } from 'react';
import { useVoice } from './useVoice';
import { useRaccourcis, correspond, type Combinaison } from '@/store/raccourcis';
import { tenir, etatTenueVide, type Evenement } from './tenue';

/**
 * Les deux touches qu'on maintient : parler, et se taire.
 *
 * Toutes les autres commandes vocales sont des bascules — une pression, un
 * changement d'etat. Ces deux-ci suivent l'enfoncement et le relachement, ce
 * qui demande d'ecouter deux evenements et de retenir ce qu'il y avait avant.
 *
 * Elles sont opposees et se ressemblent trop pour vivre separement : la
 * premiere ouvre le micro tant qu'on tient la touche, la seconde le ferme. Les
 * ecrire deux fois aurait fait diverger deux copies d'une meme mecanique
 * delicate — celle qui, mal faite, laisse un micro ouvert apres un alt-tab.
 *
 * Ce qu'elles rendent est ce qu'elles ont trouve
 * ----------------------------------------------
 * Relacher ne coupe pas, et n'ouvre pas : cela rend l'etat qui precedait
 * l'appui. Quelqu'un qui parlait deja micro ouvert continue de parler apres
 * avoir lache la touche « parler » — sans quoi la premiere pression l'aurait
 * coupe pour de bon, et c'est le genre de surprise qu'on ne relie jamais a un
 * raccourci.
 *
 * Ce qui resiste au martelement
 * -----------------------------
 * La mecanique elle-meme vit dans `tenue.ts`, seule et sans effet, avec les
 * cas qui la couvrent — dont vingt allers-retours d'affilee. Ce fichier-ci ne
 * fait que lui donner les evenements du clavier et appliquer ce qu'elle decide.
 *
 * Ce partage n'est pas de la coquetterie : c'est de la logique a etats, elle se
 * trompe silencieusement, et son erreur ne se voit qu'a l'usage — un micro qui
 * reste coupe apres qu'on a lache, ce que personne ne relie a un raccourci.
 */

type Sens = 'parler' | 'couper';

export function PousserPour() {
  const raccourcis = useRaccourcis((state) => state.liste);

  useEffect(() => {
    const pour = (action: string) =>
      raccourcis.find((entree) => entree.action === action)?.combinaison ?? null;

    const arrets = [
      brancher('parler', pour('pousser-pour-parler')),
      brancher('couper', pour('pousser-pour-couper')),
    ];

    return () => {
      for (const arret of arrets) arret();
    };
  }, [raccourcis]);

  return null;
}

/**
 * Installe une des deux touches, et rend de quoi la retirer.
 *
 * `sens` dit ce que l'enfoncement doit produire : `parler` veut un micro
 * ouvert, `couper` le veut ferme. Tout le reste est identique.
 */
function brancher(sens: Sens, combinaison: Combinaison | null): () => void {
  if (!combinaison) return () => {};

  const etat = etatTenueVide();
  const voulu = sens === 'couper';

  const dansUneSaisie = (cible: EventTarget | null) => {
    const noeud = cible as HTMLElement | null;
    if (!noeud) return false;
    return (
      noeud.tagName === 'INPUT' ||
      noeud.tagName === 'TEXTAREA' ||
      noeud.isContentEditable === true
    );
  };

  /**
   * Applique ce que la mecanique a decide.
   *
   * Aucune sortie anticipee entre la decision et son application, et c'est le
   * point le plus important de cette fonction.
   *
   * La version precedente verifiait qu'on etait bien dans un salon APRES avoir
   * consulte la mecanique — laquelle avait deja note que la touche etait
   * relachee. Quand la verification echouait, et elle echoue pendant les
   * fractions de seconde ou l'on rejoint un salon, le relachement etait
   * enregistre sans etre applique : le micro restait coupe, la touche etait
   * consideree comme lachee, et plus rien ne le rouvrait. On ne pouvait ni
   * parler ni s'en sortir autrement qu'en cliquant le bouton.
   *
   * Rendre un etat de micro hors d'un salon est sans consequence — il n'y a
   * pas de piste a couper — alors qu'omettre de le rendre coute la parole.
   */
  const appliquer = (evenement: Evenement) => {
    const voix = useVoice.getState();
    const suite = tenir(etat, evenement, voix.muted, voulu);

    useVoice.getState().signalerPoussee(suite.tenue && voulu);
    if (suite.micro === null) return;

    // La sourdine se leve aussi : tenir « parler » en etant sourd doit rendre
    // la parole, sinon la touche ne fait rien et l'on ne sait pas pourquoi.
    if (evenement === 'bas' && sens === 'parler' && useVoice.getState().deafened) {
      useVoice.getState().toggleDeafen();
    }

    /*
     * Le relachement rend aussi l'audition.
     *
     * Se retrouver sourd en lachant une touche n'a aucun sens, et c'est
     * pourtant arrive : la sourdine coupe le micro, si bien qu'un etat
     * « sourd » pris pour un simple « micro coupe » etait rendu comme tel.
     */
    if (evenement !== 'bas' && !suite.micro && useVoice.getState().deafened) {
      useVoice.getState().toggleDeafen();
    }

    // La mecanique rend une valeur VOULUE, pas une bascule : on ne bascule donc
    // que si l'on n'y est pas deja. C'est ce qui rend le martelement inoffensif.
    if (useVoice.getState().muted !== suite.micro) useVoice.getState().toggleMute();
  };

  const enfoncee = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (!correspond(event, combinaison)) return;

    // Une touche de conversation ne doit pas s'activer pendant qu'on ecrit :
    // la lettre irait dans le message et le micro changerait par surprise.
    if (dansUneSaisie(event.target)) return;
    if (!useVoice.getState().channelId) return;

    event.preventDefault();
    appliquer('bas');
  };

  const rendre = () => appliquer('perdu');

  const relachee = (event: KeyboardEvent) => {
    // Le code de la touche, pas la combinaison entiere : lacher `Ctrl` avant
    // la lettre change la combinaison, pas le fait qu'on a lache.
    if (event.code !== combinaison.code) return;
    appliquer('haut');
  };

  /*
   * La fenetre peut perdre le focus touche enfoncee — un alt-tab en pleine
   * phrase. Le relachement partirait alors ailleurs, et le micro resterait
   * dans la position de la pression sans que rien ne le ramene.
   */
  window.addEventListener('keydown', enfoncee);
  window.addEventListener('keyup', relachee);
  window.addEventListener('blur', rendre);

  return () => {
    window.removeEventListener('keydown', enfoncee);
    window.removeEventListener('keyup', relachee);
    window.removeEventListener('blur', rendre);
    rendre();
  };
}
