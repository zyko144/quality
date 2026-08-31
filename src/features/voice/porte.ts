/**
 * Porte de bruit.
 *
 * La reduction de bruit du moteur web attenue les bruits stationnaires pendant
 * qu'on parle. Elle ne fait rien contre ce qui reste entre les phrases — et
 * c'est precisement ce que les autres entendent : le ventilateur, la rue, le
 * clavier, la television de la piece a cote, presents en continu dans un salon
 * ou personne ne parle.
 *
 * Une porte ferme le micro sous un certain niveau. Ce n'est pas un traitement
 * savant : c'est un interrupteur rapide, et c'est ce qui manquait.
 *
 * Elle vit sur le fil audio, pas dans la page
 * ---------------------------------------------
 * La premiere version mesurait le niveau depuis la page, par `setInterval`
 * toutes les vingt-cinq millisecondes. Cela marchait tant que la fenetre etait
 * au premier plan — et cessait de marcher des qu'on basculait ailleurs, le
 * navigateur ralentissant les minuteries des pages masquees a une execution par
 * seconde. Or basculer ailleurs, en vocal, c'est le cas normal : on parle en
 * jouant. La porte restait donc fermee des secondes entieres et les autres
 * n'entendaient plus rien.
 *
 * `AudioWorklet` s'execute sur le fil audio, qui n'est jamais ralenti par
 * l'etat de la fenetre. Le calcul se fait par blocs de 128 echantillons, soit
 * environ toutes les 2,7 millisecondes, quoi qu'il arrive a l'ecran.
 *
 * Elle echoue ouverte
 * -------------------
 * A chaque etape — worklet indisponible, contexte suspendu, chargement du
 * module refuse — on rend le flux brut plutot qu'un flux ferme. Une porte qui
 * echoue en silence est indiagnosticable depuis l'autre bout de la ligne :
 * l'autre ne dit pas « ta porte de bruit ne marche pas », il dit « je ne
 * t'entends plus », et personne ne pense au reglage.
 */

export interface Porte {
  /** Flux a emettre, en lieu et place du micro brut. */
  flux: MediaStream;
  /** Change le seuil sans refaire le graphe. */
  reglerSeuil: (db: number) => void;
  /** Neutralise ou reactive la porte, micro inchange. */
  activer: (actif: boolean) => void;
  /** Coupe la porte et rend les ressources. Le micro brut n'est pas ferme. */
  arreter: () => void;
}

/**
 * Ouvre une porte sur ce flux.
 *
 * Rend `null` quand rien ne peut etre fait — l'appelant emet alors le micro
 * brut, ce qui est le comportement d'avant la porte, pas une panne.
 */
export async function ouvrirPorte(source: MediaStream, seuilDb: number): Promise<Porte | null> {
  const Contexte =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Contexte) return null;

  let ctx: AudioContext;
  try {
    ctx = new Contexte();
  } catch {
    return null;
  }

  const abandonner = () => {
    void ctx.close().catch(() => undefined);
    return null;
  };

  // Sans `AudioWorklet`, on renonce : la version a minuterie que cela
  // remplacerait est precisement celle qui posait probleme.
  if (!ctx.audioWorklet) return abandonner();

  try {
    await ctx.audioWorklet.addModule(new URL('./porte-worklet.js', import.meta.url));
  } catch {
    return abandonner();
  }

  /*
   * Le contexte doit tourner.
   *
   * Les navigateurs ouvrent tout `AudioContext` a l'arret tant qu'un geste ne
   * l'a pas autorise. Suspendu, le graphe ne traite rien : le flux de sortie
   * serait un silence parfait, et l'on aurait un micro « ouvert » qui n'emet
   * rien.
   */
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => undefined);
  }
  if (ctx.state !== 'running') return abandonner();

  let entree: MediaStreamAudioSourceNode;
  let porte: AudioWorkletNode;
  let sortie: MediaStreamAudioDestinationNode;

  try {
    entree = ctx.createMediaStreamSource(source);
    porte = new AudioWorkletNode(ctx, 'porte-de-bruit');
    sortie = ctx.createMediaStreamDestination();
    entree.connect(porte).connect(sortie);
  } catch {
    return abandonner();
  }

  const seuil = porte.parameters.get('seuilDb');
  const actif = porte.parameters.get('active');
  seuil?.setValueAtTime(seuilDb, ctx.currentTime);

  /*
   * Le contexte peut se suspendre en cours de route.
   *
   * Cela arrive a la mise en veille, ou quand le systeme reprend la main sur
   * le peripherique. Le graphe s'arrete alors de traiter, et le flux emis
   * devient muet sans que rien ne le signale. On le relance ; si l'on n'y
   * arrive pas, mieux vaut que la porte s'efface — c'est ce que fait
   * `activer(false)`, qui laisse tout passer.
   */
  const surEtat = () => {
    if (ctx.state !== 'suspended') return;

    void ctx.resume().catch(() => {
      actif?.setValueAtTime(0, ctx.currentTime);
    });
  };

  ctx.addEventListener('statechange', surEtat);

  return {
    flux: sortie.stream,
    reglerSeuil: (db) => seuil?.setValueAtTime(db, ctx.currentTime),
    activer: (marche) => actif?.setValueAtTime(marche ? 1 : 0, ctx.currentTime),
    arreter: () => {
      ctx.removeEventListener('statechange', surEtat);
      try {
        entree.disconnect();
        porte.disconnect();
      } catch {
        // Deja detache : rien a defaire.
      }
      void ctx.close().catch(() => undefined);
    },
  };
}
