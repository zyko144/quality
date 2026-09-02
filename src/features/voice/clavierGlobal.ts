import type { Combinaison } from '@/store/raccourcis';

/**
 * Les touches vocales, vues meme quand la fenetre n'a pas le focus.
 *
 * Ce fichier ne fait que traduire et transmettre : la surveillance elle-meme
 * vit dans `clavier.rs`, parce qu'une page web ne recoit rien du clavier des
 * qu'on passe sur autre chose. C'est toute la raison d'etre de ce detour — un
 * push-to-talk qui ne repond que quand l'application est au premier plan ne
 * repond jamais au moment ou l'on en a besoin.
 *
 * Ce qui traverse, et ce qui ne traverse pas
 * ------------------------------------------
 * On envoie les combinaisons a surveiller ; il revient des **noms d'action** et
 * un sens. Aucune frappe ne remonte : ce qui ne correspond a rien est compare
 * puis oublie du cote systeme, et n'a aucun chemin pour arriver ici.
 */

const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Une combinaison, traduite pour le systeme. */
interface ToucheSurveillee {
  nom: string;
  code: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface Frappe {
  nom: string;
  bas: boolean;
}

/**
 * Ce que la derniere tentative a donne.
 *
 * Les reglages s'en servent pour dire ce qui est vrai plutot que ce qui devrait
 * l'etre : promettre des touches qui repondent en jeu alors que le systeme a
 * refuse le crochet ferait chercher la panne du mauvais cote.
 */
let surveillanceActive = false;

export function clavierGlobalActif(): boolean {
  return surveillanceActive;
}

/**
 * Numero de la derniere inscription, pour ne pas se couper soi-meme.
 *
 * Changer un raccourci defait l'inscription puis en pose une neuve, dans cet
 * ordre. Si l'ordre « vider la liste » partait quand meme, il pourrait arriver
 * APRES la nouvelle liste — les deux traversent le meme pont, sans garantie
 * d'ordre — et l'on se retrouverait sans aucune touche surveillee, juste apres
 * en avoir regle une. Le compteur permet de reconnaitre ce cas et de se taire.
 */
let derniereInscription = 0;

/**
 * Du code de touche du navigateur au code virtuel de Windows.
 *
 * Les deux designent la touche physique et non le caractere produit, ce qui
 * evite de traduire les dispositions : la touche a cote du `A` en AZERTY reste
 * la meme touche, quel que soit le nom qu'on lui donne.
 *
 * Ce qui n'est pas traduit n'est pas surveille — mieux vaut une touche qui ne
 * repond qu'au premier plan qu'une touche qui en declenche une autre.
 */
export function codeWindows(code: string): number | null {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);

  const fonction = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (fonction) return 0x70 + Number(fonction[1]) - 1;

  const pave = /^Numpad([0-9])$/.exec(code);
  if (pave) return 0x60 + Number(pave[1]);

  const table: Record<string, number> = {
    /*
     * Les boutons de souris, dans le meme espace de codes.
     *
     * Windows leur reserve des numeros bien en dessous de ceux des touches, si
     * bien qu'aucune collision n'est possible. Le pouce d'une souris de joueur
     * — `Souris4` et `Souris5` — est le meilleur endroit ou poser une touche de
     * conversation : on l'atteint sans quitter les commandes du jeu.
     *
     * Gauche et droit ne figurent pas ici, et ne doivent jamais y figurer :
     * les poser sur une action rendrait l'ordinateur inutilisable, et l'on ne
     * pourrait meme plus atteindre le reglage pour le defaire.
     */
    Souris3: 0x04,
    Souris4: 0x05,
    Souris5: 0x06,
    Backspace: 0x08,
    Tab: 0x09,
    Enter: 0x0d,
    Escape: 0x1b,
    Space: 0x20,
    PageUp: 0x21,
    PageDown: 0x22,
    End: 0x23,
    Home: 0x24,
    ArrowLeft: 0x25,
    ArrowUp: 0x26,
    ArrowRight: 0x27,
    ArrowDown: 0x28,
    Insert: 0x2d,
    Delete: 0x2e,
    CapsLock: 0x14,
    NumpadMultiply: 0x6a,
    NumpadAdd: 0x6b,
    NumpadSubtract: 0x6d,
    NumpadDecimal: 0x6e,
    NumpadDivide: 0x6f,
    NumpadEnter: 0x0d,
    // Les modificateurs comme touche a part entiere : `Ctrl` droit est un
    // choix courant pour parler, justement parce qu'aucun jeu ne s'en sert.
    ControlLeft: 0xa2,
    ControlRight: 0xa3,
    ShiftLeft: 0xa0,
    ShiftRight: 0xa1,
    AltLeft: 0xa4,
    AltRight: 0xa5,
    Semicolon: 0xba,
    Equal: 0xbb,
    Comma: 0xbc,
    Minus: 0xbd,
    Period: 0xbe,
    Slash: 0xbf,
    Backquote: 0xc0,
    BracketLeft: 0xdb,
    Backslash: 0xdc,
    BracketRight: 0xdd,
    Quote: 0xde,
    // La touche qui n'existe que sur les claviers europeens, entre `Maj` et
    // `W` en AZERTY.
    IntlBackslash: 0xe2,
  };

  return table[code] ?? null;
}

/**
 * Vrai quand la frappe doit etre ignoree parce qu'on est en train d'ecrire.
 *
 * Le systeme, lui, ne sait rien de ce qu'on fait : il signale la touche que la
 * fenetre soit au premier plan ou non. Sans ce filtre, taper `M` dans un
 * message couperait le micro.
 *
 * `hasFocus` est la condition qui rend le filtre juste : si la fenetre n'a pas
 * le focus, ce qui est ecrit l'est ailleurs, et le champ de saisie qui garde le
 * curseur chez nous ne doit rien bloquer. C'est exactement le cas du jeu.
 */
export function enSaisie(): boolean {
  if (typeof document === 'undefined') return false;
  if (!document.hasFocus()) return false;

  const actif = document.activeElement as HTMLElement | null;
  if (!actif) return false;

  return (
    actif.tagName === 'INPUT' || actif.tagName === 'TEXTAREA' || actif.isContentEditable === true
  );
}

/**
 * Confie la liste des combinaisons au systeme et ecoute ce qu'il en renvoie.
 *
 * Rend de quoi tout defaire, et dit si la surveillance globale a bien pris : en
 * cas de refus — hors de l'application de bureau, ou si le systeme decline le
 * crochet — l'appelant reprend ses propres evenements clavier, qui repondent au
 * moins quand la fenetre est au premier plan.
 */
export async function surveillerGlobalement(
  entrees: { nom: string; combinaison: Combinaison | null }[],
  surFrappe: (frappe: Frappe) => void,
): Promise<{ actif: boolean; arreter: () => void }> {
  if (!DANS_TAURI) return { actif: false, arreter: () => {} };

  derniereInscription += 1;
  const inscription = derniereInscription;

  const touches: ToucheSurveillee[] = [];
  for (const entree of entrees) {
    if (!entree.combinaison) continue;
    const code = codeWindows(entree.combinaison.code);
    if (code === null) continue;

    touches.push({
      nom: entree.nom,
      code,
      ctrl: entree.combinaison.ctrl,
      shift: entree.combinaison.shift,
      alt: entree.combinaison.alt,
    });
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');

    const actif = await invoke<boolean>('definir_touches_globales', { touches });
    surveillanceActive = actif;
    if (!actif) return { actif: false, arreter: () => {} };

    const delier = await listen<Frappe>('touche-globale', (evenement) => {
      surFrappe(evenement.payload);
    });

    return {
      actif: true,
      arreter: () => {
        // L'ecoute cesse tout de suite : c'est elle qui pourrait faire agir
        // deux fois sur la meme frappe pendant un remplacement.
        delier();

        // Le reste attend un tour, le temps qu'une inscription qui prend la
        // suite se soit annoncee.
        window.setTimeout(() => {
          if (inscription !== derniereInscription) return;

          surveillanceActive = false;
          // La liste est videe, sinon le crochet continuerait de signaler des
          // touches que plus personne n'ecoute.
          void invoke('definir_touches_globales', { touches: [] }).catch(() => undefined);
        }, 0);
      },
    };
  } catch {
    // Une version de l'application sans cette commande, ou un systeme qui la
    // refuse : on ne casse rien, on retombe sur le clavier de la fenetre.
    return { actif: false, arreter: () => {} };
  }
}
