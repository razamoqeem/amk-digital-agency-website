/* KivoReach Website: switches the motion layer on before the page paints (sets html.mx),
   so content that animates in never flashes first. Added by the build only to pages that load
   js/motion.js, which runs later (deferred) and does the actual animation. Same conditions as motion.js. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && 'IntersectionObserver' in window) document.documentElement.classList.add('mx');
})();
