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
//! Par une connexion HTTP sur la boucle locale, et non par le canal Tauri.
//!
//! Le canal a ete essaye, et mesure : sur quatre cents paquets produits par
//! WASAPI, **un seul** atteignait l'interface. Au-dela d'un kilo-octet, ce
//! canal ne transmet pas la donnee directement — il fait executer a la page un
//! script qui va la rechercher par une commande interne, et cinquante
//! allers-retours par seconde de ce genre ne passent pas. Le defaut etait
//! d'autant plus trompeur que rien n'echouait : la capture s'ouvrait, les
//! paquets partaient, et le silence arrivait au bout.
//!
//! Ici, une seule connexion est ouverte pour toute la duree du partage, et les
//! echantillons y coulent sans etre annonces, decoupes ni reassembles. C'est
//! le meme transport que celui d'une video en lecture continue, pour la meme
//! raison : il est fait pour cela.
//!
//! Ce que la connexion n'est pas
//! -----------------------------
//! Elle n'ecoute que sur 127.0.0.1, n'accepte qu'une seule connexion, et exige
//! un jeton tire au hasard a chaque partage. Aucun autre programme de la
//! machine ne peut s'y brancher sans l'avoir devine, et elle se ferme avec le
//! partage.

#[cfg(windows)]
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(windows)]
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::Write;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::time::Duration;

use windows::core::{implement, Interface, HRESULT, IUnknown, PCWSTR};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
};
use windows::Win32::System::Com::STGM_READ;
use windows::Win32::System::Threading::{
    CreateEventW, GetCurrentProcessId, SetEvent, WaitForSingleObject,
};
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

/// Ce que la capture a vu passer, pour le diagnostic.
///
/// Trois maillons peuvent rompre entre WASAPI et les oreilles de celui qui
/// regarde : Windows peut ne rien donner, le canal peut ne rien transmettre, et
/// le fil audio peut ne rien jouer. Les deux derniers se mesurent cote web ; ce
/// compteur-ci mesure le premier, et c'est le seul moyen de les separer.
///
/// Le sommet est range en millieme, en entier : un flottant atomique n'existe
/// pas, et une valeur approchee suffit largement a distinguer « du son » de
/// « rien du tout ».
#[cfg(windows)]
static PAQUETS: AtomicU64 = AtomicU64::new(0);
#[cfg(windows)]
static TRAMES: AtomicU64 = AtomicU64::new(0);
#[cfg(windows)]
static SOMMET_MILLIEME: AtomicU64 = AtomicU64::new(0);
#[cfg(windows)]
static SILENCIEUX: AtomicU64 = AtomicU64::new(0);

/// Vrai quand la capture exclut notre propre application.
///
/// Se lit dans le diagnostic : les deux routes se comportent pareil du dehors,
/// et seule celle-ci evite l'echo. Sans ce drapeau, « il s'entend lui-meme » ne
/// se distinguerait pas de « il n'a pas la bonne version de Windows ».
#[cfg(windows)]
static EXCLUSION: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Ce que la capture a vu depuis son demarrage.
#[derive(Clone, serde::Serialize)]
pub struct DiagnosticSon {
    /// Paquets rendus par WASAPI.
    pub paquets: u64,
    /// Trames au total. Zero avec des paquets non nuls serait une anomalie.
    pub trames: u64,
    /// Le plus grand echantillon vu, en millieme de la pleine echelle.
    pub sommet: u64,
    /// Paquets que Windows a marques comme silencieux.
    pub silencieux: u64,
    /// Vrai quand la capture laisse nos propres voix de cote.
    pub exclusion: bool,
}

/// Rend ce que la capture a vu. Sans effet de bord.
///
/// L'interface l'appelle quelques secondes apres le debut d'un partage et le
/// journalise. C'est ce qui permet de dire « Windows ne donne rien » plutot que
/// « on n'entend rien », et ces deux phrases n'appellent pas la meme correction.
#[cfg(windows)]
#[tauri::command]
pub fn diagnostic_son() -> DiagnosticSon {
    DiagnosticSon {
        paquets: PAQUETS.load(Ordering::Relaxed),
        trames: TRAMES.load(Ordering::Relaxed),
        sommet: SOMMET_MILLIEME.load(Ordering::Relaxed),
        silencieux: SILENCIEUX.load(Ordering::Relaxed),
        exclusion: EXCLUSION.load(Ordering::Relaxed),
    }
}

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

    /// Port local ou le son coule, sur 127.0.0.1.
    pub port: u16,

    /// Jeton exige a la connexion. Tire au hasard a chaque partage.
    pub jeton: String,

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
pub fn demarrer_son_systeme(peripherique: Option<String>) -> Result<FormatSon, String> {
    // Le format est lu ici, sur le fil de la commande, pour pouvoir le rendre
    // tout de suite. Le fil de capture rouvre son propre client : les objets
    // COM ne traversent pas les fils sans precautions qui n'en valent pas la
    // peine pour deux appels.
    let mut format = unsafe { lire_format(peripherique.as_deref()) }?;

    /*
     * Le port est choisi par le systeme, pas par nous.
     *
     * Un port fixe se heurte a ce qui l'occupe deja, et deux fenetres de
     * l'application ne pourraient pas partager en meme temps. Zero demande au
     * systeme de trouver quelque chose de libre, et il le dit.
     */
    let ecouteur = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .map_err(|_| echec("Impossible d'ouvrir le passage du son."))?;

    let port = ecouteur
        .local_addr()
        .map_err(|_| echec("Impossible de lire le port du son."))?
        .port();

    let jeton = jeton_aleatoire();

    // Ouvrir une generation coupe la precedente, s'il en restait une.
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    // Les compteurs valent pour LA capture en cours : les laisser courir
    // ferait lire le diagnostic du partage precedent.
    PAQUETS.store(0, Ordering::Relaxed);
    TRAMES.store(0, Ordering::Relaxed);
    SOMMET_MILLIEME.store(0, Ordering::Relaxed);
    SILENCIEUX.store(0, Ordering::Relaxed);

    /*
     * Deux fils, relies par une file bornee.
     *
     * Le premier lit WASAPI, qui n'attend pas : rester trop longtemps hors de
     * sa boucle fait perdre des echantillons. Le second ecrit dans la
     * connexion, ce qui peut bloquer. Les melanger ferait payer a la capture
     * les hesitations du reseau local.
     *
     * La file est bornee a cinquante paquets — une seconde environ. Pleine,
     * l'envoi le plus ancien est abandonne plutot qu'attendu : du son en retard
     * d'une seconde ne sert a personne, et le retard ne se resorberait jamais.
     */
    let (expediteur, receveur) = sync_channel::<Vec<u8>>(50);

    let voulu = peripherique.clone();
    std::thread::spawn(move || {
        if let Err(erreur) = unsafe { capturer(&expediteur, generation, voulu.as_deref()) } {
            eprintln!("Capture du son du systeme : {erreur}");
        }
    });

    let jeton_du_fil = jeton.clone();
    std::thread::spawn(move || servir(ecouteur, receveur, generation, jeton_du_fil));

    format.port = port;
    format.jeton = jeton;
    Ok(format)
}

/// Un jeton imprevisible, tire a chaque partage.
///
/// `RandomState` est ensemence par le systeme a chaque construction : c'est ce
/// qui protege les tables de hachage de Rust contre les collisions provoquees.
/// Deux ensemencements independants donnent trente-deux caracteres, ce qui est
/// largement assez pour un jeton qui ne vit que le temps d'un partage, sur une
/// connexion qui n'ecoute que la boucle locale.
#[cfg(windows)]
fn jeton_aleatoire() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);

    let mut premier = RandomState::new().build_hasher();
    premier.write_u64(nanos);

    let mut second = RandomState::new().build_hasher();
    second.write_u64(nanos.rotate_left(32));

    format!("{:016x}{:016x}", premier.finish(), second.finish())
}

/// Sert le son sur la connexion locale, tant que la generation est la bonne.
///
/// Une seule connexion est acceptee. Les suivantes sont refermees sans un mot :
/// il n'y a qu'un partage a la fois, et laisser plusieurs lecteurs se brancher
/// n'ouvrirait que des questions sans reponse — lequel recoit quoi.
#[cfg(windows)]
fn servir(ecouteur: TcpListener, receveur: Receiver<Vec<u8>>, generation: u64, jeton: String) {
    // Sans delai, `accept` bloque pour toujours et le fil survit au partage.
    let _ = ecouteur.set_nonblocking(true);

    let mut flux: Option<TcpStream> = None;

    while GENERATION.load(Ordering::SeqCst) == generation {
        if flux.is_none() {
            match ecouteur.accept() {
                Ok((mut candidat, _)) => {
                    /*
                     * La socket acceptee repasse en mode bloquant, explicitement.
                     *
                     * L'ecouteur est en mode non bloquant pour que `accept` rende
                     * la main ; ce que les sockets acceptees en heritent depend du
                     * systeme. Lire l'en-tete sur une socket non bloquante
                     * rendrait `WouldBlock` avant meme que la requete arrive, et
                     * l'on refuserait un client parfaitement valable — avec, pour
                     * seul symptome, un partage muet de plus.
                     */
                    let _ = candidat.set_nonblocking(false);

                    if entete_valide(&mut candidat, &jeton) {
                        let _ = candidat.set_nodelay(true);
                        flux = Some(candidat);
                    }
                }
                Err(ref erreur) if erreur.kind() == std::io::ErrorKind::WouldBlock => {
                    /*
                     * Personne n'ecoute encore : on vide ce qui s'accumule.
                     *
                     * Sans cela, la file se remplit pendant que l'interface
                     * ouvre sa connexion, et le premier son qu'elle recoit est
                     * une seconde de passe — jouee d'un coup, en decalage avec
                     * l'image, et jamais rattrapee.
                     */
                    while receveur.try_recv().is_ok() {}

                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                }
                Err(_) => break,
            }
        }

        let Ok(paquet) = receveur.recv_timeout(Duration::from_millis(200)) else {
            continue;
        };

        if let Some(sortie) = flux.as_mut() {
            if sortie.write_all(&paquet).is_err() {
                break;
            }
        }
    }
}

/// Lit la requete, verifie le jeton, et repond.
///
/// Le protocole est le minimum utile : une ligne de requete dont le chemin doit
/// contenir le jeton, et une reponse sans longueur annoncee — le son n'a pas de
/// fin connue d'avance. `fetch` cote web lit le corps a mesure qu'il arrive.
#[cfg(windows)]
fn entete_valide(flux: &mut TcpStream, jeton: &str) -> bool {
    use std::io::Read;

    let _ = flux.set_read_timeout(Some(Duration::from_millis(500)));

    let mut tampon = [0u8; 1024];
    let Ok(lus) = flux.read(&mut tampon) else {
        return false;
    };

    let requete = String::from_utf8_lossy(&tampon[..lus]);

    // Le jeton est cherche dans la requete entiere plutot que dans un chemin
    // decoupe : un jeton hexadecimal de trente-deux caracteres n'apparait pas
    // par hasard dans un en-tete HTTP.
    if jeton.is_empty() || !requete.contains(jeton) {
        let _ = flux.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        return false;
    }

    let entete = concat!(
        "HTTP/1.1 200 OK\r\n",
        "Content-Type: application/octet-stream\r\n",
        "Cache-Control: no-store\r\n",
        // La page vit sur un autre port : sans cet en-tete, le moteur refuse de
        // lui donner le corps de la reponse.
        "Access-Control-Allow-Origin: *\r\n",
        "Connection: close\r\n",
        "\r\n"
    );

    // Le delai de lecture ne vaut plus rien une fois l'en-tete passe : la suite
    // n'est qu'ecriture.
    let _ = flux.set_read_timeout(None);
    flux.write_all(entete.as_bytes()).is_ok()
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
            // Renseignes par l'appelant, qui seul connait la connexion ouverte.
            port: 0,
            jeton: String::new(),
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
    file: &SyncSender<Vec<u8>>,
    generation: u64,
    voulu: Option<&str>,
) -> Result<(), String> {
    let _com = GardeCom::prendre();

    capturer_interne(file, generation, voulu)
}

/// Attend que l'activation asynchrone ait repondu.
///
/// `ActivateAudioInterfaceAsync` ne rend pas le client : il rappelle plus tard,
/// sur un fil qu'il choisit. Ce petit objet est ce rappel — il ne fait que
/// lever un evenement, que le fil appelant attend.
#[cfg(windows)]
#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Acheve(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl IActivateAudioInterfaceCompletionHandler_Impl for Acheve_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Option<&IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        unsafe { SetEvent(self.0)? };
        Ok(())
    }
}

/// Un `PROPVARIANT` portant un bloc d'octets.
///
/// La bibliotheque ne sait pas en construire : sa representation interne n'est
/// pas publique, et aucun constructeur ne couvre `VT_BLOB`. On pose donc la
/// structure telle que Windows l'attend — c'est ce que fait n'importe quel
/// appelant en C — et l'on passe son adresse.
///
/// Vingt-quatre octets sur soixante-quatre bits : huit d'en-tete, seize pour
/// l'union dont le bloc occupe une taille et un pointeur.
#[cfg(windows)]
#[repr(C)]
struct VariantBloc {
    vt: u16,
    reserve1: u16,
    reserve2: u16,
    reserve3: u16,
    taille: u32,
    remplissage: u32,
    donnees: *mut u8,
}

/// `VT_BLOB`, tel que le declare `wtypes.h`.
#[cfg(windows)]
const VT_BLOB: u16 = 65;

/// Ouvre une capture de tout le son du systeme SAUF le notre.
///
/// Pourquoi cette capture-la
/// -------------------------
/// Le bouclage ordinaire porte tout ce que joue une sortie, y compris ce que
/// joue Echow. Celui qui partage renvoyait donc aux autres leurs propres voix,
/// avec le retard du reseau : l'echo classique, insupportable au bout de trois
/// phrases, et que personne ne peut corriger de son cote.
///
/// Windows sait capturer par PROCESSUS depuis la version 20348. En designant le
/// notre et en demandant l'exclusion de son arborescence, on obtient exactement
/// ce qu'il faut : le jeu, la musique, les videos — et rien de ce que nous
/// jouons nous-memes.
///
/// Cette capture n'est liee a aucune sortie, ce qui regle du meme coup le
/// probleme du peripherique : plus de bouclage ouvert sur une entree virtuelle
/// ou rien ne joue, plus de choix a faire.
///
/// Rend `None` sur les Windows plus anciens, ou l'appelant retombe sur le
/// bouclage par sortie.
#[cfg(windows)]
unsafe fn client_sans_nos_voix(format: *const WAVEFORMATEX) -> Option<IAudioClient> {
    let evenement = CreateEventW(None, true, false, None).ok()?;

    let mut parametres = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: GetCurrentProcessId(),
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };

    let variante = VariantBloc {
        vt: VT_BLOB,
        reserve1: 0,
        reserve2: 0,
        reserve3: 0,
        taille: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
        remplissage: 0,
        donnees: &mut parametres as *mut _ as *mut u8,
    };

    let acheve: IActivateAudioInterfaceCompletionHandler = Acheve(evenement).into();

    let operation = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        &IAudioClient::IID,
        Some(&variante as *const VariantBloc as *const _),
        &acheve,
    )
    .ok()?;

    // Trois secondes : l'activation est immediate en pratique, et attendre
    // indefiniment ferait tenir le partage entier sur un appel qui ne repond pas.
    WaitForSingleObject(evenement, 3000);

    let mut resultat = HRESULT(0);
    let mut inconnu: Option<IUnknown> = None;
    operation
        .GetActivateResult(&mut resultat, &mut inconnu as *mut _ as *mut _)
        .ok()?;

    if resultat.is_err() {
        return None;
    }

    let client: IAudioClient = inconnu?.cast().ok()?;

    /*
     * Le format est impose, pas negocie.
     *
     * Une capture par processus n'a pas de peripherique, donc pas de format de
     * melange a lire : c'est a nous de dire dans quoi nous voulons les
     * echantillons. On reprend celui de la sortie par defaut pour que le reste
     * du chemin — le fil audio, le nombre de canaux — ne change pas selon la
     * route empruntee.
     */
    client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            TAMPON_100NS,
            0,
            format,
            None,
        )
        .ok()?;

    Some(client)
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
    file: &SyncSender<Vec<u8>>,
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

    /*
     * D'abord la capture qui nous exclut, ensuite celle qui prend tout.
     *
     * La premiere ecoute les processus et laisse le notre de cote : le
     * partage emporte alors le jeu et la musique, mais pas les voix d'Echow.
     * Sans elle, celui qui partage renvoie aux autres leurs propres voix avec
     * le retard du reseau — l'echo, que personne ne peut corriger de son cote.
     *
     * Elle demande Windows 10 version 20348 ou plus recent. En dessous, on
     * retombe sur le bouclage par sortie : le son passe, avec l'echo. Un echo
     * vaut mieux qu'un silence, et le journal dit laquelle des deux a servi.
     */
    let (client, exclusion) = match client_sans_nos_voix(format) {
        Some(sans_nous) => (sans_nous, true),
        None => {
            let ouverture = client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                // Le bouclage, c'est ce seul drapeau : sans lui on capturerait
                // un micro, avec lui on capture ce qui sort.
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                TAMPON_100NS,
                0,
                format,
                None,
            );

            ouverture.map_err(|_| {
                CoTaskMemFree(Some(format as *const _));
                echec("Le bouclage audio a ete refuse par Windows.")
            })?;

            (client, false)
        }
    };

    EXCLUSION.store(exclusion, Ordering::Relaxed);

    // Le format est rendu des qu'il a servi : les chemins qui suivent n'ont
    // plus a y penser.
    CoTaskMemFree(Some(format as *const _));

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
                let _ = file.try_send(std::mem::take(&mut groupe));
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

            PAQUETS.fetch_add(1, Ordering::Relaxed);
            TRAMES.fetch_add(trames as u64, Ordering::Relaxed);

            /*
             * Le silence est ajoute comme du silence, pas comme le tampon.
             *
             * Quand rien ne joue, Windows leve `SILENT` et laisse le tampon
             * dans l'etat ou il se trouvait — souvent la derniere seconde de
             * son. Le prendre tel quel ferait boucler un fragment a l'infini
             * des qu'on met en pause.
             */
            if drapeaux & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                SILENCIEUX.fetch_add(1, Ordering::Relaxed);
                groupe.resize(groupe.len() + octets, 0);
            } else {
                let tranche = std::slice::from_raw_parts(donnees, octets);

                /*
                 * Le sommet est releve ici, sur les octets bruts.
                 *
                 * Un echantillon sur seize suffit : on cherche a savoir s'il y
                 * a du son, pas a mesurer un niveau au decibel pres, et lire
                 * quarante-quatre mille flottants par seconde pour cela serait
                 * payer cher une reponse binaire.
                 */
                let flottants = std::slice::from_raw_parts(
                    donnees as *const f32,
                    octets / std::mem::size_of::<f32>(),
                );

                let mut sommet = 0.0f32;
                for valeur in flottants.iter().step_by(16) {
                    let amplitude = valeur.abs();
                    if amplitude > sommet && amplitude.is_finite() {
                        sommet = amplitude;
                    }
                }

                let millieme = (sommet * 1000.0) as u64;
                SOMMET_MILLIEME.fetch_max(millieme, Ordering::Relaxed);

                groupe.extend_from_slice(tranche);
            }
        }

        let _ = capture.ReleaseBuffer(trames);

        /*
         * `try_send` et non `send` : on n'attend jamais le lecteur.
         *
         * WASAPI n'attend pas non plus. Rester bloque sur une file pleine ferait
         * perdre des echantillons a la source pour livrer plus tard ceux qu'on
         * tient deja — c'est-a-dire troquer un trou contre un retard, puis
         * garder les deux. Un paquet abandonne se traduit par quelques
         * millisecondes de silence chez celui qui ecoute, et rien de plus.
         */
        if groupe.len() >= seuil_envoi {
            let _ = file.try_send(std::mem::take(&mut groupe));
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
pub fn demarrer_son_systeme(_peripherique: Option<String>) -> Result<FormatSon, String> {
    Err("La capture du son du systeme n'existe que sous Windows.".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn lister_sorties_audio() -> Result<Vec<SortieAudio>, String> {
    Ok(Vec::new())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn diagnostic_son() -> DiagnosticSon {
    DiagnosticSon {
        paquets: 0,
        trames: 0,
        sommet: 0,
        silencieux: 0,
        exclusion: false,
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub fn arreter_son_systeme() {}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpStream;

    /// Ouvre un ecouteur local et joue le role du serveur pour une requete.
    fn repondre_a(requete: &str, jeton: &str) -> (bool, String) {
        let ecouteur = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = ecouteur.local_addr().unwrap().port();

        let a_ecrire = requete.to_string();
        let client = std::thread::spawn(move || {
            let mut flux = TcpStream::connect(("127.0.0.1", port)).unwrap();
            flux.write_all(a_ecrire.as_bytes()).unwrap();

            let mut reponse = String::new();
            let _ = flux.set_read_timeout(Some(Duration::from_millis(500)));
            let _ = flux.read_to_string(&mut reponse);
            reponse
        });

        let (mut candidat, _) = ecouteur.accept().unwrap();
        let accepte = entete_valide(&mut candidat, jeton);

        // La connexion se ferme ici : le client peut finir sa lecture.
        drop(candidat);

        (accepte, client.join().unwrap())
    }

    #[test]
    fn le_bon_jeton_est_accepte() {
        let (accepte, reponse) = repondre_a(
            "GET /abcdef0123456789abcdef0123456789 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
            "abcdef0123456789abcdef0123456789",
        );

        assert!(accepte, "un jeton correct doit ouvrir le flux");
        assert!(reponse.starts_with("HTTP/1.1 200 OK"), "reponse : {reponse}");
        assert!(
            reponse.contains("application/octet-stream"),
            "le corps doit etre annonce binaire : {reponse}"
        );
    }

    #[test]
    fn un_mauvais_jeton_est_refuse() {
        let (accepte, reponse) = repondre_a(
            "GET /00000000000000000000000000000000 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
            "abcdef0123456789abcdef0123456789",
        );

        assert!(!accepte, "un jeton faux ne doit rien ouvrir");
        assert!(reponse.starts_with("HTTP/1.1 403"), "reponse : {reponse}");
    }

    /// Le cas qui compte le plus : un jeton vide ne doit ouvrir a personne.
    ///
    /// Sans ce test, une regression qui laisserait le jeton vide passerait
    /// inapercue — et ouvrirait le son du bureau a tout ce qui tourne sur la
    /// machine, puisque la requete « contient » alors toujours le jeton.
    #[test]
    fn un_jeton_vide_refuse_tout() {
        let (accepte, _) = repondre_a("GET / HTTP/1.1\r\n\r\n", "");
        assert!(!accepte, "un jeton vide ne doit jamais ouvrir le flux");
    }

    #[test]
    fn le_jeton_est_imprevisible() {
        let premier = jeton_aleatoire();
        let second = jeton_aleatoire();

        assert_eq!(premier.len(), 32);
        assert_ne!(premier, second, "deux partages ne partagent pas leur jeton");
    }
}
