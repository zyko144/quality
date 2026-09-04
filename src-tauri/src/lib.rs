// Orbit — enveloppe de bureau.
//
// L'interface reste celle du web : Tauri se contente de l'afficher dans le
// WebView du systeme. Ce fichier n'ajoute donc que ce qu'un navigateur ne sait
// pas faire — icone de barre des taches, fenetre unique, et surtout un clavier
// qui repond meme quand la fenetre n'est pas devant.
//
// Contrairement a Electron, aucun moteur de rendu n'est embarque : le binaire
// fait 3,4 Mo et l'installateur 1,3 Mo, la ou Electron embarquerait sa propre
// copie de Chromium.
//
// Le gain porte sur la taille livree, pas sur la memoire vive : WebView2 lance
// un Chromium multi-processus comme le ferait Electron, et l'application occupe
// environ 390 Mo au repos. Mieux que Discord, mais pas d'un ordre de grandeur.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// Masque la fenetre technique creee par le greffon d'instance unique.
///
/// Sur Windows, ce greffon ouvre une fenetre de seize pixels nommee d'apres
/// l'identifiant de l'application. Elle sert a recevoir le message d'une
/// seconde instance, et devrait rester invisible — mais elle ne l'est pas.
///
/// Les consequences se voient : Windows la designe comme fenetre principale du
/// processus, si bien que la barre des taches affiche « app.orbit.desktop-siw »
/// au lieu d'« Orbit », et elle apparait dans la liste des fenetres a partager.
///
/// La masquer ne l'empeche pas de recevoir des messages : une fenetre cachee
/// garde sa file. Le greffon continue donc de fonctionner.
#[cfg(windows)]
fn hide_single_instance_window(identifier: &str) {
    use windows::core::HSTRING;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, ShowWindow, SW_HIDE};

    let name = HSTRING::from(format!("{identifier}-siw"));

    // Sans classe, la recherche porte sur le seul titre — ce qui suffit, le nom
    // etant derive d'un identifiant unique a l'application.
    if let Ok(handle) = unsafe { FindWindowW(None, &name) } {
        if !handle.is_invalid() {
            let _ = unsafe { ShowWindow(handle, SW_HIDE) };
        }
    }
}

#[cfg(not(windows))]
fn hide_single_instance_window(_identifier: &str) {}

/// Ramene la fenetre au premier plan, en la restaurant si elle etait reduite.
fn focus_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Enumeration des sources partageables, pour notre propre selecteur.
///
/// L'implementation depend du systeme : Win32 sur Windows, une liste vide
/// ailleurs tant que macOS et Linux n'ont pas la leur. Les deux exposent la
/// meme commande, donc rien ne change en aval.
#[cfg(windows)]
#[path = "capture.rs"]
mod capture;

#[cfg(not(windows))]
#[path = "capture_autre.rs"]
mod capture;

/// Les touches vocales, observees meme quand la fenetre n'a pas le focus.
/// Voir `clavier.rs` : c'est ce qui rend le push-to-talk utilisable en jeu.
mod clavier;

/// Capture du son du systeme, par le bouclage de Windows. Voir `son.rs`.
mod flux;
mod image;

/// Ce que l'ordinateur joue, lu chez Windows plutot que chez Spotify.
/// Voir `musique.rs` : c'est ce qui evite une liaison OAuth.
mod musique;

mod son;

/// Retire la fenetre de selection de partage imposee par WebView2.
///
/// A chaque appel de `getDisplayMedia`, le moteur ouvre sa propre fenetre —
/// celle qui annonce « http://tauri.localhost veut partager votre ecran ». Elle
/// n'est reglable par aucune API : ni Tauri ni la page n'ont prise dessus.
///
/// WebView2 lit en revanche `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` a la
/// creation de son environnement, avant toute fenetre. Le drapeau
/// `--auto-select-desktop-capture-source` demande a Chromium de choisir seul la
/// premiere source dont le nom contient la chaine donnee, et de ne rien
/// afficher.
///
/// La valeur est « 1 », et ce chiffre est le seul repere fiable.
///
/// Chromium retient la premiere source dont le nom *contient* la chaine
/// donnee. Restait a trouver une chaine presente dans le nom de l'ecran quelle
/// que soit la langue.
///
/// Deux essais ont echoue avant celui-ci. « Entire screen » ne correspond a
/// rien sur un systeme en francais, ou les sources s'appellent « Ecran 1 » et
/// « Ecran 2 ». Une chaine vide paraissait elegante — elle est contenue dans
/// n'importe quel nom — mais Chromium ignore le drapeau quand sa valeur est
/// vide, et la fenetre revenait.
///
/// Le numero, lui, n'est traduit nulle part : « Ecran 1 », « Screen 1 »,
/// « Bildschirm 1 » le contiennent tous.
///
/// Deux consequences a assumer :
///
///  - La source prise est toujours la premiere, c'est-a-dire l'ecran principal.
///    Partager une fenetre revient donc a decouper cette image, ce que fait
///    `decoupe.ts` a partir de la position que le systeme nous donne.
///  - Une fenetre ou un ecran situes hors de l'ecran principal ne sont pas dans
///    l'image : l'interface le detecte et le dit, plutot que de diffuser autre
///    chose que ce qui a ete choisi.
///
/// La variable doit etre posee avant que Tauri ne construise le WebView : une
/// fois l'environnement cree, elle n'est plus relue.
#[cfg(windows)]
fn desactiver_selecteur_webview() {
    /*
     * Le drapeau est pose sans condition.
     *
     * Une version l'a rendu facultatif, pour recuperer le son du partage : la
     * case « partager aussi l'audio systeme » vit dans la fenetre que ce
     * drapeau supprime. C'etait une erreur — rendre cette fenetre, c'est rendre
     * exactement ce qu'on avait entrepris de retirer, titre
     * « http://tauri.localhost » compris.
     *
     * Le son se prend ailleurs, par le bouclage du systeme. Voir
     * `sonSysteme.ts`.
     */
    // `std::env::set_var` est marque `unsafe` a partir de l'edition 2024 ; en
    // 2021 il ne l'est pas, et l'appel a lieu avant tout fil supplementaire.
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--auto-select-desktop-capture-source=1",
    );
}

#[cfg(not(windows))]
fn desactiver_selecteur_webview() {}

/// Le dossier de donnees de l'application, sans passer par Tauri.
///
/// Tauri le donne aussi, mais seulement une fois construit — c'est-a-dire trop
/// tard pour ce dont il sert ici. La regle qui le compose est stable et tient en
/// une ligne : `%LOCALAPPDATA%\<identifiant>`.
#[cfg(windows)]
fn dossier_donnees() -> Option<std::path::PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| std::path::PathBuf::from(base).join(IDENTIFIANT))
}

#[cfg(windows)]
const IDENTIFIANT: &str = "app.echow.desktop";

/// Efface une fois pour toutes le cache de l'ancien Service Worker.
///
/// Une version passee servait son interface par un Service Worker (VitePWA).
/// Quand Tauri remplace le binaire, le WebView continue de servir l'ancienne
/// interface depuis ce cache, et la nouvelle n'apparait jamais. Il faut donc
/// l'effacer une fois, au passage a une version qui n'en pose plus.
///
/// Pourquoi AVANT le constructeur
/// ------------------------------
/// Ce nettoyage vivait dans `setup`, et le commentaire d'a cote disait
/// pourtant l'inverse de ce qu'il supposait : « le greffon a deja cree sa
/// fenetre a ce stade ». Le WebView2 etait donc DEJA en train de demarrer quand
/// on supprimait `Cache`, `Code Cache` et `Service Worker` sous ses pieds.
///
/// Le processus hote survivait, son moteur de rendu non : la fenetre s'ouvrait
/// et restait vide. Et comme tout depend de qui gagne la course, cela marchait
/// une fois sur deux — le pire des defauts, celui qu'on croit corrige parce
/// qu'il vient de ne pas se produire.
///
/// Ici, aucune fenetre n'existe encore : il n'y a personne a qui arracher quoi
/// que ce soit.
///
/// Une seule fois
/// --------------
/// Un temoin marque le nettoyage fait. Sans lui, on vide le cache HTTP a chaque
/// lancement — l'application redemarre plus lentement pour toujours, afin de
/// resoudre un probleme qui ne peut se poser qu'une fois.
#[cfg(windows)]
fn effacer_ancien_cache_webview() {
    let Some(donnees) = dossier_donnees() else {
        return;
    };

    let temoin = donnees.join(".cache-webview-efface");
    if temoin.exists() {
        return;
    }

    let profil = donnees.join("EBWebView").join("Default");
    for nom in ["Service Worker", "Cache", "Code Cache"] {
        let chemin = profil.join(nom);
        if chemin.exists() {
            let _ = std::fs::remove_dir_all(&chemin);
        }
    }

    // Le temoin est pose meme si le profil n'existait pas : une installation
    // neuve n'a rien a nettoyer, ni maintenant ni plus tard.
    let _ = std::fs::create_dir_all(&donnees);
    let _ = std::fs::write(&temoin, b"fait");
}

#[cfg(not(windows))]
fn effacer_ancien_cache_webview() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    desactiver_selecteur_webview();

    // Avant toute chose : plus rien ne doit toucher au profil du WebView une
    // fois qu'il a commence a demarrer. Voir la fonction.
    effacer_ancien_cache_webview();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            musique::lecture_en_cours,
            musique::pochette_en_cours,
            musique::ouvrir_lien,
            capture::sources_partageables,
            capture::zone_source,
            capture::masquer_barre_partage,
            son::demarrer_son_systeme,
            son::arreter_son_systeme,
            son::lister_sorties_audio,
            son::diagnostic_son,
            image::demarrer_image,
            image::arreter_image,
            image::cadence_image,
            clavier::definir_touches_globales
        ])
        // Une seconde instance ne cree pas de fenetre : elle reveille celle qui
        // existe deja. Sans cela, cliquer deux fois sur l'icone ouvrirait deux
        // applications connectees au meme compte.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        // Mises a jour : le greffon telecharge et installe l'archive signee,
        // sans repasser par l'installateur complet. `process` sert a relancer
        // l'application une fois l'archive posee.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Les liens des messages partent vers le navigateur du systeme. Sans
        // ce greffon, `target="_blank"` ne fait rien dans la vue web, et un
        // lien ouvert dans la fenetre de l'application afficherait un site
        // tiers sans barre d'adresse — on ne saurait plus ou l'on est.
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Le greffon a deja cree sa fenetre a ce stade : la masquer plus
            // tot ne trouverait rien.
            hide_single_instance_window(&app.config().identifier);

            let show = MenuItem::with_id(app, "show", "Ouvrir Orbit", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::with_id("orbit")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Orbit")
                .menu(&menu)
                // Le menu ne doit pas surgir au clic gauche : ce clic sert a
                // afficher la fenetre, geste attendu sur Windows.
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => focus_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        focus_main(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermer la fenetre met en veille dans la barre des taches au lieu
            // de quitter : on continue de recevoir les messages, comme le fait
            // n'importe quelle messagerie de bureau. « Quitter » reste
            // accessible depuis le menu de l'icone.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Orbit n'a pas pu demarrer");
}
