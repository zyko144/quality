//! Les raccourcis qui repondent meme quand on joue — clavier et souris.
//!
//! Jusqu'ici les touches vocales etaient lues par la vue web, qui ne recoit
//! rien des que la fenetre perd le focus. Autrement dit : le push-to-talk
//! fonctionnait partout sauf la ou il sert — en pleine partie, l'application
//! derriere le jeu.
//!
//! Pourquoi un crochet bas niveau plutot que le greffon de raccourcis
//! -----------------------------------------------------------------
//! Tauri sait deja poser des raccourcis globaux, mais il passe par
//! `RegisterHotKey`, qui a deux defauts redhibitoires ici :
//!
//!  - il **confisque** la touche. Une touche de conversation posee sur `V` ou
//!    `F9` disparaitrait du jeu, ce qui est exactement ce qu'il ne faut pas ;
//!  - il ne signale que l'enfoncement. Or maintenir une touche demande de
//!    savoir aussi quand elle est lachee, sans quoi le micro reste ouvert.
//!
//! `WH_KEYBOARD_LL` observe le clavier sans rien consommer : la frappe continue
//! son chemin vers le jeu, et l'on voit l'enfoncement comme le relachement.
//! C'est le mecanisme qu'emploient les autres logiciels de conversation.
//!
//! Ce qui ne remonte jamais
//! ------------------------
//! Seules les combinaisons que l'interface a demandees produisent un evenement,
//! et il ne porte que le **nom de l'action** — jamais la touche, jamais le
//! caractere. Rien de ce qu'on tape ailleurs ne quitte ce fichier, et il n'y a
//! nulle part ou cela pourrait fuir : la comparaison se fait ici, dans le
//! crochet, et ce qui ne correspond pas est oublie dans la foulee.
//!
//! Les boutons de souris
//! ---------------------
//! Le pouce d'une souris de joueur porte deux boutons dont aucun jeu ne se sert
//! vraiment : c'est le meilleur endroit ou poser une touche de conversation,
//! parce qu'on l'atteint sans quitter les commandes. Ils passent par un second
//! crochet, de la meme famille, et rejoignent exactement le meme chemin que les
//! touches — meme regle de modificateurs, meme filtrage des repetitions.
//!
//! Le clic gauche et le clic droit ne sont **pas** proposes. Les poser sur une
//! action rendrait l'ordinateur inutilisable, et l'on ne pourrait meme plus
//! atteindre le reglage pour defaire ce qu'on vient de faire.
//!
//! Une limite qui vient du systeme : une fenetre lancee en administrateur ne
//! transmet pas ses frappes a un programme qui ne l'est pas. Les touches
//! resteront donc sans effet au-dessus d'un jeu lance en administrateur, et
//! aucun logiciel ne s'en sort autrement.

use serde::{Deserialize, Serialize};

/// Une combinaison a surveiller, telle que l'interface la decrit.
///
/// `code` est le code virtuel Windows de la touche physique, traduit cote
/// interface depuis le `code` du navigateur : les deux designent la touche et
/// non le caractere, ce qui laisse les dispositions tranquilles.
#[derive(Clone, Deserialize)]
pub struct ToucheSurveillee {
    /// Ce que l'interface reconnaitra en retour : l'action, pas la touche.
    pub nom: String,
    pub code: u32,
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
}

/// Ce qu'on renvoie a l'interface : quelle action, et dans quel sens.
#[derive(Clone, Serialize)]
pub struct Frappe {
    pub nom: String,
    pub bas: bool,
}

/// Les boutons de souris qu'on accepte, dans l'espace des codes de touches.
///
/// Windows leur reserve deja des numeros — molette cliquee, et les deux du
/// pouce — bien en dessous de ceux des touches. Les faire passer par le meme
/// chemin evite d'avoir deux mecaniques a garder d'accord.
pub const BOUTON_MILIEU: u32 = 0x04;
pub const BOUTON_POUCE_1: u32 = 0x05;
pub const BOUTON_POUCE_2: u32 = 0x06;

/// Quel bouton, et dans quel sens, pour un message de la souris.
///
/// Separe de la procedure du crochet parce que l'eprouver autrement
/// demanderait de cliquer pour de vrai sur le bureau de quelqu'un — un bouton
/// de pouce, c'est « page precedente » dans la plupart des fenetres, et le cas
/// se paierait en navigation perdue.
///
/// Rend `None` pour tout le reste, y compris les deplacements : le crochet en
/// recoit plusieurs centaines par seconde, et c'est la sortie qui doit etre la
/// plus rapide.
pub fn bouton_de(message: u32, donnees: u32) -> Option<(u32, bool)> {
    // Les valeurs viennent de `WinUser.h`. Les nommer ici plutot que d'importer
    // le module Windows garde cette fonction compilable partout, donc
    // eprouvable partout.
    const MILIEU_BAS: u32 = 0x0207;
    const MILIEU_HAUT: u32 = 0x0208;
    const POUCE_BAS: u32 = 0x020b;
    const POUCE_HAUT: u32 = 0x020c;

    match message {
        MILIEU_BAS => Some((BOUTON_MILIEU, true)),
        MILIEU_HAUT => Some((BOUTON_MILIEU, false)),
        POUCE_BAS | POUCE_HAUT => {
            // Lequel des deux boutons du pouce vit dans les seize bits de poids
            // fort de `mouseData`.
            let bouton = match (donnees >> 16) & 0xffff {
                1 => BOUTON_POUCE_1,
                2 => BOUTON_POUCE_2,
                _ => return None,
            };

            Some((bouton, message == POUCE_BAS))
        }
        _ => None,
    }
}

/// Vrai si les modificateurs demandes sont enfonces.
///
/// Les modificateurs **en trop sont toleres**, et c'est un choix, non un oubli.
/// La vue web, elle, exige l'egalite exacte. Mais quelqu'un qui court dans un
/// jeu tient `Maj` en permanence : une touche de conversation qui refuse de
/// repondre parce qu'un modificateur etranger est enfonce ne repondrait
/// justement jamais pendant une partie — c'est-a-dire au seul moment ou elle
/// sert.
///
/// Le prix est connu : poser `Maj+M` et `M` sur deux actions differentes ferait
/// partir les deux. Les reglages refusent deja deux actions sur la meme
/// combinaison, et ce cas-la reste rare devant celui qu'on repare.
pub fn modificateurs_suffisants(
    touche: &ToucheSurveillee,
    ctrl: bool,
    shift: bool,
    alt: bool,
) -> bool {
    (!touche.ctrl || ctrl) && (!touche.shift || shift) && (!touche.alt || alt)
}

#[cfg(windows)]
mod fenetres {
    use super::{Frappe, ToucheSurveillee};
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{sync_channel, SyncSender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter};
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, HC_ACTION, KBDLLHOOKSTRUCT, MSG,
        MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_MBUTTONDOWN,
        WM_MBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
    };



    /// Ce qu'on surveille. Vide tant que l'interface n'a rien demande, et c'est
    /// la sortie la plus rapide du crochet.
    static SURVEILLEES: Mutex<Vec<ToucheSurveillee>> = Mutex::new(Vec::new());

    /// Les actions dont la touche est actuellement tenue.
    ///
    /// Windows repete l'enfoncement tant que la touche reste pressee — une
    /// trentaine de fois par seconde. Sans ce filtre, tenir une touche inonderait
    /// l'interface d'evenements identiques, et une touche tenue longtemps couterait
    /// plus cher que tout le reste du vocal reuni.
    static TENUES: Mutex<Option<HashSet<String>>> = Mutex::new(None);

    static VOIE: OnceLock<SyncSender<Frappe>> = OnceLock::new();
    static DEMARRE: AtomicBool = AtomicBool::new(false);

    /// Vrai si un modificateur est enfonce a cet instant.
    ///
    /// Le crochet ne donne que la touche qui vient de bouger : l'etat des
    /// modificateurs se lit a cote.
    fn enfonce(touche: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY) -> bool {
        // Le bit de poids fort dit « enfoncee maintenant ». Le bit de poids
        // faible dit « pressee depuis le dernier appel », ce qui ne nous
        // interesse pas et donnerait des faux positifs.
        (unsafe { GetAsyncKeyState(touche.0 as i32) } as u16 & 0x8000) != 0
    }

    /// Compare la frappe a ce qu'on surveille, et signale les changements.
    ///
    /// Tourne **dans** le crochet : Windows retire un crochet qui tarde a rendre
    /// la main, et c'est tout le clavier de la machine qui ralentit en attendant.
    /// D'ou une regle simple : ici, on prend deux verrous, on compare, et l'on
    /// depose au plus un message dans une file. Rien qui attende, rien qui alloue
    /// hors du strict necessaire, et surtout aucun appel a l'interface.
    fn observer(vk: u32, bas: bool) {
        let Ok(liste) = SURVEILLEES.lock() else {
            return;
        };
        if liste.is_empty() {
            return;
        }

        // La regle vit dans `modificateurs_suffisants`, avec ses cas : elle est
        // volontairement plus souple qu'il n'y parait, et une souplesse qu'on
        // n'eprouve pas est une souplesse qu'on retire par megarde.
        let ctrl = enfonce(VK_CONTROL);
        let shift = enfonce(VK_SHIFT);
        let alt = enfonce(VK_MENU);

        for touche in liste.iter() {
            if touche.code != vk {
                continue;
            }

            /*
             * Le relachement ne verifie que la touche, jamais les modificateurs.
             *
             * Lacher `Ctrl` avant la lettre change la combinaison, pas le fait
             * qu'on a lache. Exiger la combinaison entiere au relachement laissait
             * le micro dans la position de l'appui, indefiniment.
             */
            if bas && !super::modificateurs_suffisants(touche, ctrl, shift, alt) {
                continue;
            }

            let Ok(mut tenues) = TENUES.lock() else {
                return;
            };
            let tenues = tenues.get_or_insert_with(HashSet::new);

            // Seuls les changements comptent : c'est ce qui absorbe la repetition
            // automatique, et ce qui rend un martelement sans consequence.
            let change = if bas {
                tenues.insert(touche.nom.clone())
            } else {
                tenues.remove(&touche.nom)
            };
            if !change {
                continue;
            }

            if let Some(voie) = VOIE.get() {
                // Jamais bloquant. Une file pleine signifie que l'interface ne
                // suit plus ; mieux vaut perdre une frappe que retenir le clavier
                // de toute la machine.
                let _ = voie.try_send(Frappe {
                    nom: touche.nom.clone(),
                    bas,
                });
            }
        }
    }

    unsafe extern "system" fn procedure_souris(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code == HC_ACTION as i32 {
            let message = wparam.0 as u32;

            /*
             * Le deplacement est ecarte en premier, et c'est ce qui compte.
             *
             * Ce crochet recoit chaque mouvement de la souris : plusieurs
             * centaines par seconde des qu'on la bouge. Tout ce qui suit doit
             * donc etre saute le plus tot possible, sans prendre le moindre
             * verrou.
             */
            let donnees = if message == WM_XBUTTONDOWN || message == WM_XBUTTONUP {
                (*(lparam.0 as *const MSLLHOOKSTRUCT)).mouseData
            } else {
                0
            };

            if let Some((bouton, bas)) = super::bouton_de(message, donnees) {
                observer(bouton, bas);
            }
        }

        // Le clic poursuit son chemin : un bouton de conversation ne doit pas
        // disparaitre du jeu.
        CallNextHookEx(None, code, wparam, lparam)
    }

    unsafe extern "system" fn procedure(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let message = wparam.0 as u32;
            let bas = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            let haut = message == WM_KEYUP || message == WM_SYSKEYUP;

            if bas || haut {
                let frappe = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
                observer(frappe.vkCode, bas);
            }
        }

        // La frappe poursuit son chemin, toujours. C'est toute la difference avec
        // un raccourci enregistre : le jeu recoit la touche comme si de rien
        // n'etait.
        CallNextHookEx(None, code, wparam, lparam)
    }

    /// Pose le crochet et le fil qui previent l'interface. Une seule fois.
    ///
    /// Rend `false` si le systeme refuse le crochet : l'interface reprend alors
    /// ses propres evenements clavier, qui marchent au moins quand elle est au
    /// premier plan.
    fn demarrer(app: AppHandle) -> bool {
        if DEMARRE.swap(true, Ordering::SeqCst) {
            return true;
        }

        let (envoi, reception) = sync_channel::<Frappe>(64);
        let _ = VOIE.set(envoi);

        // L'interface est prevenue depuis un fil ordinaire : le crochet, lui, ne
        // doit rien faire qui puisse durer.
        std::thread::spawn(move || {
            while let Ok(frappe) = reception.recv() {
                let _ = app.emit("touche-globale", frappe);
            }
        });

        // Le crochet appartient au fil qui l'a pose, et ce fil doit tenir une
        // boucle de messages : sans elle, Windows n'appelle jamais la procedure.
        let (pose, resultat) = sync_channel::<bool>(1);

        std::thread::spawn(move || unsafe {
            let clavier = SetWindowsHookExW(WH_KEYBOARD_LL, Some(procedure), None, 0);

            /*
             * La souris est posee sur le MEME fil, et c'est necessaire : un
             * crochet appartient au fil qui l'a pose, et c'est la boucle de
             * messages de ce fil qui le fait vivre. Deux fils demanderaient deux
             * boucles pour rien.
             *
             * Son echec n'empeche pas le reste : le clavier seul vaut mieux que
             * rien, et c'est de loin le cas le plus courant.
             */
            let souris = SetWindowsHookExW(WH_MOUSE_LL, Some(procedure_souris), None, 0);
            let _ = pose.try_send(clavier.is_ok() || souris.is_ok());

            if clavier.is_err() && souris.is_err() {
                return;
            }

            let mut message = MSG::default();
            // `GetMessageW` rend -1 en cas d'erreur : le comparer a zero seul
            // ferait tourner cette boucle sans fin sur un fil qui ne sert plus.
            while GetMessageW(&mut message, None, 0, 0).0 > 0 {}
        });

        resultat
            .recv_timeout(Duration::from_millis(500))
            .unwrap_or(false)
    }

    pub fn definir(app: AppHandle, touches: Vec<ToucheSurveillee>) -> bool {
        let actif = demarrer(app);

        /*
         * Ce qui etait tenu est rendu avant de changer la liste.
         *
         * Rebrancher une touche pendant qu'on la maintient laissait l'interface
         * persuadee qu'elle etait toujours enfoncee : le relachement ne
         * correspondait plus a rien, et le micro restait dans la position de
         * l'appui — coupe, sans que rien ne le rouvre.
         */
        if let Ok(mut tenues) = TENUES.lock() {
            if let Some(anciennes) = tenues.take() {
                if let Some(voie) = VOIE.get() {
                    for nom in anciennes {
                        let _ = voie.try_send(Frappe { nom, bas: false });
                    }
                }
            }
        }

        if let Ok(mut liste) = SURVEILLEES.lock() {
            *liste = touches;
        }

        actif
    }
}

/// Declare les combinaisons a surveiller, et rend `true` si le clavier global
/// repond. Une liste vide eteint la surveillance sans defaire le crochet.
#[tauri::command]
#[cfg(windows)]
pub fn definir_touches_globales(
    app: tauri::AppHandle,
    touches: Vec<ToucheSurveillee>,
) -> Result<bool, String> {
    Ok(fenetres::definir(app, touches))
}

#[tauri::command]
#[cfg(not(windows))]
pub fn definir_touches_globales(
    _app: tauri::AppHandle,
    _touches: Vec<ToucheSurveillee>,
) -> Result<bool, String> {
    // Ailleurs, l'interface garde ses propres evenements clavier.
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::{modificateurs_suffisants, ToucheSurveillee};

    fn touche(ctrl: bool, shift: bool, alt: bool) -> ToucheSurveillee {
        ToucheSurveillee {
            nom: "essai".into(),
            code: 0x4d,
            ctrl,
            shift,
            alt,
        }
    }

    #[test]
    fn une_touche_nue_repond_meme_les_mains_pleines() {
        // Le cas qui motive toute la regle : on court dans un jeu, `Maj` est
        // tenu, et la touche de conversation doit repondre quand meme.
        let nue = touche(false, false, false);

        assert!(modificateurs_suffisants(&nue, false, false, false));
        assert!(modificateurs_suffisants(&nue, false, true, false));
        assert!(modificateurs_suffisants(&nue, true, true, true));
    }

    #[test]
    fn les_boutons_de_souris_se_decodent() {
        use super::{bouton_de, BOUTON_MILIEU, BOUTON_POUCE_1, BOUTON_POUCE_2};

        assert_eq!(bouton_de(0x0207, 0), Some((BOUTON_MILIEU, true)));
        assert_eq!(bouton_de(0x0208, 0), Some((BOUTON_MILIEU, false)));

        // Le numero du bouton du pouce vit dans les seize bits de poids fort ;
        // le lire dans les seize bits de poids faible rendrait toujours zero, et
        // aucun des deux boutons ne repondrait jamais.
        assert_eq!(bouton_de(0x020b, 1 << 16), Some((BOUTON_POUCE_1, true)));
        assert_eq!(bouton_de(0x020c, 2 << 16), Some((BOUTON_POUCE_2, false)));

        // Les bits de poids faible portent l'etat des autres boutons : ils ne
        // doivent rien changer au numero qu'on lit.
        assert_eq!(bouton_de(0x020b, (1 << 16) | 0xffff), Some((BOUTON_POUCE_1, true)));
    }

    #[test]
    fn le_reste_de_la_souris_est_ignore() {
        use super::bouton_de;

        // Le deplacement, avant tout : le crochet en recoit plusieurs centaines
        // par seconde des qu'on bouge la souris.
        assert_eq!(bouton_de(0x0200, 0), None);

        /*
         * Gauche et droit ne doivent JAMAIS repondre.
         *
         * Les poser sur une action rendrait l'ordinateur inutilisable, et l'on
         * ne pourrait meme plus cliquer le reglage pour le defaire. Le refus est
         * ici, dans le crochet, en plus de celui de l'interface : deux verrous
         * plutot qu'un sur ce qui ne se rattrape pas.
         */
        assert_eq!(bouton_de(0x0201, 0), None, "clic gauche accepte");
        assert_eq!(bouton_de(0x0202, 0), None);
        assert_eq!(bouton_de(0x0204, 0), None, "clic droit accepte");
        assert_eq!(bouton_de(0x0205, 0), None);

        // Un troisieme bouton de pouce, que Windows ne definit pas.
        assert_eq!(bouton_de(0x020b, 3 << 16), None);
    }

    #[test]
    fn les_modificateurs_demandes_sont_exiges() {
        let avec_ctrl_maj = touche(true, true, false);

        assert!(!modificateurs_suffisants(&avec_ctrl_maj, false, false, false));
        assert!(!modificateurs_suffisants(&avec_ctrl_maj, true, false, false));
        assert!(!modificateurs_suffisants(&avec_ctrl_maj, false, true, false));
        assert!(modificateurs_suffisants(&avec_ctrl_maj, true, true, false));

        // Un `Alt` en plus ne retire rien : c'est la meme tolerance.
        assert!(modificateurs_suffisants(&avec_ctrl_maj, true, true, true));
    }
}
