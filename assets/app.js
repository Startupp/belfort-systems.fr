/* Belfort Systems — interactions (léger, sans dépendance) */
(function () {
  "use strict";

  var header = document.querySelector("header.site");
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("mainNav");

  /* Ombre du header au défilement */
  function onScroll() {
    if (!header) return;
    if (window.scrollY > 8) header.classList.add("scrolled");
    else header.classList.remove("scrolled");
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* Menu mobile */
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
    });
    Array.prototype.forEach.call(nav.querySelectorAll("a"), function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Ouvrir le menu");
      });
    });
  }

  /* Entrée discrète vers le jeu « Sous l'Écorce », au pied de page */
  var foot = document.querySelector("footer.site .f-bottom span");
  if (foot) {
    var egg = document.createElement("a");
    egg.className = "egg";
    egg.href = "/ecorce/";
    egg.title = "Sous l'Écorce";
    egg.setAttribute("aria-label", "Sous l'Écorce, un jeu");
    egg.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.5 12.6a8.5 7.6 0 0 1 17 0c0 .8-.6 1.3-1.4 1.3H4.9c-.8 0-1.4-.5-1.4-1.3z" fill="currentColor"/><path d="M9.3 14.9h5.4v2.9a2.7 2.7 0 0 1-5.4 0z" fill="currentColor" opacity=".7"/></svg>';
    foot.insertBefore(egg, foot.firstChild);
  }

  /* Apparition au défilement */
  var reveals = document.querySelectorAll(".reveal");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduce || !("IntersectionObserver" in window)) {
    Array.prototype.forEach.call(reveals, function (el) { el.classList.add("in"); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

  Array.prototype.forEach.call(reveals, function (el) { io.observe(el); });
})();
