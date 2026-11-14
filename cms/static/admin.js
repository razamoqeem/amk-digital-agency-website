/* Website CMS admin. All content is inserted with textContent or form values;
   nothing typed by the editor is ever written as HTML here. */
(function () {
  'use strict';

  var TITLE_MAX = 60, DESC_MIN = 70, DESC_MAX = 160;
  var settings = { tokens: { sizes: [], colors: {}, opacities: [] }, schema_types: [], site_url: '' };
  var page = null;          // the page being edited
  var currentSlug = null;   // its slug on disk ("new" for an unsaved page)
  var hasErrors = false;
  var checkTimer = null;

  function $(id) { return document.getElementById(id); }
  function pagePath(slug) { return slug === 'home' ? '/' : '/' + slug + '/'; }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k]; else node.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function api(method, url, body) {
    var opts = { method: method, headers: { 'X-AMK-CMS': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    });
  }

  /* ── Contrast (same formula as the server) ── */
  function lum(hex) {
    var h = hex.replace('#', '');
    var c = [0, 2, 4].map(function (i) {
      var v = parseInt(h.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function blend(fg, bg, a) {
    var f = fg.replace('#', ''), b = bg.replace('#', '');
    return '#' + [0, 2, 4].map(function (i) {
      var v = Math.round(parseInt(f.substr(i, 2), 16) * a + parseInt(b.substr(i, 2), 16) * (1 - a));
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }
  function contrast(fg, bg, opacity) {
    var seen = blend(fg, bg, (opacity === undefined ? 100 : opacity) / 100);
    var a = lum(seen), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  /* ── Page list ── */
  function loadPages() {
    return api('GET', '/api/pages').then(function (r) {
      var list = $('page-list');
      list.textContent = '';
      r.data.pages.forEach(function (p) {
        var li = el('li');
        var btn = el('button', { type: 'button' }, pagePath(p.slug));
        if (p.slug === currentSlug) btn.setAttribute('aria-current', 'true');
        if (p.errors) btn.appendChild(el('span', { class: 'badge bad' }, p.errors + ' problem' + (p.errors > 1 ? 's' : '')));
        else if (p.warnings) btn.appendChild(el('span', { class: 'badge warn' }, p.warnings + ' warning' + (p.warnings > 1 ? 's' : '')));
        else btn.appendChild(el('span', { class: 'badge ok' }, 'OK'));
        if (p.noindex) btn.appendChild(el('span', { class: 'badge warn' }, 'noindex'));
        if (p.draft) btn.appendChild(el('span', { class: 'badge warn' }, 'draft'));
        btn.addEventListener('click', function () { openPage(p.slug); });
        li.appendChild(btn);
        list.appendChild(li);
      });
    });
  }

  function openPage(slug) {
    api('GET', '/api/pages/' + slug.split('/').map(encodeURIComponent).join('/')).then(function (r) {
      if (!r.ok) return;
      page = r.data;
      currentSlug = slug;
      showEditor();
    });
  }

  function newPage() {
    page = {
      slug: '', title: '', description: '', canonical: '', noindex: false, draft: false,
      og: { title: '', description: '', image: '' }, schema: [],
      blocks: [{ type: 'heading', level: 1, text: '', size: 'xl', color: 'ink', opacity: 100 }]
    };
    currentSlug = 'new';
    showEditor();
  }

  /* ── Editor ── */
  function showEditor() {
    $('limits-editor').hidden = true;
    $('col-editor').hidden = true;
    var layout = document.querySelector('.layout');
    if (layout) layout.classList.remove('limits-active');
    var btnLim = $('btn-limits');
    if (btnLim) btnLim.removeAttribute('aria-current');
    var colBtns = document.querySelectorAll('#collection-items-list button');
    Array.prototype.forEach.call(colBtns, function (b) { b.removeAttribute('aria-current'); });
    $('editor').hidden = false;
    $('checks-panel').hidden = false;
    $('editor-title').textContent = currentSlug === 'new' ? 'New page' : 'Editing ' + pagePath(currentSlug);
    $('f-title').value = page.title || '';
    $('f-desc').value = page.description || '';
    $('f-slug').value = page.slug || '';
    $('f-canonical').value = page.canonical || '';
    $('f-noindex').checked = !!page.noindex;
    $('f-draft').checked = !!page.draft;
    $('f-og-title').value = (page.og || {}).title || '';
    $('f-og-desc').value = (page.og || {}).description || '';
    $('f-og-image').value = (page.og || {}).image || '';
    var box = $('schema-box');
    box.textContent = '';
    settings.schema_types.forEach(function (name) {
      var label = el('label');
      var cb = el('input', { type: 'checkbox', value: name });
      cb.checked = (page.schema || []).indexOf(name) !== -1;
      cb.addEventListener('change', function () {
        page.schema = Array.prototype.filter.call(box.querySelectorAll('input'), function (i) { return i.checked; })
          .map(function (i) { return i.value; });
        changed();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + name));
      box.appendChild(label);
    });
    $('save-status').textContent = '';
    renderBlocks();
    updateSeo();
    loadPages();
    scheduleCheck(0);
  }

  function updateSeo() {
    var t = $('f-title').value, d = $('f-desc').value, slug = $('f-slug').value;
    var ct = $('c-title'), cd = $('c-desc');
    ct.textContent = t.length + ' / ' + TITLE_MAX;
    ct.className = 'count' + (t.length > TITLE_MAX ? ' over' : '');
    cd.textContent = d.length + ' (aim for ' + DESC_MIN + ' to ' + DESC_MAX + ')';
    cd.className = 'count' + ((d.length && (d.length < DESC_MIN || d.length > DESC_MAX)) ? ' over' : '');
    var base = settings.site_url || 'https://[TO BE CONFIRMED]';
    $('serp-url').textContent = base + pagePath(slug);
    $('serp-title').textContent = t || 'Page title';
    $('serp-desc').textContent = d || 'Meta description';
    $('slug-hint').textContent = (currentSlug !== 'new' && slug && slug !== currentSlug)
      ? 'Saving will move this page and add a 301 redirect from ' + pagePath(currentSlug) + ' to ' + pagePath(slug) + '.' : '';
  }

  function field(labelText, input) {
    var wrap = el('div');
    var id = 'i' + Math.random().toString(36).slice(2);
    var label = el('label', { for: id }, labelText);
    input.id = id;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function selectOf(options, value, onChange) {
    var s = el('select');
    options.forEach(function (o) {
      var opt = el('option', { value: String(o.value) }, o.label);
      if (String(o.value) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }

  function textInput(value, onInput, multiline) {
    var i = multiline ? el('textarea', { rows: '3' }) : el('input', { type: 'text', autocomplete: 'off' });
    i.value = value || '';
    i.addEventListener('input', function () { onInput(i.value); });
    return i;
  }

  function tokenRow(block, contrastNote) {
    var row = el('div', { class: 'row' });
    var t = settings.tokens;
    row.appendChild(field('Size', selectOf(t.sizes.map(function (s) { return { value: s, label: s }; }), block.size,
      function (v) { block.size = v; changed(); contrastNote(); })));
    row.appendChild(field('Colour', selectOf(Object.keys(t.colors).map(function (c) { return { value: c, label: c }; }), block.color,
      function (v) { block.color = v; changed(); contrastNote(); })));
    row.appendChild(field('Opacity', selectOf(t.opacities.map(function (o) { return { value: o, label: o + '%' }; }), block.opacity,
      function (v) { block.opacity = parseInt(v, 10); changed(); contrastNote(); })));
    return row;
  }

  function renderBlocks() {
    var host = $('blocks');
    host.textContent = '';
    var names = { heading: 'Heading', paragraph: 'Paragraph', list: 'List', image: 'Image', button: 'Button', faq: 'Question and answer', 'tool-embed': 'Tool link' };
    page.blocks.forEach(function (block, index) {
      var box = el('div', { class: 'block' });
      var head = el('div', { class: 'block-head' });
      head.appendChild(el('strong', {}, (index + 1) + '. ' + (names[block.type] || block.type)));
      var up = el('button', { type: 'button', class: 'btn small', 'aria-label': 'Move block ' + (index + 1) + ' up' }, 'Up');
      var down = el('button', { type: 'button', class: 'btn small', 'aria-label': 'Move block ' + (index + 1) + ' down' }, 'Down');
      var del = el('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove block ' + (index + 1) }, 'Remove');
      up.disabled = index === 0;
      down.disabled = index === page.blocks.length - 1;
      up.addEventListener('click', function () { move(index, -1); });
      down.addEventListener('click', function () { move(index, 1); });
      del.addEventListener('click', function () { page.blocks.splice(index, 1); renderBlocks(); changed(); });
      head.appendChild(up); head.appendChild(down); head.appendChild(del);
      box.appendChild(head);

      var note = el('p', { class: 'contrast' });
      function contrastNote() {
        var t = settings.tokens, bg = t.colors[t.page_background] || '#ffffff';
        if (block.type === 'button') {
          var rb = contrast('#ffffff', t.colors[block.color] || '#000000', 100);
          note.textContent = 'White text on this colour: ' + rb.toFixed(2) + ':1' + (rb < 4.5 ? ' (too low, needs 4.5:1)' : ' (passes)');
          note.className = 'contrast ' + (rb < 4.5 ? 'bad' : 'ok');
          return;
        }
        if (!block.color || !t.colors[block.color]) { note.textContent = ''; return; }
        var large = block.type === 'heading' && (block.size === 'lg' || block.size === 'xl');
        var need = large ? 3 : 4.5;
        var r = contrast(t.colors[block.color], bg, block.opacity);
        note.textContent = 'Contrast on the page background: ' + r.toFixed(2) + ':1' + (r < need ? ' (too low, needs ' + need + ':1)' : ' (passes)');
        note.className = 'contrast ' + (r < need ? 'bad' : 'ok');
      }

      if (block.type === 'heading') {
        var row = el('div', { class: 'row' });
        row.appendChild(field('Level', selectOf([1, 2, 3, 4].map(function (n) { return { value: n, label: 'H' + n }; }), block.level,
          function (v) { block.level = parseInt(v, 10); changed(); })));
        box.appendChild(row);
        box.appendChild(field('Heading text', textInput(block.text, function (v) { block.text = v; changed(); })));
        box.appendChild(tokenRow(block, contrastNote));
      } else if (block.type === 'paragraph') {
        box.appendChild(field('Text (bold, italic and links are allowed; other HTML is removed on save)',
          textInput(block.html, function (v) { block.html = v; changed(); }, true)));
        box.appendChild(tokenRow(block, contrastNote));
      } else if (block.type === 'list') {
        box.appendChild(field('Items (one per line)', textInput((block.items || []).join('\n'),
          function (v) { block.items = v.split('\n'); changed(); }, true)));
        var lab = el('label', { class: 'check' });
        var cb = el('input', { type: 'checkbox' });
        cb.checked = !!block.ordered;
        cb.addEventListener('change', function () { block.ordered = cb.checked; changed(); });
        lab.appendChild(cb); lab.appendChild(document.createTextNode(' Numbered list'));
        box.appendChild(lab);
        box.appendChild(tokenRow(block, contrastNote));
      } else if (block.type === 'image') {
        box.appendChild(field('Image path or web address', textInput(block.src, function (v) { block.src = v; changed(); })));
        box.appendChild(field('Alt text (describe the image)', textInput(block.alt, function (v) { block.alt = v; changed(); })));
        var dims = el('div', { class: 'row' });
        ['width', 'height'].forEach(function (k) {
          var n = el('input', { type: 'number', min: '1' });
          n.value = block[k] || '';
          n.addEventListener('input', function () { block[k] = parseInt(n.value, 10) || null; changed(); });
          dims.appendChild(field(k === 'width' ? 'Width (pixels)' : 'Height (pixels)', n));
        });
        box.appendChild(dims);
      } else if (block.type === 'button') {
        box.appendChild(field('Label', textInput(block.label, function (v) { block.label = v; changed(); })));
        box.appendChild(field('Link (path on this site or web address)', textInput(block.href, function (v) { block.href = v; changed(); })));
        var crow = el('div', { class: 'row' });
        crow.appendChild(field('Colour', selectOf(Object.keys(settings.tokens.colors).map(function (c) { return { value: c, label: c }; }),
          block.color || 'accent', function (v) { block.color = v; changed(); contrastNote(); })));
        box.appendChild(crow);
      } else if (block.type === 'faq') {
        box.appendChild(field('Question', textInput(block.question, function (v) { block.question = v; changed(); })));
        box.appendChild(field('Answer', textInput(block.answer, function (v) { block.answer = v; changed(); }, true)));
      }
      box.appendChild(note);
      contrastNote();
      host.appendChild(box);
    });
  }

  function move(index, delta) {
    var target = index + delta;
    if (target < 0 || target >= page.blocks.length) return;
    var item = page.blocks.splice(index, 1)[0];
    page.blocks.splice(target, 0, item);
    renderBlocks();
    changed();
  }

  function addBlock() {
    var type = $('add-type').value;
    var defaults = {
      heading: { type: 'heading', level: 2, text: '', size: 'lg', color: 'ink', opacity: 100 },
      paragraph: { type: 'paragraph', html: '', size: 'md', color: 'ink', opacity: 100 },
      list: { type: 'list', ordered: false, items: [], size: 'md', color: 'ink', opacity: 100 },
      image: { type: 'image', src: '', alt: '', width: null, height: null },
      button: { type: 'button', label: '', href: '', color: 'accent' },
      faq: { type: 'faq', question: '', answer: '' }
    };
    page.blocks.push(defaults[type]);
    renderBlocks();
    changed();
  }

  /* ── Live checks ── */
  function collect() {
    page.title = $('f-title').value;
    page.description = $('f-desc').value;
    page.slug = $('f-slug').value.trim();
    page.canonical = $('f-canonical').value.trim();
    page.noindex = $('f-noindex').checked;
    page.draft = $('f-draft').checked;
    page.og = { title: $('f-og-title').value, description: $('f-og-desc').value, image: $('f-og-image').value };
    return page;
  }

  function changed() {
    $('save-status').textContent = 'Not saved';
    updateSeo();
    scheduleCheck(350);
  }

  function scheduleCheck(delay) {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(runCheck, delay);
  }

  function fillList(node, items, emptyText) {
    node.textContent = '';
    if (!items.length) { node.appendChild(el('li', { class: 'none' }, emptyText)); return; }
    items.forEach(function (m) { node.appendChild(el('li', {}, m)); });
  }

  function runCheck() {
    if (!page) return;
    api('POST', '/api/check', collect()).then(function (r) {
      var data = r.data;
      hasErrors = data.errors.length > 0;
      $('btn-save').disabled = hasErrors;
      fillList($('errors'), data.errors, 'None. The page can be saved.');
      fillList($('warnings'), data.warnings, 'None.');
      var outline = $('outline');
      outline.textContent = '';
      data.outline.forEach(function (h) {
        var li = el('li', { class: 'lv' + h.level });
        li.appendChild(el('span', { class: 'tag' }, 'H' + h.level));
        li.appendChild(document.createTextNode(h.text || '(empty)'));
        outline.appendChild(li);
      });
      if (!data.outline.length) outline.appendChild(el('li', {}, 'No headings yet.'));
    });
  }

  function save() {
    if (!page || hasErrors) return;
    api('PUT', '/api/pages/' + currentSlug.split('/').map(encodeURIComponent).join('/'), collect()).then(function (r) {
      if (!r.ok || !r.data.saved) {
        $('save-status').textContent = 'Not saved: fix the problems listed.';
        fillList($('errors'), (r.data && r.data.errors) || ['Save failed.'], '');
        return;
      }
      currentSlug = r.data.slug;
      $('save-status').textContent = r.data.redirect_added
        ? 'Saved. Redirect added: ' + r.data.redirect_added.from + ' → ' + r.data.redirect_added.to
        : 'Saved. Press "Build site" to update the pages.';
      $('editor-title').textContent = 'Editing ' + pagePath(currentSlug);
      updateSeo();
      loadPages();
    });
  }

  function build() {
    var box = $('build-report');
    box.textContent = 'Building…';
    api('POST', '/api/build').then(function (r) {
      box.textContent = '';
      var d = r.data;
      box.appendChild(el('p', { class: d.ok ? 'ok' : 'bad' },
        d.ok ? 'Build finished: ' + d.pages.length + ' page(s). Review, then commit and push.' : 'Build stopped. The site was not changed.'));
      (d.errors || []).forEach(function (m) { box.appendChild(el('p', { class: 'bad' }, m)); });
      (d.warnings || []).forEach(function (m) { box.appendChild(el('p', {}, 'Warning: ' + m)); });
    });
  }

  /* ── Usage limits editor ── */
  var availableTools = [];

  function openLimits() {
    api('GET', '/api/limits').then(function (r) {
      if (!r.ok) return;
      var limitsData = r.data.limits || {};
      availableTools = r.data.tools || [];

      // Hide page editor, checks panel, and collection editor
      page = null;
      currentSlug = null;
      $('editor').hidden = true;
      $('checks-panel').hidden = true;
      $('col-editor').hidden = true;
      var layout = document.querySelector('.layout');
      if (layout) layout.classList.add('limits-active');

      // Clear active states on pages and collections list
      var pageBtns = document.querySelectorAll('#page-list button');
      Array.prototype.forEach.call(pageBtns, function (b) { b.removeAttribute('aria-current'); });
      var colBtns = document.querySelectorAll('#collection-items-list button');
      Array.prototype.forEach.call(colBtns, function (b) { b.removeAttribute('aria-current'); });
      var btnLim = $('btn-limits');
      if (btnLim) btnLim.setAttribute('aria-current', 'true');

      $('limits-editor').hidden = false;
      $('limits-save-status').textContent = '';

      // Populate form fields
      $('lim-enabled').checked = limitsData.enabled !== false;
      $('lim-warn-percent').value = limitsData.warn_percent !== undefined ? limitsData.warn_percent : 80;
      $('lim-runs-before-email').value = limitsData.runs_before_email !== undefined ? limitsData.runs_before_email : 3;

      var free = limitsData.free || {};
      $('lim-free-daily').value = free.daily !== undefined ? free.daily : 10;
      $('lim-free-monthly').value = free.monthly !== undefined ? free.monthly : 100;
      $('lim-free-session').value = free.session !== undefined ? free.session : 10;

      var testers = limitsData.testers || {};
      var isUnlimited = testers.unlimited !== false;
      $('lim-tester-unlimited').checked = isUnlimited;
      $('lim-tester-daily').value = testers.daily !== undefined ? testers.daily : 500;
      $('lim-tester-monthly').value = testers.monthly !== undefined ? testers.monthly : 5000;
      $('lim-tester-session').value = testers.session !== undefined ? testers.session : 500;
      $('tester-caps-row').style.opacity = isUnlimited ? '0.5' : '1';

      // Render tool caps
      var cont = $('tool-caps-container');
      cont.textContent = '';
      var configuredTools = limitsData.tools || {};
      availableTools.forEach(function (t) {
        var card = el('div', { class: 'tool-cap-item' });
        var lbl = el('label', { for: 'cap-' + t.slug }, t.name + ' ');
        lbl.appendChild(el('span', { class: 'tool-slug' }, '(' + t.slug + ')'));
        var val = (configuredTools[t.slug] && configuredTools[t.slug].daily) || 0;
        var inp = el('input', {
          type: 'number',
          id: 'cap-' + t.slug,
          min: '0',
          max: '10000',
          value: String(val)
        });
        card.appendChild(lbl);
        card.appendChild(inp);
        cont.appendChild(card);
      });
    });
  }

  function saveLimits() {
    var btn = $('btn-save-limits');
    btn.disabled = true;
    $('limits-save-status').textContent = 'Saving…';

    var freeDaily = parseInt($('lim-free-daily').value, 10);
    var freeMonthly = parseInt($('lim-free-monthly').value, 10);
    var freeSession = parseInt($('lim-free-session').value, 10);
    var testerDaily = parseInt($('lim-tester-daily').value, 10);
    var testerMonthly = parseInt($('lim-tester-monthly').value, 10);
    var testerSession = parseInt($('lim-tester-session').value, 10);
    var warnPct = parseInt($('lim-warn-percent').value, 10);
    var beforeEmail = parseInt($('lim-runs-before-email').value, 10);

    var toolsObj = {};
    availableTools.forEach(function (t) {
      var inp = $('cap-' + t.slug);
      if (inp) {
        var v = parseInt(inp.value, 10);
        if (v > 0) {
          toolsObj[t.slug] = { daily: v };
        }
      }
    });

    var payload = {
      enabled: $('lim-enabled').checked,
      warn_percent: isNaN(warnPct) ? 80 : warnPct,
      runs_before_email: isNaN(beforeEmail) ? 3 : beforeEmail,
      free: {
        daily: isNaN(freeDaily) ? 10 : freeDaily,
        monthly: isNaN(freeMonthly) ? 100 : freeMonthly,
        session: isNaN(freeSession) ? 10 : freeSession
      },
      testers: {
        unlimited: $('lim-tester-unlimited').checked,
        daily: isNaN(testerDaily) ? 500 : testerDaily,
        monthly: isNaN(testerMonthly) ? 5000 : testerMonthly,
        session: isNaN(testerSession) ? 500 : testerSession
      },
      tools: toolsObj
    };

    api('PUT', '/api/limits', payload).then(function (r) {
      btn.disabled = false;
      if (r.ok && r.data.saved) {
        $('limits-save-status').textContent = 'Saved. Takes effect immediately on next tool run.';
      } else {
        $('limits-save-status').textContent = 'Save failed. Check input values.';
      }
    });
  }

  /* ── Webflow-Style Custom CMS Collections ── */
  var collectionsList = [];
  var foldersList = [];
  var activeCollectionId = 'blogs';
  var activeColItem = null;
  var currentColSlug = null;

  function loadCollections() {
    return api('GET', '/api/collections').then(function (r) {
      if (!r.ok) return;
      collectionsList = r.data.schemas || [];
      foldersList = r.data.folders || [];
      populateFolderDropdown();
      loadCollectionItems(activeCollectionId);
    });
  }

  function populateFolderDropdown() {
    var sel = $('col-folder-select');
    if (!sel) return;
    sel.textContent = '';
    var optRoot = el('option', { value: '' }, '/ (Site root)');
    sel.appendChild(optRoot);
    foldersList.forEach(function (f) {
      var opt = el('option', { value: f.id }, '/' + (f.fullPath || f.slug) + '/ (' + (f.name || f.id) + ')');
      sel.appendChild(opt);
    });
  }

  function loadCollectionItems(colId) {
    activeCollectionId = colId;
    return api('GET', '/api/collections/' + colId + '/items').then(function (r) {
      var list = $('collection-items-list');
      if (!list) return;
      list.textContent = '';
      if (!r.ok || !r.data.items || r.data.items.length === 0) {
        var emptyLi = el('li', { style: 'padding: 8px 10px; font-size: 13px; color: var(--muted);' }, 'No items yet.');
        list.appendChild(emptyLi);
        return;
      }
      r.data.items.forEach(function (item) {
        var li = el('li');
        var btn = el('button', { type: 'button' }, item.title || item.slug);
        if (currentColSlug === item.slug && !$('col-editor').hidden) btn.setAttribute('aria-current', 'true');
        if (item.draft) btn.appendChild(el('span', { class: 'badge warn' }, 'draft'));
        else btn.appendChild(el('span', { class: 'badge ok' }, 'Live'));
        btn.addEventListener('click', function () { openCollectionItem(colId, item.slug); });
        li.appendChild(btn);
        list.appendChild(li);
      });
    });
  }

  function newCollectionItem() {
    var schema = collectionsList.find(function (c) { return c.id === activeCollectionId; });
    var defaultFields = {};
    if (schema && schema.fields) {
      schema.fields.forEach(function (f) {
        defaultFields[f.key] = f.default !== undefined ? f.default : '';
      });
    }
    activeColItem = {
      slug: '',
      title: '',
      folderId: foldersList.length ? foldersList[0].id : '',
      fields: defaultFields,
      seo: { title: '', description: '', image: '', jsonLd: null },
      draft: false
    };
    currentColSlug = 'new';
    showCollectionEditor();
  }

  function openCollectionItem(colId, slug) {
    api('GET', '/api/collections/' + colId + '/items/' + encodeURIComponent(slug)).then(function (r) {
      if (!r.ok) return;
      activeColItem = r.data.item;
      currentColSlug = slug;
      showCollectionEditor();
    });
  }

  function showCollectionEditor() {
    // Hide standard page editor and limits
    $('editor').hidden = true;
    $('checks-panel').hidden = true;
    $('limits-editor').hidden = true;
    var layout = document.querySelector('.layout');
    if (layout) layout.classList.add('limits-active');

    // Deselect page buttons & limits button
    var pageBtns = document.querySelectorAll('#page-list button');
    Array.prototype.forEach.call(pageBtns, function (b) { b.removeAttribute('aria-current'); });
    var btnLim = $('btn-limits');
    if (btnLim) btnLim.removeAttribute('aria-current');

    // Update collection list active state
    loadCollectionItems(activeCollectionId);

    $('col-editor').hidden = false;
    $('col-save-status').textContent = '';
    var schema = collectionsList.find(function (c) { return c.id === activeCollectionId; }) || { name: activeCollectionId, fields: [] };
    $('col-name-label').textContent = schema.name || activeCollectionId;
    $('col-editor-title').textContent = (currentColSlug === 'new' ? 'New ' : 'Editing ') + (schema.name ? schema.name.slice(0, -1) : 'Item');

    var btnDel = $('btn-delete-col-item');
    if (btnDel) btnDel.style.display = currentColSlug === 'new' ? 'none' : 'inline-block';

    $('col-slug').value = activeColItem.slug || '';
    $('col-folder-select').value = activeColItem.folderId || '';
    $('col-draft').checked = !!activeColItem.draft;

    var seo = activeColItem.seo || {};
    $('col-seo-title').value = seo.title || '';
    $('col-seo-desc').value = seo.description || '';
    $('col-seo-image').value = seo.image || '';
    $('col-json-ld').value = seo.jsonLd ? JSON.stringify(seo.jsonLd, null, 2) : '';

    renderDynamicCustomFields(schema, activeColItem.fields || {});
    updateColPathPreview();
  }

  function updateColPathPreview() {
    var folderId = $('col-folder-select').value;
    var slug = $('col-slug').value.trim() || 'my-item';
    var folder = foldersList.find(function (f) { return f.id === folderId; });
    var path = folder && folder.fullPath ? '/' + folder.fullPath + '/' + slug + '/' : '/' + slug + '/';
    var base = settings.site_url || 'https://[TO BE CONFIRMED]';
    $('col-path-preview').textContent = base + path;
  }

  function renderDynamicCustomFields(schema, values) {
    var cont = $('col-custom-fields');
    cont.textContent = '';
    if (!schema.fields || schema.fields.length === 0) {
      cont.appendChild(el('p', { class: 'hint-text' }, 'No custom fields configured for this collection.'));
      return;
    }

    schema.fields.forEach(function (f) {
      var wrap = el('div', { class: 'field-item' });
      var id = 'col-f-' + f.key;
      var lbl = el('label', { for: id }, f.label + (f.required ? ' *' : ''));
      wrap.appendChild(lbl);

      var curVal = values[f.key] !== undefined ? values[f.key] : (f.default !== undefined ? f.default : '');

      if (f.type === 'text') {
        var inp = el('input', { type: 'text', id: id, value: curVal });
        inp.addEventListener('input', function () {
          values[f.key] = inp.value;
          if (f.key === 'title' && currentColSlug === 'new' && !$('col-slug').value) {
            $('col-slug').value = inp.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            updateColPathPreview();
          }
        });
        wrap.appendChild(inp);
      } else if (f.type === 'textarea') {
        var ta = el('textarea', { id: id, rows: '3' });
        ta.value = curVal;
        ta.addEventListener('input', function () { values[f.key] = ta.value; });
        wrap.appendChild(ta);
      } else if (f.type === 'richtext') {
        var rta = el('textarea', { id: id, class: 'richtext-textarea', rows: '6' });
        rta.value = curVal;
        rta.addEventListener('input', function () { values[f.key] = rta.value; });
        wrap.appendChild(rta);
        wrap.appendChild(el('p', { class: 'field-desc' }, 'Accepts markdown or clean HTML markup.'));
      } else if (f.type === 'image') {
        var imgInp = el('input', { type: 'text', id: id, placeholder: '/images/... or https://...', value: curVal });
        var preview = el('img', { class: 'field-input-img-preview' });
        if (curVal) { preview.src = curVal; preview.style.display = 'block'; }
        imgInp.addEventListener('input', function () {
          values[f.key] = imgInp.value;
          if (imgInp.value) {
            preview.src = imgInp.value;
            preview.style.display = 'block';
          } else {
            preview.style.display = 'none';
          }
        });
        wrap.appendChild(imgInp);
        wrap.appendChild(preview);
      } else if (f.type === 'boolean') {
        var chkLabel = el('label', { class: 'check' });
        var chk = el('input', { type: 'checkbox', id: id });
        chk.checked = !!curVal;
        chk.addEventListener('change', function () { values[f.key] = chk.checked; });
        chkLabel.appendChild(chk);
        chkLabel.appendChild(document.createTextNode(' ' + (f.description || f.label)));
        wrap.replaceChild(chkLabel, lbl);
      } else if (f.type === 'number') {
        var numInp = el('input', { type: 'number', id: id, value: String(curVal) });
        numInp.addEventListener('input', function () { values[f.key] = parseFloat(numInp.value) || 0; });
        wrap.appendChild(numInp);
      } else if (f.type === 'date') {
        var dateInp = el('input', { type: 'date', id: id, value: curVal });
        dateInp.addEventListener('change', function () { values[f.key] = dateInp.value; });
        wrap.appendChild(dateInp);
      } else if (f.type === 'select') {
        var sel = el('select', { id: id });
        (f.options || []).forEach(function (optVal) {
          var o = el('option', { value: optVal }, optVal);
          if (optVal === curVal) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () { values[f.key] = sel.value; });
        wrap.appendChild(sel);
      }

      if (f.description && f.type !== 'boolean') {
        wrap.appendChild(el('p', { class: 'field-desc' }, f.description));
      }
      cont.appendChild(wrap);
    });
  }

  function saveCollectionItem() {
    var btn = $('btn-save-col-item');
    btn.disabled = true;
    var status = $('col-save-status');
    status.textContent = 'Saving...';

    var slug = $('col-slug').value.trim();
    if (!slug) {
      status.textContent = 'Error: Slug is required.';
      btn.disabled = false;
      return;
    }

    var jsonLdRaw = $('col-json-ld').value.trim();
    var jsonLdParsed = null;
    if (jsonLdRaw) {
      try {
        jsonLdParsed = JSON.parse(jsonLdRaw);
      } catch (err) {
        status.textContent = 'Error: Invalid JSON-LD syntax.';
        btn.disabled = false;
        return;
      }
    }

    var payload = {
      slug: slug,
      title: (activeColItem.fields && activeColItem.fields.title) || (activeColItem.fields && activeColItem.fields.name) || slug,
      folderId: $('col-folder-select').value || null,
      draft: $('col-draft').checked,
      fields: activeColItem.fields || {},
      seo: {
        title: $('col-seo-title').value.trim(),
        description: $('col-seo-desc').value.trim(),
        image: $('col-seo-image').value.trim(),
        jsonLd: jsonLdParsed
      }
    };

    api('PUT', '/api/collections/' + activeCollectionId + '/items/' + encodeURIComponent(slug), payload).then(function (r) {
      btn.disabled = false;
      if (r.ok && r.data.saved) {
        status.textContent = 'Item saved successfully!';
        currentColSlug = slug;
        loadCollectionItems(activeCollectionId);
        $('btn-delete-col-item').style.display = 'inline-block';
      } else {
        status.textContent = 'Error: ' + ((r.data && r.data.error) || 'Failed to save item.');
      }
    });
  }

  function deleteCollectionItem() {
    if (!currentColSlug || currentColSlug === 'new') return;
    if (!confirm('Are you sure you want to delete this item? This action is permanent.')) return;
    api('DELETE', '/api/collections/' + activeCollectionId + '/items/' + encodeURIComponent(currentColSlug)).then(function (r) {
      if (r.ok && r.data.deleted) {
        currentColSlug = null;
        activeColItem = null;
        $('col-editor').hidden = true;
        loadCollectionItems(activeCollectionId);
      }
    });
  }

  /* ── Header Usage Limitation Bar ── */
  function updateUsageWidget() {
    api('GET', '/api/limits').then(function (r) {
      if (!r.ok) return;
      var limits = r.data.limits || {};
      var dailyLimit = (limits.free && limits.free.daily) ? limits.free.daily : 50;
      var currentUsage = parseInt(localStorage.getItem('amk_demo_scrapes') || '12', 10);
      var pct = Math.min(100, Math.round((currentUsage / dailyLimit) * 100));
      var textEl = $('hdr-usage-text');
      var fillEl = $('hdr-usage-fill');
      if (textEl) textEl.textContent = currentUsage + ' / ' + dailyLimit;
      if (fillEl) {
        fillEl.style.width = pct + '%';
        fillEl.className = 'progress-fill ' + (pct < 50 ? 'green' : (pct < 80 ? 'yellow' : 'red'));
      }
    });
  }

  /* ── Start ── */
  ['f-title', 'f-desc', 'f-slug', 'f-canonical', 'f-og-title', 'f-og-desc', 'f-og-image'].forEach(function (id) {
    $(id).addEventListener('input', changed);
  });
  $('f-noindex').addEventListener('change', changed);
  $('f-draft').addEventListener('change', changed);
  $('btn-add').addEventListener('click', addBlock);
  $('btn-save').addEventListener('click', save);
  $('btn-build').addEventListener('click', build);
  $('btn-new').addEventListener('click', newPage);
  $('btn-limits').addEventListener('click', openLimits);
  $('btn-save-limits').addEventListener('click', saveLimits);
  $('lim-tester-unlimited').addEventListener('change', function () {
    $('tester-caps-row').style.opacity = this.checked ? '0.5' : '1';
  });

  // Collections UI listeners
  $('btn-new-item').addEventListener('click', newCollectionItem);
  $('btn-save-col-item').addEventListener('click', saveCollectionItem);
  $('btn-delete-col-item').addEventListener('click', deleteCollectionItem);
  $('col-slug').addEventListener('input', updateColPathPreview);
  $('col-folder-select').addEventListener('change', updateColPathPreview);

  var colTabs = document.querySelectorAll('.col-tab-btn');
  Array.prototype.forEach.call(colTabs, function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(colTabs, function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var col = btn.getAttribute('data-col');
      loadCollectionItems(col);
    });
  });

  api('GET', '/api/settings').then(function (r) {
    settings = r.data;
    loadCollections();
    updateUsageWidget();
    return loadPages();
  });
})();
