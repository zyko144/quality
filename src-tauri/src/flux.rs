//! Un flux d'octets vers l'interface, par la boucle locale.
//!
//! Pourquoi pas le canal de Tauri
//! ------------------------------
//! Il a ete essaye, et mesure : sur quatre cents paquets audio produits par
//! Windows, **un seul** atteignait l'interface. Au-dela d'un kilo-octet, ce
//! canal ne transmet pas la donnee directement — il fait executer a la page un
//! script qui va la rechercher par une commande interne — et cinquante
//! allers-retours par seconde de ce genre ne passent pas. Rien n'echouait pour
//! autant : le silence arrivait au bout, sans une erreur nulle part.
//!
//! Ici, une connexion unique est ouverte pour toute la duree, et les octets y
//! coulent sans etre annonces, decoupes ni reassembles.
//!
//! Ce que ce passage n'est pas
//! ---------------------------
//! Il n'ecoute que 127.0.0.1, n'accepte qu'une connexion, et exige un jeton
//! tire au hasard a chaque ouverture. Aucun autre programme de la machine ne
//! s'y branche sans l'avoir devine, et il se ferme avec ce qu'il sert.
//!
//! Ce fichier existe parce que deux flux l'empruntent — le son et l'image. En
//! garder deux copies aurait fait deriver l'une des deux, et c'est la poignee
//! de main qui garde la porte.

#![cfg(windows)]

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::sync::mpsc::Receiver;
use std::time::Duration;

/// De quoi joindre un flux : un port et le jeton qui l'ouvre.
pub struct Passage {
    pub ecouteur: TcpListener,
    pub port: u16,
    pub jeton: String,
}

/// Ouvre un passage sur un port que le systeme choisit.
///
/// Un port fixe se heurterait a ce qui l'occupe deja, et deux flux simultanes —
/// le son et l'image d'un meme partage — ne pourraient pas coexister.
pub fn ouvrir() -> std::io::Result<Passage> {
    let ecouteur = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?;
    let port = ecouteur.local_addr()?.port();

    Ok(Passage {
        ecouteur,
        port,
        jeton: jeton_aleatoire(),
    })
}

/// Un jeton imprevisible, tire a chaque ouverture.
///
/// `RandomState` est ensemence par le systeme a chaque construction : c'est ce
/// qui protege les tables de hachage de Rust contre les collisions provoquees.
/// Deux ensemencements independants donnent trente-deux caracteres, largement
/// assez pour un jeton qui ne vit que le temps d'un partage, sur une connexion
/// qui n'ecoute que la boucle locale.
pub fn jeton_aleatoire() -> String {
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

/// Sert un flux d'octets tant que `continuer` le dit.
///
/// Une seule connexion est acceptee. Les suivantes sont refermees sans un mot :
/// il n'y a qu'un partage a la fois, et laisser plusieurs lecteurs se brancher
/// n'ouvrirait que des questions sans reponse — lequel recoit quoi.
pub fn servir<F>(passage: Passage, receveur: Receiver<Vec<u8>>, continuer: F)
where
    F: Fn() -> bool,
{
    // Sans delai, `accept` bloque pour toujours et le fil survit au partage.
    let _ = passage.ecouteur.set_nonblocking(true);

    let mut flux: Option<TcpStream> = None;

    while continuer() {
        if flux.is_none() {
            match passage.ecouteur.accept() {
                Ok((mut candidat, _)) => {
                    /*
                     * La socket acceptee repasse en mode bloquant, explicitement.
                     *
                     * L'ecouteur est non bloquant pour que `accept` rende la
                     * main ; ce que les sockets acceptees en heritent depend du
                     * systeme. Lire l'en-tete sur une socket non bloquante
                     * rendrait `WouldBlock` avant que la requete arrive, et l'on
                     * refuserait un client parfaitement valable — avec, pour
                     * seul symptome, un partage muet ou noir de plus.
                     */
                    let _ = candidat.set_nonblocking(false);

                    if entete_valide(&mut candidat, &passage.jeton) {
                        let _ = candidat.set_nodelay(true);
                        flux = Some(candidat);
                    }
                }
                Err(ref erreur) if erreur.kind() == std::io::ErrorKind::WouldBlock => {
                    /*
                     * Personne n'ecoute encore : on vide ce qui s'accumule.
                     *
                     * Sans cela, la file se remplit pendant que l'interface
                     * ouvre sa connexion, et la premiere chose qu'elle recoit
                     * est une seconde de passe — jouee d'un coup, en decalage
                     * avec le reste, et jamais rattrapee.
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
/// contenir le jeton, et une reponse sans longueur annoncee — un flux n'a pas de
/// fin connue d'avance. `fetch` cote web lit le corps a mesure qu'il arrive.
pub fn entete_valide(flux: &mut TcpStream, jeton: &str) -> bool {
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
        // La page vit sur une autre origine : sans cet en-tete, le moteur
        // refuse de lui donner le corps de la reponse.
        "Access-Control-Allow-Origin: *\r\n",
        "Connection: close\r\n",
        "\r\n"
    );

    // Le delai de lecture ne vaut plus rien une fois l'en-tete passe : la suite
    // n'est qu'ecriture.
    let _ = flux.set_read_timeout(None);
    flux.write_all(entete.as_bytes()).is_ok()
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

#[cfg(test)]
mod tests {
    use super::*;

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
    /// inapercue — et ouvrirait le son et l'image du bureau a tout ce qui
    /// tourne sur la machine, puisque la requete « contient » alors toujours
    /// le jeton.
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
        assert_ne!(premier, second, "deux ouvertures ne partagent pas leur jeton");
    }

    /// Deux passages ouverts en meme temps ne se marchent pas dessus.
    ///
    /// C'est exactement ce que fait un partage : un flux pour le son, un pour
    /// l'image. Un port fixe les aurait fait se disputer la place.
    #[test]
    fn deux_passages_coexistent() {
        let premier = ouvrir().unwrap();
        let second = ouvrir().unwrap();

        assert_ne!(premier.port, second.port);
        assert_ne!(premier.jeton, second.jeton);
    }
}
