/* AMK Digital Agency Website: reading progress, contents highlight, code copy, chart bars,
   share links, blog filter and site search. Every page works without this file; it only adds comfort. */
(function () {
  'use strict';
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function ready(fn) {
    if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    // Reading progress: how far through the article or docs text, not the whole page.
    var bar = document.querySelector('.art-progress span');
    var text = document.querySelector('[data-reading] .art-body, [data-reading].docs-main');
    if (bar && text) {
      var tick = function () {
        var r = text.getBoundingClientRect();
        var total = r.height - window.innerHeight * 0.6;
        var pct = total > 0 ? Math.min(100, Math.max(0, (-r.top + window.innerHeight * 0.2) / total * 100)) : 100;
        bar.style.width = pct + '%';
      };
      window.addEventListener('scroll', tick, { passive: true });
      window.addEventListener('resize', tick);
      tick();
    }

    // Contents: highlight the section being read. On phones the list starts folded.
    var toc = $$('.art-toc a');
    if (toc.length && 'IntersectionObserver' in window) {
      var byId = {};
      toc.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
      var heads = $$('h2[id], h3[id]').filter(function (h) { return byId[h.id]; });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          toc.forEach(function (a) { a.classList.remove('is-current'); a.removeAttribute('aria-current'); });
          var a = byId[e.target.id];
          if (a) { a.classList.add('is-current'); a.setAttribute('aria-current', 'location'); }
        });
      }, { rootMargin: '-90px 0px -70% 0px' });
      heads.forEach(function (h) { io.observe(h); });
    }
    if (window.matchMedia('(max-width: 1023px)').matches) {
      $$('.art-toc details, .docs-menu').forEach(function (d) { d.removeAttribute('open'); });
    }

    // Copy button on code blocks.
    if (navigator.clipboard) {
      $$('.code-block').forEach(function (fig) {
        var cap = fig.querySelector('figcaption');
        var code = fig.querySelector('code');
        if (!cap || !code) return;
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'code-copy'; btn.textContent = 'Copy';
        btn.addEventListener('click', function () {
          navigator.clipboard.writeText(code.textContent).then(function () {
            btn.textContent = 'Copied';
            setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
          });
        });
        cap.appendChild(btn);
      });
    }

    // Chart bars (the numbers are already printed; this only draws the bars).
    $$('.bar-fill[data-pct]').forEach(function (b) { b.style.width = Math.min(100, +b.getAttribute('data-pct') || 0) + '%'; });

    // Share links: built from this page's own address, so no site address is stored in the page.
    var share = document.querySelector('.share');
    if (share) {
      var u = encodeURIComponent(location.origin + location.pathname);
      $$('a[data-share]', share).forEach(function (a) {
        var t = encodeURIComponent(a.getAttribute('data-title') || document.title);
        a.href = a.getAttribute('data-share').replace('%(u)s', u).replace('%(t)s', t);
      });
      share.hidden = false;
    }

    // Blog: search box and category chips filter the cards on the page.
    var list = document.querySelector('[data-list]');
    if (list) {
      var cards = $$('.post-card', list);
      var input = document.querySelector('[data-list-search] input');
      var chips = $$('.chip');
      var none = document.querySelector('.no-results');
      var cat = '';
      var apply = function () {
        var q = (input && input.value || '').trim().toLowerCase();
        var shown = 0;
        cards.forEach(function (c) {
          var ok = (!cat || c.getAttribute('data-category') === cat) && (!q || c.textContent.toLowerCase().indexOf(q) >= 0);
          c.hidden = !ok;
          if (ok) shown++;
        });
        if (none) none.hidden = shown > 0;
      };
      chips.forEach(function (ch) {
        ch.addEventListener('click', function () {
          cat = ch.getAttribute('data-filter') || '';
          chips.forEach(function (x) { x.classList.toggle('is-on', x === ch); x.setAttribute('aria-pressed', x === ch ? 'true' : 'false'); });
          apply();
        });
      });
      if (chips.length > 2) chips[0].parentNode.hidden = false;
      var form = document.querySelector('[data-list-search]');
      if (form) form.addEventListener('submit', function (e) { e.preventDefault(); });
      if (input) input.addEventListener('input', apply);
      var hash = decodeURIComponent(location.hash.slice(1));
      if (hash) chips.forEach(function (ch) {
        var f = ch.getAttribute('data-filter') || '';
        if (f && f.toLowerCase().replace(/[^a-z0-9]+/g, '-') === hash) ch.click();
      });
    }

    // Site search (resources hub and docs): a small index built with the site.
    $$('[data-site-search]').forEach(function (form) {
      var input = form.querySelector('input');
      var out = form.querySelector('.search-results');
      var index = null;
      var load = function () {
        if (index) return Promise.resolve(index);
        return fetch('/search-index.json').then(function (r) { return r.json(); }).then(function (d) { index = d; return d; });
      };
      var run = function () {
        var q = input.value.trim().toLowerCase();
        if (q.length < 2) { out.textContent = ''; return; }
        load().then(function (items) {
          var words = q.split(/\s+/);
          var hits = items.filter(function (it) {
            var hay = (it.t + ' ' + it.d + ' ' + it.c).toLowerCase();
            return words.every(function (w) { return hay.indexOf(w) >= 0; });
          }).slice(0, 8);
          out.textContent = '';
          if (!hits.length) {
            var li = document.createElement('li'); li.textContent = 'No results. Try another word.'; li.className = 'no-results';
            out.appendChild(li); return;
          }
          hits.forEach(function (it) {
            var li = document.createElement('li');
            var a = document.createElement('a'); a.href = it.u;
            var b = document.createElement('b'); b.textContent = it.t;
            var s = document.createElement('small'); s.textContent = it.k + ' · ' + it.d;
            a.appendChild(b); a.appendChild(s); li.appendChild(a); out.appendChild(li);
          });
        }).catch(function () { out.textContent = ''; });
      };
      form.addEventListener('submit', function (e) { e.preventDefault(); var first = out.querySelector('a'); if (first) location.href = first.href; });
      input.addEventListener('input', run);
      input.addEventListener('focus', load);
    });
  });
})();
