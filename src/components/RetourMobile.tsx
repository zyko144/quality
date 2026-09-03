import { Icon } from '@/components/Icon';
import { useIsMobile } from '@/lib/useMediaQuery';
import { useUI } from '@/store/ui';

/**
 * Le retour vers la navigation, sur telephone.
 *
 * Sur petit ecran la barre laterale est hors champ : elle coulisse par-dessus
 * la page au lieu de la cotoyer. Une page qui occupe tout l'ecran sans porter ce
 * bouton est donc une impasse — on y entre, et plus rien n'en sort. C'etait le
 * cas des amis, de l'assistant, des badges, des suggestions et du support : cinq
 * pages, cinq culs-de-sac.
 *
 * L'en-tete des salons avait le bouton depuis toujours. Le recopier dans chaque
 * page aurait fait cinq copies a tenir d'accord — et il a suffi qu'une seule
 * page soit ajoutee sans lui pour qu'on s'y retrouve bloque. Un composant ne
 * s'oublie pas de la meme facon : il se voit manquer a la lecture de l'en-tete.
 *
 * Une fleche, et non un chevron ni trois barres : sur telephone on ne cherche
 * pas a « ouvrir un tiroir », on cherche a revenir d'ou l'on vient. La fleche
 * dit ou l'on va ; le reste dit comment ca bouge, ce que personne ne demande.
 *
 * Rend `null` sur grand ecran, ou la barre laterale est deja visible et ou le
 * bouton ne ferait que voler de la place a un titre.
 */
export function RetourMobile({ label = 'Revenir a la navigation' }: { label?: string }) {
  const isMobile = useIsMobile();

  if (!isMobile) return null;

  /*
   * Quitter la page, PUIS ouvrir le tiroir.
   *
   * Il n'ouvrait que le tiroir. Le tiroir se pose par-dessus, on le referme, et
   * l'on se retrouve exactement ou l'on etait : sur la page qu'on voulait
   * quitter. Le bouton ne ramenait donc nulle part — il ouvrait un menu, ce qui
   * n'est pas ce qu'une fleche vers la gauche promet.
   *
   * Fermer d'abord met la conversation derriere le tiroir. Refermer celui-ci,
   * d'un geste ou en touchant a cote, laisse alors la ou l'on voulait aller.
   */
  const revenir = () => {
    /*
     * On ferme les quatre pages pleines, sans en rouvrir une.
     *
     * `showDirectMessages` etait le geste evident, mais elle REMET `friendsOpen`
     * a vrai — c'est son role, le bouton d'accueil des messages prives ouvre les
     * amis. Depuis la page des amis elle ne changeait donc rien, et le bouton y
     * restait aussi mort qu'avant.
     *
     * On pose l'etat directement : la vue reste celle des messages prives, et
     * c'est la conversation en cours — ou son absence — qui reparait derriere
     * le tiroir.
     */
    useUI.setState({
      friendsOpen: false,
      wavesOpen: false,
      suggestionsOpen: false,
      supportOpen: false,
    });

    useUI.getState().openNav();
  };

  return (
    <button type="button" className="icon-btn retour-mobile" onClick={revenir} aria-label={label}>
      <Icon name="arrow-left" size={18} />
    </button>
  );
}
