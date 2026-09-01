//! Sources partageables : fenetres et ecrans, avec leur vignette.
//!
//! Le moteur web impose sa propre fenetre de selection a chaque appel de
//! `getDisplayMedia`, et aucune page ne peut la remplacer — c'est deliberе,
//! une page ne doit pas pouvoir designer seule ce qu'elle filme. Mais une
//! application de bureau, elle, en a le droit : ce module enumere les sources
//! cote systeme pour que l'interface propose son propre selecteur.
//!
//! Rien n'est envoye nulle part. Les vignettes sont produites a la demande,
//! rendues dans la fenetre de l'application, et jetees ensuite.

use base64::Engine;
use serde::Serialize;

use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
// `PrintWindow` est range du cote de l'impression, ce qui ne va pas de soi :
// c'est pourtant la seule facon de demander a une fenetre de se dessiner
// ailleurs qu'a sa place a l'ecran.
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, EnumDisplayMonitors,
    GetDIBits, GetMonitorInfoW, GetWindowDC, ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, HDC, HMONITOR, MONITORINFOEXW,
    SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetWindowLongW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowPlacement, IsIconic, IsWindow, IsWindowVisible, GA_ROOT, GWL_EXSTYLE,
    PW_RENDERFULLCONTENT, WINDOWPLACEMENT, WS_EX_TOOLWINDOW,
};

/// Une source qu'on peut proposer au partage.
#[derive(Serialize)]
pub struct Source {
    /// Poignee de fenetre, ou index d'ecran prefixe : sert a la capture.
    pub id: String,
    pub titre: String,
    /// `fenetre` ou `ecran`.
    pub genre: &'static str,
    pub largeur: i32,
    pub hauteur: i32,
    /// Coin haut-gauche a l'ecran. L'interface s'en sert pour savoir si une
    /// source se trouve sur le moniteur principal, seul que l'on sache
    /// capturer sans ouvrir la fenetre du moteur.
    pub x: i32,
    pub y: i32,
    /// Vignette PNG en `data:` — vide si la capture a echoue.
    pub vignette: String,
    /// La fenetre est reduite dans la barre des taches.
    ///
    /// Elle figure quand meme dans la liste : « toutes mes applications
    /// ouvertes » comprend celles qu'on vient de reduire, et ne pas les voir
    /// donnait le sentiment que le selecteur en oubliait la moitie. Elle n'a
    /// simplement pas d'apercu — une fenetre reduite ne dessine rien — et
    /// choisir la restaure avant de capturer.
    pub reduite: bool,
}

/// Largeur des vignettes. Assez pour reconnaitre une fenetre, assez peu pour
/// que dresser la liste entiere reste instantane.
const VIGNETTE_LARGEUR: i32 = 320;

/// Vrai si Windows considere la fenetre comme masquee.
///
/// Une fenetre peut etre « visible » au sens de `IsWindowVisible` tout en etant
/// escamotee par le gestionnaire de bureau : applications du Store suspendues,
/// fenetres d'un autre bureau virtuel. Elles n'ont rien a faire dans la liste,
/// et leur capture ne rendrait qu'un rectangle noir.
fn escamotee(fenetre: HWND) -> bool {
    let mut masquee: u32 = 0;
    let taille = std::mem::size_of::<u32>() as u32;

    let ok = unsafe {
        DwmGetWindowAttribute(
            fenetre,
            DWMWA_CLOAKED,
            &mut masquee as *mut u32 as *mut _,
            taille,
        )
    };

    ok.is_ok() && masquee != 0
}

/// Titre de la fenetre, ou une chaine vide.
fn titre(fenetre: HWND) -> String {
    let longueur = unsafe { GetWindowTextLengthW(fenetre) };
    if longueur <= 0 {
        return String::new();
    }

    let mut tampon = vec![0u16; longueur as usize + 1];
    let ecrits = unsafe { GetWindowTextW(fenetre, &mut tampon) };
    String::from_utf16_lossy(&tampon[..ecrits as usize])
}

/// Retient les fenetres qu'un humain reconnaitrait comme une application.
fn partageable(fenetre: HWND) -> bool {
    if !unsafe { IsWindowVisible(fenetre) }.as_bool() {
        return false;
    }

    // Seules les fenetres racines : les boites de dialogue appartenant a une
    // application apparaitraient sinon a cote d'elle, sans qu'on sache
    // laquelle choisir.
    if unsafe { GetAncestor(fenetre, GA_ROOT) } != fenetre {
        return false;
    }

    // Les palettes d'outils ne sont pas des fenetres qu'on partage.
    let styles = unsafe { GetWindowLongW(fenetre, GWL_EXSTYLE) } as u32;
    if styles & WS_EX_TOOLWINDOW.0 != 0 {
        return false;
    }

    if escamotee(fenetre) {
        return false;
    }

    // Une fenetre reduite a un cadre qui ne veut rien dire — Windows la range
    // hors de l'ecran — donc la mesure ne s'applique qu'aux autres.
    if unsafe { IsIconic(fenetre) }.as_bool() {
        return true;
    }

    let mut cadre = RECT::default();
    if unsafe { GetWindowRect(fenetre, &mut cadre) }.is_err() {
        return false;
    }

    // Sous cette taille, c'est une fenetre technique, pas une application.
    (cadre.right - cadre.left) >= 160 && (cadre.bottom - cadre.top) >= 120
}

/// La zone que la fenetre occupera une fois restauree.
///
/// `GetWindowRect` d'une fenetre reduite rend un rectangle range hors de
/// l'ecran, souvent `-32000`. S'en servir donnerait des tuiles minuscules et,
/// pire, ferait croire a l'interface que la fenetre est sur un autre moniteur.
fn cadre_restaure(fenetre: HWND) -> Option<RECT> {
    let mut place = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        ..Default::default()
    };

    unsafe { GetWindowPlacement(fenetre, &mut place) }.ok()?;
    Some(place.rcNormalPosition)
}

/// Encode des pixels BGRA en PNG, puis en `data:`.
fn en_png(pixels: &[u8], largeur: u32, hauteur: u32) -> Option<String> {
    let mut rgba = Vec::with_capacity(pixels.len());
    for bloc in pixels.chunks_exact(4) {
        // GDI rend du BGRA ; PNG attend du RGBA. Le canal alpha renvoye par
        // `GetDIBits` n'est pas fiable, on le force a l'opacite.
        rgba.extend_from_slice(&[bloc[2], bloc[1], bloc[0], 255]);
    }

    let mut brut = Vec::new();
    {
        let mut encodeur = png::Encoder::new(&mut brut, largeur, hauteur);
        encodeur.set_color(png::ColorType::Rgba);
        encodeur.set_depth(png::BitDepth::Eight);
        let mut ecrivain = encodeur.write_header().ok()?;
        ecrivain.write_image_data(&rgba).ok()?;
    }

    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&brut)
    ))
}

/// Reduit un bitmap deja pret et l'encode en vignette.
fn reduire(source: HDC, largeur: i32, hauteur: i32) -> Option<String> {
    let cible_l = VIGNETTE_LARGEUR.min(largeur);
    let cible_h = ((cible_l as f32) * (hauteur as f32) / (largeur as f32)).round() as i32;
    if cible_h <= 0 {
        return None;
    }

    unsafe {
        let ecran = GetWindowDC(HWND(std::ptr::null_mut()));
        if ecran.is_invalid() {
            return None;
        }

        let memoire = CreateCompatibleDC(ecran);
        let bitmap = CreateCompatibleBitmap(ecran, cible_l, cible_h);
        let ancien = SelectObject(memoire, bitmap);

        // Sans ce mode, la reduction procede par abandon de lignes et le
        // resultat est illisible : on ne reconnait plus la fenetre.
        SetStretchBltMode(memoire, HALFTONE);

        let copie = StretchBlt(
            memoire, 0, 0, cible_l, cible_h, source, 0, 0, largeur, hauteur, SRCCOPY,
        );

        let mut resultat = None;

        if copie.as_bool() {
            let mut entete = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: cible_l,
                    // Negatif : sans cela GDI rend l'image a l'envers.
                    biHeight: -cible_h,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut pixels = vec![0u8; (cible_l * cible_h * 4) as usize];
            let lues = GetDIBits(
                memoire,
                bitmap,
                0,
                cible_h as u32,
                Some(pixels.as_mut_ptr() as *mut _),
                &mut entete,
                DIB_RGB_COLORS,
            );

            if lues != 0 && !uniforme(&pixels) {
                resultat = en_png(&pixels, cible_l as u32, cible_h as u32);
            }
        }

        SelectObject(memoire, ancien);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(memoire);
        ReleaseDC(HWND(std::ptr::null_mut()), ecran);

        resultat
    }
}

/// Vrai si tous les pixels se valent — une vignette entierement noire.
///
/// C'est ainsi qu'echoue `PrintWindow` sur ce qu'il ne sait pas rendre : il
/// annonce une reussite et rend un rectangle vide. Sans ce test, la moitie des
/// tuiles seraient noires et l'on croirait le selecteur casse.
fn uniforme(pixels: &[u8]) -> bool {
    let Some(premier) = pixels.get(..4) else {
        return true;
    };

    !pixels.chunks_exact(4).any(|pixel| pixel[..3] != premier[..3])
}

/// Demande a la fenetre de se dessiner, occultee ou non.
///
/// C'est ce qui repare l'apercu le plus deroutant du selecteur : la vignette
/// venait d'une copie de l'ECRAN a l'endroit de la fenetre, si bien qu'une
/// fenetre derriere une autre montrait celle de devant. On choisissait Steam et
/// l'on voyait le navigateur pose dessus — d'ou l'impression de partager
/// l'ecran entier.
///
/// `PW_RENDERFULLCONTENT` est ce qui le rend utilisable : sans lui, tout ce qui
/// dessine en accelere — un navigateur, une application du Store — rend noir.
/// Il reste des cas ou la fenetre ne sait pas se dessiner a la demande, et l'on
/// repasse alors par l'ecran, ou l'on ne perd rien : ces fenetres-la sont
/// justement celles qui sont au premier plan.
fn vignette_fenetre(fenetre: HWND, zone: RECT) -> Option<String> {
    let largeur = zone.right - zone.left;
    let hauteur = zone.bottom - zone.top;
    if largeur <= 0 || hauteur <= 0 {
        return None;
    }

    unsafe {
        let ecran = GetWindowDC(HWND(std::ptr::null_mut()));
        if ecran.is_invalid() {
            return None;
        }

        let memoire = CreateCompatibleDC(ecran);
        let bitmap = CreateCompatibleBitmap(ecran, largeur, hauteur);
        let ancien = SelectObject(memoire, bitmap);

        let rendu = PrintWindow(fenetre, memoire, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT));
        let resultat = if rendu.as_bool() {
            reduire(memoire, largeur, hauteur)
        } else {
            None
        };

        SelectObject(memoire, ancien);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(memoire);
        ReleaseDC(HWND(std::ptr::null_mut()), ecran);

        resultat
    }
}

/// Capture une zone de l'ecran, reduite a la taille d'une vignette.
///
/// Le recours, quand la fenetre ne sait pas se dessiner a la demande. Ce qu'on
/// obtient est ce qui se trouve la — donc la bonne image pour une fenetre au
/// premier plan, et celle de dessus pour une fenetre couverte.
fn vignette_de(zone: RECT) -> Option<String> {
    let largeur = zone.right - zone.left;
    let hauteur = zone.bottom - zone.top;
    if largeur <= 0 || hauteur <= 0 {
        return None;
    }

    let largeur = zone.right - zone.left;
    let hauteur = zone.bottom - zone.top;
    if largeur <= 0 || hauteur <= 0 {
        return None;
    }

    unsafe {
        let ecran = GetWindowDC(HWND(std::ptr::null_mut()));
        if ecran.is_invalid() {
            return None;
        }

        let memoire = CreateCompatibleDC(ecran);
        let bitmap = CreateCompatibleBitmap(ecran, largeur, hauteur);
        let ancien = SelectObject(memoire, bitmap);

        let copie = BitBlt(
            memoire, 0, 0, largeur, hauteur, ecran, zone.left, zone.top, SRCCOPY,
        );

        let resultat = if copie.is_ok() {
            reduire(memoire, largeur, hauteur)
        } else {
            None
        };

        SelectObject(memoire, ancien);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(memoire);
        ReleaseDC(HWND(std::ptr::null_mut()), ecran);

        resultat
    }
}

/// Rappel d'`EnumWindows`, qui empile les fenetres retenues.
unsafe extern "system" fn collecter(fenetre: HWND, contexte: LPARAM) -> BOOL {
    let liste = &mut *(contexte.0 as *mut Vec<Source>);

    if !partageable(fenetre) {
        return TRUE;
    }

    let nom = titre(fenetre);
    if nom.trim().is_empty() {
        return TRUE;
    }

    // Notre propre fenetre : la partager reviendrait a filmer le selecteur.
    if nom == "Orbit" {
        return TRUE;
    }

    let reduite = IsIconic(fenetre).as_bool();

    // Reduite, le cadre courant est hors de l'ecran : on prend celui qu'elle
    // retrouvera en se rouvrant.
    let cadre = if reduite {
        match cadre_restaure(fenetre) {
            Some(place) => place,
            None => return TRUE,
        }
    } else {
        let mut courant = RECT::default();
        if GetWindowRect(fenetre, &mut courant).is_err() {
            return TRUE;
        }
        courant
    };

    /*
     * L'apercu vient de la fenetre elle-meme, pas de l'ecran.
     *
     * Une fenetre reduite ne dessine rien, et rien ne peut le lui faire faire :
     * elle part sans apercu, et l'interface le dit plutot que de montrer un
     * rectangle noir.
     */
    let vignette = if reduite {
        String::new()
    } else {
        vignette_fenetre(fenetre, cadre)
            .or_else(|| vignette_de(cadre))
            .unwrap_or_default()
    };

    liste.push(Source {
        id: format!("fenetre:{}", fenetre.0 as isize),
        titre: nom,
        genre: "fenetre",
        largeur: cadre.right - cadre.left,
        hauteur: cadre.bottom - cadre.top,
        x: cadre.left,
        y: cadre.top,
        vignette,
        reduite,
    });

    TRUE
}

/// Rappel d'`EnumDisplayMonitors`.
unsafe extern "system" fn collecter_ecran(
    moniteur: HMONITOR,
    _dc: HDC,
    _zone: *mut RECT,
    contexte: LPARAM,
) -> BOOL {
    let liste = &mut *(contexte.0 as *mut Vec<Source>);

    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

    if !GetMonitorInfoW(moniteur, &mut info.monitorInfo as *mut _).as_bool() {
        return TRUE;
    }

    let cadre = info.monitorInfo.rcMonitor;
    let index = liste.iter().filter(|s| s.genre == "ecran").count() + 1;

    liste.push(Source {
        id: format!("ecran:{}", moniteur.0 as isize),
        titre: if info.monitorInfo.dwFlags & 1 != 0 {
            "Ecran principal".to_string()
        } else {
            format!("Ecran {index}")
        },
        genre: "ecran",
        largeur: cadre.right - cadre.left,
        hauteur: cadre.bottom - cadre.top,
        x: cadre.left,
        y: cadre.top,
        vignette: vignette_de(cadre).unwrap_or_default(),
        // Un ecran n'est jamais reduit.
        reduite: false,
    });

    TRUE
}

/// Liste les ecrans puis les fenetres, vignettes comprises.
#[tauri::command]
pub fn sources_partageables() -> Vec<Source> {
    let mut liste: Vec<Source> = Vec::new();
    let contexte = LPARAM(&mut liste as *mut Vec<Source> as isize);

    unsafe {
        // Les ecrans d'abord : c'est le choix le plus courant, il doit arriver
        // en tete sans que l'interface ait a retrier.
        let _ = EnumDisplayMonitors(
            HDC(std::ptr::null_mut()),
            None,
            Some(collecter_ecran),
            contexte,
        );
        let _ = EnumWindows(Some(collecter), contexte);
    }

    liste
}

/// Position d'une source a l'ecran, en pixels physiques.
#[derive(Serialize)]
pub struct Zone {
    pub x: i32,
    pub y: i32,
    pub largeur: i32,
    pub hauteur: i32,
    /// Faux quand la fenetre a disparu ou a ete reduite depuis le choix.
    pub visible: bool,
}

/// Ou se trouve la source choisie, maintenant.
///
/// La capture porte toujours sur l'ecran entier — c'est la seule facon d'eviter
/// la fenetre de selection du moteur web. Partager une fenetre seule consiste
/// donc a decouper cette image, et le decoupage doit suivre la fenetre quand on
/// la deplace ou la redimensionne. D'ou cette interrogation repetee plutot
/// qu'une position figee au depart.
#[tauri::command]
pub fn zone_source(id: String) -> Zone {
    let absente = Zone {
        x: 0,
        y: 0,
        largeur: 0,
        hauteur: 0,
        visible: false,
    };

    let Some((genre, valeur)) = id.split_once(':') else {
        return absente;
    };

    let Ok(poignee) = valeur.parse::<isize>() else {
        return absente;
    };

    if genre == "ecran" {
        let moniteur = HMONITOR(poignee as *mut _);
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

        let ok = unsafe { GetMonitorInfoW(moniteur, &mut info.monitorInfo as *mut _) };
        if !ok.as_bool() {
            return absente;
        }

        let cadre = info.monitorInfo.rcMonitor;
        return Zone {
            x: cadre.left,
            y: cadre.top,
            largeur: cadre.right - cadre.left,
            hauteur: cadre.bottom - cadre.top,
            visible: true,
        };
    }

    let fenetre = HWND(poignee as *mut _);

    if !unsafe { IsWindow(fenetre) }.as_bool() || !partageable(fenetre) {
        return absente;
    }

    let mut cadre = RECT::default();
    if unsafe { GetWindowRect(fenetre, &mut cadre) }.is_err() {
        return absente;
    }

    Zone {
        x: cadre.left,
        y: cadre.top,
        largeur: cadre.right - cadre.left,
        hauteur: cadre.bottom - cadre.top,
        visible: true,
    }
}

/// Masque la barre « … partage votre ecran » du moteur.
///
/// Chromium pose une petite fenetre flottante pendant toute la duree d'un
/// partage, avec un bouton « Arreter le partage ». Aucune API ne permet de la
/// retirer : ni Tauri, ni WebView2, ni un drapeau de ligne de commande. Elle
/// annonce en plus l'adresse interne de l'application, `http://tauri.localhost`,
/// qui ne veut rien dire pour qui utilise le logiciel.
///
/// Notre propre interface dit deja qu'un partage est en cours et propose de
/// l'arreter — sur la tuile, dans la barre de commandes, et jusque dans la
/// barre laterale. Cette seconde annonce ne fait que dupliquer, moins bien.
///
/// La reconnaissance porte sur l'adresse contenue dans le titre : c'est le seul
/// element qui ne change pas d'une langue a l'autre, la phrase qui l'entoure
/// etant traduite.
///
/// La barre n'apparait pas immediatement : la fenetre est cherchee plusieurs
/// fois pendant deux secondes, puis on abandonne. Ne pas la trouver n'est pas
/// une erreur — une version future du moteur pourrait ne plus la poser.
#[tauri::command]
pub fn masquer_barre_partage() {
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

    unsafe extern "system" fn chercher(fenetre: HWND, contexte: LPARAM) -> BOOL {
        let trouvee = &mut *(contexte.0 as *mut bool);

        if !IsWindowVisible(fenetre).as_bool() {
            return TRUE;
        }

        let nom = titre(fenetre);

        // Notre propre fenetre s'appelle « Quality » : seule celle du moteur
        // affiche l'adresse interne.
        if nom.contains("tauri.localhost") {
            let _ = ShowWindow(fenetre, SW_HIDE);
            *trouvee = true;
            return windows::Win32::Foundation::FALSE;
        }

        TRUE
    }

    std::thread::spawn(|| {
        for _ in 0..20 {
            let mut trouvee = false;
            let contexte = LPARAM(&mut trouvee as *mut bool as isize);
            unsafe {
                let _ = EnumWindows(Some(chercher), contexte);
            }

            if trouvee {
                return;
            }

            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{sources_partageables, uniforme};

    #[test]
    fn une_vignette_noire_est_reconnue() {
        /*
         * C'est ainsi qu'echoue `PrintWindow` : il annonce une reussite et rend
         * un rectangle vide. Sans ce test, la moitie des tuiles seraient noires
         * et l'on croirait le selecteur casse plutot que la fenetre muette.
         */
        let noir = vec![0u8; 64 * 4];
        assert!(uniforme(&noir));

        let mut presque = vec![7u8; 64 * 4];
        assert!(uniforme(&presque));

        // Un seul pixel qui differe suffit : l'image porte quelque chose.
        presque[40] = 200;
        assert!(!uniforme(&presque));
    }

    #[test]
    fn le_canal_alpha_ne_compte_pas() {
        /*
         * GDI laisse l'alpha a zero sur ce qu'il rend, et de facon inegale.
         * Le prendre en compte ferait passer une image parfaitement noire pour
         * une image qui porte quelque chose — et l'on afficherait le rectangle
         * vide qu'on voulait ecarter.
         */
        let mut noir = vec![0u8; 8 * 4];
        noir[3] = 255;
        noir[7] = 0;

        assert!(uniforme(&noir));
    }

    #[test]
    fn la_liste_tient_ses_promesses() {
        let sources = sources_partageables();

        // Une machine a toujours au moins un ecran ; en trouver zero voudrait
        // dire que l'enumeration elle-meme a echoue.
        assert!(
            sources.iter().any(|source| source.genre == "ecran"),
            "aucun ecran enumere",
        );

        for source in &sources {
            assert!(!source.titre.trim().is_empty(), "source sans titre");

            // Une fenetre reduite est annoncee avec la taille qu'elle
            // retrouvera, jamais avec le rectangle hors ecran que Windows lui
            // donne en attendant.
            assert!(
                source.largeur > 0 && source.hauteur > 0,
                "{} annonce {}x{}",
                source.titre,
                source.largeur,
                source.hauteur,
            );

            // Une vignette est soit absente, soit une image lisible : une
            // chaine tronquee ferait une tuile cassee dans la grille.
            if !source.vignette.is_empty() {
                assert!(
                    source.vignette.starts_with("data:image/png;base64,"),
                    "vignette illisible pour {}",
                    source.titre,
                );
            }

            // L'apercu d'une fenetre reduite n'existe pas, et le pretendre
            // afficherait un rectangle noir a la place du signe qui explique.
            if source.reduite {
                assert!(source.vignette.is_empty(), "{} reduite avec apercu", source.titre);
            }
        }
    }
}
