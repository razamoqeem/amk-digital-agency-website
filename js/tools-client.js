/* KivoReach Website: shared code for the tool pages.
   Talks to the tools service, shows the free runs left, and shows the email
   step and the "Continue in the App" step when a limit is reached.
   A page needs two elements: #runs-line and #gate-panel. */
'use strict';

  // Address of the tools service, from js/config.js, or defaults to current origin.
  const TOOLS_API = (window.AMK_SITE && /^https?:\/\//.test(window.AMK_SITE.apiUrl || ''))
    ? window.AMK_SITE.apiUrl.replace(/\/+$/, '') : (window.location && window.location.origin ? window.location.origin : '');


  // ── Tools service ────────────────────────────────────────
  const TOOL_NAMES = { 'seo-audit': 'SEO audit', 'site-scan': 'Page and site scan', 'domain-age': 'Domain age', 'domain-rank': 'Domain rank', 'domain-overview': 'Domain overview',
    'meta-tags': 'Meta tags', 'headings': 'Headings', 'images': 'Images', 'links': 'Links', 'redirects': 'Redirects',
    'robots-sitemap': 'Robots and sitemap', 'ssl-check': 'SSL', 'schema-social': 'Schema and social tags',
    'keyword-density': 'Keyword density', 'technology': 'Technology' };

  function timeLeft(iso) {
    const ms = new Date(iso) - new Date();
    if (!(ms > 0)) return 'a moment';
    const h = Math.floor(ms / 3600000), m = Math.ceil((ms % 3600000) / 60000);
    return h >= 48 ? Math.ceil(h / 24) + ' days' : h >= 1 ? h + ' h ' + m + ' min' : m + ' min';
  }

  // The usage panel: one headline (runs left now), then one row per limit, all worded the
  // same way ("X used · Y left of Z"), and a bar for whichever limit runs out first.
  function showRuns(all) {
    const line = document.getElementById('runs-line');
    if (!line || !all) return;
    const only = line.dataset.tool;
    const first = all[only] || all[Object.keys(all)[0]];
    const lim = first && first.limits;
    if (!lim) return;

    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    line.textContent = '';

    if (!lim.enforced) {
      line.appendChild(el('span', '', (lim.tier === 'tester' ? 'Tester access: limits are off.' : 'Limits are off.') +
        ' Runs counted today: ' + ((lim.daily && lim.daily.used) || 0)));
      line.hidden = false;
      return;
    }

    // Each limit that is switched on, in the order a visitor cares about.
    const rows = [
      ['This tool today', lim.tool_daily],
      ['All tools today', lim.daily],
      ['This visit', lim.session],
      ['This month', lim.monthly]
    ].filter(r => r[1] && r[1].limit > 0);
    if (!rows.length) return;

    // The limit that runs out first decides how many runs are left right now.
    const tight = rows.reduce((a, b) => (b[1].remaining < a[1].remaining ? b : a));
    const left = Math.max(0, tight[1].remaining || 0);

    const box = el('div', 'usage-progress-container');
    const head = el('div', 'usage-progress-label');
    const h = el('span');
    h.appendChild(document.createTextNode('Free runs left now: '));
    h.appendChild(el('strong', '', String(left)));
    head.appendChild(h);
    if (tight[1].resets_at) head.appendChild(el('span', '', 'Resets in ' + timeLeft(tight[1].resets_at)));
    box.appendChild(head);

    const used = tight[1].limit - left;
    const pct = Math.min(100, Math.round((used / tight[1].limit) * 100));
    const track = el('div', 'usage-progress-track');
    const fill = el('div', 'usage-progress-fill ' + (pct < 50 ? 'green' : pct < 80 ? 'yellow' : 'red'));
    fill.style.width = pct + '%';
    track.appendChild(fill);
    box.appendChild(track);

    const list = el('ul', 'usage-rows');
    rows.forEach(([label, p]) => {
      const li = el('li', p === tight[1] ? 'is-tight' : '');
      li.appendChild(el('span', '', label));
      li.appendChild(el('span', '', (p.used || 0) + ' used · ' + Math.max(0, p.remaining || 0) + ' left of ' + p.limit));
      list.appendChild(li);
    });
    box.appendChild(list);
    if (lim.warning) box.appendChild(el('p', 'usage-warning', lim.warning));

    line.appendChild(box);
    line.hidden = false;
  }

  // Shown when a daily, monthly, per-tool or per-visit limit stops a run.
  function showLimitGate(message, lim, upgradeUrl) {
    const which = lim && lim.blocked_by;
    const resets = which && lim[which] && lim[which].resets_at;
    if (resets) { try { localStorage.setItem('amk_limit_until', resets); } catch (e) { /* optional */ } }
    gate(panel => {
      const names = { daily: 'Daily limit reached', monthly: 'Monthly limit reached', tool_daily: 'Daily limit for this tool reached', session: 'Limit for one visit reached' };
      panel.appendChild(mk('strong', names[which] || 'Limit reached'));
      panel.appendChild(mk('p', message, 'margin:8px 0; color:var(--text);'));
      if (resets) {
        const wait = mk('p', '', 'margin:8px 0; color:var(--text); font-weight:700;');
        const tick = () => { wait.textContent = 'Time until your allowance refreshes: ' + timeLeft(resets); };
        tick(); setInterval(tick, 30000);
        panel.appendChild(wait);
      }
      if (/^https?:\/\//.test(upgradeUrl || '')) {
        panel.appendChild(mk('p', 'Do not want to wait? Continue in the KivoReach Studio.', 'margin:8px 0 12px; color:var(--text);'));
        const link = mk('a', 'Continue in the App', 'display:inline-block;');
        link.href = upgradeUrl; link.className = 'btn-primary';
        panel.appendChild(link);
      }
    });
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
        panel.appendChild(mk('p', 'Create an account in the KivoReach Studio to keep going.', 'margin:8px 0 12px; color:var(--text);'));
        const link = mk('a', 'Continue in the App', 'display:inline-block;');
        link.href = upgradeUrl; link.className = 'btn-primary';
        panel.appendChild(link);
      } else {
        panel.appendChild(mk('p', 'The KivoReach Studio is not open yet. Please check back soon.', 'margin-top:8px; color:var(--text);'));
      }
    });
  }

  // Runs one tool. Returns its data, or throws an Error with a plain message.
  async function callTool(tool, body) {
    let res, json;
    // Bot check: a fresh single-use token for each run, when the check is switched on (js/config.js).
    const payload = Object.assign({}, body);
    if (window.AMKBot && window.AMKBot.enabled) {
      try { payload.turnstile_token = await window.AMKBot.token(); }
      catch (e) { throw new Error('The security check could not finish. Please reload the page and try again.'); }
    }
    try {
      res = await fetch(TOOLS_API + '/v1/tools/' + tool, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
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
    if (json.error && json.error.code === 'limit_reached') showLimitGate(message, json.runs && json.runs.limits, json.upgrade_url);
    throw new Error(message);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!TOOLS_API) return;
    loadRuns();
    try {
      const until = localStorage.getItem('amk_limit_until');
      if (until && new Date(until) <= new Date()) {
        localStorage.removeItem('amk_limit_until');
        gate(panel => panel.appendChild(mk('strong', "Your usage allowance has been refreshed. You're ready to continue!")));
      }
    } catch (e) { /* optional */ }
    const confirmed = new URLSearchParams(location.search).get('confirmed');
    if (confirmed === '1') gate(panel => panel.appendChild(mk('strong', 'Email confirmed. Your extra free runs are now active.')));
    if (confirmed === '0') gate(panel => panel.appendChild(mk('strong', 'That confirmation link is no longer valid. Please ask for a new one.')));
  });

