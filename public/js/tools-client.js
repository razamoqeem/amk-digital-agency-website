/* AMK Digital Agency Website: shared code for the tool pages.
   Talks to the tools service, shows the free runs left, and shows the email
   step and the "Continue in the App" step when a limit is reached.
   A page needs two elements: #runs-line and #gate-panel. */
'use strict';

  // Address of the tools service, from js/config.js. Empty until that service exists.
  const TOOLS_API = (window.AMK_SITE && /^https?:\/\//.test(window.AMK_SITE.apiUrl || ''))
    ? window.AMK_SITE.apiUrl.replace(/\/+$/, '') : '';


  // ── Tools service ────────────────────────────────────────
  const TOOL_NAMES = { 'seo-audit': 'SEO audit', 'site-scan': 'Page and site scan', 'domain-age': 'Domain age', 'domain-rank': 'Domain rank', 'domain-overview': 'Domain overview',
    'meta-tags': 'Meta tags', 'headings': 'Headings', 'images': 'Images', 'links': 'Links', 'redirects': 'Redirects',
    'robots-sitemap': 'Robots and sitemap', 'ssl-check': 'SSL', 'schema-social': 'Schema and social tags',
    'keyword-density': 'Keyword density', 'technology': 'Technology' };

  function showRuns(all) {
    const line = document.getElementById('runs-line');
    if (!line || !all) return;
    const only = line.dataset.tool;      // a page for one tool shows only that tool
    // The page with several tools lists only its own tools.
    const mine = ['seo-audit', 'site-scan', 'domain-age', 'domain-rank'];
    line.textContent = 'Free runs left: ' + Object.keys(TOOL_NAMES)
      .filter(t => all[t] && (only ? t === only : mine.includes(t))).map(t => TOOL_NAMES[t] + ' ' + all[t].remaining + ' of ' + all[t].limit).join('  ·  ');
    line.hidden = false;
  }
  const RUNS = {};
  async function loadRuns() {
    try {
      const res = await fetch(TOOLS_API + '/v1/usage', { credentials: 'include' });
      const json = await res.json();
      if (json.ok) {
        Object.assign(RUNS, json.runs); showRuns(RUNS);
        const rankCard = document.getElementById('card-rank');
        if (rankCard && json.runs['domain-rank']) rankCard.hidden = false;
      }
    } catch (e) { /* the status line simply stays hidden */ }
  }

  function gate(build) {
    const panel = document.getElementById('gate-panel');
    panel.textContent = '';
    build(panel);
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function mk(tag, text, style) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (style) node.style.cssText = style;
    return node;
  }

  function showEmailGate(tool, message) {
    gate(panel => {
      panel.appendChild(mk('strong', message));
      const form = mk('form', '', 'display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;');
      const input = mk('input', '', 'flex:1; min-width:220px;');
      input.type = 'email'; input.required = true; input.className = 'tool-input';
      input.placeholder = 'you@example.com'; input.setAttribute('aria-label', 'Email address');
      const btn = mk('button', 'Send confirmation link', 'width:auto;');
      btn.type = 'submit'; btn.className = 'tool-run-btn';
      const note = mk('p', '', 'margin-top:10px; font-size:13px; color:var(--muted);');
      const priv = mk('p', 'We use your email to send the confirmation link and to count your free runs.', 'margin-top:10px; font-size:13px; color:var(--muted);');
      form.append(input, btn);
      panel.append(form, priv, note);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        btn.disabled = true;
        try {
          const res = await fetch(TOOLS_API + '/v1/leads', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: input.value, tool })
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error.message);
          note.textContent = json.delivery === 'local_window'
            ? 'Local test mode: email sending is not connected yet. Open the confirmation link shown in the Website window on this computer.'
            : 'Check your inbox and open the confirmation link.';
        } catch (err) {
          note.textContent = err.message || 'That did not work. Please try again.';
          btn.disabled = false;
        }
      });
    });
  }

  function showUpgradeGate(message, upgradeUrl) {
    gate(panel => {
      panel.appendChild(mk('strong', message));
      if (/^https?:\/\//.test(upgradeUrl || '')) {
        panel.appendChild(mk('p', 'Create an account in the AMK Digital Agency App to keep going.', 'margin:8px 0 12px; color:var(--text);'));
        const link = mk('a', 'Continue in the App', 'display:inline-block;');
        link.href = upgradeUrl; link.className = 'btn-primary';
        panel.appendChild(link);
      } else {
        panel.appendChild(mk('p', 'The AMK Digital Agency App is not open yet. Please check back soon.', 'margin-top:8px; color:var(--text);'));
      }
    });
  }

  // Runs one tool. Returns its data, or throws an Error with a plain message.
  async function callTool(tool, body) {
    let res, json;
    try {
      res = await fetch(TOOLS_API + '/v1/tools/' + tool, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      json = await res.json();
    } catch (e) {
      throw new Error('The tools are temporarily unavailable. Please try again soon.');
    }
    if (json.runs) { RUNS[tool] = json.runs; showRuns(RUNS); }
    if (json.ok) return json.data;
    const message = (json.error && json.error.message) || 'That did not work. Please try again.';
    if (json.error && json.error.code === 'email_required') showEmailGate(tool, message);
    if (json.error && json.error.code === 'upgrade_required') showUpgradeGate(message, json.upgrade_url);
    throw new Error(message);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!TOOLS_API) return;
    loadRuns();
    const confirmed = new URLSearchParams(location.search).get('confirmed');
    if (confirmed === '1') gate(panel => panel.appendChild(mk('strong', 'Email confirmed. Your extra free runs are now active.')));
    if (confirmed === '0') gate(panel => panel.appendChild(mk('strong', 'That confirmation link is no longer valid. Please ask for a new one.')));
  });

