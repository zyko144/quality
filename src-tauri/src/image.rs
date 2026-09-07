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

/*
 * Ou passent les images, compte par compte.
 *
 * « Ca rame » decrit aussi bien une capture qui ne produit rien qu'un encodeur
 * qui n'avance pas, et les deux se corrigent a l'oppose l'un de l'autre. Le
 * cote interface sait deja dire combien d'images lui parviennent ; ces
 * compteurs-ci disent ce qu'il en est advenu AVANT, ce qui est la seule facon
 * de distinguer une image que Windows n'a jamais produite d'une image qu'on a
 * jetee soi-meme.
 */
static ARRIVEES: AtomicU64 = AtomicU64::new(0);
static GARDEES: AtomicU64 = AtomicU64::new(0);
/// Images lues puis abandonnees faute de place dans la PREMIERE file.
static ABANDONNEES: AtomicU64 = AtomicU64::new(0);

/*
 * Et celles perdues dans la SECONDE.
 *
 * Il y a deux files sur le chemin, et une seule etait comptee. Les traces d'un
 * partage en 3440x1440 le montrent sans ambiguite :
 *
 *     arrivees 166 · gardees 164 · abandonnees 0 · recues 31
 *
 * Cent trente-trois images disparaissent entre ce qu'on rapatrie et ce qui
 * atteint la piste, et le seul compteur qui existait disait « zero perdue ».
 * Il disait vrai : elles ne se perdaient pas la.
 *
 * Une image de cette definition pese 19,8 megaoctets. La file d'envoi n'en
 * garde qu'une, et le fil qui la vide ecrit dans une connexion locale que
 * l'interface lit a son rythme : quand elle ne suit pas, `try_send` echoue et
 * l'image est abandonnee — silencieusement, jusqu'ici.
 */
static NON_SERVIES: AtomicU64 = AtomicU64::new(0);

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

/// Part de l'intervalle toleree en avance. Voir `retenir`.
const TOLERANCE: u64 = 8;

/// Faut-il garder cette image ? Rend la prochaine echeance, ou `None`.
///
/// Le filtre precedent mesurait le temps ecoule DEPUIS LA DERNIERE IMAGE
/// GARDEE et jetait tout ce qui arrivait avant l'intervalle. La regle est juste
/// en apparence et perd la moitie des images des que la source tourne a la
/// cadence demandee — le cas le plus courant : soixante images par seconde
/// demandees sur un ecran a soixante hertz.
///
/// Le mecanisme est celui d'un battement. Les arrivees ne sont pas
/// regulieres a la nanoseconde pres ; il suffit qu'une image arrive quelques
/// microsecondes trop tot pour etre jetee, et la suivante est alors mesuree
/// depuis la precedente GARDEE, donc trente-trois millisecondes plus tard.
/// Une gardee, une jetee, indefiniment : trente images par seconde pour
/// soixante demandees et soixante capturees, sans que rien ne le signale.
///
/// Deux changements le suppriment :
///
///  - on vise une ECHEANCE, qui avance de l'intervalle exact a chaque image
///    gardee. Elle ne derive pas, alors qu'un delai mesure depuis la derniere
///    gardee accumule le retard de chacune ;
///  - on tolere une avance d'un huitieme d'intervalle. C'est ce qui absorbe la
///    gigue : sans elle, l'echeance et la source se croisent sans arret.
///
/// La tolerance ne peut pas emballer la cadence : au pire elle rend huit
/// septiemes de ce qui est demande, et la source, de toute facon, ne produit
/// pas plus qu'elle ne produit.
fn retenir(maintenant_ns: u64, echeance_ns: u64, intervalle_ns: u64) -> Option<u64> {
    if maintenant_ns + intervalle_ns / TOLERANCE < echeance_ns {
        return None;
    }

    /*
     * Apres une pause, on ne rattrape pas.
     *
     * Rien ne bouge a l'ecran pendant une seconde : la capture ne produit
     * rien, et l'echeance se retrouve loin dans le passe. Sans ce plancher,
     * les soixante images suivantes passeraient toutes d'un coup — une rafale
     * a la cadence de l'ecran, le temps que l'echeance revienne au present.
     */
    Some((echeance_ns + intervalle_ns).max(maintenant_ns))
}

/// Taille de l'en-tete pose devant chaque image : largeur, hauteur, octets.
pub const ENTETE: usize = 12;

/// Une image capturee, deja mise en forme pour le passage.
///
/// Pourquoi l'en-tete est reserve DES la lecture
/// ---------------------------------------------
/// Cette structure portait les seuls pixels, et l'envoi fabriquait ensuite un
/// second tampon : douze octets d'en-tete, puis une copie complete des pixels.
/// Une image 1080p pese 8,3 megaoctets ; a soixante par seconde, cette copie
/// seule demandait cinq cents megaoctets par seconde de bande passante memoire
/// — un coeur entier occupe a deplacer des octets qui etaient deja au bon
/// format, sur la machine de quelqu'un qui joue en meme temps.
///
/// Reserver la place au moment ou l'on ecrit les pixels ne coute rien : on
/// ecrit alors directement a leur place definitive, et l'envoi n'a plus qu'a
/// remplir les douze premiers octets.
pub struct Image {
    pub largeur: u32,
    pub hauteur: u32,
    /// Le paquet entier : douze octets d'en-tete, puis les octets BGRA.
    ///
    /// L'en-tete est deja rempli. Les pixels commencent a `ENTETE` et n'ont
    /// aucun remplissage entre les lignes.
    pub paquet: Vec<u8>,
}

impl Image {
    /// Les seuls pixels, sans l'en-tete. Pour les essais et la lecture.
    pub fn pixels(&self) -> &[u8] {
        &self.paquet[ENTETE..]
    }
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

    ARRIVEES.store(0, Ordering::Relaxed);
    GARDEES.store(0, Ordering::Relaxed);
    ABANDONNEES.store(0, Ordering::Relaxed);
    NON_SERVIES.store(0, Ordering::Relaxed);

    /*
     * Le temps est compte depuis l'ouverture, en nanosecondes.
     *
     * `Instant` ne se compare pas a un nombre, et la regle de retenue doit
     * pouvoir tourner sans horloge pour etre eprouvee. Voir `retenir` et ses
     * essais : c'est une boucle de decision, et celles-la ne se verifient pas
     * en les lisant.
     */
    let depart = std::time::Instant::now();
    let mut echeance: u64 = 0;

    let mut attente = Attente::default();

    let pour_evenement = reserve.clone();
    reserve.FrameArrived(&TypedEventHandler::new(
        move |_reserve: &Option<Direct3D11CaptureFramePool>, _| {
            let Ok(image) = pour_evenement.TryGetNextFrame() else {
                return Ok(());
            };

            ARRIVEES.fetch_add(1, Ordering::Relaxed);

            let maintenant = depart.elapsed().as_nanos() as u64;
            let intervalle = INTERVALLE_NS.load(Ordering::Relaxed);

            let Some(suivante) = retenir(maintenant, echeance, intervalle) else {
                return Ok(());
            };
            echeance = suivante;

            if let Ok(Some(lue)) = lire(&materiel, &contexte, &image, &mut attente) {
                GARDEES.fetch_add(1, Ordering::Relaxed);

                // La file ne bloque jamais : une image en retard ne sert a
                // personne. Mais on compte celles qu'on abandonne, sans quoi
                // « il manque des images » ne designe rien.
                if expediteur.try_send(lue).is_err() {
                    ABANDONNEES.fetch_add(1, Ordering::Relaxed);
                }
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

    /*
     * La place de l'en-tete est reservee AVANT les pixels.
     *
     * Elle est remplie tout de suite : la largeur et la hauteur sont connues,
     * la taille se deduit de l'allocation. Le fil d'envoi n'aura donc plus rien
     * a recopier — c'est tout l'objet de ce detour.
     */
    let octets = (largeur * hauteur * 4) as usize;
    let mut paquet = Vec::with_capacity(ENTETE + octets);
    paquet.extend_from_slice(&largeur.to_le_bytes());
    paquet.extend_from_slice(&hauteur.to_le_bytes());
    paquet.extend_from_slice(&(octets as u32).to_le_bytes());

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
        paquet.extend_from_slice(tout);
    } else {
        for ligne in 0..hauteur {
            let depart =
                unsafe { (vue.pData as *const u8).add((ligne as usize) * vue.RowPitch as usize) };
            paquet.extend_from_slice(unsafe { std::slice::from_raw_parts(depart, utile) });
        }
    }

    unsafe { contexte.Unmap(copie, 0) };

    Ok(Some(Image {
        largeur,
        hauteur,
        paquet,
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
            image.pixels().len(),
            (image.largeur * image.hauteur * 4) as usize,
            "les lignes doivent etre recopiees sans remplissage"
        );

        let premier = &image.pixels()[..4];
        let varie = image.pixels().chunks_exact(4).any(|pixel| pixel != premier);
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
             * Rien a recopier : le paquet est deja forme.
             *
             * Chaque image porte sa taille — une fenetre redimensionnee pendant
             * qu'on la partage change de dimensions, et sans en-tete
             * l'interface lirait la suivante avec les anciennes : une image
             * penchee, puis n'importe quoi. Cet en-tete est desormais ecrit au
             * moment ou les pixels sont rapatries, a leur place definitive.
             *
             * On envoie donc le tampon tel quel, sans le dupliquer.
             */
            if expediteur.try_send(image.paquet).is_err() {
                NON_SERVIES.fetch_add(1, Ordering::Relaxed);
            }
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

/// La retenue des images, eprouvee contre une source qui tourne.
///
/// Ces essais-la n'ont besoin ni d'ecran ni de carte graphique : `retenir` ne
/// connait que des nanosecondes. C'est tout l'interet de l'avoir sortie de
/// l'evenement — la regle precedente vivait au milieu d'un appel de Windows,
/// et l'on ne pouvait ni la lire ni la mesurer sans partager un ecran a la
/// main, en comptant les images a l'oeil.
#[cfg(test)]
mod essais_retenue {
    use super::*;

    /// Fait tourner la regle contre une source reguliere. Rend les images gardees.
    fn tourner(source_hz: u64, cible_hz: u32, images: u64, gigue_ns: i64) -> u64 {
        let intervalle = intervalle_pour(cible_hz);
        let periode = 1_000_000_000 / source_hz;

        let mut echeance = 0u64;
        let mut gardees = 0u64;

        for n in 0..images {
            /*
             * La gigue alterne d'une image a l'autre.
             *
             * C'est ce qui compte : une source parfaitement reguliere ne
             * revele rien. Le battement naissait justement de ce qu'une image
             * arrivait parfois quelques microsecondes trop tot.
             */
            let ecart = if n % 2 == 0 { gigue_ns } else { -gigue_ns };
            let maintenant = (n * periode).saturating_add_signed(ecart);

            if let Some(suivante) = retenir(maintenant, echeance, intervalle) {
                echeance = suivante;
                gardees += 1;
            }
        }

        gardees
    }

    /// Le defaut lui-meme : soixante demandees sur un ecran a soixante hertz.
    ///
    /// La regle precedente en rendait la moitie. Les traces le disaient sans
    /// qu'on sache le lire : `limite: none` — rien ne retenait l'encodeur — et
    /// pourtant deux fois moins d'images qu'il n'en arrivait.
    #[test]
    fn une_source_a_la_cadence_demandee_passe_entiere() {
        let gardees = tourner(60, 60, 600, 200_000);
        assert!(gardees >= 590, "seulement {gardees} images sur 600");
    }

    /// Et l'on ne depasse pas ce qui a ete demande.
    ///
    /// La tolerance pourrait, mal posee, faire passer plus d'images que la
    /// cadence voulue — ce serait payer un rapatriement pour rien.
    #[test]
    fn un_ecran_rapide_est_ramene_a_la_cadence_voulue() {
        let gardees = tourner(144, 60, 1440, 100_000);

        // Dix secondes a 144 Hz : environ six cents images a soixante.
        assert!(gardees >= 580, "seulement {gardees} images");
        assert!(gardees <= 690, "{gardees} images, soit plus que demande");
    }

    #[test]
    fn une_cadence_basse_est_respectee() {
        // Trente demandees sur soixante disponibles : une sur deux, et c'est
        // cette fois voulu.
        let gardees = tourner(60, 30, 600, 200_000);
        assert!((290..=310).contains(&gardees), "{gardees} images");
    }

    /// Une pause ne se rattrape pas en rafale.
    #[test]
    fn apres_une_pause_on_ne_rattrape_pas() {
        let intervalle = intervalle_pour(60);

        // L'echeance est restee une seconde en arriere : rien ne bougeait.
        let echeance = 0;
        let maintenant = 1_000_000_000;

        let suivante = retenir(maintenant, echeance, intervalle).expect("image gardee");

        /*
         * L'echeance revient au present. Sans ce plancher, elle serait a
         * 16,7 ms — dans le passe — et les soixante images suivantes
         * passeraient toutes, d'un coup.
         */
        assert!(suivante >= maintenant, "l'echeance est restee dans le passe");
        assert!(suivante <= maintenant + intervalle);
    }

    #[test]
    fn une_image_trop_en_avance_est_jetee() {
        let intervalle = intervalle_pour(60);
        // La moitie d'un intervalle en avance : bien au-dela de la gigue.
        assert!(retenir(intervalle / 2, intervalle, intervalle).is_none());
    }
}

/// Ce que la capture a vu, entre son arrivee et la file.
#[derive(serde::Serialize)]
pub struct DiagnosticImage {
    /// Images que Windows a produites. Suit le rafraichissement de l'ecran.
    pub arrivees: u64,
    /// Images retenues par la cadence, puis rapatriees en memoire centrale.
    pub gardees: u64,
    /// Images rapatriees puis abandonnees faute de place dans la premiere file.
    pub abandonnees: u64,
    /// Images abandonnees a l'envoi, faute de place dans la seconde.
    pub non_servies: u64,
}

/// Rend ces comptes. Sans effet de bord.
///
/// « Il manque des images » a trois causes qui se corrigent a l'oppose les unes
/// des autres, et rien dans l'interface ne les distingue :
///
///  - `arrivees` faible : Windows ne produit rien. L'ecran est fixe, ou la
///    source est masquee. Il n'y a rien a corriger.
///  - `gardees` bien en dessous de `arrivees` : c'est NOUS qui filtrons. Soit
///    la cadence demandee est basse, soit la regle de retenue se trompe — elle
///    l'a fait, et perdait une image sur deux.
///  - `abandonnees` non nul : le lecteur n'absorbe pas ce qu'on produit. Le
///    goulot est en aval, dans le passage ou dans l'interface.
///
/// Le compte des images qui arrivent VRAIMENT jusqu'a la piste est tenu de
/// l'autre cote, dans `imageSysteme.ts`. Les quatre nombres cote a cote
/// referment la chaine.
#[tauri::command]
pub fn diagnostic_image() -> DiagnosticImage {
    DiagnosticImage {
        arrivees: ARRIVEES.load(Ordering::Relaxed),
        gardees: GARDEES.load(Ordering::Relaxed),
        abandonnees: ABANDONNEES.load(Ordering::Relaxed),
        non_servies: NON_SERVIES.load(Ordering::Relaxed),
    }
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
