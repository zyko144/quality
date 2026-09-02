import { useEffect } from 'react';
import { useVoice } from './useVoice';
import {
  useRaccourcis,
  correspond,
  codeSouris,
  type ActionVocale,
  type Combinaison,
} from '@/store/raccourcis';
import { tenir, etatTenueVide, type Evenement, type EtatTenue } from './tenue';
import { surveillerGlobalement, enSaisie } from './clavierGlobal';
import { journal } from '@/lib/journal';

/**
 * Toutes les touches du vocal, en un seul endroit.
 *
 * Elles etaient a deux endroits : les bascules dans le grand gestionnaire de
 * `Workspace`, les touches maintenues ici. Cela tenait tant que les deux
 * lisaient le meme clavier — mais des lors qu'une partie passe par le systeme
 * et l'autre par la fenetre, la meme pression arrive deux fois et la bascule
 * s'annule elle-meme. Deux chemins vers une bascule, c'est un chemin de trop.
 *
 * Deux facons d'entendre le clavier
 * ---------------------------------
 * **Par le systeme**, quand l'application de bureau le permet : les touches
 * repondent meme au-dessus d'un jeu, ce qui est la seule facon utile d'avoir un
 * push-to-talk. Voir `clavierGlobal.ts` et `clavier.rs`.
 *
 * **Par la fenetre**, sinon : dans un navigateur, ou si le systeme refuse le
 * crochet. Les touches ne repondent alors qu'au premier plan — c'est ce qu'on
 * avait partout jusqu'ici.
 *
 * **Les deux sont branches en permanence**, et c'est une correction, pas un
 * oubli. La version precedente n'en gardait qu'un : quand le systeme
 * s'annoncait actif, la fenetre etait debranchee. Une seule faille en aval — un
 * evenement qui ne traverse pas, une ecoute qui ne s'attache pas — et il ne
 * restait plus AUCUN raccourci, pas meme ceux qui marchaient depuis toujours.
 * Un repli qu'on demonte des que le chemin principal se declare n'est pas un
 * repli.
 *
 * Le double declenchement est ecarte autrement : le chemin systeme laisse une
 * trace datee de ce qu'il vient de traiter, et celui de la fenetre s'efface
 * devant elle. Une trace perimee ne bloque rien, si bien que le pire cas reste
 * « les raccourcis marchent quand la fenetre est devant » — ce qu'on avait
 * toujours eu.
 *
 * Ce que les touches maintenues rendent
 * -------------------------------------
 * Relacher ne coupe pas et n'ouvre pas : cela rend l'etat qui precedait
 * l'appui. Quelqu'un qui parlait deja micro ouvert continue de parler apres
 * avoir lache la touche « parler » — sans quoi la premiere pression l'aurait
 * coupe pour de bon, et c'est le genre de surprise qu'on ne relie jamais a un
 * raccourci. La mecanique vit dans `tenue.ts`, seule et sans effet, avec ses
 * cas — dont vingt allers-retours d'affilee.
 */

/** Ce que l'enfoncement doit produire, pour les deux touches maintenues. */
type Sens = 'parler' | 'couper';

const MAINTENUES: Record<Sens, ActionVocale> = {
  parler: 'pousser-pour-parler',
  couper: 'pousser-pour-couper',
};

export function RaccourcisVocaux() {
  const raccourcis = useRaccourcis((state) => state.liste);

  useEffect(() => {
    let abandonne = false;
    let defaire: (() => void) | null = null;
    let surveilleParLeSysteme = false;

    const pour = (action: ActionVocale) =>
      raccourcis.find((entree) => entree.action === action)?.combinaison ?? null;

    // Une machine a etats par touche maintenue, gardee entre les pressions :
    // c'est elle qui retient ce qu'il y avait avant l'appui.
    const tenues: Record<Sens, EtatTenue> = {
      parler: etatTenueVide(),
      couper: etatTenueVide(),
    };

    /**
     * Applique une touche maintenue.
     *
     * Aucune sortie anticipee entre la decision et son application, et c'est le
     * point le plus important de cette fonction.
     *
     * Une version precedente verifiait qu'on etait bien dans un salon APRES
     * avoir consulte la mecanique — laquelle avait deja note que la touche etait
     * relachee. Quand la verification echouait, et elle echoue pendant les
     * fractions de seconde ou l'on rejoint un salon, le relachement etait
     * enregistre sans etre applique : le micro restait coupe, la touche etait
     * consideree comme lachee, et plus rien ne le rouvrait.
     *
     * Rendre un etat de micro hors d'un salon est sans consequence — il n'y a
     * pas de piste a couper — alors qu'omettre de le rendre coute la parole.
     */
    const maintenir = (sens: Sens, evenement: Evenement) => {
      const voulu = sens === 'couper';
      const suite = tenir(tenues[sens], evenement, useVoice.getState().muted, voulu);

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

      // La mecanique rend une valeur VOULUE, pas une bascule : on ne bascule
      // donc que si l'on n'y est pas deja. C'est ce qui rend le martelement
      // inoffensif.
      if (useVoice.getState().muted !== suite.micro) useVoice.getState().toggleMute();
    };

    /** Les bascules : une pression, un changement d'etat. */
    const basculer = (action: ActionVocale) => {
      const voix = useVoice.getState();
      if (!voix.channelId) return;

      if (action === 'micro') voix.toggleMute();
      else if (action === 'sourdine') voix.toggleDeafen();
      else if (action === 'camera') void voix.toggleCamera();
      else if (action === 'partage') void voix.toggleScreenShare();
      else if (action === 'quitter') void voix.leave();
    };

    /**
     * Le seul point d'entree, quelle que soit la provenance de la frappe.
     *
     * Les deux chemins — systeme et fenetre — aboutissent ici, ce qui garantit
     * qu'une touche fait la meme chose dans les deux cas.
     */
    const agir = (action: ActionVocale, bas: boolean) => {
      /*
       * Une touche de conversation ne s'active pas pendant qu'on ecrit.
       *
       * Le systeme, lui, ne sait rien de ce qu'on fait : il signale la touche
       * que la fenetre soit devant ou non. Sans ce filtre, taper « M » dans un
       * message couperait le micro. Le filtre ne mord que si la fenetre a le
       * focus — voir `enSaisie` : ecrire dans un jeu n'est pas ecrire ici.
       */
      if (enSaisie()) return;

      if (action === 'pousser-pour-parler') {
        if (bas && !useVoice.getState().channelId) return;
        maintenir('parler', bas ? 'bas' : 'haut');
        return;
      }

      if (action === 'pousser-pour-couper') {
        if (bas && !useVoice.getState().channelId) return;
        maintenir('couper', bas ? 'bas' : 'haut');
        return;
      }

      if (bas) basculer(action);
    };

    /*
     * Ce que le systeme vient de traiter, et quand.
     *
     * La fenetre recoit la meme frappe que lui quand l'application est devant.
     * Sans cette trace, la bascule partirait deux fois — donc pas du tout.
     *
     * Un quart de seconde : bien plus que l'ecart entre les deux chemins pour
     * une meme frappe, bien moins que l'intervalle entre deux pressions
     * volontaires, meme rapides.
     */
    const traitees = new Map<string, number>();
    const MEMOIRE = 250;

    const dejaTraitee = (action: ActionVocale, bas: boolean) => {
        const cle = `${action}|${bas}`;
        const vue = traitees.get(cle);
        return vue !== undefined && Date.now() - vue < MEMOIRE;
    };

    /* ------------------------------------------------------------------ */
    /* Par la fenetre : toujours branche.                                   */
    /* ------------------------------------------------------------------ */

    const parLaFenetre = (): (() => void) => {
      const enfoncee = (event: KeyboardEvent) => {
        // Windows repete l'enfoncement tant que la touche reste pressee : sans
        // ce filtre, tenir une touche la ferait basculer trente fois par seconde.
        if (event.repeat) return;

        for (const entree of raccourcis) {
          if (!correspond(event, entree.combinaison)) continue;
          event.preventDefault();
          // Le systeme a pu voir la meme frappe un instant plus tot.
          if (!dejaTraitee(entree.action, true)) agir(entree.action, true);
          return;
        }
      };

      const relachee = (event: KeyboardEvent) => {
        for (const sens of ['parler', 'couper'] as Sens[]) {
          const combinaison = pour(MAINTENUES[sens]);
          // Le code de la touche, pas la combinaison entiere : lacher `Ctrl`
          // avant la lettre change la combinaison, pas le fait qu'on a lache.
          if (!combinaison || event.code !== combinaison.code) continue;
          if (!dejaTraitee(MAINTENUES[sens], false)) agir(MAINTENUES[sens], false);
        }
      };

      /*
       * La fenetre peut perdre le focus touche enfoncee — un alt-tab en pleine
       * phrase. Le relachement partirait alors ailleurs, et le micro resterait
       * dans la position de la pression sans que rien ne le ramene.
       *
       * Ce rattrapage n'a de sens que sur ce chemin-la : quand le systeme
       * surveille, l'alt-tab est justement le cas nominal, et rendre le micro
       * en quittant la fenetre reviendrait a couper le push-to-talk a l'instant
       * ou il commence a servir.
       */
      const rendre = () => {
        /*
         * Quand le systeme surveille, un alt-tab est le cas nominal : rendre le
         * micro en quittant la fenetre couperait le push-to-talk a l'instant
         * meme ou il commence a servir. Le vrai relachement arrivera par le
         * systeme, qui le voit ou que l'on soit.
         */
        if (surveilleParLeSysteme) return;

        maintenir('parler', 'perdu');
        maintenir('couper', 'perdu');
      };

      /*
       * Les boutons de souris, par la fenetre aussi.
       *
       * Sans cela, un bouton de pouce ne repondrait que dans l'application de
       * bureau, jamais dans un navigateur — et l'ecart serait d'autant plus
       * deroutant qu'il porterait sur un seul type de raccourci.
       */
      const clic = (event: MouseEvent, bas: boolean) => {
        const code = codeSouris(event.button);
        if (!code) return;

        for (const entree of raccourcis) {
          if (!entree.combinaison || entree.combinaison.code !== code) continue;

          // Les modificateurs ne sont exiges qu'a l'enfoncement, comme pour les
          // touches : lacher `Ctrl` avant le bouton ne defait pas le fait qu'on
          // a lache le bouton.
          if (
            bas &&
            (event.ctrlKey !== entree.combinaison.ctrl ||
              event.shiftKey !== entree.combinaison.shift ||
              event.altKey !== entree.combinaison.alt)
          ) {
            continue;
          }

          event.preventDefault();
          if (!dejaTraitee(entree.action, bas)) agir(entree.action, bas);
          return;
        }
      };

      const clicBas = (event: MouseEvent) => clic(event, true);
      const clicHaut = (event: MouseEvent) => clic(event, false);

      window.addEventListener('keydown', enfoncee);
      window.addEventListener('keyup', relachee);
      window.addEventListener('blur', rendre);
      window.addEventListener('mousedown', clicBas);
      window.addEventListener('mouseup', clicHaut);

      return () => {
        window.removeEventListener('keydown', enfoncee);
        window.removeEventListener('keyup', relachee);
        window.removeEventListener('blur', rendre);
        window.removeEventListener('mousedown', clicBas);
        window.removeEventListener('mouseup', clicHaut);
        rendre();
      };
    };

    /* ------------------------------------------------------------------ */
    /* Par le systeme, si possible.                                        */
    /* ------------------------------------------------------------------ */

    const entrees = raccourcis
      .filter((entree): entree is typeof entree & { combinaison: Combinaison } =>
        entree.combinaison !== null,
      )
      .map((entree) => ({ nom: entree.action, combinaison: entree.combinaison }));

    // La fenetre d'abord, et sans condition : c'est le socle, pas le repli.
    const defaireFenetre = parLaFenetre();

    void surveillerGlobalement(entrees, (frappe) => {
      const action = frappe.nom as ActionVocale;
      traitees.set(`${action}|${frappe.bas}`, Date.now());
      agir(action, frappe.bas);
    }).then((suivi) => {
      // L'effet a pu etre defait pendant l'attente : on rend alors ce qu'on
      // vient d'obtenir plutot que de laisser une surveillance orpheline.
      if (abandonne) {
        suivi.arreter();
        return;
      }

      surveilleParLeSysteme = suivi.actif;
      defaire = suivi.arreter;

      journal.info(
        'vocal',
        suivi.actif
          ? 'Touches vocales surveillees par le systeme'
          : 'Touches vocales lues par la fenetre seule',
        { touches: entrees.length },
      );
    });

    return () => {
      abandonne = true;
      defaire?.();
      defaireFenetre();
    };
  }, [raccourcis]);

  return null;
}
