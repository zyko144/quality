import { useEffect, useState } from 'react';
import { useSession } from '@/store/session';
import { useRoute, navigate } from '@/lib/router';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { PasswordRecovery } from '@/features/auth/PasswordRecovery';
import { ChooseUsername } from '@/features/auth/ChooseUsername';
import { Landing } from '@/features/landing/Landing';
import { Workspace } from '@/features/shell/Workspace';
import { MaintenanceScreen } from '@/features/maintenance/MaintenanceScreen';
import { RetourScreen } from '@/features/maintenance/RetourScreen';
import { EN_MAINTENANCE, traverseLaMaintenance } from '@/features/maintenance/acces';
import { doitAnnoncerLeRetour, marquerRetourVu } from '@/features/maintenance/retour';

/**
 * Echow, et le verrou de maintenance.
 *
 * Pendant une maintenance, l'application entiere est remplacee par son ecran —
 * pour les comptes existants comme pour les nouveaux, et quelle que soit la
 * version installee.
 *
 * A une exception pres, sans laquelle la maintenance se ferait a l'aveugle :
 * les comptes de l'equipe passent, et voient l'application telle qu'elle est en
 * train d'etre reparee. Voir `acces.ts` — la liste y est ecrite en dur, parce
 * qu'elle doit valoir meme quand la base est justement ce qu'on repare.
 *
 * La connexion reste donc joignable, mais elle ne mene nulle part pour qui
 * n'est pas sur la liste : on retombe sur l'ecran de maintenance apres s'etre
 * identifie. Ouvrir un compte pendant la maintenance ne donne acces a rien.
 */
export function App() {
  const session = useSession((state) => state.session);
  const loading = useSession((state) => state.loading);
  const recovering = useSession((state) => state.recovering);
  const profile = useSession((state) => state.profile);
  const initialize = useSession((state) => state.initialize);

  const { route } = useRoute();

  // Lu une seule fois : ce que l'on a deja vu ne change pas en cours de session.
  const [annoncerRetour, setAnnoncerRetour] = useState(doitAnnoncerLeRetour);

  useEffect(() => initialize(), [initialize]);

  /**
   * Redirections.
   *
   * Elles vivent dans un effet et non dans le rendu : appeler `navigate`
   * pendant un rendu modifierait l'historique au milieu d'une passe de React,
   * ce qui declencherait un second rendu immediat et, ici, une boucle.
   */
  useEffect(() => {
    if (loading || recovering) return;

    // Une session ouverte n'a rien a faire sur la presentation ou la connexion.
    if (session && route !== '/app') {
      navigate('/app', { replace: true });
      return;
    }

    // Sans session, l'application renvoie vers la connexion plutot que vers un
    // ecran vide.
    if (!session && route === '/app') {
      navigate('/connexion', { replace: true });
    }
  }, [session, route, loading, recovering]);

  /*
   * Rien pendant le chargement, et c'est voulu.
   *
   * L'ecran d'attente de `index.html` est encore a l'ecran : il porte le logo,
   * le nom et sa barre, et il est peint avant meme que le script ne soit lu.
   * En afficher un second par-dessus donnait deux chargements a la suite — le
   * logo qui tourne, puis une roue grise sans rapport — et faisait paraitre le
   * demarrage deux fois plus long qu'il ne l'est.
   *
   * C'est `main.tsx` qui retire le voile, une fois la session connue.
   */
  if (loading) return null;

  /*
   * Le verrou, pose apres la session et avant tout le reste.
   *
   * Apres, parce qu'il faut savoir QUI demande avant de decider. Avant tout le
   * reste, parce qu'une fois passe ce point l'application est entiere : rien
   * ne doit pouvoir s'y glisser sans etre passe par ici.
   *
   * La connexion echappe au verrou — c'est le seul chemin par lequel un compte
   * de l'equipe peut se faire reconnaitre. Elle ne donne acces a rien de plus
   * pour les autres, qui retombent ici une fois identifies.
   */
  const autorise = traverseLaMaintenance(session?.user.email);

  if (EN_MAINTENANCE && !autorise && route !== '/connexion') {
    return <MaintenanceScreen />;
  }

  /*
   * La levee de la maintenance s'annonce, une fois.
   *
   * A ceux qui ont vu l'ecran rouge, et a eux seuls. Les ramener directement
   * dans l'application les laisserait supposer que rien n'a change — ou pire,
   * que ca n'avait pas ete coupe. Mais l'annoncer a qui decouvre Echow ce
   * jour-la serait absurde : on lui apprendrait la fin d'une absence qu'il n'a
   * pas vecue, et il faudrait cliquer pour la passer.
   *
   * Avant la reprise du mot de passe et avant l'espace de travail : c'est le
   * premier ecran de la session qui suit la maintenance, sinon ce n'est plus un
   * retour, c'est une interruption.
   */
  if (!EN_MAINTENANCE && annoncerRetour) {
    return (
      <RetourScreen
        onEntrer={() => {
          marquerRetourVu();
          setAnnoncerRetour(false);
        }}
      />
    );
  }

  // Le retour depuis un lien de recuperation passe avant tout le reste : une
  // session est deja ouverte, mais le mot de passe n'a pas encore ete choisi.
  if (recovering) {
    return <PasswordRecovery />;
  }

  /*
   * Entrer ne demande qu'une session — la liste ne vaut que sous maintenance.
   *
   * Cette condition etait `session && autorise`, ce qui etait juste tant que la
   * maintenance durait : la liste disait qui pouvait passer. Elle est restee
   * telle quelle a la levee, et tous ceux qui n'y figurent pas se sont mis a
   * retomber sur la page d'accueil APRES s'etre connectes. Leur session
   * existait, leur compte etait bon, et l'application les renvoyait a la porte
   * qu'ils venaient de franchir.
   *
   * Le defaut ne pouvait pas se voir de mon cote : mon adresse est sur la
   * liste. Il ne touchait que les autres, tous les autres, et sur le web comme
   * sur le bureau — ce qui a fait chercher du cote de l'application de bureau
   * pendant des heures.
   *
   * Un drapeau leve doit rendre son verrou inoffensif, pas le laisser en place
   * a moitie. C'est ce que la condition dit maintenant.
   */
  if (session && (!EN_MAINTENANCE || autorise)) {
    // Un compte ouvert par un fournisseur tiers arrive avec un pseudo deduit
    // de son adresse. On le fait trancher avant d'entrer : c'est ce par quoi
    // les autres le mentionneront.
    //
    // La colonne peut manquer si la migration n'est pas appliquee : on ne
    // bloque alors personne, `undefined` etant traite comme « deja choisi ».
    if (profile && profile.username_chosen === false) {
      return <ChooseUsername />;
    }

    return (
      <>
        <a className="skip-link" href="#conversation">
          Aller a la conversation
        </a>
        <Workspace />
      </>
    );
  }

  if (route === '/connexion') {
    return <AuthScreen />;
  }

  // Hors maintenance, la presentation reste la porte d'entree ordinaire.
  return EN_MAINTENANCE ? <MaintenanceScreen /> : <Landing />;
}
