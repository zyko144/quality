//! Capture d'une fenetre ou d'un ecran, par l'interface de Windows.
//!
//! Pourquoi ce fichier existe
//! --------------------------
//! Jusqu'ici, partager passait par le moteur web : on lui demandait l'ecran
//! entier — toujours le premier — et l'on decoupait l'image pour isoler la
//! fenetre choisie. Trois defauts en decoulaient, et aucun ne se corrigeait
//! sans changer de methode :
//!
//!  - ce qui recouvrait la fenetre partait avec elle, puisqu'on ne decoupait
//!    qu'une image ou elle etait deja recouverte ;
//!  - le second ecran etait hors d'atteinte, n'etant pas dans l'image ;
//!  - une fenetre reduite n'avait plus rien a decouper.
//!
//! `Windows.Graphics.Capture` capture la source elle-meme, sur le processeur
//! graphique : une fenetre rend son contenu meme recouverte, chaque ecran est
//! une source a part entiere, et rien n'est recopie par le processeur.
//!
//! Ce que ce fichier fait, et ne fait pas
//! -------------------------------------
//! Il rend des images. Les encoder et les transmettre a la page viendra
//! ensuite, dans un fichier separe : melanger l'acquisition et l'encodage
//! rendrait les deux impossibles a eprouver isolement, et c'est precisement ce
//! qu'on veut pouvoir faire d'un chemin aussi long.

#![cfg(windows)]
// Rien n'appelle encore ce fichier : il est la premiere moitie d'un chemin dont
// la seconde — encoder les images et les rendre a la page — reste a ecrire. Le
// silence sur le code inutilise vaut jusque-la, et pas au-dela.
#![allow(dead_code)]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};

use windows::core::Interface;

/// Le `Result` de Windows, nomme : sans cela il masque celui de la
/// bibliotheque standard, et l'on ne sait plus lequel une signature designe.
use windows::core::Result as ResultatWin;
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
    D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::System::WinRT::Direct3D11::CreateDirect3D11DeviceFromDXGIDevice;
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

/// Nombre d'images que la reserve garde.
///
/// Deux suffisent : on prend celle qui arrive pendant que la precedente est
/// encore lue. Davantage n'ajouterait que du retard — une image gardee est une
/// image qui attend son tour, et une image en retard ne sert a personne.
const IMAGES_EN_RESERVE: i32 = 2;

/// Intervalle minimal entre deux images rapatriees, en nanosecondes.
///
/// Regle en cours de partage, et c'est tout l'interet : rapatrier une image
/// coute deux millisecondes a 1080p — une copie depuis la carte, puis une
/// recopie en memoire centrale — et il faut y ajouter la conversion que le
/// moteur fait ensuite pour l'encodeur. Capturer soixante images quand
/// l'encodeur n'en sort que vingt-cinq, c'est payer ce prix trente-cinq fois
/// par seconde pour des images que personne ne verra jamais.
///
/// Un entier partage plutot qu'un message : la valeur est lue dans le rappel
/// d'arrivee, qui appartient a Windows et ne doit rien attendre.
static INTERVALLE_NS: AtomicU64 = AtomicU64::new(0);

/// Regle la cadence de capture sans rouvrir la source.
///
/// Rouvrir couperait l'image une demi-seconde, ce qui se verrait bien plus que
/// le gain — et se produirait a chaque fois que la machine souffle un peu.
#[tauri::command]
#[cfg(windows)]
pub fn cadence_image(images: u32) {
    INTERVALLE_NS.store(intervalle_pour(images), Ordering::Relaxed);
}

#[tauri::command]
#[cfg(not(windows))]
pub fn cadence_image(_images: u32) {}

/// L'intervalle correspondant a une cadence, borne par prudence.
fn intervalle_pour(images: u32) -> u64 {
    // Cinq images par seconde au plancher : en dessous, ce n'est plus un
    // partage mais une suite de photographies.
    1_000_000_000 / images.clamp(5, 240) as u64
}

/// Une image capturee, ramenee en memoire centrale.
pub struct Image {
    pub largeur: u32,
    pub hauteur: u32,
    /// Octets BGRA, sans remplissage entre les lignes.
    pub pixels: Vec<u8>,
}

/// Une capture en cours. Se referme en la laissant tomber.
pub struct Capture {
    _session: GraphicsCaptureSession,
    _reserve: Direct3D11CaptureFramePool,
    images: Receiver<Image>,
}

impl Capture {
    /// L'image suivante, ou `None` si la capture s'est arretee.
    ///
    /// Bloque jusqu'a la prochaine image. La source n'en produit pas quand rien
    /// ne change a l'ecran — une fenetre immobile n'a rien de neuf a dire — et
    /// c'est voulu : reemettre une image identique couterait un encodage pour
    /// rien.
    pub fn suivante(&self) -> Option<Image> {
        self.images.recv().ok()
    }

    /// L'image suivante si elle est deja la, sans attendre.
    pub fn disponible(&self) -> Option<Image> {
        self.images.try_recv().ok()
    }
}

/// Ouvre une capture sur une fenetre.
pub fn capturer_fenetre(fenetre: HWND, images: u32) -> ResultatWin<Capture> {
    let interop: IGraphicsCaptureItemInterop =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;

    let source: GraphicsCaptureItem = unsafe { interop.CreateForWindow(fenetre)? };
    ouvrir(source, images)
}

/// Ouvre une capture sur un ecran.
pub fn capturer_ecran(ecran: HMONITOR, images: u32) -> ResultatWin<Capture> {
    let interop: IGraphicsCaptureItemInterop =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;

    let source: GraphicsCaptureItem = unsafe { interop.CreateForMonitor(ecran)? };
    ouvrir(source, images)
}

/// Le materiel graphique, et son pendant cote WinRT.
///
/// Les deux representent le meme appareil : `Direct3D11CaptureFramePool` parle
/// le second, la lecture des textures parle le premier. On garde donc les deux
/// plutot que de reconstruire l'un a partir de l'autre a chaque image.
fn appareil() -> ResultatWin<(ID3D11Device, ID3D11DeviceContext, IDirect3DDevice)> {
    let mut materiel: Option<ID3D11Device> = None;
    let mut contexte: Option<ID3D11DeviceContext> = None;

    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            // `BGRA_SUPPORT` est exige par la capture : sans lui, la creation
            // reussit et la reserve d'images echoue plus tard, sans dire pourquoi.
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut materiel),
            None,
            Some(&mut contexte),
        )?;
    }

    let materiel = materiel.ok_or_else(|| windows::core::Error::from_win32())?;
    let contexte = contexte.ok_or_else(|| windows::core::Error::from_win32())?;

    let dxgi: IDXGIDevice = materiel.cast()?;

    /*
     * Notre travail passe apres celui du jeu.
     *
     * La carte arbitre entre ceux qui la sollicitent, et rien ne lui dit
     * spontanement que recopier une image de partage est moins urgent que
     * dessiner la scene qu'on est en train de jouer. Ce reglage le lui dit.
     *
     * L'echelle va de moins sept a sept ; moins deux suffit a nous faire passer
     * apres sans nous faire attendre indefiniment. Le pilote a le droit de
     * refuser — d'ou l'echec ignore : c'est une preference, pas une garantie.
     */
    let _ = unsafe { dxgi.SetGPUThreadPriority(-2) };

    let winrt = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? };
    let winrt: IDirect3DDevice = winrt.cast()?;

    Ok((materiel, contexte, winrt))
}

/// Monte la reserve d'images et branche l'arrivee.
fn ouvrir(source: GraphicsCaptureItem, images: u32) -> ResultatWin<Capture> {
    let (materiel, contexte, winrt) = appareil()?;
    let taille = source.Size()?;

    let reserve = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &winrt,
        // BGRA huit bits par composante : ce que la capture rend nativement, et
        // ce qu'un encodeur accepte sans conversion prealable.
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        IMAGES_EN_RESERVE,
        taille,
    )?;

    /*
     * La file est bornee a deux, et ne bloque jamais.
     *
     * L'evenement d'arrivee est appele par Windows sur son propre fil : y
     * attendre un lecteur lent ferait accumuler du retard dans la capture
     * elle-meme, que rien ne rattraperait. Une image abandonnee coute une image ;
     * une capture en retard coute tout le reste.
     */
    // Nomme `recues` et non `images` : ce dernier porte deja la cadence voulue,
    // et l'ombrer faisait lire la cadence sur le recepteur du canal.
    let (expediteur, recues): (SyncSender<Image>, Receiver<Image>) = sync_channel(2);

    /*
     * La cadence est filtree ICI, avant de rapatrier quoi que ce soit.
     *
     * La capture de Windows suit le rafraichissement de l'ecran : cent
     * quarante-quatre images par seconde sur un moniteur de joueur. Le filtre
     * vivait en aval, si bien qu'on payait le rapatriement complet — recopie
     * vers une texture d'attente, puis vers la memoire centrale, soit huit
     * megaoctets — pour quatre-vingt-quatre images sur cent quarante-quatre
     * qu'on jetait ensuite.
     *
     * Une image ecartee ici ne coute rien : elle est rendue a la reserve sans
     * avoir traverse le bus.
     */
    INTERVALLE_NS.store(intervalle_pour(images), Ordering::Relaxed);
    let mut precedente = std::time::Instant::now() - std::time::Duration::from_secs(1);

    let mut attente = Attente::default();

    let pour_evenement = reserve.clone();
    reserve.FrameArrived(&TypedEventHandler::new(
        move |_reserve: &Option<Direct3D11CaptureFramePool>, _| {
            let Ok(image) = pour_evenement.TryGetNextFrame() else {
                return Ok(());
            };

            let maintenant = std::time::Instant::now();
            let intervalle =
                std::time::Duration::from_nanos(INTERVALLE_NS.load(Ordering::Relaxed));

            if maintenant.duration_since(precedente) < intervalle {
                return Ok(());
            }
            precedente = maintenant;

            if let Ok(Some(lue)) = lire(&materiel, &contexte, &image, &mut attente) {
                let _ = expediteur.try_send(lue);
            }

            Ok(())
        },
    ))?;

    let session = reserve.CreateCaptureSession(&source)?;

    /*
     * Le contour jaune est retire quand Windows le permet.
     *
     * Il encadre par defaut ce qui est capture. C'est une garantie honnete —
     * on voit ce qui est filme — mais elle se retrouve DANS l'image envoyee,
     * ou elle n'apprend rien a personne et masque une bordure de la fenetre.
     * La propriete n'existe que sur les Windows recents, d'ou l'echec ignore.
     */
    let _ = session.SetIsBorderRequired(false);

    session.StartCapture()?;

    Ok(Capture {
        _session: session,
        _reserve: reserve,
        images: recues,
    })
}

/// Les textures d'attente, gardees d'une image a l'autre.
///
/// **Deux, et lues en decale.** C'est le point qui coute des images par seconde
/// a celui qui partage, et il ne se devine pas.
///
/// La texture rendue par la capture vit sur la carte et ne se lit pas
/// directement : il faut la recopier dans une texture faite pour etre lue par
/// le processeur, puis demander l'acces a cette copie. Avec une seule texture,
/// on demande l'acces a une copie qu'on vient d'ordonner : la carte doit donc
/// terminer TOUT ce qu'elle a en cours avant de rendre la main. Le jeu, qui
/// partage la meme carte, se retrouve arrete net soixante fois par seconde —
/// et c'est cela qu'on paie en images perdues, bien plus que le temps de la
/// copie elle-meme.
///
/// Avec deux, on ordonne la copie dans l'une et on lit l'autre, remplie a
/// l'image precedente : la carte a eu tout le temps de la finir, et rien
/// n'attend. Le prix est une image de retard, soit une quinzaine de
/// millisecondes que personne ne remarque dans un partage d'ecran.
///
/// En creer une par image serait pire encore : le pilote allouerait soixante
/// fois par seconde, ce qui coute plus cher que la copie. Les dimensions ne
/// changent que si la source change de taille, et l'on refait alors les deux.
#[derive(Default)]
struct Attente {
    textures: Option<[ID3D11Texture2D; 2]>,
    largeur: u32,
    hauteur: u32,
    /// Celle qu'on va remplir. L'autre porte l'image precedente.
    tour: usize,
    /// Faux tant que la seconde texture n'a jamais ete remplie.
    amorcee: bool,
}

/// Ramene une image du processeur graphique vers la memoire centrale.
///
/// Rend `Ok(None)` a la toute premiere image : il n'y a alors rien a lire dans
/// l'autre texture, et rendre une image noire serait pire que n'en rendre
/// aucune.
fn lire(
    materiel: &ID3D11Device,
    contexte: &ID3D11DeviceContext,
    image: &windows::Graphics::Capture::Direct3D11CaptureFrame,
    attente: &mut Attente,
) -> ResultatWin<Option<Image>> {
    let surface = image.Surface()?;
    let acces: windows::Win32::System::WinRT::Direct3D11::IDirect3DDxgiInterfaceAccess =
        surface.cast()?;
    let texture: ID3D11Texture2D = unsafe { acces.GetInterface()? };

    let mut description = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut description) };

    let largeur = description.Width;
    let hauteur = description.Height;

    // On refait les textures seulement si la taille a change : une fenetre
    // redimensionnee pendant qu'on la partage, et rien d'autre.
    let convient =
        attente.textures.is_some() && attente.largeur == largeur && attente.hauteur == hauteur;

    if !convient {
        let forme = D3D11_TEXTURE2D_DESC {
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
            ..description
        };

        let faire = || -> ResultatWin<ID3D11Texture2D> {
            let mut neuve: Option<ID3D11Texture2D> = None;
            unsafe { materiel.CreateTexture2D(&forme, None, Some(&mut neuve))? };
            neuve.ok_or_else(windows::core::Error::from_win32)
        };

        attente.textures = Some([faire()?, faire()?]);
        attente.largeur = largeur;
        attente.hauteur = hauteur;
        attente.tour = 0;
        // La taille a change : ce que porte l'autre texture ne vaut plus rien.
        attente.amorcee = false;
    }

    let textures = attente.textures.as_ref().expect("les textures viennent d'etre posees");

    // On ordonne la copie dans l'une, on lira l'autre.
    unsafe { contexte.CopyResource(&textures[attente.tour], &texture) };

    let precedente = 1 - attente.tour;
    attente.tour = precedente;

    if !attente.amorcee {
        // Premiere image : l'autre texture n'a jamais rien recu. On amorce, et
        // la prochaine sera lisible.
        attente.amorcee = true;
        return Ok(None);
    }

    let copie = &textures[precedente];

    /*
     * L'acces ne devrait pas attendre : cette copie a ete ordonnee a l'image
     * precedente, et la carte l'a terminee depuis longtemps. C'est toute la
     * raison d'etre des deux textures.
     */
    let mut vue = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { contexte.Map(copie, 0, D3D11_MAP_READ, 0, Some(&mut vue))? };

    let mut pixels = Vec::with_capacity((largeur * hauteur * 4) as usize);

    /*
     * Les lignes sont recopiees une a une.
     *
     * La carte aligne chaque ligne sur une largeur qui lui convient — `RowPitch`
     * — souvent plus grande que la ligne utile. Copier le bloc d'un seul tenant
     * emporterait ce remplissage et decalerait l'image d'un peu plus a chaque
     * ligne : l'image penchee, defaut classique et immediatement reconnaissable.
     */
    let utile = (largeur * 4) as usize;

    if vue.RowPitch as usize == utile {
        /*
         * Aucun remplissage : une seule copie plutot que mille.
         *
         * La carte aligne souvent ses lignes sur la largeur utile quand
         * celle-ci tombe juste — ce qui est le cas des definitions usuelles.
         * On evite alors mille quatre-vingts appels par image.
         */
        let tout = unsafe { std::slice::from_raw_parts(vue.pData as *const u8, utile * hauteur as usize) };
        pixels.extend_from_slice(tout);
    } else {
        for ligne in 0..hauteur {
            let depart =
                unsafe { (vue.pData as *const u8).add((ligne as usize) * vue.RowPitch as usize) };
            pixels.extend_from_slice(unsafe { std::slice::from_raw_parts(depart, utile) });
        }
    }

    unsafe { contexte.Unmap(copie, 0) };

    Ok(Some(Image {
        largeur,
        hauteur,
        pixels,
    }))
}

/// La taille annoncee d'une source, sans ouvrir de capture.
pub fn taille_source(source: &GraphicsCaptureItem) -> ResultatWin<SizeInt32> {
    source.Size()
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
    use windows::Win32::Foundation::POINT;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    /// La capture rend-elle une image de l'ecran, et une vraie ?
    ///
    /// « Une vraie » compte autant que « une » : une texture non initialisee est
    /// uniformement noire et satisferait un test qui ne verifierait que la
    /// taille. On regarde donc si les pixels different entre eux — un bureau,
    /// meme sobre, n'est jamais d'une seule couleur.
    #[test]
    fn l_ecran_principal_rend_une_image() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }

        if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
            eprintln!("capture non prise en charge sur cette machine : test ignore");
            return;
        }

        let principal = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
        let capture = capturer_ecran(principal, 60).expect("la capture doit s'ouvrir");

        // La premiere image peut tarder : la session demarre, et l'ecran doit
        // changer pour qu'une image soit produite.
        let mut image = None;
        for _ in 0..40 {
            if let Some(recue) = capture.disponible() {
                image = Some(recue);
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        let image = image.expect("une image doit arriver en deux secondes");

        assert!(image.largeur >= 640, "largeur : {}", image.largeur);
        assert!(image.hauteur >= 480, "hauteur : {}", image.hauteur);
        assert_eq!(
            image.pixels.len(),
            (image.largeur * image.hauteur * 4) as usize,
            "les lignes doivent etre recopiees sans remplissage"
        );

        let premier = &image.pixels[..4];
        let varie = image.pixels.chunks_exact(4).any(|pixel| pixel != premier);
        assert!(varie, "l'image est uniforme : la lecture n'a rien rapporte");
    }
}

/* -------------------------------------------------------------------------- */
/* Le flux vers l'interface                                                    */
/* -------------------------------------------------------------------------- */

/// Generation de capture d'image en cours.
///
/// Meme role que pour le son : un booleen ne suffisait pas, car arreter puis
/// relancer aussitot laissait l'ancien fil croire qu'il devait continuer.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Ce que l'interface doit savoir pour lire le flux.
#[derive(Clone, serde::Serialize)]
pub struct FluxImage {
    pub port: u16,
    pub jeton: String,
    pub largeur: u32,
    pub hauteur: u32,
}

/// Ouvre la capture d'une source et sert ses images sur la boucle locale.
///
/// `source` est l'identifiant rendu par `sources_partageables` : `fenetre:N` ou
/// `ecran:N`. C'est le meme vocabulaire que le selecteur, pour qu'un choix se
/// transmette sans traduction.
#[tauri::command]
pub fn demarrer_image(source: String, images: u32) -> Result<FluxImage, String> {
    let capture = ouvrir_source(&source, images)?;
    let (largeur, hauteur) = premiere_taille(&capture)?;

    let passage = crate::flux::ouvrir().map_err(|_| "Impossible d'ouvrir le passage.".to_string())?;
    let port = passage.port;
    let jeton = passage.jeton.clone();

    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    /*
     * La file ne garde qu'une image, et ne bloque jamais.
     *
     * Une image en retard ne sert a personne : ce qu'on veut montrer, c'est ce
     * qui est a l'ecran maintenant. En garder plusieurs ferait accumuler du
     * retard que rien ne rattraperait, et l'image finirait par decrire un passe
     * que celui qui regarde ne peut pas relier a ce qu'il entend.
     */
    let (expediteur, receveur) = std::sync::mpsc::sync_channel::<Vec<u8>>(1);

    std::thread::spawn(move || {
        while GENERATION.load(Ordering::SeqCst) == generation {
            let Some(image) = capture.suivante() else {
                break;
            };

            /*
             * Chaque image porte sa taille.
             *
             * Une fenetre change de taille pendant qu'on la partage, et la
             * suivante n'a alors plus les memes dimensions. Sans cet en-tete,
             * l'interface lirait la nouvelle image avec l'ancienne taille — une
             * image penchee, puis n'importe quoi.
             */
            let mut paquet = Vec::with_capacity(12 + image.pixels.len());
            paquet.extend_from_slice(&image.largeur.to_le_bytes());
            paquet.extend_from_slice(&image.hauteur.to_le_bytes());
            paquet.extend_from_slice(&(image.pixels.len() as u32).to_le_bytes());
            paquet.extend_from_slice(&image.pixels);

            let _ = expediteur.try_send(paquet);
        }
    });

    std::thread::spawn(move || {
        crate::flux::servir(passage, receveur, || {
            GENERATION.load(Ordering::SeqCst) == generation
        })
    });

    Ok(FluxImage {
        port,
        jeton,
        largeur,
        hauteur,
    })
}

/// Arrete la capture d'image. Sans effet si elle ne tourne pas.
#[tauri::command]
pub fn arreter_image() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// Ouvre la capture correspondant a un identifiant du selecteur.
fn ouvrir_source(source: &str, images: u32) -> Result<Capture, String> {
    let (genre, valeur) = source
        .split_once(':')
        .ok_or_else(|| "Source illisible.".to_string())?;

    let poignee: isize = valeur
        .parse()
        .map_err(|_| "Source illisible.".to_string())?;

    match genre {
        "fenetre" => {
            let fenetre = HWND(poignee as *mut std::ffi::c_void);
            rouvrir(fenetre);

            capturer_fenetre(fenetre, images)
                .map_err(|_| "Cette fenetre ne peut pas etre capturee.".to_string())
        }
        "ecran" => capturer_ecran(HMONITOR(poignee as *mut std::ffi::c_void), images)
            .map_err(|_| "Cet ecran ne peut pas etre capture.".to_string()),
        _ => Err("Source inconnue.".to_string()),
    }
}

/// Rouvre une fenetre reduite, sans la mettre au premier plan.
///
/// Le selecteur propose desormais les fenetres reduites — « mes applications
/// ouvertes » comprend celles qu'on vient de ranger, et les taire donnait le
/// sentiment qu'il en oubliait la moitie. Mais une fenetre reduite ne dessine
/// rien : la capture rendrait un rectangle noir, indefiniment et sans rien dire.
///
/// `SW_SHOWNOACTIVATE` la rouvre sans voler le focus. Celui qui partage reste
/// donc ou il est, au lieu d'etre arrache a ce qu'il faisait par sa propre
/// commande de partage.
#[cfg(windows)]
fn rouvrir(fenetre: HWND) {
    use windows::Win32::UI::WindowsAndMessaging::{IsIconic, ShowWindow, SW_SHOWNOACTIVATE};

    if unsafe { IsIconic(fenetre) }.as_bool() {
        let _ = unsafe { ShowWindow(fenetre, SW_SHOWNOACTIVATE) };

        // Le temps que le gestionnaire de bureau lui rende une surface : sans
        // cette pause, la capture s'ouvre sur une fenetre qui n'a pas encore
        // dessine et rend une premiere image vide.
        std::thread::sleep(std::time::Duration::from_millis(120));
    }
}

/// Attend la premiere image pour connaitre la taille reelle de la source.
///
/// La taille annoncee par `GraphicsCaptureItem` est celle de la fenetre, bordure
/// comprise ; celle des images peut differer d'un pixel ou deux selon l'echelle
/// du systeme. Mieux vaut annoncer ce qui arrivera vraiment que ce qu'on croit.
fn premiere_taille(capture: &Capture) -> Result<(u32, u32), String> {
    for _ in 0..60 {
        if let Some(image) = capture.disponible() {
            return Ok((image.largeur, image.hauteur));
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }

    Err("La source n'a rendu aucune image.".to_string())
}
