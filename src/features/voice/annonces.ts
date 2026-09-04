/**
 * A quel rythme on a le droit d'annoncer sa presence dans un salon vocal.
 *
 * Le probleme, en une phrase : Realtime ne refuse pas une annonce de presence
 * trop rapide, il FERME le canal. Depasser la cadence ne coute donc pas un
 * message perdu, mais le salon entier — et l'application n'avait aucun moyen de
 * l'apprendre, la trame qui l'explique n'etant journalisee nulle part :
 *
 *     {"message":"Client presence rate limit exceeded","status":"error"}
 *     phx_close
 *
 * C'etait la cause de la boucle vocale, et elle etait entierement de notre
 * fait. Le battement republiait la presence toutes les TROIS secondes ; le
 * serveur fermait le canal a la sixieme annonce, soit quinze secondes apres
 * chaque ouverture. La liste des participants se vidait — « on s'entend mais on
 * ne se voit pas » — la surveillance rebatissait, et l'on recommencait quinze
 * secondes plus tard. Les traces d'un seul appel de vingt minutes montrent cent
 * reconstructions, toutes espacees de la meme quinzaine de secondes.
 *
 * La loi du serveur, mesuree
 * --------------------------
 * Un canal neuf par essai, quarante-cinq secondes de repos entre deux mesures
 * pour ne pas se contaminer soi-meme :
 *
 *     6 annonces d'affilee        la 6e ferme
 *     5 d'affilee + 1 a 25 s      ferme
 *     5 d'affilee + 1 a 30 s      tient
 *     4 d'affilee + 1             tient
 *     une toutes les 3 s          ferme au 6e envoi, a 15,1 s
 *     une toutes les 6 s          tient 150 s (25 envois)
 *
 * Soit : CINQ annonces par fenetre glissante de trente secondes, la sixieme
 * ferme le canal.
 *
 * Pourquoi une fenetre et non un seau a jetons
 * --------------------------------------------
 * Le seau a ete ecrit, puis mesure contre le vrai serveur : il autorise une
 * rafale de quatre, se recharge d'un jeton toutes les sept secondes, et la
 * republication suivante faisait la sixieme annonce DANS la fenetre. Le canal
 * se fermait a soixante-trois secondes. Un seau borne le rythme moyen ; le
 * serveur, lui, compte ce qui est arrive dans les trente dernieres secondes.
 * C'est donc cela qu'il faut compter.
 */

/** Duree sur laquelle le serveur compte les annonces. */
export const FENETRE_PRESENCE = 30_000;

/**
 * Ce qu'on s'autorise dans cette fenetre.
 *
 * Quatre, quand le serveur en accepte cinq. La reserve n'est pas de la
 * timidite : une limite trouvee par la mesure sur un projet, un soir donne,
 * n'est pas un contrat — elle peut differer d'un plan a l'autre, d'une region a
 * l'autre, et changer sans que personne le dise. Se tenir a un de moins coute
 * une annonce par demi-minute et evite de rendre le vocal inutilisable le jour
 * ou elle bougera.
 */
export const ANNONCES_PAR_FENETRE = 4;

/**
 * Delai au bout duquel on se re-annonce sans avoir rien change.
 *
 * La presence de Realtime est declarative : elle ne vaut que tant que le
 * serveur en garde la trace. Une reconnexion du socket, un envoi perdu, et
 * notre entree n'y est plus sans que rien ne s'en apercoive — on reste alors
 * invisible dans son propre salon. Ce filet-la est utile ; il etait seulement
 * tendu huit fois trop serre, et c'est lui qui coupait la corde.
 *
 * Vingt-cinq secondes ne coutent qu'une annonce par fenetre, laissant les trois
 * autres a ce qui presse vraiment : les changements d'etat.
 */
export const REPUBLICATION_PRESENCE = 25_000;

/**
 * Combien de temps attendre avant la prochaine annonce, zero si elle peut
 * partir tout de suite.
 *
 * `envois` porte les dates des annonces deja faites, la plus ancienne en tete ;
 * celles qui sont sorties de la fenetre en sont retirees au passage. La purge
 * se fait a la lecture plutot que par une minuterie : une minuterie de plus
 * serait une chose de plus a arreter en quittant le salon, et l'oublier une
 * seule fois suffit a republier dans un salon qu'on a laisse.
 */
export function attenteAvantAnnonce(envois: number[], maintenant: number): number {
  for (
    let plusAncienne = envois[0];
    plusAncienne !== undefined && maintenant - plusAncienne >= FENETRE_PRESENCE;
    plusAncienne = envois[0]
  ) {
    envois.shift();
  }

  const plusAncienne = envois[0];
  if (plusAncienne === undefined || envois.length < ANNONCES_PAR_FENETRE) return 0;

  // La place se libere quand la plus ancienne sort de la fenetre, pas avant.
  return Math.max(1, FENETRE_PRESENCE - (maintenant - plusAncienne));
}

/** Retient qu'une annonce vient de partir. */
export function retenirAnnonce(envois: number[], maintenant: number): void {
  envois.push(maintenant);
}
