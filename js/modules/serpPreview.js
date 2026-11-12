const SerpPreview = (() => {
  let mode = 'desktop';
  let _state = { url: '', domain: '', title: '', description: '', schemaTypes: [] };

  function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="glass-card" style="padding: 24px; margin-bottom: 24px; border: 1px solid var(--border-glass);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; flex-wrap:wrap; gap:16px;">
          <h4 style="margin:0; color:var(--text); font-family:var(--font-head); font-size:18px;">Live SERP Snippet Analysis</h4>
          <div class="device-toggles" style="display:flex; gap:4px; background:var(--bg-alt); padding:4px; border-radius:var(--radius-full); border: 1px solid var(--border);">
            <button id="sp-desk-btn" style="border:none; background:#fff; border-radius:var(--radius-full); padding:6px 14px; font-size:12px; font-weight:700; cursor:pointer; color:var(--accent); box-shadow:var(--shadow-sm); transition:all 0.2s;">💻 Desktop</button>
            <button id="sp-mob-btn" style="border:none; background:transparent; border-radius:var(--radius-full); padding:6px 14px; font-size:12px; font-weight:700; cursor:pointer; color:var(--text-muted); transition:all 0.2s;">📱 Mobile</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
          <div class="sp-editor" style="display:flex; flex-direction:column; gap:16px;">
            <div>
              <label style="display:block; font-size:12px; font-weight:700; color:var(--text-muted); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.05em;">Meta Title <span id="sp-title-count" style="float:right;">0/60</span></label>
              <input type="text" id="sp-title-input" name="seo_meta_title_field" autocomplete="off" spellcheck="false" value="" placeholder="Run an audit to load this page's title…" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:var(--radius-md); font-size:14px; outline:none; background:var(--bg); color:var(--text); transition:border 0.2s;">
            </div>
            <div>
              <label style="display:block; font-size:12px; font-weight:700; color:var(--text-muted); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.05em;">Meta Description <span id="sp-desc-count" style="float:right;">0/160</span></label>
              <textarea id="sp-desc-input" name="seo_meta_desc_field" autocomplete="off" spellcheck="false" rows="4" placeholder="Run an audit to load this page's meta description…" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:var(--radius-md); font-size:14px; font-family:inherit; outline:none; background:var(--bg); color:var(--text); transition:border 0.2s; resize:vertical;"></textarea>
            </div>
          </div>

          <div class="sp-preview-wrapper" style="background:#fff; border:1px solid var(--border); border-radius:var(--radius-lg); padding:24px; display:flex; justify-content:center; align-items:flex-start; overflow:hidden; box-shadow: inset 0 2px 10px rgba(0,0,0,0.02);">
            <div id="sp-preview-box" style="width:600px; max-width:100%; transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);">
              <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
                <div style="width:28px; height:28px; background:var(--bg-alt); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px;">🌐</div>
                <div>
                  <div id="sp-preview-domain" style="font-size:14px; color:#202124;">Your website</div>
                  <div id="sp-preview-url" style="font-size:12px; color:#4d5156;">https://your-website.com</div>
                </div>
              </div>
              <div id="sp-preview-title" style="color:#1a0dab; font-size:20px; cursor:pointer; font-family:arial,sans-serif; margin-bottom:4px; line-height:1.3;"></div>
              <div id="sp-preview-desc" style="color:#4d5156; font-size:14px; line-height:1.58; font-family:arial,sans-serif;"></div>
            </div>
          </div>
        </div>

        <!-- SERP feature / snippet-type analysis -->
        <div id="sp-snippet-analysis" style="margin-top:22px; border-top:1px solid var(--border); padding-top:18px;">
          <div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:10px;">SERP Feature Eligibility</div>
          <div id="sp-features" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
          <div id="sp-suggestions" style="margin-top:14px; display:flex; flex-direction:column; gap:8px;"></div>
        </div>
      </div>
    `;

    bindEvents();
    updatePreview();
    analyzeSnippet();
  }

  /** Populate the preview from real audit data (URL, title, description, schema types). */
  function populate(data) {
    if (!data) return;
    let url = data.url || data.URL || '';
    let domain = url;
    try { domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, ''); }
    catch (e) { domain = (url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; }

    _state = {
      url: url || _state.url,
      domain: domain || _state.domain,
      title: (data.title || data.Title || '').replace(/^MISSING$/, ''),
      description: (data.description || data['Meta Description'] || '').replace(/^MISSING$/, ''),
      schemaTypes: data.schemaTypes || data.schema_types || [],
    };

    const ti = document.getElementById('sp-title-input');
    const di = document.getElementById('sp-desc-input');
    const dom = document.getElementById('sp-preview-domain');
    const u = document.getElementById('sp-preview-url');
    if (ti) ti.value = _state.title;
    if (di) di.value = _state.description;
    if (dom) dom.textContent = _state.domain || 'Your website';
    if (u) u.textContent = _state.url || ('https://' + (_state.domain || 'your-website.com'));
    updatePreview();
    analyzeSnippet();
  }

  function bindEvents() {
    const titleInput = document.getElementById('sp-title-input');
    const descInput = document.getElementById('sp-desc-input');
    const deskBtn = document.getElementById('sp-desk-btn');
    const mobBtn = document.getElementById('sp-mob-btn');

    titleInput.addEventListener('input', () => { updatePreview(); analyzeSnippet(); });
    descInput.addEventListener('input', () => { updatePreview(); analyzeSnippet(); });

    deskBtn.addEventListener('click', () => {
      mode = 'desktop';
      deskBtn.style.background = '#fff'; deskBtn.style.color = 'var(--accent)'; deskBtn.style.boxShadow = 'var(--shadow-sm)';
      mobBtn.style.background = 'transparent'; mobBtn.style.color = 'var(--text-muted)'; mobBtn.style.boxShadow = 'none';
      document.getElementById('sp-preview-box').style.width = '600px';
      updatePreview();
    });

    mobBtn.addEventListener('click', () => {
      mode = 'mobile';
      mobBtn.style.background = '#fff'; mobBtn.style.color = 'var(--accent)'; mobBtn.style.boxShadow = 'var(--shadow-sm)';
      deskBtn.style.background = 'transparent'; deskBtn.style.color = 'var(--text-muted)'; deskBtn.style.boxShadow = 'none';
      document.getElementById('sp-preview-box').style.width = '375px';
      updatePreview();
    });
  }

  function updatePreview() {
    const titleStr = (document.getElementById('sp-title-input') || {}).value || '';
    const descStr = (document.getElementById('sp-desc-input') || {}).value || '';
    const titleLimit = 60;
    const descLimit = mode === 'desktop' ? 160 : 125;
    const truncTitle = titleStr.length > titleLimit ? titleStr.substring(0, titleLimit) + '…' : titleStr;
    const truncDesc = descStr.length > descLimit ? descStr.substring(0, descLimit) + '…' : descStr;

    document.getElementById('sp-preview-title').textContent = truncTitle || 'Add a title';
    document.getElementById('sp-preview-desc').textContent = truncDesc || 'Add a description';

    const tc = document.getElementById('sp-title-count');
    tc.innerHTML = `${titleStr.length}/${titleLimit} <span style="font-size:10px;">chars</span>`;
    const dc = document.getElementById('sp-desc-count');
    dc.innerHTML = `${descStr.length}/${descLimit} <span style="font-size:10px;">chars</span>`;

    const titleInput = document.getElementById('sp-title-input');
    const descInput = document.getElementById('sp-desc-input');
    if (titleStr.length > titleLimit) { tc.style.color = 'var(--accent-error)'; titleInput.style.borderColor = 'var(--accent-error)'; }
    else if (titleStr.length < 50) { tc.style.color = 'var(--accent-warn)'; titleInput.style.borderColor = 'var(--accent-warn)'; }
    else { tc.style.color = 'var(--accent-success)'; titleInput.style.borderColor = 'var(--accent-success)'; }

    const minDesc = mode === 'desktop' ? 125 : 110;
    if (descStr.length > descLimit) { dc.style.color = 'var(--accent-error)'; descInput.style.borderColor = 'var(--accent-error)'; }
    else if (descStr.length < minDesc) { dc.style.color = 'var(--accent-warn)'; descInput.style.borderColor = 'var(--accent-warn)'; }
    else { dc.style.color = 'var(--accent-success)'; descInput.style.borderColor = 'var(--accent-success)'; }
  }

  /** Detect which SERP feature/snippet this page is eligible for + suggest more. */
  function analyzeSnippet() {
    const featEl = document.getElementById('sp-features');
    const sugEl = document.getElementById('sp-suggestions');
    if (!featEl || !sugEl) return;

    const title = ((document.getElementById('sp-title-input') || {}).value || '').toLowerCase();
    const desc = ((document.getElementById('sp-desc-input') || {}).value || '').toLowerCase();
    const schema = (_state.schemaTypes || []).map(s => String(s).toLowerCase());
    const has = t => schema.some(s => s.includes(t));
    const isQuestion = /\b(how|what|why|when|where|who|which|is|are|can|does|do)\b/.test(title) || title.includes('?');

    // [name, eligible(bool), how]
    const features = [
      ['Standard Snippet', true, 'Your title + meta description (always shown).'],
      ['Featured Snippet (Position 0)', isQuestion || /\b(guide|how to|steps|best)\b/.test(title),
        'Answer a question concisely (40-60 words) right after a clear H2.'],
      ['FAQ Rich Result', has('faq'), 'Add FAQPage schema with question/answer pairs.'],
      ['Review / Star Rating', has('review') || has('aggregaterating') || has('product'),
        'Add Review/AggregateRating (or Product) schema.'],
      ['Breadcrumbs', has('breadcrumb'), 'Add BreadcrumbList schema for a cleaner URL path.'],
      ['Sitelinks', has('organization') || has('website'),
        'Strong site structure + Organization schema improve sitelink chances.'],
      ['How-To Rich Result', has('howto') || /how to/.test(title), 'Add HowTo schema with ordered steps.'],
      ['Article Rich Result', has('article') || has('blogposting') || has('newsarticle'),
        'Add Article schema (headline, author, datePublished).'],
    ];

    featEl.innerHTML = features.map(f => {
      const ok = f[1];
      const bg = ok ? 'rgba(29,209,161,.14)' : 'rgba(154,160,184,.12)';
      const col = ok ? 'var(--accent-success)' : 'var(--text-muted)';
      return `<span title="${f[2].replace(/"/g, '')}" style="display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;font-size:12px;font-weight:700;background:${bg};color:${col};">${ok ? '✓' : '○'} ${f[0]}</span>`;
    }).join('');

    // Suggestions: only for features NOT yet eligible (top 3).
    const missing = features.filter(f => !f[1]).slice(0, 3);
    sugEl.innerHTML = missing.length
      ? missing.map(f => `<div style="font-size:13px;color:var(--text); background:rgba(108,99,255,.07); border-radius:8px; padding:8px 12px;"><b style="color:var(--accent);">Unlock ${f[0]}:</b> ${f[2]}</div>`).join('')
      : '<div style="font-size:13px;color:var(--accent-success);">🎉 This page is eligible for all the common SERP features.</div>';
  }

  return { init, populate };
})();
