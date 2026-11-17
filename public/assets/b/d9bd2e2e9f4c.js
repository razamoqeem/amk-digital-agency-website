/* /js/theme-engine.js */
/* ============================================================
   AMK Digital Agency — THEME-ENGINE.JS
   Auto / Light / Dark theme. Runs in <head> before the page paints, so there is no flash.
   Auto follows the visitor's clock: light from 06:00, dark from 20:00 (checked again every
   10 minutes). Light or Dark chosen by hand is remembered and overrides Auto.
   Stored in localStorage "amk_theme" as auto | light | dark.
   ============================================================ */
(function () {
  var KEY = 'amk_theme';
  var DARK_FROM = 20, LIGHT_FROM = 6;

  function mode() {
    try {
      var v = String(localStorage.getItem(KEY) || '').toLowerCase();
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch (e) { return 'auto'; }
  }
  function clockDark() {
    var h = new Date().getHours();
    return h >= DARK_FROM || h < LIGHT_FROM;
  }
  function apply(m) {
    var dark = m === 'dark' || (m === 'auto' && clockDark());
    var root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-mode', m);
    root.style.colorScheme = dark ? 'dark' : 'light';
    return dark;
  }
  apply(mode());

  var NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
  var LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  var HELP = { auto: 'changes with the time of day', light: 'always light', dark: 'always dark' };
  var ICON = { auto: '◐', light: '☀', dark: '☾' };

  function updateButtons() {
    var m = mode();
    document.querySelectorAll('.theme-toggle-btn').forEach(function (btn) {
      btn.setAttribute('aria-label', 'Theme: ' + LABEL[m] + ' (' + HELP[m] + '). Switch to ' + LABEL[NEXT[m]] + '.');
      btn.setAttribute('title', 'Theme: ' + LABEL[m] + ', ' + HELP[m]);
      btn.textContent = '';
      var ic = document.createElement('span'); ic.setAttribute('aria-hidden', 'true'); ic.textContent = ICON[m];
      var lb = document.createElement('span'); lb.className = 'theme-label'; lb.textContent = LABEL[m];
      btn.appendChild(ic); btn.appendChild(document.createTextNode(' ')); btn.appendChild(lb);
    });
  }

  function set(m) {
    m = String(m || '').toLowerCase();
    if (m !== 'light' && m !== 'dark') m = 'auto';
    try { localStorage.setItem(KEY, m); localStorage.setItem('amk_os_theme', m.toUpperCase()); } catch (e) {}
    apply(m);
    updateButtons();
  }
  function toggle() { set(NEXT[mode()]); }
  function bindAll() {
    updateButtons();
    document.querySelectorAll('.theme-toggle-btn').forEach(function (btn) {
      if (btn._themeBound) return;
      btn.addEventListener('click', function (e) { e.preventDefault(); toggle(); });
      btn._themeBound = true;
    });
  }

  // Auto mode: switch at 06:00 and 20:00 without a reload.
  setInterval(function () { if (mode() === 'auto') apply('auto'); }, 600000);

  window.AMKTheme = { set: set, toggle: toggle, bindAll: bindAll, mode: mode };
  window.toggleAMKTheme = toggle;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAll);
  else bindAll();
})();

;
/* /js/site-nav.js */
/* AMK Digital Agency Website: shared navigation behaviour (pairs with css/nav.css).
   Loaded in <head> so html.amk-js is set before the page paints (the phone menu never flashes open).
   Desktop: dropdowns open on hover/focus through CSS; this script adds tap-to-open, Escape, outside-click
   and keeps aria-expanded truthful. Phone: the menu button opens the menu, each section opens by tap. */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('amk-js');

  function setup() {
    var nav = document.querySelector('[data-amk-nav]');
    if (!nav) return;
    var burger = nav.querySelector('.amk-burger');
    var dds = Array.prototype.slice.call(nav.querySelectorAll('.amk-dd'));
    var desktop = window.matchMedia('(min-width: 980px)');

    function setDD(dd, open) {
      dd.classList.toggle('is-open', open);
      dd.classList.remove('is-closed');
      var b = dd.querySelector('.amk-caret');
      if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function closeAll(except) { dds.forEach(function (dd) { if (dd !== except) setDD(dd, false); }); }
    function setMenu(open) {
      nav.classList.toggle('is-open', open);
      if (burger) {
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      }
      if (!open) closeAll();
    }

    if (burger) burger.addEventListener('click', function () { setMenu(!nav.classList.contains('is-open')); });

    dds.forEach(function (dd) {
      var caret = dd.querySelector('.amk-caret');
      if (caret) caret.addEventListener('click', function (e) {
        e.preventDefault();
        var open = !dd.classList.contains('is-open');
        closeAll(dd);
        setDD(dd, open);
      });
      // keep aria-expanded in step with hover on desktop
      dd.addEventListener('mouseenter', function () { if (desktop.matches && caret) caret.setAttribute('aria-expanded', 'true'); });
      dd.addEventListener('mouseleave', function () {
        if (!desktop.matches) return;
        dd.classList.remove('is-closed');
        if (!dd.classList.contains('is-open') && caret) caret.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var openDD = dds.filter(function (dd) { return dd.classList.contains('is-open') || dd.matches(':hover') || dd.contains(document.activeElement); })[0];
      if (openDD) {
        setDD(openDD, false);
        openDD.classList.add('is-closed');
        var link = openDD.querySelector('.amk-nl');
        if (link && openDD.contains(document.activeElement)) link.focus();
      } else if (nav.classList.contains('is-open')) { setMenu(false); if (burger) burger.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target)) { closeAll(); if (!desktop.matches) setMenu(false); }
    });
    desktop.addEventListener('change', function () { setMenu(false); });

    // shadow under the bar once the page scrolls
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { root.classList.toggle('amk-scrolled', window.scrollY > 8); ticking = false; });
    }, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();

;
/* /js/motion.js */
/* AMK Digital Agency Website: motion layer (pairs with css/motion.css).
   Loaded in <head> so the "mx" class is set before the page paints (no flash of content that then hides).
   Content is never hidden when the visitor asks for reduced motion, when IntersectionObserver is missing,
   or when this script does not run: the CSS only hides items under html.mx.

   Treatments (set in the HTML with data-mx, or chosen automatically):
     rise    headings, forms          fade + rise
     fade    descriptions, buttons    fade only
     scale   visuals, charts, bands   fade + grow from 0.95
     words   big statements           words light up one after another
     [data-mx-stagger] on a grid      its children rise one after another */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;
  var root = document.documentElement;
  root.classList.add('mx');

  var SKIP = '.amk-nav, .amk-chat, footer, .skip-link, [hidden], script, style, .mx-progress';
  var AUTO = ['.page-body > *', 'main > section > *', 'main .hero > *', 'main > h1', 'main > h2', 'main > p',
              '.tool-hero .container > *', '.tool-workspace .container > *', 'main .panel', 'main .notice:not([hidden])'];
  var GRIDS = ['.cards', '.sc-grid-cards', '.sc-stats', '.sc-charts', '.sc-ba-grid', '.sc-chips', '.tools-grid', '.compare-grid',
               '.x-cards', '.x-features', '[data-mx-stagger]', '.x-chips'];

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('mx-in');
      io.unobserve(e.target);
      countUp(e.target);
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });

  function guess(el) {
    if (/^H[1-4]$/.test(el.tagName)) return 'rise';
    if (el.matches('p, ul, ol, .x-ctas, .runs-line, .meta')) return 'fade';
    if (el.matches('figure, img, svg, .sc-chart, .x-cta, .x-hero-visual, .sc-table-wrap, .x-toc')) return 'scale';
    return 'rise';
  }

  var atLoad = true;
  setTimeout(function () { atLoad = false; }, 1500);

  function mark(el, delay) {
    if (!el || el.classList.contains('mx-reveal') || el.closest(SKIP)) return;
    if (!el.getClientRects().length) return;   // not shown yet (for example tool results): never animate it later
    // Text already on screen when the page opens is shown at once (no fade), so the main heading paints
    // immediately; this keeps Largest Contentful Paint fast. Cards and pictures still animate in.
    if (atLoad && el.matches('h1, h2, h3, p, ul, ol, .x-kicker, .art-meta, .crumbs, .hub-kicker, .art-cat') &&
        el.getBoundingClientRect().top < window.innerHeight) return;
    if (!el.hasAttribute('data-mx')) el.setAttribute('data-mx', guess(el));
    if (el.getAttribute('data-mx') === 'words') splitWords(el);
    el.classList.add('mx-reveal');
    if (delay) el.style.setProperty('--mx-d', delay + 'ms');
    io.observe(el);
  }

  // Wrap each word in a span (text stays in the page for search engines and screen readers).
  function splitWords(el) {
    var n = 0, walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var frag = document.createDocumentFragment();
      node.nodeValue.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
        var s = document.createElement('span');
        s.className = 'mx-w';
        s.textContent = part;
        s.style.setProperty('--i', String(Math.min(n++, 40)));
        frag.appendChild(s);
      });
      node.parentNode.replaceChild(frag, node);
    });
  }

  // Stat numbers count up once, from 0 to the real value already written in the page.
  function countUp(el) {
    var list = el.matches('.sc-stat') ? [el.querySelector('b')] : [];
    list.forEach(function (b) {
      if (!b || !/^\d{1,6}$/.test(b.textContent.trim())) return;
      var end = parseInt(b.textContent, 10), t0 = null;
      var step = function (t) {
        if (!t0) t0 = t;
        var p = Math.min(1, (t - t0) / 900);
        b.textContent = String(Math.round(end * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function setup() {
    var bar = document.createElement('div');
    bar.className = 'mx-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.setProperty('--mx-p', max > 0 ? Math.min(1, window.scrollY / max).toFixed(4) : '0');
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    var hero = document.querySelector('main .x-hero') || document.querySelector('main .hero') || document.querySelector('.tool-hero') || document.querySelector('main.page-body');
    if (hero) hero.classList.add('mx-hero');

    // explicit treatments first, then grids (staggered), then everything else
    document.querySelectorAll('main [data-mx]').forEach(function (el) { mark(el, 0); });
    GRIDS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (grid) {
        if (grid.closest(SKIP)) return;
        Array.prototype.forEach.call(grid.children, function (child, i) {
          if (!child.hasAttribute('data-mx')) child.setAttribute('data-mx', 'rise');
          mark(child, Math.min(i, 7) * 90);
        });
      });
    });
    AUTO.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (GRIDS.some(function (g) { return el.matches(g); })) return;          // grids animate through their children
        if (el.querySelector('[data-mx], .mx-reveal')) return;                     // a wrapper whose parts animate on their own
        mark(el, 0);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();

  // Safety net: anything still hidden near the screen after load is shown.
  window.addEventListener('load', function () {
    setTimeout(function () {
      document.querySelectorAll('.mx-reveal:not(.mx-in)').forEach(function (el) {
        if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('mx-in');
      });
    }, 4000);
  });
})();
