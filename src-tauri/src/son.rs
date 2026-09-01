//! Capture du son du systeme, par le bouclage de Windows.
//!
//! Pourquoi cote natif
//! -------------------
//! Le moteur web n'accorde le son d'un partage d'ecran que si la case
//! « partager aussi l'audio » a ete cochee — et cette case vit dans la fenetre
//! de selection du systeme, celle que nous supprimons pour afficher la notre.
//! Deux tentatives de contournement ont echoue, la seconde en tuant le
//! processus de rendu ; leur trace est dans `src/features/voice/sonSysteme.ts`.
//!
//! Ce module ne demande rien au moteur web. Il parle directement a WASAPI,
//! l'interface audio de Windows, dans son mode « bouclage » : au lieu d'ecouter
//! une entree, on ecoute ce qui sort vers les haut-parleurs. C'est le meme
//! chemin qu'emprunte un logiciel d'enregistrement.
//!
//! Ce qu'il capture
//! ----------------
//! TOUT ce que l'ordinateur joue, et pas seulement la fenetre partagee : le
//! bouclage est global, il n'existe pas de bouclage par application. En
//! pratique cela revient au meme — on partage un jeu, et le jeu est ce qui fait
//! du bruit — mais il faut le savoir : sur des haut-parleurs, les voix des
//! autres participants sont reprises et leur reviennent.
//!
//! Comment le son remonte
//! ----------------------
//! Les echantillons partent vers l'interface par un canal Tauri, en binaire
//! brut. Les passer en JSON couterait plus cher que le son lui-meme : 48 000
//! echantillons par seconde et par canal, chacun devenant une suite de
//! chiffres. Cote web, un `AudioWorklet` les rejoue et en refait une piste.

#[cfg(windows)]
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(windows)]
use tauri::ipc::{Channel, InvokeResponseBody};

#[cfg(windows)]
use windows::core::PCWSTR;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::STGM_READ;
use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;
#[cfg(windows)]
use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
// `WAVE_FORMAT_IEEE_FLOAT` vit dans Multimedia, pas dans Audio : les deux
// modules se partagent les constantes de format sans logique apparente.
#[cfg(windows)]
use windows::Win32::Media::Multimedia::WAVE_FORMAT_IEEE_FLOAT;
#[cfg(windows)]
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};

/// Duree du tampon demande a Windows, en unites de 100 nanosecondes.
///
/// Deux cents millisecondes : assez pour absorber un a-coup du systeme sans
/// perdre d'echantillons, assez peu pour que le son n'arrive pas en retard sur
/// l'image. Le tampon n'ajoute pas cette latence — on le vide en continu — il
/// borne seulement ce qu'on peut rattraper.
#[cfg(windows)]
const TAMPON_100NS: i64 = 2_000_000;

/// Pause entre deux releves quand le tampon est vide.
///
/// WASAPI peut signaler ses paquets par evenement, ce qui serait plus fin. Mais
/// le mode evenementiel impose des contraintes de format et de periode que le
/// peripherique refuse parfois, et retomber dessus en cours de route est plus
/// delicat que d'accepter cinq millisecondes de sondage.
#[cfg(windows)]
const REPOS_MS: u64 = 5;

/// Duree minimale d'un envoi vers l'interface, en millisecondes.
///
/// WASAPI rend ses paquets par tranches d'une dizaine de millisecondes. Les
/// transmettre un par un ferait cent allers-retours par seconde entre le fil de
/// capture et le moteur web, chacun repassant par le fil principal de la
/// fenetre : precisement le fil qu'on veut laisser tranquille pendant qu'un jeu
/// tourne. On les regroupe donc, et vingt millisecondes de retard ne s'entendent
/// pas — la transmission par le reseau en ajoute bien davantage.
#[cfg(windows)]
const GROUPE_MS: usize = 20;

/// Generation de capture en cours.
///
/// Un simple booleen ne suffisait pas. Arreter puis relancer aussitot — ce que
/// fait un utilisateur qui recoupe son partage — remettait le drapeau a vrai
/// avant que l'ancien fil ne l'ait vu passer a faux : il continuait, et deux
/// captures alimentaient le meme canal. Chaque fil retient ici son numero et
/// s'arrete des que le compteur avance, ce qu'un demarrage comme un arret font.
#[cfg(windows)]
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Ce que la capture annonce a l'interface avant d'envoyer des echantillons.
#[derive(Clone, serde::Serialize)]
pub struct FormatSon {
    /// Frequence d'echantillonnage du peripherique, en hertz.
    pub frequence: u32,
    /// Nombre de canaux. Deux le plus souvent, mais rien ne le garantit.
    pub canaux: u16,

    /// Nom lisible du peripherique dont on capture la sortie.
    ///
    /// Il ne sert a rien au fonctionnement, et beaucoup au diagnostic. Le
    /// bouclage porte ce que joue le peripherique de sortie PAR DEFAUT ; si le
    /// jeu, lui, joue sur un autre — un casque choisi dans ses options quand le
    /// defaut reste les haut-parleurs — la capture reussit et ne porte que du
    /// silence. Rien ne distingue ce cas d'un partage muet, sauf de pouvoir
    /// lire quel peripherique a ete pris.
    pub peripherique: Option<String>,
}

/// Une sortie audio, telle qu'on la propose a l'utilisateur.
#[derive(Clone, serde::Serialize)]
#[allow(dead_code)]
pub struct SortieAudio {
    /// Identifiant stable, celui que Windows attribue au point de terminaison.
    pub id: String,
    pub nom: String,
    /// Vrai pour la sortie par defaut de Windows.
    pub defaut: bool,
}

/// Enumere les sorties audio actives.
///
/// Pourquoi l'interface en a besoin
/// --------------------------------
/// Le bouclage porte ce que joue UN point de terminaison. Nous prenions
/// toujours celui par defaut, ce qui parait evident et ne l'est pas : sur une
/// machine equipee d'un routeur audio virtuel — Voicemeeter, VB-Cable, ceux
/// qu'on installe justement pour separer les sons — la sortie par defaut est
/// une entree virtuelle sur laquelle rien ne joue. La capture reussit alors
/// parfaitement et ne transporte que du silence.
///
/// Rien ne le distingue d'un partage muet, et le corriger demandait de changer
/// le peripherique par defaut de Windows pour toute la machine. D'ou ce choix,
/// rendu a qui partage.
#[cfg(windows)]
#[tauri::command]
pub fn lister_sorties_audio() -> Result<Vec<SortieAudio>, String> {
    unsafe {
        let _com = GardeCom::prendre();

        let enumerateur: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|_| "Impossible d'interroger les peripheriques audio.".to_string())?;

        let defaut = enumerateur
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .ok()
            .and_then(|d| d.GetId().ok())
            .map(|id| id.to_string().unwrap_or_default());

        let collection = enumerateur
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|_| "Aucune sortie audio active.".to_string())?;

        let combien = collection.GetCount().unwrap_or(0);
        let mut sorties = Vec::with_capacity(combien as usize);

        for index in 0..combien {
            let Ok(appareil) = collection.Item(index) else {
                continue;
            };

            let Ok(id) = appareil.GetId() else { continue };
            let id = id.to_string().unwrap_or_default();
            if id.is_empty() {
                continue;
            }

            sorties.push(SortieAudio {
                defaut: defaut.as_deref() == Some(id.as_str()),
                nom: nom_du_peripherique(&appareil).unwrap_or_else(|| id.clone()),
                id,
            });
        }

        Ok(sorties)
    }
}

/// Le peripherique demande, ou celui par defaut.
///
/// Un identifiant qui ne correspond plus a rien — casque debranche, pilote
/// reinstalle — retombe sur le defaut plutot que d'echouer : perdre le son
/// parce qu'on a change de casque serait absurde, et le niveau mesure cote
/// interface dira si le repli ne convient pas.
#[cfg(windows)]
unsafe fn choisir_peripherique(
    enumerateur: &IMMDeviceEnumerator,
    voulu: Option<&str>,
) -> Result<IMMDevice, String> {
    if let Some(id) = voulu.filter(|id| !id.is_empty()) {
        let large: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
        if let Ok(appareil) = enumerateur.GetDevice(PCWSTR(large.as_ptr())) {
            return Ok(appareil);
        }
    }

    enumerateur
        .GetDefaultAudioEndpoint(eRender, eConsole)
        .map_err(|_| echec("Aucun peripherique de sortie audio."))
}

/// Erreur rendue a l'interface, en francais et sans code Windows.
#[cfg(windows)]
fn echec(quoi: &str) -> String {
    format!("{quoi} Le partage partira sans le son.")
}

/// Demarre la capture et envoie les echantillons dans `canal`.
///
/// Rend le format du peripherique : l'interface en a besoin pour rejouer les
/// echantillons a la bonne vitesse. Le lui faire deviner produirait un son
/// transpose, ce qui s'entend immediatement et ne se diagnostique pas.
#[cfg(windows)]
#[tauri::command]
pub fn demarrer_son_systeme(
    canal: Channel<InvokeResponseBody>,
    peripherique: Option<String>,
) -> Result<FormatSon, String> {
    // Le format est lu ici, sur le fil de la commande, pour pouvoir le rendre
    // tout de suite. Le fil de capture rouvre son propre client : les objets
    // COM ne traversent pas les fils sans precautions qui n'en valent pas la
    // peine pour deux appels.
    let format = unsafe { lire_format(peripherique.as_deref()) }?;

    // Ouvrir une generation coupe la precedente, s'il en restait une.
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    std::thread::spawn(move || {
        if let Err(erreur) = unsafe { capturer(&canal, generation, peripherique.as_deref()) } {
            eprintln!("Capture du son du systeme : {erreur}");
        }
    });

    Ok(format)
}

/// Arrete la capture. Sans effet si elle ne tourne pas.
#[cfg(windows)]
#[tauri::command]
pub fn arreter_son_systeme() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// COM initialise par nous, et rendu par nous.
///
/// `CoInitializeEx` echoue avec `RPC_E_CHANGED_MODE` quand le fil appartient
/// deja a un autre modele — ce qui est le cas du fil principal d'une fenetre.
/// L'echec est sans consequence : COM est utilisable, il l'etait deja.
///
/// Ce qui ne l'est pas, c'est d'appeler `CoUninitialize` malgre tout. Le compte
/// de references de l'appartement tomberait a zero pour une initialisation qui
/// n'etait pas la notre, et les objets COM que le reste de l'application tenait
/// deviendraient invalides — un defaut lointain, intermittent, et impossible a
/// rattacher a ce fichier. Cette garde rend donc ce qu'elle a pris, et rien de
/// plus.
#[cfg(windows)]
struct GardeCom(bool);

#[cfg(windows)]
impl GardeCom {
    unsafe fn prendre() -> Self {
        Self(CoInitializeEx(None, COINIT_MULTITHREADED).is_ok())
    }
}

#[cfg(windows)]
impl Drop for GardeCom {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

/// Le format du peripherique de sortie par defaut.
#[cfg(windows)]
unsafe fn lire_format(voulu: Option<&str>) -> Result<FormatSon, String> {
    let _com = GardeCom::prendre();

    let resultat = (|| {
        let enumerateur: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|_| echec("Impossible d'interroger les peripheriques audio."))?;

        let peripherique = choisir_peripherique(&enumerateur, voulu)?;

        let client: IAudioClient = peripherique
            .Activate(CLSCTX_ALL, None)
            .map_err(|_| echec("Le peripherique de sortie a refuse l'acces."))?;

        let format = client
            .GetMixFormat()
            .map_err(|_| echec("Format audio illisible."))?;

        let lu = FormatSon {
            frequence: (*format).nSamplesPerSec,
            canaux: (*format).nChannels,
            peripherique: nom_du_peripherique(&peripherique),
        };

        CoTaskMemFree(Some(format as *const _));
        Ok(lu)
    })();

    resultat
}

/// Le nom lisible d'un peripherique, ou `None`.
///
/// Il se lit dans le magasin de proprietes, sous une cle dont le nom
/// (`PKEY_Device_FriendlyName`) n'est pas expose par le binding : on la
/// reconstruit. Un echec n'a aucune consequence — on perd une ligne de
/// diagnostic, pas du son — d'ou les `ok()?` en cascade plutot qu'une erreur
/// remontee jusqu'a l'interface.
#[cfg(windows)]
unsafe fn nom_du_peripherique(peripherique: &IMMDevice) -> Option<String> {
    let proprietes = peripherique.OpenPropertyStore(STGM_READ).ok()?;

    let cle = PROPERTYKEY {
        fmtid: windows::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };

    let valeur = proprietes.GetValue(&cle).ok()?;
    let nom = valeur.to_string();

    if nom.is_empty() {
        None
    } else {
        Some(nom)
    }
}

/// Le fil de capture : ouvre, boucle, ferme.
#[cfg(windows)]
unsafe fn capturer(
    canal: &Channel<InvokeResponseBody>,
    generation: u64,
    voulu: Option<&str>,
) -> Result<(), String> {
    let _com = GardeCom::prendre();

    capturer_interne(canal, generation, voulu)
}

/// Vrai si le format decrit des flottants 32 bits.
///
/// Deux facons de le dire coexistent. L'ancienne pose l'etiquette
/// `WAVE_FORMAT_IEEE_FLOAT` directement. La moderne pose
/// `WAVE_FORMAT_EXTENSIBLE` et range le vrai type dans un identifiant global,
/// dont le premier champ reprend l'ancienne etiquette — d'ou la comparaison,
/// qui parait etrange et ne l'est pas.
///
/// Se contenter de « 32 bits » accepterait aussi l'entier 32 bits, qu'on lirait
/// comme des flottants : du bruit blanc a plein volume.
#[cfg(windows)]
unsafe fn est_flottant(format: *const WAVEFORMATEX) -> bool {
    if (*format).wBitsPerSample != 32 {
        return false;
    }

    let etiquette = (*format).wFormatTag;

    if etiquette == WAVE_FORMAT_IEEE_FLOAT as u16 {
        return true;
    }

    if etiquette != WAVE_FORMAT_EXTENSIBLE as u16 {
        return false;
    }

    // `cbSize` annonce les octets qui suivent la structure de base ; sans eux,
    // l'identifiant qu'on s'apprete a lire n'existe pas.
    if (*format).cbSize < 22 {
        return false;
    }

    let etendu = format as *const WAVEFORMATEXTENSIBLE;
    (*etendu).SubFormat.data1 == WAVE_FORMAT_IEEE_FLOAT
}

#[cfg(windows)]
unsafe fn capturer_interne(
    canal: &Channel<InvokeResponseBody>,
    generation: u64,
    voulu: Option<&str>,
) -> Result<(), String> {
    let enumerateur: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
        .map_err(|_| echec("Impossible d'interroger les peripheriques audio."))?;

    let peripherique = choisir_peripherique(&enumerateur, voulu)?;

    let client: IAudioClient = peripherique
        .Activate(CLSCTX_ALL, None)
        .map_err(|_| echec("Le peripherique de sortie a refuse l'acces."))?;

    let format = client
        .GetMixFormat()
        .map_err(|_| echec("Format audio illisible."))?;

    if !est_flottant(format) {
        CoTaskMemFree(Some(format as *const _));
        return Err(echec("Le peripherique n'expose pas un format reconnu."));
    }

    let frequence = (*format).nSamplesPerSec as usize;
    let octets_par_trame = (*format).nBlockAlign as usize;

    let ouverture = client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        // Le bouclage, c'est ce seul drapeau : sans lui on capturerait un
        // micro, avec lui on capture ce qui sort.
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        TAMPON_100NS,
        0,
        format,
        None,
    );

    // Le format est rendu des qu'il a servi, quel que soit le sort de l'appel :
    // les chemins d'erreur qui suivent n'ont plus a y penser.
    CoTaskMemFree(Some(format as *const _));
    ouverture.map_err(|_| echec("Le bouclage audio a ete refuse par Windows."))?;

    let capture: IAudioCaptureClient = client
        .GetService()
        .map_err(|_| echec("Le service de capture est indisponible."))?;

    client
        .Start()
        .map_err(|_| echec("La capture n'a pas pu demarrer."))?;

    let seuil_envoi = frequence * GROUPE_MS / 1000 * octets_par_trame;
    let mut groupe: Vec<u8> = Vec::with_capacity(seuil_envoi * 2);

    while GENERATION.load(Ordering::SeqCst) == generation {
        let disponible = capture.GetNextPacketSize().unwrap_or(0);

        if disponible == 0 {
            /*
             * Le tampon est vide : on envoie ce qu'on garde avant de dormir.
             *
             * Sans cela, la fin d'un son resterait coincee dans le groupe en
             * cours jusqu'au son suivant — c'est-a-dire, quand on met un jeu en
             * pause, une syllabe suspendue qui repartirait bien plus tard.
             */
            if !groupe.is_empty() {
                let _ = canal.send(InvokeResponseBody::Raw(std::mem::take(&mut groupe)));
                groupe.reserve(seuil_envoi * 2);
            }

            std::thread::sleep(std::time::Duration::from_millis(REPOS_MS));
            continue;
        }

        let mut donnees: *mut u8 = std::ptr::null_mut();
        let mut trames: u32 = 0;
        let mut drapeaux: u32 = 0;

        if capture
            .GetBuffer(&mut donnees, &mut trames, &mut drapeaux, None, None)
            .is_err()
        {
            break;
        }

        if trames > 0 {
            let octets = trames as usize * octets_par_trame;

            /*
             * Le silence est ajoute comme du silence, pas comme le tampon.
             *
             * Quand rien ne joue, Windows leve `SILENT` et laisse le tampon
             * dans l'etat ou il se trouvait — souvent la derniere seconde de
             * son. Le prendre tel quel ferait boucler un fragment a l'infini
             * des qu'on met en pause.
             */
            if drapeaux & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                groupe.resize(groupe.len() + octets, 0);
            } else {
                groupe.extend_from_slice(std::slice::from_raw_parts(donnees, octets));
            }
        }

        let _ = capture.ReleaseBuffer(trames);

        if groupe.len() >= seuil_envoi {
            let _ = canal.send(InvokeResponseBody::Raw(std::mem::take(&mut groupe)));
            groupe.reserve(seuil_envoi * 2);
        }
    }

    let _ = client.Stop();

    Ok(())
}

/* -------------------------------------------------------------------------- */
/* Hors de Windows                                                             */
/* -------------------------------------------------------------------------- */
//
// Le bouclage est propre a WASAPI. macOS demande un peripherique virtuel que
// l'utilisateur installe lui-meme, et Linux passe par PulseAudio ou PipeWire.
// Les commandes existent partout pour que l'interface n'ait pas a savoir sur
// quel systeme elle tourne ; ailleurs, elles disent simplement non.

#[cfg(not(windows))]
#[tauri::command]
pub fn demarrer_son_systeme(
    _canal: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
    _peripherique: Option<String>,
) -> Result<FormatSon, String> {
    Err("La capture du son du systeme n'existe que sous Windows.".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn lister_sorties_audio() -> Result<Vec<SortieAudio>, String> {
    Ok(Vec::new())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn arreter_son_systeme() {}
