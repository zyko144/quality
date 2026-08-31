/* ==========================================================================
   Qualityz — le peu de JavaScript dont le site a besoin.

   Trois choses, pas une de plus : le menu sur petit ecran, l'annee du pied de
   page, et une apparition discrete au defilement. Le site fonctionne
   entierement sans ce fichier ; il ne fait qu'ajouter du confort.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     Adresse de contact du centre d'aide.

     Renseignee, elle active le formulaire : le bouton ouvre le logiciel de
     messagerie du visiteur avec un message deja redige. Rien n'est envoye a
     son insu, et il n'y a pas de serveur derriere — c'est lui qui expedie.

     Videe, le formulaire se desactive et le dit franchement. Il n'existe
     volontairement pas de troisieme etat : un formulaire qui a l'air d'envoyer
     sans rien envoyer vaut moins que pas de formulaire.
     ---------------------------------------------------------------------- */
  var ADRESSE_CONTACT = 'contactqualityz@gmail.com';

  // On signale que le script tourne. Les styles d'apparition sont conditionnes
  // a cette classe, pour qu'un blocage du JavaScript ne laisse pas la page
  // vide.
  document.documentElement.classList.add('js');

  document.addEventListener('DOMContentLoaded', function () {
    menuMobile();
    anneeCourante();
    apparitions();
    rechercheAide();
    formulaireAide();
  });

  /* -------------------------------------------------- Menu sur mobile --- */

  function menuMobile() {
    var bascule = document.querySelector('.bascule-nav');
    var nav = document.getElementById('nav-principale');
    if (!bascule || !nav) return;

    bascule.addEventListener('click', function () {
      var ouvert = nav.getAttribute('data-ouvert') === 'true';
      nav.setAttribute('data-ouvert', String(!ouvert));
      bascule.setAttribute('aria-expanded', String(!ouvert));
    });

    // Echap referme le menu et rend le focus au bouton.
    document.addEventListener('keydown', function (evenement) {
      if (evenement.key !== 'Escape') return;
      if (nav.getAttribute('data-ouvert') !== 'true') return;
      nav.setAttribute('data-ouvert', 'false');
      bascule.setAttribute('aria-expanded', 'false');
      bascule.focus();
    });
  }

  /* ----------------------------------------------- Annee du pied de page - */

  function anneeCourante() {
    var cibles = document.querySelectorAll('[data-annee]');
    var annee = String(new Date().getFullYear());
    for (var i = 0; i < cibles.length; i++) {
      cibles[i].textContent = annee;
    }
  }

  /* ------------------------------------------------------- Apparitions --- */

  function apparitions() {
    var blocs = document.querySelectorAll('[data-apparition]');
    if (!blocs.length) return;

    var reduit =
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Sans IntersectionObserver, ou si l'utilisateur a demande moins
    // d'animation, on affiche tout immediatement.
    if (reduit || !('IntersectionObserver' in window)) {
      for (var i = 0; i < blocs.length; i++) {
        blocs[i].classList.add('est-visible');
      }
      return;
    }

    var observateur = new IntersectionObserver(
      function (entrees) {
        entrees.forEach(function (entree) {
          if (!entree.isIntersecting) return;
          entree.target.classList.add('est-visible');
          observateur.unobserve(entree.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );

    blocs.forEach(function (bloc) {
      observateur.observe(bloc);
    });
  }

  /* --------------------------------------------- Recherche du centre d'aide

     Filtre les entrees a la frappe. La comparaison passe par une forme
     normalisee — sans accents, sans casse — pour que « mise a jour » trouve
     « mise a jour » comme « mise à jour », et que personne n'ait a deviner
     l'orthographe exacte employee dans la reponse. */

  // Marques diacritiques combinantes, U+0300 a U+036F. Ecrites en echappement
  // plutot qu'en clair : ces caracteres sont invisibles dans un editeur.
  var DIACRITIQUES = new RegExp('[\u0300-\u036f]', 'g');

  function normaliser(texte) {
    var t = String(texte).toLowerCase();
    // `normalize` manque sur les navigateurs tres anciens : on degrade sans
    // casser, la recherche reste simplement sensible aux accents.
    if (typeof ''.normalize === 'function') {
      t = t.normalize('NFD').replace(DIACRITIQUES, '');
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  function rechercheAide() {
    var champ = document.getElementById('recherche-aide');
    var compte = document.getElementById('aide-compte');
    var vide = document.getElementById('aide-vide');
    if (!champ) return;

    var entrees = [].slice.call(document.querySelectorAll('.aide__entree'));
    if (!entrees.length) return;

    // Le texte de chaque entree est indexe une fois, au chargement : refaire
    // la lecture du DOM a chaque touche serait inutilement couteux.
    var index = entrees.map(function (entree) {
      return {
        element: entree,
        categorie: entree.closest('.aide__categorie'),
        texte: normaliser(entree.textContent),
        ouvertAuDepart: entree.hasAttribute('open')
      };
    });
    var categories = [].slice.call(document.querySelectorAll('.aide__categorie'));

    function filtrer() {
      var terme = normaliser(champ.value);
      var trouves = 0;

      index.forEach(function (item) {
        var visible = !terme || item.texte.indexOf(terme) !== -1;
        item.element.hidden = !visible;
        if (visible) trouves++;
        // Une entree trouvee s'ouvre, pour que la reponse soit lisible sans
        // un clic de plus. Sans recherche, on rend a chacune son etat initial.
        if (terme) {
          item.element.open = visible;
        } else {
          item.element.open = item.ouvertAuDepart;
        }
      });

      // Une categorie dont plus rien ne subsiste disparait avec son titre.
      categories.forEach(function (categorie) {
        var reste = categorie.querySelector('.aide__entree:not([hidden])');
        categorie.hidden = !reste;
      });

      if (vide) vide.hidden = trouves !== 0;
      if (compte) {
        if (!terme) {
          compte.textContent = '';
        } else if (trouves === 0) {
          compte.textContent = 'Aucune entree pour « ' + champ.value.trim() + ' ».';
        } else {
          compte.textContent =
            trouves + (trouves > 1 ? ' entrees trouvees' : ' entree trouvee') + '.';
        }
      }
    }

    champ.addEventListener('input', filtrer);
    // Echap vide le champ et rend la liste complete.
    champ.addEventListener('keydown', function (evenement) {
      if (evenement.key === 'Escape' && champ.value) {
        evenement.stopPropagation();
        champ.value = '';
        filtrer();
      }
    });
  }

  /* ------------------------------------------- Formulaire du centre d'aide

     Deux etats seulement. Sans adresse de contact renseignee en tete de ce
     fichier, les champs restent desactives et l'avis l'explique. Avec une
     adresse, le bouton compose un courriel prerempli : c'est le visiteur qui
     l'envoie, depuis son propre logiciel de messagerie. */

  function formulaireAide() {
    var formulaire = document.getElementById('formulaire-aide');
    if (!formulaire) return;

    var champs = document.getElementById('champs-aide');
    var avis = document.getElementById('avis-formulaire');
    var avisTexte = document.getElementById('avis-texte');
    var adresse = String(ADRESSE_CONTACT || '').trim();

    if (!adresse) return; // On laisse le formulaire desactive, tel qu'il est ecrit.

    champs.disabled = false;
    avis.className = 'formulaire__avis formulaire__avis--pret';
    avisTexte.textContent =
      'Le bouton ouvre votre logiciel de messagerie avec le message deja redige, ' +
      'a destination de ' + adresse + ". Rien ne part avant que vous ne l'envoyiez.";

    formulaire.addEventListener('submit', function (evenement) {
      evenement.preventDefault();

      var valeur = function (id) {
        var champ = document.getElementById(id);
        return champ ? champ.value.trim() : '';
      };

      var categorie = valeur('champ-categorie');
      var objet = valeur('champ-objet');
      var description = valeur('champ-description');

      if (!objet || !description) {
        alert('Merci de renseigner au moins un objet et une description.');
        return;
      }

      var corps = [
        description,
        '',
        '---',
        'Categorie : ' + categorie,
        "Version de l'application : " + (valeur('champ-version') || 'non precisee'),
        'Systeme : ' + valeur('champ-systeme'),
        'Navigateur : ' + navigator.userAgent
      ].join('\r\n');

      window.location.href =
        'mailto:' + encodeURIComponent(adresse) +
        '?subject=' + encodeURIComponent('[' + categorie + '] ' + objet) +
        '&body=' + encodeURIComponent(corps);
    });
  }
})();
