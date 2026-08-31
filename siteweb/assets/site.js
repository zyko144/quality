/* ==========================================================================
   Qualityz — le peu de JavaScript dont le site a besoin.

   Trois choses, pas une de plus : le menu sur petit ecran, l'annee du pied de
   page, et une apparition discrete au defilement. Le site fonctionne
   entierement sans ce fichier ; il ne fait qu'ajouter du confort.
   ========================================================================== */

(function () {
  'use strict';

  // On signale que le script tourne. Les styles d'apparition sont conditionnes
  // a cette classe, pour qu'un blocage du JavaScript ne laisse pas la page
  // vide.
  document.documentElement.classList.add('js');

  document.addEventListener('DOMContentLoaded', function () {
    menuMobile();
    anneeCourante();
    apparitions();
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
})();
