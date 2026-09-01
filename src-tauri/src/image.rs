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

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};

use windows::core::{Interface, Result};
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
pub fn capturer_fenetre(fenetre: HWND) -> Result<Capture> {
    let interop: IGraphicsCaptureItemInterop =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;

    let source: GraphicsCaptureItem = unsafe { interop.CreateForWindow(fenetre)? };
    ouvrir(source)
}

/// Ouvre une capture sur un ecran.
pub fn capturer_ecran(ecran: HMONITOR) -> Result<Capture> {
    let interop: IGraphicsCaptureItemInterop =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;

    let source: GraphicsCaptureItem = unsafe { interop.CreateForMonitor(ecran)? };
    ouvrir(source)
}

/// Le materiel graphique, et son pendant cote WinRT.
///
/// Les deux representent le meme appareil : `Direct3D11CaptureFramePool` parle
/// le second, la lecture des textures parle le premier. On garde donc les deux
/// plutot que de reconstruire l'un a partir de l'autre a chaque image.
fn appareil() -> Result<(ID3D11Device, ID3D11DeviceContext, IDirect3DDevice)> {
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
    let winrt = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? };
    let winrt: IDirect3DDevice = winrt.cast()?;

    Ok((materiel, contexte, winrt))
}

/// Monte la reserve d'images et branche l'arrivee.
fn ouvrir(source: GraphicsCaptureItem) -> Result<Capture> {
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
    let (expediteur, images): (SyncSender<Image>, Receiver<Image>) = sync_channel(2);

    let pour_evenement = reserve.clone();
    reserve.FrameArrived(&TypedEventHandler::new(
        move |_reserve: &Option<Direct3D11CaptureFramePool>, _| {
            let Ok(image) = pour_evenement.TryGetNextFrame() else {
                return Ok(());
            };

            if let Ok(lue) = lire(&materiel, &contexte, &image) {
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
        images,
    })
}

/// Ramene une image du processeur graphique vers la memoire centrale.
///
/// La texture rendue par la capture vit sur la carte et ne se lit pas
/// directement : il faut la recopier dans une texture « d'attente », faite pour
/// etre lue par le processeur. C'est le seul passage couteux de ce fichier, et
/// il disparaitra le jour ou l'encodage se fera sur la carte elle-meme.
fn lire(
    materiel: &ID3D11Device,
    contexte: &ID3D11DeviceContext,
    image: &windows::Graphics::Capture::Direct3D11CaptureFrame,
) -> Result<Image> {
    let surface = image.Surface()?;
    let acces: windows::Win32::System::WinRT::Direct3D11::IDirect3DDxgiInterfaceAccess =
        surface.cast()?;
    let texture: ID3D11Texture2D = unsafe { acces.GetInterface()? };

    let mut description = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut description) };

    let attente = D3D11_TEXTURE2D_DESC {
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
        ..description
    };

    let mut copie: Option<ID3D11Texture2D> = None;
    unsafe { materiel.CreateTexture2D(&attente, None, Some(&mut copie))? };
    let copie = copie.ok_or_else(windows::core::Error::from_win32)?;

    unsafe { contexte.CopyResource(&copie, &texture) };

    let mut vue = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { contexte.Map(&copie, 0, D3D11_MAP_READ, 0, Some(&mut vue))? };

    let largeur = description.Width;
    let hauteur = description.Height;
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
    for ligne in 0..hauteur {
        let depart = unsafe { (vue.pData as *const u8).add((ligne as usize) * vue.RowPitch as usize) };
        pixels.extend_from_slice(unsafe { std::slice::from_raw_parts(depart, utile) });
    }

    unsafe { contexte.Unmap(&copie, 0) };

    Ok(Image {
        largeur,
        hauteur,
        pixels,
    })
}

/// La taille annoncee d'une source, sans ouvrir de capture.
pub fn taille_source(source: &GraphicsCaptureItem) -> Result<SizeInt32> {
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
        let capture = capturer_ecran(principal).expect("la capture doit s'ouvrir");

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
