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
import { retourDejaVu, marquerRetourVu } from '@/features/maintenance/retour';

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
  const [retourVu, setRetourVu] = useState(retourDejaVu);

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
   * La derniere chose que ces gens ont vue est un ecran rouge disant que tout
   * etait suspendu. Les ramener directement dans l'application les laisserait
   * supposer que rien n'a change — ou pire, que ca n'avait pas ete coupe.
   *
   * Avant la reprise du mot de passe et avant l'espace de travail : c'est le
   * premier ecran de la session qui suit la maintenance, sinon ce n'est plus un
   * retour, c'est une interruption.
   */
  if (!EN_MAINTENANCE && !retourVu) {
    return (
      <RetourScreen
        onEntrer={() => {
          marquerRetourVu();
          setRetourVu(true);
        }}
      />
    );
  }

  // Le retour depuis un lien de recuperation passe avant tout le reste : une
  // session est deja ouverte, mais le mot de passe n'a pas encore ete choisi.
  if (recovering) {
    return <PasswordRecovery />;
  }

  if (session && autorise) {
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
