/**
 * La porte de bruit, sur le fil audio.
 *
 * Ce fichier tourne dans le contexte `AudioWorkletGlobalScope`, pas dans la
 * page. C'est toute la raison de son existence : le fil audio n'est jamais
 * ralenti quand la fenetre passe en arriere-plan, la ou `setInterval` tombe a
 * une execution par seconde.
 *
 * La version precedente mesurait le niveau depuis la page toutes les vingt-cinq
 * millisecondes. Des qu'on basculait sur autre chose — un jeu, precisement le
 * cas ou l'on parle en vocal — le navigateur ralentissait ce reglage et la
 * porte restait fermee des secondes entieres. Les autres n'entendaient plus
 * rien, ou seulement la fin des phrases.
 *
 * Ici, le calcul se fait par blocs de 128 echantillons, soit environ toutes les
 * 2,7 millisecondes a 48 kHz, quoi qu'il arrive a l'ecran.
 */

/** Duree pendant laquelle la porte reste ouverte apres le dernier son utile. */
const RETENUE_S = 0.32;

/**
 * Constantes d'ouverture et de fermeture, en secondes.
 *
 * L'ouverture est presque instantanee et la fermeture lente. L'inverse
 * couperait le debut des mots — le defaut classique des portes mal reglees, ou
 * l'on entend « ...onjour » au lieu de « bonjour ».
 */
const MONTEE_S = 0.006;
const DESCENTE_S = 0.12;

class PorteDeBruit extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'seuilDb',
        defaultValue: -50,
        minValue: -100,
        maxValue: 0,
        automationRate: 'k-rate',
      },
      /*
       * Permet de neutraliser la porte sans defaire le graphe.
       *
       * Couper le reglage en pleine conversation ne doit pas demander de
       * recapturer le micro : on laisse simplement tout passer.
       */
      {
        name: 'active',
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    /*
     * Ouverte au depart.
     *
     * Une porte qui echoue doit echouer ouverte. Fermee, le moindre defaut —
     * contexte suspendu, parametre absent — se traduit par un silence total
     * que personne ne sait diagnostiquer depuis l'autre bout de la ligne.
     * Ouverte, le pire qui puisse arriver est qu'on entende un peu de fond.
     */
    this.gain = 1;
    this.ouverteJusqua = 0;
  }

  process(entrees, sorties, parametres) {
    const entree = entrees[0];
    const sortie = sorties[0];

    // Pas de canal : le micro n'a pas encore rendu la main. On garde le
    // processeur en vie, sans quoi il ne redemarrerait pas.
    if (!entree || entree.length === 0 || !sortie) return true;

    const actif = parametres['active'][0] >= 0.5;
    const seuilDb = parametres['seuilDb'][0];

    // Niveau efficace du premier canal, en decibels.
    const canal = entree[0];
    let somme = 0;
    for (let i = 0; i < canal.length; i += 1) somme += canal[i] * canal[i];
    const niveauDb = 20 * Math.log10(Math.sqrt(somme / canal.length) + 1e-8);

    const duree = canal.length / sampleRate;

    if (!actif) {
      this.gain = 1;
    } else if (niveauDb > seuilDb) {
      this.ouverteJusqua = currentTime + RETENUE_S;
      this.gain += (1 - this.gain) * Math.min(1, duree / MONTEE_S);
    } else if (currentTime > this.ouverteJusqua) {
      this.gain += (0 - this.gain) * Math.min(1, duree / DESCENTE_S);
    }

    /*
     * Le gain est applique par echantillon, en glissant vers sa cible.
     *
     * L'appliquer d'un bloc a l'autre produirait un saut de niveau tous les
     * 2,7 millisecondes, audible comme un cliquetis. L'interpolation lisse la
     * transition a l'interieur du bloc.
     */
    for (let c = 0; c < entree.length; c += 1) {
      const source = entree[c];
      const cible = sortie[c];
      if (!source || !cible) continue;
      for (let i = 0; i < source.length; i += 1) cible[i] = source[i] * this.gain;
    }

    return true;
  }
}

registerProcessor('porte-de-bruit', PorteDeBruit);
