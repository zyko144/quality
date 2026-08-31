import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import type { SettingsSection } from '@/store/ui';

/**
 * Chercher un reglage sans savoir ou il se trouve.
 *
 * Onze sections, une centaine de reglages. Le classement est defendable —
 * « Voix et video » regroupe bien ce qui concerne le micro — mais il suppose de
 * partager le raisonnement de qui l'a range. Personne ne cherche « Voix et
 * video » : on cherche « le truc qui enleve le bruit du clavier ».
 *
 * D'ou cette liste. Elle ne remplace pas la navigation, elle repond a une autre
 * question : non pas « ou vais-je ? » mais « ou est ce que je cherche ? ».
 *
 * L'index est ecrit a la main. Le deduire du rendu supposerait de monter toutes
 * les sections en meme temps pour lire leur contenu, ce qui couterait a chaque
 * ouverture pour un service qu'on rend en une trentaine de lignes.
 */

interface Entree {
  libelle: string;
  section: SettingsSection;
  /** Ce qu'on tape en cherchant, quand ce n'est pas le libelle. */
  mots?: string;
}

const INDEX: Entree[] = [
  // Compte et confidentialite
  { libelle: 'Changer mon mot de passe', section: 'compte', mots: 'securite identifiants' },
  { libelle: 'Supprimer mon compte', section: 'compte', mots: 'effacer partir quitter' },
  { libelle: 'Qui peut m’ecrire', section: 'confidentialite', mots: 'messages prives inconnus' },
  { libelle: 'Personnes bloquees', section: 'confidentialite', mots: 'blocage ignorer' },
  { libelle: 'Mes donnees', section: 'confidentialite', mots: 'export rgpd telecharger' },

  // Profil
  { libelle: 'Photo de profil', section: 'profil', mots: 'avatar image pdp' },
  { libelle: 'Banniere', section: 'profil', mots: 'fond image entete' },
  { libelle: 'Pseudo et nom affiche', section: 'profil', mots: 'nom arobase identite' },
  { libelle: 'Biographie', section: 'profil', mots: 'bio a propos description' },

  // Voix et video
  { libelle: 'Choisir mon micro', section: 'voix', mots: 'peripherique entree casque' },
  { libelle: 'Choisir mes haut-parleurs', section: 'voix', mots: 'sortie casque ecouteurs' },
  { libelle: 'Choisir ma camera', section: 'voix', mots: 'webcam video peripherique' },
  { libelle: 'Tester mon micro', section: 'voix', mots: 'essai niveau verification' },
  {
    libelle: 'Suppression du bruit',
    section: 'voix',
    mots: 'clavier ventilateur chien rue fond porte rnnoise souffle',
  },
  { libelle: 'Annulation de l’echo', section: 'voix', mots: 'larsen retour haut-parleurs' },
  { libelle: 'Gain automatique', section: 'voix', mots: 'niveau volume micro egaliser' },
  { libelle: 'Qualite du son', section: 'voix', mots: 'debit musique stereo kbps opus' },
  { libelle: 'Masquer mon adresse IP', section: 'voix', mots: 'confidentialite relais turn reseau' },
  { libelle: 'Volume general des voix', section: 'voix', mots: 'son sortie fort faible' },
  { libelle: 'Sensibilite du micro', section: 'voix', mots: 'seuil detection parole' },
  { libelle: 'Volume des signaux sonores', section: 'voix', mots: 'bips arrivee depart micro coupe' },
  { libelle: 'Definition du partage d’ecran', section: 'voix', mots: 'stream 1080p 720p qualite' },
  { libelle: 'Images par seconde du partage', section: 'voix', mots: 'fps 60 fluidite stream' },
  { libelle: 'Fluidite ou nettete du partage', section: 'voix', mots: 'jeu texte priorite stream' },
  { libelle: 'Envoyer le son de mon partage', section: 'voix', mots: 'audio systeme jeu stream' },
  { libelle: 'Qualite de ma camera', section: 'voix', mots: 'webcam definition 720p' },

  // Apparence et accessibilite
  { libelle: 'Theme clair ou sombre', section: 'apparence', mots: 'noir nuit jour couleur' },
  { libelle: 'Couleur de l’interface', section: 'apparence', mots: 'accent teinte indigo rose' },
  { libelle: 'Densite d’affichage', section: 'apparence', mots: 'compact aere espacement' },
  { libelle: 'Transparence', section: 'apparence', mots: 'flou verre glass' },
  { libelle: 'Images animees', section: 'apparence', mots: 'gif animation bouger' },
  { libelle: 'Taille du texte', section: 'accessibilite', mots: 'police grand petit lisible' },
  { libelle: 'Saturation des couleurs', section: 'accessibilite', mots: 'contraste daltonisme' },
  { libelle: 'Reduire les animations', section: 'accessibilite', mots: 'mouvement vertige' },
  { libelle: 'Souligner les liens', section: 'accessibilite', mots: 'lisibilite liens' },

  // Discussion
  { libelle: 'Affichage des messages', section: 'discussion', mots: 'compact groupe avatar' },
  { libelle: 'Entree pour envoyer', section: 'discussion', mots: 'clavier envoyer touche' },
  { libelle: 'Apercu des liens', section: 'discussion', mots: 'embed vignette prevu' },

  // Notifications
  { libelle: 'Son de mention', section: 'notifications', mots: 'alerte bip arobase' },
  { libelle: 'Me prevenir a chaque message', section: 'notifications', mots: 'alerte tout bruit' },
  { libelle: 'Notifications du systeme', section: 'notifications', mots: 'bulles windows bureau' },

  // Divers
  { libelle: 'Mode performance', section: 'avance', mots: 'jeu fps economie fluidite ordinateur lent' },
  { libelle: 'Rechercher une mise a jour', section: 'avance', mots: 'version maj nouveaute' },
  { libelle: 'Version installee', section: 'avance', mots: 'numero a propos' },
  { libelle: 'Raccourcis clavier', section: 'raccourcis', mots: 'touches combinaisons' },
  { libelle: 'Langue', section: 'avance', mots: 'francais traduction' },
];

/** Retire les accents : on tape « generale » plus souvent que « generale ». */
function sansAccent(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const NOMS: Record<SettingsSection, string> = {
  compte: 'Mon compte',
  profil: 'Profil',
  confidentialite: 'Confidentialite',
  apparence: 'Apparence',
  accessibilite: 'Accessibilite',
  discussion: 'Discussion',
  voix: 'Voix et video',
  notifications: 'Notifications',
  raccourcis: 'Raccourcis',
  avance: 'Avance',
};

export function RechercheReglages({
  onChoisir,
}: {
  onChoisir: (section: SettingsSection) => void;
}) {
  const [terme, setTerme] = useState('');

  const trouves = useMemo(() => {
    const cherche = sansAccent(terme.trim());
    if (cherche.length < 2) return [];

    return INDEX.filter((entree) =>
      sansAccent(`${entree.libelle} ${entree.mots ?? ''} ${NOMS[entree.section]}`).includes(cherche),
    ).slice(0, 8);
  }, [terme]);

  return (
    <div className="reglages-recherche">
      <label className="reglages-recherche__champ">
        <Icon name="search" size={15} />
        <input
          type="search"
          className="reglages-recherche__saisie"
          value={terme}
          placeholder="Chercher un reglage"
          aria-label="Chercher un reglage"
          onChange={(event) => setTerme(event.target.value)}
        />
      </label>

      {terme.trim().length >= 2 ? (
        trouves.length === 0 ? (
          <p className="reglages-recherche__vide">Rien ne correspond.</p>
        ) : (
          <ul className="reglages-recherche__liste">
            {trouves.map((entree) => (
              <li key={entree.libelle}>
                <button
                  type="button"
                  className="reglages-recherche__resultat"
                  onClick={() => {
                    onChoisir(entree.section);
                    setTerme('');
                  }}
                >
                  <span className="reglages-recherche__nom truncate">{entree.libelle}</span>
                  {/* La section est dite : on apprend ou se trouve la chose, et
                      la fois suivante on y va directement. */}
                  <span className="reglages-recherche__section">{NOMS[entree.section]}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
