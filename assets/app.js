/* Belfort Systems — interactions de l'interface (léger, sans dépendance, un seul fichier).
   En-tête, menu mobile, apparitions au défilement, mascotte. Les prix, le simulateur, le formulaire
   et le calendrier sont dans site.js. */
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var header = document.querySelector("header.site");
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("mainNav");

  /* Ombre de l'en-tête au défilement */
  function onScroll() {
    if (!header) return;
    if (window.scrollY > 8) header.classList.add("scrolled");
    else header.classList.remove("scrolled");
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* Menu mobile */
  if (toggle && nav) {
    var fermer = function () {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Ouvrir le menu");
    };
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
    });
    Array.prototype.forEach.call(nav.querySelectorAll("a"), function (a) {
      a.addEventListener("click", fermer);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("open")) { fermer(); toggle.focus(); }
    });
    document.addEventListener("click", function (e) {
      if (nav.classList.contains("open") && !nav.contains(e.target) && !toggle.contains(e.target)) fermer();
    });
  }

  /* Entrée discrète vers le jeu, au pied de page */
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

  /* Mascotte : petit saut quand elle entre à l'écran, au survol et au clic */
  var mascottes = document.querySelectorAll(".mascotte");
  function hop(m) {
    if (reduce) return;
    m.classList.remove("hop");
    void m.offsetWidth; // relance l'animation
    m.classList.add("hop");
  }
  Array.prototype.forEach.call(mascottes, function (m) {
    m.addEventListener("click", function () { hop(m); });
  });

  /* Apparitions au défilement (et petit saut de la mascotte quand elle apparaît) */
  var reveals = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    Array.prototype.forEach.call(reveals, function (el) { el.classList.add("in"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      io.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  Array.prototype.forEach.call(reveals, function (el) { io.observe(el); });

  var ioM = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var m = e.target;
      setTimeout(function () { hop(m); }, 500);
      ioM.unobserve(m);
    });
  }, { threshold: 0.6 });
  Array.prototype.forEach.call(mascottes, function (m) { ioM.observe(m); });
})();
