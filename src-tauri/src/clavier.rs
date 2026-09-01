//! Les raccourcis qui repondent meme quand on joue.
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
        WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
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
            let crochet = SetWindowsHookExW(WH_KEYBOARD_LL, Some(procedure), None, 0);
            let _ = pose.try_send(crochet.is_ok());
            if crochet.is_err() {
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
