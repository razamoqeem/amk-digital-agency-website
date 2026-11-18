/* Moved out of free-tools.html so the page works under the strict security policy. */

  'use strict';

  // ── Shared helpers ───────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    if (TOOLS_API) return;
    var notice = document.getElementById('tools-unavailable');
    if (notice) notice.hidden = false;
    document.querySelectorAll('.tool-card button').forEach(function (btn) {
      btn.disabled = true;
      btn.title = 'Temporarily unavailable';
    });
  });

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function setLoading(id, on) {
    document.getElementById(id + '-loading').classList.toggle('active', on);
    document.getElementById(id + '-result').classList.toggle('active', !on && document.getElementById(id + '-result').dataset.ready === '1');
  }

  function showResult(id) {
    const el = document.getElementById(id + '-result');
    el.dataset.ready = '1';
    el.classList.add('active');
  }

  function normUrl(raw) {
    try {
      let u = raw.trim();
      if (!u.startsWith('http')) u = 'https://' + u;
      return new URL(u).hostname.replace('www.', '');
    } catch { return raw.trim().replace(/^https?:\/\/(www\.)?/, '').split('/')[0]; }
  }

  // Seeded random for consistent results per domain
  function scoreClass(s) {
    return s >= 70 ? 'score-good' : s >= 45 ? 'score-warn' : 'score-bad';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  // ── 0. INSTANT SEO AUDIT (real, live scan) ───────────────
  async function runInstantAudit() {
    const input = document.getElementById('ia-url');
    let raw = input.value.trim();
    if (!raw) { input.focus(); return; }
    let url = raw;
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    input.value = url;

    const btn = document.getElementById('ia-run-btn');
    const errEl = document.getElementById('ia-error');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" class="s-2459925"></span> Scanning…';
    document.getElementById('ia-loading').classList.add('active');
    document.getElementById('ia-result').classList.remove('active');
    errEl.classList.remove('visible');

    try {
      const data = await callTool('seo-audit', { url });

      const score = data.score || 0;
      const el = document.getElementById('ia-score-el');
      el.textContent = score;
      el.className = 'score-circle ' + scoreClass(score);
      document.getElementById('ia-grade').textContent = 'GRADE ' + (data.grade || '—');
      document.getElementById('ia-domain').textContent = data.domain || url;
      document.getElementById('ia-crawler').textContent = data.metrics?.crawler_access || '—';
      document.getElementById('ia-https').textContent = data.metrics?.https || '—';
      document.getElementById('ia-freshness').textContent = data.metrics?.word_count != null ? data.metrics.word_count + ' words' : '—';

      const findings = data.top_findings || [];
      document.getElementById('ia-findings').innerHTML = findings.length
        ? findings.map(f => {
            const sev = ({ critical: 'critical', high: 'high', medium: 'medium', low: 'low' })[String(f.severity || 'LOW').toLowerCase()] || 'low';
            return `<div class="audit-finding"><span class="audit-sev ${sev}">${esc(f.severity)}</span><span>${esc(f.title)}</span></div>`;
          }).join('')
        : '<div class="audit-finding"><span>No issues found by these checks.</span></div>';

      const criticalEl = document.getElementById('ia-critical');
      if (data.most_important_fix) {
        document.getElementById('ia-critical-text').textContent = data.most_important_fix;
        criticalEl.style.display = 'block';
      } else {
        criticalEl.style.display = 'none';
      }

      showResult('ia');
    } catch (err) {
      // The server already sends a complete, plain-language sentence.
      errEl.textContent = String(err.message || 'The audit did not finish. Please try again.');
      errEl.classList.add('visible');
    } finally {
      document.getElementById('ia-loading').classList.remove('active');
      btn.disabled = false;
      btn.innerHTML = '⚡ Run Audit';
    }
  }

  // Auto-run if ?url= is present (matches the previous /tools/seo-audit.html behaviour)
  (function () {
    const qp = new URLSearchParams(location.search).get('url');
    if (qp) {
      document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('ia-url').value = qp;
        runInstantAudit();
      });
    }
  })();

  // ── 1. BACKLINK ANALYSER ─────────────────────────────────
  async function runDomainTool() {
    const raw = document.getElementById('dom-url').value.trim();
    if (!raw) { document.getElementById('dom-url').focus(); return; }
    const domain = normUrl(raw);

    const errEl = document.getElementById('dom-error');
    errEl.style.display = 'none';
    document.getElementById('dom-loading').classList.add('active');
    document.getElementById('dom-result').classList.remove('active');

    try {
      const scan = await callTool('site-scan', { url: raw });
      let age = null;
      try { age = await callTool('domain-age', { domain }); } catch (e) { age = null; }
      document.getElementById('dom-loading').classList.remove('active');

      const sec = scan.security || {};
      const crawl = scan.crawlability || {};
      const tech = scan.tech_stack || {};
      const ageYears = age ? Math.floor(age.age_days / 365) : null;

      const checks = [sec.https, sec.ssl_valid, crawl.robots_txt, (crawl.sitemaps || []).length > 0];
      const passed = checks.filter(Boolean).length;
      const trustEl = document.getElementById('dom-trust-el');
      trustEl.textContent = passed + '/' + checks.length;
      trustEl.className = 'score-circle ' + (passed === checks.length ? 'score-good' : passed >= 2 ? 'score-warn' : 'score-bad');
      document.getElementById('dom-grade').textContent = 'Basic setup checks passed';
      document.getElementById('dom-summary').textContent = (scan.domain || domain) + ': HTTPS, valid certificate, robots.txt, sitemap';
      document.getElementById('dom-age').textContent = ageYears !== null ? (ageYears === 0 ? '< 1 year' : ageYears + ' year' + (ageYears > 1 ? 's' : '')) : 'Unavailable';
      document.getElementById('dom-ssl').innerHTML = sec.https
        ? (sec.ssl_valid ? '<span class="val good">✓ Active SSL</span>' : '<span class="val warn">⚠ HTTPS, SSL issue</span>')
        : '<span class="val bad">✗ Not secure (no HTTPS)</span>';
      document.getElementById('dom-pages').textContent = crawl.sitemap_url_count
        ? crawl.sitemap_url_count.toLocaleString() + ' URLs in sitemap'
        : 'Unknown (no sitemap)';
      document.getElementById('dom-tech').textContent = (tech.detected && tech.detected.length) ? tech.detected.join(', ') : 'Not detected';
      document.getElementById('dom-robots').innerHTML = crawl.robots_txt ? '<span class="val good">✓ Present</span>' : '<span class="val bad">✗ Missing</span>';
      document.getElementById('dom-sitemap').innerHTML = (crawl.sitemaps || []).length ? '<span class="val good">✓ Found</span>' : '<span class="val warn">⚠ Not Found</span>';

      const tagsEl = document.getElementById('dom-tags');
      tagsEl.innerHTML = [
        (ageYears !== null && ageYears >= 3) ? '<span class="tag tag-info">Established Domain</span>' : '<span class="tag tag-warn">Under 3 years or age unknown</span>',
        sec.https ? '<span class="tag tag-info">SSL Active</span>' : '<span class="tag tag-bad">No SSL</span>'
      ].join('');

      showResult('dom');
    } catch (err) {
      document.getElementById('dom-loading').classList.remove('active');
      errEl.style.display = 'block';
      errEl.innerHTML = esc(err.message);
    }
  }

  // ── AI readiness checks ─────────────────────────────────────
  async function runAIEOTool() {
    const raw = document.getElementById('aieo-url').value.trim();
    if (!raw) { document.getElementById('aieo-url').focus(); return; }
    const domain = normUrl(raw);

    const errEl = document.getElementById('aieo-error');
    errEl.style.display = 'none';
    document.getElementById('aieo-loading').classList.add('active');
    document.getElementById('aieo-result').classList.remove('active');

    try {
      const scan = await callTool('site-scan', { url: raw });
      document.getElementById('aieo-loading').classList.remove('active');

      const sd = scan.structured_data || {};
      const llms = scan.llms_txt || {};
      const images = scan.images || {};
      const intl = scan.international || {};
      const social = scan.social || {};
      const onPage = scan.on_page || {};
      const types = sd.types || [];
      const og = social.open_graph || {};

      // Plain yes / no checks from the crawl. No score is modelled on top of them.
      const hasEntity = types.some(t => ['Organization', 'Person', 'LocalBusiness'].includes(t));
      const ogCount = Object.keys(og).length;
      const checks = [!!llms.present, (sd.blocks || 0) > 0, hasEntity, ogCount > 0];
      const passed = checks.filter(Boolean).length;
      const el = document.getElementById('aieo-score-el');
      el.textContent = passed + '/' + checks.length;
      el.className = 'score-circle ' + (passed === checks.length ? 'score-good' : passed >= 2 ? 'score-warn' : 'score-bad');
      document.getElementById('aieo-grade').textContent = 'Checks passed';
      document.getElementById('aieo-summary').textContent = (scan.domain || domain) + ': llms.txt, structured data, organisation or person markup, social preview tags';

      document.getElementById('aieo-llms').innerHTML = llms.present ? '<span class="val good">✓ Present</span>' : '<span class="val bad">✗ Missing — add /llms.txt</span>';
      document.getElementById('aieo-schema').textContent = (sd.blocks || 0) + ' block' + (sd.blocks === 1 ? '' : 's') + ', ' + types.length + ' type' + (types.length === 1 ? '' : 's');
      document.getElementById('aieo-eeat').innerHTML = hasEntity ? '<span class="val good">✓ Found</span>' : '<span class="val warn">Not found</span>';
      document.getElementById('aieo-types').textContent = types.length ? types.join(', ') : 'None found';
      document.getElementById('aieo-og').textContent = ogCount ? ogCount + ' Open Graph tag' + (ogCount === 1 ? '' : 's') : 'None found';
      document.getElementById('aieo-words').textContent = onPage.word_count != null ? onPage.word_count.toLocaleString() + ' words' : '—';

      showResult('aieo');
    } catch (err) {
      document.getElementById('aieo-loading').classList.remove('active');
      errEl.style.display = 'block';
      errEl.innerHTML = esc(err.message);
    }
  }

  // ── Page SEO check ───────────────────────────────────────
  async function runSEOTool() {
    const raw = document.getElementById('seo-url').value.trim();
    const kw = document.getElementById('seo-kw').value.trim();
    if (!raw) { document.getElementById('seo-url').focus(); return; }
    const domain = normUrl(raw);

    const errEl = document.getElementById('seo-error');
    errEl.style.display = 'none';
    document.getElementById('seo-loading').classList.add('active');
    document.getElementById('seo-result').classList.remove('active');

    try {
      const scan = await callTool('site-scan', { url: raw, keyword: kw });
      document.getElementById('seo-loading').classList.remove('active');

      const onPage = scan.on_page || {};
      const images = scan.images || {};
      const sd = scan.structured_data || {};
      const score = scan.score;
      const titleLen = onPage.title_len || 0;
      const descLen = onPage.desc_len || 0;
      const h1Count = onPage.h1_count || 0;
      const wordCount = onPage.word_count || 0;
      const altPct = images.alt_coverage_pct != null ? images.alt_coverage_pct : 100;
      const hasSchema = (sd.blocks || 0) > 0;

      const scoreEl = document.getElementById('seo-score-el');
      scoreEl.textContent = score;
      scoreEl.className = 'score-circle ' + scoreClass(score);
      document.getElementById('seo-grade').textContent = score >= 70 ? 'Well Optimised' : score >= 50 ? 'Needs Work' : 'Critical Issues';
      document.getElementById('seo-summary').textContent = `${scan.domain || domain}`;

      document.getElementById('seo-title').textContent = titleLen + ' chars' + (titleLen >= 50 && titleLen <= 60 ? ' ✓' : titleLen > 60 ? ' (too long)' : ' (too short)');
      document.getElementById('seo-title').className = 'val ' + (titleLen >= 50 && titleLen <= 60 ? 'good' : 'warn');
      document.getElementById('seo-desc').textContent = descLen === 0 ? 'Missing' : descLen + ' chars' + (descLen >= 120 && descLen <= 160 ? ' ✓' : ' — adjust to 120–160');
      document.getElementById('seo-desc').className = 'val ' + (descLen >= 120 && descLen <= 160 ? 'good' : 'warn');
      document.getElementById('seo-h1').innerHTML = h1Count === 1 ? '<span class="val good">✓ Single H1</span>' : h1Count === 0 ? '<span class="val bad">✗ No H1 Found</span>' : '<span class="val warn">⚠ Multiple H1s</span>';
      document.getElementById('seo-words').textContent = wordCount.toLocaleString() + ' words';
      document.getElementById('seo-words').className = 'val ' + (wordCount >= 600 ? 'good' : 'warn');
      document.getElementById('seo-alts').textContent = altPct + '%';
      document.getElementById('seo-alts').className = 'val ' + (altPct >= 80 ? 'good' : altPct >= 50 ? 'warn' : 'bad');
      document.getElementById('seo-schema').innerHTML = hasSchema ? '<span class="val good">✓ Present</span>' : '<span class="val bad">✗ No Schema Markup</span>';

      const issues = [];
      if (titleLen < 50) issues.push('<span class="tag tag-bad">Short Title</span>');
      if (h1Count !== 1) issues.push('<span class="tag tag-bad">H1 Issue</span>');
      if (altPct < 80) issues.push('<span class="tag tag-warn">Missing Alt Text</span>');
      if (!hasSchema) issues.push('<span class="tag tag-warn">Add Schema</span>');
      if (wordCount >= 600) issues.push('<span class="tag tag-good">Good Content Length</span>');
      if (kw && scan.keyword_match) {
        issues.push(scan.keyword_match.in_title
          ? '<span class="tag tag-good">Keyword in Title</span>'
          : '<span class="tag tag-warn">Keyword Missing from Title</span>');
      }
      document.getElementById('seo-tags').innerHTML = issues.join('');

      showResult('seo');
    } catch (err) {
      document.getElementById('seo-loading').classList.remove('active');
      errEl.style.display = 'block';
      errEl.innerHTML = esc(err.message);
    }
  }

  // ── Domain age ──────────────────────────
  async function runAgeTool() {
    const raw = document.getElementById('age-url').value.trim();
    if (!raw) { document.getElementById('age-url').focus(); return; }
    const domain = normUrl(raw);

    const errEl = document.getElementById('age-error');
    errEl.style.display = 'none';
    document.getElementById('age-loading').classList.add('active');
    document.getElementById('age-result').classList.remove('active');

    try {
      const data = await callTool('domain-age', { domain });
      document.getElementById('age-loading').classList.remove('active');

      const regDate = new Date(data.registered_on);
      const expDate = data.expires_on ? new Date(data.expires_on) : null;
      const totalDays = data.age_days;
      const years = Math.floor(totalDays / 365);
      const months = Math.floor((totalDays % 365) / 30);
      const ageLabel = years > 0
        ? `${years} year${years > 1 ? 's' : ''}${months > 0 ? `, ${months} mo` : ''}`
        : `${months} month${months !== 1 ? 's' : ''}`;
      const el = document.getElementById('age-score-el');
      el.textContent = years > 0 ? years + 'y' : months + 'm';
      el.className = 'score-circle ' + (years >= 5 ? 'score-good' : years >= 2 ? 'score-warn' : 'score-bad');
      document.getElementById('age-grade').textContent = years >= 5 ? 'Registered 5+ years ago' : years >= 2 ? 'Registered 2+ years ago' : 'Registered recently';
      document.getElementById('age-summary').textContent = domain;
      document.getElementById('age-reg-date').textContent = regDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      document.getElementById('age-years').textContent = ageLabel;
      document.getElementById('age-expires').textContent = expDate ? expDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not disclosed';
      document.getElementById('age-registrar').textContent = data.registrar || 'Not disclosed';

      document.getElementById('age-tags').innerHTML = [
        '<span class="tag tag-info">Source: ' + (data.source === 'rdap' ? 'registry record (RDAP)' : 'registry record (WHOIS)') + '</span>',
      ].join('');

      showResult('age');
    } catch (err) {
      document.getElementById('age-loading').classList.remove('active');
      errEl.style.display = 'block';
      errEl.innerHTML = esc(err.message);
    }
  }

  // ── Domain rank ──────────────────────────────────────────
  async function runRankTool() {
    const raw = document.getElementById('rank-url').value.trim();
    if (!raw) { document.getElementById('rank-url').focus(); return; }
    const domain = normUrl(raw);
    const errEl = document.getElementById('rank-error');
    errEl.style.display = 'none';
    document.getElementById('rank-loading').classList.add('active');
    document.getElementById('rank-result').classList.remove('active');
    try {
      const data = await callTool('domain-rank', { domain });
      document.getElementById('rank-loading').classList.remove('active');
      const score = Number(data.rank_score);
      const el = document.getElementById('rank-score-el');
      el.textContent = score;
      el.className = 'score-circle ' + (score >= 6 ? 'score-good' : score >= 3 ? 'score-warn' : 'score-bad');
      document.getElementById('rank-summary').textContent = data.domain;
      document.getElementById('rank-position').textContent = data.global_position != null ? '#' + Number(data.global_position).toLocaleString() : 'Not published';
      document.getElementById('rank-refs').textContent = data.referring_domains != null ? Number(data.referring_domains).toLocaleString() : 'Not published';
      document.getElementById('rank-date').textContent = data.data_date || 'Not published';
      showResult('rank');
    } catch (err) {
      document.getElementById('rank-loading').classList.remove('active');
      errEl.style.display = 'block';
      errEl.innerHTML = esc(err.message);
    }
  }
  

/* Buttons that used onclick="fn()" now carry data-run="fn". */
document.querySelectorAll('[data-run]').forEach(function (el) {
  el.addEventListener('click', function (e) { var fn = window[el.getAttribute('data-run')]; if (typeof fn === 'function') fn(e); });
});
