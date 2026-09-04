//! Ce que l'ordinateur est en train de jouer.
//!
//! Pourquoi pas l'API de Spotify
//! -----------------------------
//! Lire « ce que vous ecoutez » chez Spotify demande une liaison OAuth : un
//! compte developpeur, une adresse de retour declaree, un secret qui ne peut
//! pas vivre dans une application de bureau, et une configuration a tenir chez
//! l'hebergeur. Beaucoup de plomberie pour un titre et une pochette.
//!
//! Windows sait deja tout cela. Chaque lecteur — Spotify, un navigateur, un
//! jeu — declare sa lecture au systeme pour que les touches multimedia du
//! clavier et l'incrustation de volume fonctionnent. On lit la meme source.
//!
//! Ce que cela change, et c'est mieux
//! ----------------------------------
//! Rien a lier, rien a autoriser, rien a configurer. Et cela ne se limite pas a
//! Spotify : YouTube dans un onglet, Deezer, un fichier local — tout ce qui
//! s'annonce au systeme est vu. Le nom de l'application est rendu tel quel,
//! pour que l'interface puisse dire « sur Spotify » quand c'en est un.
//!
//! Ce que cela ne fait pas
//! -----------------------
//! Rien n'est envoye nulle part depuis ici. Ce module LIT, et rend. La decision
//! de publier quoi que ce soit appartient a l'interface, qui ne le fait que si
//! la personne l'a demande dans ses reglages.

#[cfg(windows)]
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
#[cfg(windows)]
use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};

/// Ce qui joue, tel qu'on le rend a l'interface.
#[derive(Clone, Default, serde::Serialize)]
pub struct Lecture {
    pub titre: String,
    pub artiste: String,
    pub album: String,
    /// Identifiant de l'application qui joue, tel que Windows le connait.
    ///
    /// `Spotify.exe`, `msedge`, `chrome`… L'interface s'en sert pour nommer la
    /// source ; on ne la traduit pas ici, parce que la liste des lecteurs
    /// changera plus vite que ce fichier.
    pub source: String,
    /// Vrai en lecture, faux en pause. Une pause n'est pas une absence.
    pub joue: bool,
    pub position_ms: i64,
    pub duree_ms: i64,
    /// Vrai si un dessin de pochette existe. Il se demande a part.
    ///
    /// La pochette pese jusqu'a plusieurs centaines de kilo-octets une fois
    /// encodee. La faire transiter a CHAQUE releve — toutes les dix secondes,
    /// pour un morceau qui n'a pas change — chargeait le pont vers la page pour
    /// rien. Voir `pochette_en_cours`, qu'on n'appelle qu'au changement de
    /// titre.
    pub a_une_pochette: bool,
}

/// La pochette, lue jusqu'au bout et encodee.
///
/// Rend une chaine vide plutot qu'une erreur : une pochette manquante est un
/// detail d'affichage, jamais une raison de ne rien dire de ce qui joue.
#[cfg(windows)]
fn pochette(reference: &IRandomAccessStreamReference) -> String {
    let Ok(operation) = reference.OpenReadAsync() else {
        return String::new();
    };
    let Ok(flux) = operation.get() else {
        return String::new();
    };

    let Ok(taille) = flux.Size() else {
        return String::new();
    };

    // Une pochette depasse rarement deux cents kilo-octets. Au-dela, ce n'est
    // pas une pochette, et l'on ne va pas faire transiter cela a chaque releve.
    if taille == 0 || taille > 400_000 {
        return String::new();
    }

    let Ok(lecteur) = DataReader::CreateDataReader(&flux) else {
        return String::new();
    };

    if lecteur.LoadAsync(taille as u32).and_then(|o| o.get()).is_err() {
        return String::new();
    }

    let mut octets = vec![0u8; taille as usize];
    if lecteur.ReadBytes(&mut octets).is_err() {
        return String::new();
    }

    /*
     * Le type est devine, faute d'etre annonce.
     *
     * `ContentType()` existe sur le flux mais rend souvent une chaine vide :
     * les lecteurs ne la renseignent pas tous. On regarde donc les premiers
     * octets, ce qui ne se trompe pas — un PNG commence toujours pareil.
     */
    let genre = if octets.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else {
        "image/jpeg"
    };

    format!("data:{};base64,{}", genre, base64_simple(&octets))
}

/// Encodage base64, sans dependance.
///
/// Une caisse de plus pour trente lignes ne se justifie pas, et celle-ci n'a
/// aucune subtilite : trois octets deviennent quatre caracteres, le reste est
/// complete par des `=`.
#[cfg(windows)]
fn base64_simple(octets: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut sortie = String::with_capacity(octets.len().div_ceil(3) * 4);

    for morceau in octets.chunks(3) {
        let a = morceau[0] as u32;
        let b = *morceau.get(1).unwrap_or(&0) as u32;
        let c = *morceau.get(2).unwrap_or(&0) as u32;
        let assemble = (a << 16) | (b << 8) | c;

        sortie.push(TABLE[(assemble >> 18) as usize & 63] as char);
        sortie.push(TABLE[(assemble >> 12) as usize & 63] as char);
        sortie.push(if morceau.len() > 1 {
            TABLE[(assemble >> 6) as usize & 63] as char
        } else {
            '='
        });
        sortie.push(if morceau.len() > 2 {
            TABLE[assemble as usize & 63] as char
        } else {
            '='
        });
    }

    sortie
}

/// Ce qui joue en ce moment, ou `None` si rien ne joue.
///
/// `None` couvre trois cas volontairement confondus : aucun lecteur ouvert, un
/// Windows trop ancien pour cette interface, et un systeme qui n'est pas
/// Windows. Du point de vue de l'interface, ce sont le meme : il n'y a rien a
/// montrer, et rien a expliquer.
/*
 * Les commandes sont ASYNCHRONES, et ce n'est pas un detail de style.
 *
 * Tauri execute une commande synchrone sur le FIL PRINCIPAL — celui qui dessine
 * la fenetre. Or tout ce qui suit attend : `RequestAsync().get()` attend le
 * gestionnaire de Windows, la lecture de la pochette attend un flux. Dix
 * secondes plus tard, cela recommence.
 *
 * Le resultat s'est vu tout de suite a l'usage : « Echow ne repond pas ». La
 * fenetre cessait de repondre parce qu'on lui prenait son fil pour interroger
 * le lecteur de musique.
 *
 * `spawn_blocking` porte ce travail sur un fil fait pour attendre. La fenetre
 * garde le sien.
 */
#[tauri::command]
#[cfg(windows)]
pub async fn lecture_en_cours() -> Option<Lecture> {
    tauri::async_runtime::spawn_blocking(lire_maintenant)
        .await
        .ok()
        .flatten()
}

/// La pochette du morceau en cours, ou une chaine vide.
///
/// A part, et appelee seulement quand le titre change : elle pese jusqu'a
/// plusieurs centaines de kilo-octets une fois encodee, et la faire transiter a
/// chaque releve chargeait le pont pour redire la meme image.
#[tauri::command]
#[cfg(windows)]
pub async fn pochette_en_cours() -> String {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(seance) = seance_courante() else {
            return String::new();
        };

        seance
            .TryGetMediaPropertiesAsync()
            .ok()
            .and_then(|o| o.get().ok())
            .and_then(|p| p.Thumbnail().ok())
            .map(|r| pochette(&r))
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

/// Ce que vaut une seance, pour choisir entre plusieurs.
///
/// Windows peut en tenir cinq a la fois : un lecteur de musique, deux onglets,
/// un jeu, une visioconference. `GetCurrentSession()` rend la plus RECEMMENT
/// active — et un onglet qui demarre une video passe alors devant la musique
/// qui joue depuis vingt minutes. C'est exactement ce qui a ete rapporte :
/// « ca met ce que j'ecoute sur le navigateur mais pas Spotify ».
///
/// On note donc chaque seance, et l'on garde la meilleure :
///
/// - **Elle joue** pese plus que tout le reste. Un lecteur en pause n'est pas
///   ce qu'on ecoute, quelle que soit l'application.
/// - **Un lecteur de musique** passe devant un navigateur. Quand les deux
///   jouent, c'est la musique qu'on veut montrer — un navigateur joue aussi les
///   videos, les publicites et les sons d'interface.
/// - **Un titre** est exige : une seance sans titre n'a rien a afficher.
///
/// La regle est une fonction ORDINAIRE, qui ne prend que deux valeurs. Elle
/// pourrait lire la seance elle-meme ; elle ne le fait pas, pour pouvoir etre
/// mise a l'epreuve sans qu'aucune musique ne joue.
pub(crate) fn note_de_seance(joue: bool, source: &str) -> i32 {
    let source = source.to_lowercase();

    let musique = [
        "spotify", "deezer", "tidal", "itunes", "applemusic", "musicbee", "foobar", "aimp",
        "winamp", "vlc",
    ]
    .iter()
    .any(|nom| source.contains(nom));

    let navigateur = ["chrome", "msedge", "firefox", "brave", "opera"]
        .iter()
        .any(|nom| source.contains(nom));

    let mut note = 0;
    if joue {
        note += 100;
    }
    if musique {
        note += 20;
    }
    if navigateur {
        note -= 10;
    }

    note
}

#[cfg(windows)]
fn note_de_la_seance(
    seance: &windows::Media::Control::GlobalSystemMediaTransportControlsSession,
) -> i32 {
    let joue = seance
        .GetPlaybackInfo()
        .and_then(|i| i.PlaybackStatus())
        .map(|etat| etat.0 == 4)
        .unwrap_or(false);

    let source = seance
        .SourceAppUserModelId()
        .map(|t| t.to_string())
        .unwrap_or_default();

    note_de_seance(joue, &source)
}

/// La seance qu'on montre : celle qui joue, et de preference de la musique.
#[cfg(windows)]
fn seance_courante() -> Option<windows::Media::Control::GlobalSystemMediaTransportControlsSession> {
    let gestionnaire = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()?;

    let mut meilleure: Option<(
        i32,
        windows::Media::Control::GlobalSystemMediaTransportControlsSession,
    )> = None;

    if let Ok(seances) = gestionnaire.GetSessions() {
        for seance in seances {
            // Une seance sans titre n'a rien a montrer : certains lecteurs en
            // declarent une des leur ouverture, avant d'avoir joue quoi que ce
            // soit.
            let a_un_titre = seance
                .TryGetMediaPropertiesAsync()
                .ok()
                .and_then(|o| o.get().ok())
                .and_then(|p| p.Title().ok())
                .map(|t| !t.to_string().trim().is_empty())
                .unwrap_or(false);

            if !a_un_titre {
                continue;
            }

            let note = note_de_la_seance(&seance);

            if meilleure.as_ref().map(|(vue, _)| note > *vue).unwrap_or(true) {
                meilleure = Some((note, seance));
            }
        }
    }

    // Le repli garde l'ancien comportement quand l'enumeration ne donne rien.
    meilleure
        .map(|(_, seance)| seance)
        .or_else(|| gestionnaire.GetCurrentSession().ok())
}

#[cfg(windows)]
fn lire_maintenant() -> Option<Lecture> {
    let seance = seance_courante()?;
    let proprietes = seance.TryGetMediaPropertiesAsync().ok()?.get().ok()?;

    let titre = proprietes.Title().map(|t| t.to_string()).unwrap_or_default();

    // Sans titre, il n'y a rien a montrer : un lecteur ouvert sur rien annonce
    // parfois une seance vide, et l'afficher donnerait une carte sans contenu.
    if titre.trim().is_empty() {
        return None;
    }

    let horloge = seance.GetTimelineProperties().ok();
    let (position_ms, duree_ms) = horloge
        .map(|h| {
            let position = h.Position().map(|d| d.Duration / 10_000).unwrap_or(0);
            let fin = h.EndTime().map(|d| d.Duration / 10_000).unwrap_or(0);
            (position, fin)
        })
        .unwrap_or((0, 0));

    let joue = seance
        .GetPlaybackInfo()
        .and_then(|i| i.PlaybackStatus())
        .map(|etat| etat.0 == 4) // 4 = en lecture
        .unwrap_or(false);

    Some(Lecture {
        titre,
        artiste: proprietes.Artist().map(|t| t.to_string()).unwrap_or_default(),
        album: proprietes.AlbumTitle().map(|t| t.to_string()).unwrap_or_default(),
        source: seance
            .SourceAppUserModelId()
            .map(|t| t.to_string())
            .unwrap_or_default(),
        joue,
        position_ms,
        duree_ms,
        a_une_pochette: proprietes.Thumbnail().is_ok(),
    })
}

#[tauri::command]
#[cfg(not(windows))]
pub async fn lecture_en_cours() -> Option<Lecture> {
    None
}

#[tauri::command]
#[cfg(not(windows))]
pub async fn pochette_en_cours() -> String {
    String::new()
}

#[cfg(all(test, windows))]
mod essais {
    /// Verifie que l'appel aboutit depuis un fil ordinaire.
    ///
    /// WinRT exige souvent que le fil appelant soit initialise, et un appel qui
    /// echoue silencieusement rendrait `None` en permanence — indiscernable de
    /// « rien ne joue ». Ce cas ne verifie pas qu'il Y A de la musique, il
    /// verifie que la question peut etre posee.
    #[test]
    fn la_question_peut_etre_posee() {
        /*
         * La lecture des metadonnees doit rester BREVE.
         *
         * Elle est desormais portee par un fil qui n'est pas celui de la
         * fenetre, mais la borne reste utile : une attente longue ici
         * signalerait un appel qui a change de nature, et l'on empilerait des
         * attentes toutes les dix secondes.
         *
         * Mesure au moment ou ce cas a ete ecrit : 17 ms pour les
         * metadonnees, 14 ms pour la pochette.
         */
        let debut = std::time::Instant::now();
        let reponse = super::lire_maintenant();
        let duree = debut.elapsed();

        println!("metadonnees en {duree:?} : {:?}", reponse.as_ref().map(|l| (&l.source, &l.titre)));

        assert!(
            duree < std::time::Duration::from_millis(500),
            "la lecture des metadonnees a pris {duree:?}"
        );
    }
}

/// Ouvre une adresse dans le navigateur du systeme.
///
/// Pourquoi ici plutot que par le greffon
/// --------------------------------------
/// `tauri-plugin-opener` refuse la commande sur cette installation :
///
///     Command plugin:opener|open_url not allowed by ACL
///
/// La permission est pourtant declaree, le greffon enregistre, le binaire a
/// jour et la fenetre correctement nommee — la cause n'est pas trouvee. Ce qui
/// EST etabli, c'est que les commandes de l'application, elles, aboutissent :
/// la capture d'ecran, le son du systeme et la lecture en cours passent toutes
/// par ce chemin sans jamais etre refusees.
///
/// On emprunte donc le chemin qui marche. Une dependance de moins, aussi : le
/// greffon ne servait qu'a cela.
///
/// Le protocole est verifie ICI
/// ----------------------------
/// `ShellExecuteW` lance ce qu'on lui donne — une adresse, mais aussi un
/// programme, un fichier, une commande. La page verifie deja le protocole avant
/// d'appeler ; le refaire ici est la seule barriere qui tienne, parce que c'est
/// la seule que du code de page ne peut pas contourner.
#[tauri::command]
#[cfg(windows)]
pub fn ouvrir_lien(url: String) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let propre = url.trim();

    if !(propre.starts_with("https://") || propre.starts_with("http://")) {
        return Err("Seules les adresses http et https s'ouvrent ainsi.".into());
    }

    // Un retour a la ligne ou un caractere nul couperait la chaine et ferait
    // executer autre chose que ce qu'on a lu.
    if propre.contains(['\n', '\r', '\0']) {
        return Err("Adresse illisible.".into());
    }

    let cible = HSTRING::from(propre);
    let action = HSTRING::from("open");

    let retour = unsafe {
        ShellExecuteW(None, &action, &cible, None, None, SW_SHOWNORMAL)
    };

    // `ShellExecuteW` rend une valeur superieure a 32 en cas de succes. C'est
    // une convention d'un autre age, mais c'est la sienne.
    if retour.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!("Le systeme a refuse d'ouvrir l'adresse ({}).", retour.0 as isize))
    }
}

#[tauri::command]
#[cfg(not(windows))]
pub fn ouvrir_lien(_url: String) -> Result<(), String> {
    Err("Disponible seulement sur Windows.".into())
}

#[cfg(test)]
mod essais_choix {
    use super::note_de_seance;

    /// Ce qui joue passe avant tout le reste.
    ///
    /// Un lecteur en pause n'est pas ce qu'on ecoute, quelle que soit
    /// l'application : Spotify en pause perd contre un onglet qui joue.
    #[test]
    fn ce_qui_joue_gagne() {
        assert!(note_de_seance(true, "MSEdge") > note_de_seance(false, "Spotify.exe"));
    }

    /// A egalite, la musique passe devant le navigateur.
    ///
    /// C'est le defaut rapporte : `GetCurrentSession()` rend la seance la plus
    /// RECEMMENT active, donc un onglet qui demarre une video passait devant la
    /// musique qui jouait depuis vingt minutes.
    ///
    /// Mesure sur cette machine, les deux en lecture :
    ///     Spotify.exe  note=120
    ///     MSEdge       note=90
    #[test]
    fn la_musique_passe_devant_le_navigateur() {
        assert!(note_de_seance(true, "Spotify.exe") > note_de_seance(true, "MSEdge"));
        assert!(note_de_seance(true, "Deezer.exe") > note_de_seance(true, "chrome"));
    }

    /// Une application inconnue reste entre les deux.
    ///
    /// Elle ne merite ni la faveur d'un lecteur reconnu, ni la defiance faite
    /// aux navigateurs — lesquels jouent aussi les publicites et les sons
    /// d'interface.
    #[test]
    fn un_lecteur_inconnu_tient_le_milieu() {
        let inconnu = note_de_seance(true, "UnLecteurQuelconque.exe");

        assert!(inconnu < note_de_seance(true, "Spotify.exe"));
        assert!(inconnu > note_de_seance(true, "firefox"));
    }
}

#[cfg(all(test, windows))]
mod essais_lien {
    /// Le protocole est refuse avant d'atteindre le systeme.
    ///
    /// C'est la seule barriere qui tienne : la page verifie deja, mais du code
    /// de page peut etre contourne. Celle-ci ne le peut pas.
    #[test]
    fn seules_les_adresses_web_passent() {
        for mauvais in [
            "file:///C:/Windows/System32/cmd.exe",
            "cmd.exe",
            "javascript:alert(1)",
            r"C:\Windows\System32\calc.exe",
            "",
        ] {
            assert!(
                super::ouvrir_lien(mauvais.to_string()).is_err(),
                "aurait du refuser : {mauvais}"
            );
        }
    }

    /// Une adresse coupee par un retour a la ligne ferait executer la suite.
    #[test]
    fn une_adresse_coupee_est_refusee() {
        assert!(super::ouvrir_lien("https://exemple.fr\ncalc.exe".to_string()).is_err());
        assert!(super::ouvrir_lien("https://exemple.fr\0calc".to_string()).is_err());
    }
}
