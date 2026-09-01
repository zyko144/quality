/**
 * Rejoue les echantillons captures par Windows.
 *
 * Le fil natif envoie le son du systeme par paquets, a son propre rythme —
 * celui du peripherique. Le fil audio, lui, reclame exactement 128 trames tous
 * les 128 / frequence de seconde, sans jamais attendre. Les deux ne peuvent pas
 * s'accorder directement : il faut un tampon entre eux.
 *
 * Le tampon est circulaire et de taille fixe. Grandir a la demande reviendrait
 * a accumuler du retard sans le dire : si la source produit plus vite que la
 * sortie ne consomme, le son partirait avec quelques secondes de decalage sur
 * l'image, et rien ne le rattraperait jamais.
 */

/**
 * Capacite du tampon, en trames.
 *
 * Un demi-seconde a 48 kHz. Assez pour absorber une rafale du systeme ou un
 * a-coup de la machine ; assez peu pour que le retard reste imperceptible si
 * le tampon se remplit.
 */
const CAPACITE = 24000;

/**
 * Reserve a constituer avant de commencer a jouer, en trames.
 *
 * Environ soixante millisecondes. La source arrive par paquets, et deux
 * paquets ne sont jamais separes exactement du meme intervalle : sans reserve,
 * le moindre retard trouve le tampon vide et pose un blanc. Un blanc de
 * quelques trames, a cette cadence, s'entend comme un craquement.
 *
 * Ce delai n'est paye qu'au demarrage et apres un silence — jamais en continu.
 */
const AMORCE = 3000;

class LectureSonSysteme extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.canaux = options?.processorOptions?.canaux ?? 2;

    // Un tableau par canal : le fil audio ecrit canal par canal, et
    // desentrelacer a la reception evite de le refaire a chaque bloc.
    this.tampon = Array.from({ length: this.canaux }, () => new Float32Array(CAPACITE));
    this.ecriture = 0;
    this.lecture = 0;
    this.remplissage = 0;

    this.port.onmessage = (message) => {
      if (message.data === 'stop') {
        this.vivant = false;
        return;
      }

      this.ecrire(new Float32Array(message.data));
    };

    this.vivant = true;

    /*
     * Faux tant que la reserve n'est pas constituee.
     *
     * On repasse a faux si le tampon se vide malgre tout : reprendre aussitot
     * ferait alterner son et blanc a chaque bloc. Mieux vaut se taire un
     * instant, refaire la reserve, et repartir proprement.
     */
    this.pret = false;
  }

  /** Range un paquet entrelace dans le tampon, canal par canal. */
  ecrire(entrelace) {
    const trames = Math.floor(entrelace.length / this.canaux);

    for (let t = 0; t < trames; t += 1) {
      /*
       * Tampon plein : on jette la trame la plus ancienne.
       *
       * Jeter la nouvelle serait plus simple, mais reviendrait a garder du son
       * perime en refusant le son courant — le decalage se figerait au lieu de
       * se resorber. Perdre quelques millisecondes de l'ancien passe inapercu ;
       * un retard permanent, non.
       */
      if (this.remplissage === CAPACITE) {
        this.lecture = (this.lecture + 1) % CAPACITE;
        this.remplissage -= 1;
      }

      for (let c = 0; c < this.canaux; c += 1) {
        this.tampon[c][this.ecriture] = entrelace[t * this.canaux + c];
      }

      this.ecriture = (this.ecriture + 1) % CAPACITE;
      this.remplissage += 1;
    }
  }

  process(_entrees, sorties) {
    const sortie = sorties[0];
    if (!sortie || sortie.length === 0) return this.vivant;

    const blocs = sortie[0].length;

    if (!this.pret) {
      if (this.remplissage < AMORCE) return this.vivant;
      this.pret = true;
    }

    for (let i = 0; i < blocs; i += 1) {
      if (this.remplissage === 0) {
        // Rien a jouer : du silence, et surtout pas la fin du tampon repetee.
        for (let c = 0; c < sortie.length; c += 1) sortie[c][i] = 0;
        this.pret = false;
        continue;
      }

      for (let c = 0; c < sortie.length; c += 1) {
        // Une sortie stereo alimentee par une source mono prend le meme canal
        // des deux cotes, plutot que du silence a droite.
        const source = this.tampon[Math.min(c, this.canaux - 1)];
        sortie[c][i] = source[this.lecture];
      }

      this.lecture = (this.lecture + 1) % CAPACITE;
      this.remplissage -= 1;
    }

    return this.vivant;
  }
}

registerProcessor('son-systeme', LectureSonSysteme);
