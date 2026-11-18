'use strict';
/* KivoReach Website: the SEO checks (no dependencies).
   Every value is read from a real response. A page that cannot be read gets an error,
   never an invented score. All outside requests go through safe-fetch.js. */
const tls = require('tls');
const net = require('net');
const { parse, clip } = require('./html');
const { safeGet, safeHead, validatePublicUrl, pinnedLookup, FetchError, UnsafeUrlError } = require('./safe-fetch');

class ToolError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const PENALTY = { HIGH: 12, MEDIUM: 6, LOW: 2 };
const SCHEMA_REQUIRED = {
  Article: ['headline', 'author', 'datePublished'], NewsArticle: ['headline', 'author', 'datePublished'], BlogPosting: ['headline', 'author', 'datePublished'],
  Product: ['name', 'offers'], FAQPage: ['mainEntity'], QAPage: ['mainEntity'], BreadcrumbList: ['itemListElement'],
  Organization: ['name', 'url'], LocalBusiness: ['name', 'address'], Person: ['name'], Recipe: ['name', 'recipeIngredient', 'recipeInstructions'],
  Event: ['name', 'startDate', 'location'], VideoObject: ['name', 'thumbnailUrl', 'uploadDate'], Review: ['reviewRating', 'author'], HowTo: ['name', 'step']
};
const MAX_LIST = 200;
const MAX_LINK_CHECKS = 40;

const grade = (s) => (s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 55 ? 'D' : 'F');
const normUrl = (u) => String(u || '').split('#')[0].replace(/\/+$/, '').toLowerCase();
const lower = (headers) => Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v)]));

/* ── Fetching with plain-language errors ─────────────────── */
function httpMessage(code) {
  if (code === 401 || code === 403) return 'The site refused our request (HTTP ' + code + '). It may be blocking automated tools.';
  if (code === 404) return 'That page was not found (HTTP 404). Check the address.';
  if (code === 429) return 'The site is rate-limiting requests (HTTP 429). Try again in a few minutes.';
  if (code >= 500) return 'The site returned a server error (HTTP ' + code + '). Try again later.';
  return 'The page returned an error (HTTP ' + code + ').';
}

async function fetchPage(url, opts = {}) {
  try { return await safeGet(url, { timeout: 12000, ...opts }); }
  catch (e) {
    if (e instanceof FetchError) {
      if (e.kind === 'not_allowed') throw new ToolError(400, 'invalid_url', e.message);
      throw new ToolError(422, 'site_unreachable', e.message);
    }
    throw new ToolError(422, 'site_unreachable', 'The site could not be reached.');
  }
}

async function checkedUrl(text) {
  try {
    const { url } = await validatePublicUrl(String(text || ''));
    return url.protocol + '//' + url.host.toLowerCase() + (url.pathname || '/') + url.search;
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new ToolError(400, 'invalid_url', e.message);
    throw e;
  }
}

/* ── Certificate ─────────────────────────────────────────── */
const CERT_PROBLEMS = {
  CERT_HAS_EXPIRED: 'The certificate has expired.', DEPTH_ZERO_SELF_SIGNED_CERT: 'The certificate is self-signed.',
  SELF_SIGNED_CERT_IN_CHAIN: 'The certificate chain contains a self-signed certificate.', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The certificate chain is incomplete.',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'The certificate issuer is not trusted.', ERR_TLS_CERT_ALTNAME_INVALID: 'The certificate does not match the site name.',
  CERT_NOT_YET_VALID: 'The certificate is not valid yet.', CERT_REVOKED: 'The certificate has been revoked.'
};
function inspectCert(host) {
  return new Promise(async (resolve, reject) => {
    let checked;
    try { checked = await validatePublicUrl('https://' + host); } catch (e) { return reject(new ToolError(400, 'invalid_url', e.message)); }
    const socket = tls.connect({ host, port: 443, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: true, lookup: pinnedLookup(checked.ip), timeout: 8000 });
    const out = { host };
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      out.protocol = socket.getProtocol(); out.cipher = (socket.getCipher() || {}).name || null;
      const from = new Date(cert.valid_from), to = new Date(cert.valid_to);
      out.valid = socket.authorized === true;
      out.issued_to = (cert.subject && cert.subject.CN) || null;
      out.issuer = (cert.issuer && cert.issuer.O) || null;
      out.valid_from = from.toISOString().slice(0, 10); out.valid_until = to.toISOString().slice(0, 10);
      out.days_left = Math.floor((to - Date.now()) / 86400000);
      const names = String(cert.subjectaltname || '').split(', ').filter((n) => n.startsWith('DNS:')).map((n) => n.slice(4));
      out.names_total = names.length; out.names = names.slice(0, 12);
      socket.end(); resolve(out);
    });
    socket.once('timeout', () => { socket.destroy(); reject(new ToolError(422, 'site_unreachable', 'No secure connection could be made to that site (port 443).')); });
    socket.once('error', (e) => {
      if (CERT_PROBLEMS[e.code] || /^(CERT_|ERR_TLS_CERT)/.test(e.code || '')) resolve({ host, valid: false, problem: CERT_PROBLEMS[e.code] || 'The certificate could not be verified.' });
      else reject(new ToolError(422, 'site_unreachable', 'No secure connection could be made to that site (port 443).'));
    });
  });
}

/* ═══ Full audit (SEO audit, site scan, overview, schema, technology) ═══ */
class Report {
  constructor(url) { this.url = url; this.final_url = url; this.findings = []; this.sections = {}; }
  finding(severity, category, title, detail = '', recommendation = '') { this.findings.push({ severity, category, title, detail, recommendation }); }
  section(name, data) { this.sections[name] = data; }
  build() {
    let score = 100; const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    this.findings.forEach((f) => { score -= PENALTY[f.severity] || 2; counts[f.severity] = (counts[f.severity] || 0) + 1; });
    score = Math.max(0, Math.min(100, score));
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    this.findings.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
    return { url: this.url, final_url: this.final_url, score, grade: grade(score), issue_counts: counts, total_issues: this.findings.length, findings: this.findings, sections: this.sections };
  }
}

function analyzeRedirects(rep, resp) {
  const chain = resp.history.map((h) => ({ url: h.url, status: h.status }));
  rep.final_url = resp.url;
  const data = { redirect_chain: chain, hops: chain.length, final_status: resp.status };
  if (chain.length >= 2) rep.finding('MEDIUM', 'Crawlability', 'Redirect chain of ' + chain.length + ' hops', chain.map((h) => h.status).join(' > ') + ' > ' + resp.status, 'Point the first URL directly at the final destination (single 301).');
  if (chain.length && chain[0].url.startsWith('http://') && resp.url.startsWith('https://')) data.https_upgrade = true;
  rep.section('redirects', data);
}

async function analyzeSecurity(rep, parsedUrl, resp) {
  const https = parsedUrl.protocol === 'https:';
  const data = { https };
  const h = lower(resp.headers);
  if (!https) rep.finding('HIGH', 'Security', 'Site not served over HTTPS', '', 'Install an SSL certificate and 301-redirect all http:// to https://.');
  const wanted = [['strict-transport-security', 'HSTS'], ['content-security-policy', 'Content-Security-Policy'], ['x-content-type-options', 'X-Content-Type-Options'], ['x-frame-options', 'X-Frame-Options'], ['referrer-policy', 'Referrer-Policy']];
  const present = [], missing = [];
  wanted.forEach(([key, label]) => {
    if (h[key]) present.push(label);
    else {
      missing.push(label);
      if (key === 'strict-transport-security' && https) rep.finding('MEDIUM', 'Security', 'Missing HSTS header', '', 'Add Strict-Transport-Security to force HTTPS on repeat visits.');
    }
  });
  data.headers_present = present; data.headers_missing = missing;
  if (missing.length) rep.finding('LOW', 'Security', missing.length + ' security headers missing', missing.join(', '), 'Add the missing hardening headers at the server/CDN.');
  if (https) {
    try {
      const cert = await inspectCert(parsedUrl.hostname);
      if (cert.valid === false) throw Object.assign(new Error(cert.problem), { soft: true });
      data.ssl_valid = true; data.ssl_expires_in_days = cert.days_left; data.ssl_issuer = cert.issuer;
      if (cert.days_left < 0) rep.finding('HIGH', 'Security', 'SSL certificate expired', '', 'Renew the TLS certificate immediately.');
      else if (cert.days_left < 15) rep.finding('MEDIUM', 'Security', 'SSL certificate expires in ' + cert.days_left + ' days', '', 'Renew/auto-renew the certificate soon.');
    } catch (e) {
      data.ssl_valid = false; data.ssl_error = String(e.message || '').slice(0, 120);
      rep.finding('HIGH', 'Security', 'Could not validate SSL certificate', data.ssl_error, 'Verify the certificate chain and hostname match.');
    }
  }
  rep.section('security', data);
}

function analyzeMixedContent(rep, parsedUrl, doc) {
  if (parsedUrl.protocol !== 'https:') return;
  const insecure = doc.resourceUrls().filter((u) => u.startsWith('http://'));
  if (insecure.length) rep.finding('HIGH', 'Security', insecure.length + ' mixed-content (http) resources on HTTPS page', insecure[0], 'Serve every sub-resource over https:// to avoid browser warnings.');
  rep.section('mixed_content', { count: insecure.length, examples: insecure.slice(0, 5) });
}

function analyzeIndexability(rep, doc, resp) {
  const content = (doc.meta('robots') || '').toLowerCase();
  const xr = String(lower(resp.headers)['x-robots-tag'] || '').toLowerCase();
  if (content.includes('noindex') || xr.includes('noindex')) rep.finding('HIGH', 'Indexability', 'Page is set to NOINDEX', content || xr, 'Remove noindex if this page should rank in search.');
  if (content.includes('nofollow')) rep.finding('MEDIUM', 'Indexability', 'Page is set to NOFOLLOW', '', 'Allow link equity to flow unless intentionally sculpted.');
  rep.section('indexability', { meta_robots: content || null, x_robots_tag: xr || null });
}

function analyzeCanonical(rep, doc) {
  let href = doc.canonical();
  const data = { canonical: href };
  if (!href) rep.finding('MEDIUM', 'On-Page', 'No canonical tag', '', 'Add a self-referential <link rel=canonical> to consolidate signals.');
  else {
    try { href = new URL(href, rep.final_url).href; data.canonical = href; } catch (e) { /* keep as written */ }
    if (normUrl(href) !== normUrl(rep.final_url)) { data.self_referential = false; rep.finding('LOW', 'On-Page', 'Canonical points to a different URL', href, 'Confirm this is intentional; otherwise self-canonicalize.'); }
    else data.self_referential = true;
  }
  rep.section('canonical', data);
}

function analyzeOnPage(rep, doc) {
  const title = doc.title, desc = doc.meta('description') || '';
  const heads = doc.headings(), h1s = heads.filter((h) => h.level === 1);
  const viewport = doc.meta('viewport'), lang = doc.lang;
  const words = doc.text().split(/\s+/).filter(Boolean).length;
  rep.section('on_page', { title, title_len: title.length, meta_description: desc, desc_len: desc.length, h1_count: h1s.length, word_count: words, has_viewport: !!viewport, lang });
  if (!title) rep.finding('HIGH', 'On-Page', 'Missing <title> tag', '', 'Add a unique 50-60 char title with the primary keyword near the front.');
  else if (title.length > 65) rep.finding('LOW', 'On-Page', 'Title too long (' + title.length + ' chars)', '', "Trim to ~60 chars so it doesn't truncate in SERPs.");
  else if (title.length < 25) rep.finding('LOW', 'On-Page', 'Title quite short (' + title.length + ' chars)', '', 'Expand toward 50-60 chars to use the available SERP space.');
  if (!desc) rep.finding('MEDIUM', 'On-Page', 'Missing meta description', '', 'Write a 140-160 char description with a call to action.');
  else if (desc.length > 165) rep.finding('LOW', 'On-Page', 'Meta description long (' + desc.length + ' chars)', '', 'Trim to ~155 chars to avoid truncation.');
  if (!h1s.length) rep.finding('HIGH', 'On-Page', 'No H1 heading', '', 'Add exactly one descriptive H1 per page.');
  else if (h1s.length > 1) rep.finding('LOW', 'On-Page', 'Multiple H1s (' + h1s.length + ')', '', 'Prefer a single H1; demote the rest to H2/H3.');
  let prev = 0;
  for (const h of heads) { if (prev && h.level - prev > 1) { rep.finding('LOW', 'On-Page', 'Skipped heading level', 'H' + prev + ' > H' + h.level, 'Keep heading levels sequential for accessibility & structure.'); break; } prev = h.level; }
  if (!viewport) rep.finding('HIGH', 'Mobile', 'No viewport meta tag', '', "Add <meta name=viewport content='width=device-width, initial-scale=1'>.");
  if (!lang) rep.finding('LOW', 'On-Page', 'Missing <html lang> attribute', '', 'Declare the page language for accessibility & hreflang correctness.');
  if (words < 300) rep.finding('MEDIUM', 'Content', 'Thin content (' + words + ' words)', '', 'Expand to comprehensively cover the topic (usually 600+ words).');
}

function analyzeImages(rep, doc) {
  const imgs = doc.images(), total = imgs.length;
  const missingAlt = imgs.filter((i) => !String(i.alt || '').trim()).length;
  const noDims = imgs.filter((i) => !(i.width && i.height)).length;
  rep.section('images', { total, missing_alt: missingAlt, alt_coverage_pct: total ? Math.round(((total - missingAlt) / total) * 100) : 100, without_dimensions: noDims, lazy_loaded: imgs.filter((i) => i.loading === 'lazy').length });
  if (total && missingAlt / total > 0.2) rep.finding('MEDIUM', 'On-Page', missingAlt + '/' + total + ' images missing alt text', '', 'Add descriptive, keyword-relevant alt text for accessibility & image SEO.');
  if (total && noDims / total > 0.5) rep.finding('LOW', 'Performance', 'Many images lack width/height', '', 'Set explicit dimensions to reduce Cumulative Layout Shift (CLS).');
}

function analyzeLinks(rep, doc, parsedUrl) {
  let internal = 0, external = 0, empty = 0, generic = 0;
  const GENERIC = new Set(['click here', 'read more', 'here', 'more', 'link', 'this']);
  doc.anchors().forEach((a) => {
    if (!a.href || /^(#|javascript:|mailto:|tel:|data:)/i.test(a.href)) return;
    let full; try { full = new URL(a.href, rep.final_url); } catch (e) { return; }
    const text = a.text.toLowerCase();
    if (!text) empty++; else if (GENERIC.has(text)) generic++;
    if (full.host === parsedUrl.host) internal++; else external++;
  });
  rep.section('links', { internal, external, empty_anchors: empty, generic_anchors: generic });
  if (empty > 0) rep.finding('LOW', 'Links', empty + ' links with empty anchor text', '', 'Give every link descriptive anchor text (helps crawlers & screen readers).');
  if (generic >= 5) rep.finding('LOW', 'Links', generic + " generic anchors ('click here', 'read more')", '', 'Use keyword-relevant anchors so internal links pass topical context.');
  if (internal === 0) rep.finding('MEDIUM', 'Links', 'No internal links found', '', 'Add internal links to distribute authority and aid discovery.');
}

function analyzeStructuredData(rep, doc) {
  const blocks = doc.jsonLd(), types = [], errors = [], incomplete = [];
  const walk = (obj) => {
    (Array.isArray(obj) ? obj : [obj]).forEach((it) => {
      if (!it || typeof it !== 'object') return;
      if (it['@graph']) walk(it['@graph']);
      (Array.isArray(it['@type']) ? it['@type'] : [it['@type']]).forEach((t) => {
        if (!t || typeof t !== 'string') return;
        types.push(t);
        const req = SCHEMA_REQUIRED[t];
        if (req) { const missing = req.filter((p) => !(p in it)); if (missing.length) incomplete.push({ type: t, missing }); }
      });
    });
  };
  blocks.forEach((b) => { try { walk(JSON.parse(b || '{}')); } catch (e) { errors.push(String(e.message).slice(0, 80)); } });
  rep.section('structured_data', { types: [...new Set(types)].sort(), blocks: blocks.length, parse_errors: errors, incomplete });
  if (!blocks.length) rep.finding('MEDIUM', 'Structured Data', 'No JSON-LD structured data', '', 'Add schema.org markup (Organization, Article/Product, BreadcrumbList) for rich results.');
  if (errors.length) rep.finding('MEDIUM', 'Structured Data', errors.length + ' JSON-LD blocks failed to parse', errors[0], 'Fix the malformed JSON-LD so search engines can read it.');
  incomplete.forEach((v) => rep.finding('LOW', 'Structured Data', v.type + ' schema missing: ' + v.missing.join(', '), '', 'Add the required properties so ' + v.type + ' is rich-result eligible.'));
}

function analyzeSocial(rep, doc) {
  const og = doc.metaPrefix('og:', 'property'), tw = doc.metaPrefix('twitter:', 'name');
  rep.section('social', { open_graph: og, twitter: tw });
  const missing = ['title', 'description', 'image'].filter((k) => !og[k]);
  if (missing.length) rep.finding('LOW', 'Social', 'Open Graph missing: ' + missing.join(', '), '', 'Add og:title/description/image so shared links render rich previews.');
  if (!tw.card) rep.finding('LOW', 'Social', 'No Twitter Card markup', '', 'Add twitter:card (summary_large_image) for better X/Twitter previews.');
}

function analyzeInternational(rep, doc) {
  const hrefl = doc.alternates().map((l) => l.hreflang);
  const data = { hreflang_count: hrefl.length, hreflangs: hrefl, has_x_default: hrefl.map((h) => h.toLowerCase()).includes('x-default') };
  if (hrefl.length && !data.has_x_default) rep.finding('LOW', 'International', 'hreflang set without x-default', '', 'Add an x-default hreflang for users outside the targeted locales.');
  rep.section('international', data);
}

function analyzeTech(rep, resp, doc) {
  const h = lower(resp.headers);
  const server = h.server || '', powered = h['x-powered-by'] || '';
  const generator = (doc.meta('generator') || '').toLowerCase();
  const hay = doc.raw.toLowerCase() + ' ' + generator;
  const detected = [];
  [['WordPress', ['wp-content', 'wp-includes', 'wordpress']], ['Shopify', ['cdn.shopify.com', 'shopify']], ['Next.js', ['__next_data__', '_next/static']],
   ['Wix', ['static.wixstatic.com', 'wix.com']], ['Squarespace', ['static1.squarespace.com', 'squarespace']], ['Webflow', ['assets.website-files.com', 'webflow']],
   ['Drupal', ['drupal.js', 'drupal.settings']], ['Joomla', ['/media/jui/', 'joomla']], ['Magento', ['mage/cookies', 'magento']]]
    .forEach(([name, needles]) => { if (needles.some((n) => hay.includes(n))) detected.push(name); });
  if (/php/i.test(powered) && !detected.includes('PHP')) detected.push('PHP');
  if (/cloudflare/i.test(server)) detected.push('Cloudflare'); else if (/nginx/i.test(server)) detected.push('Nginx'); else if (/apache/i.test(server)) detected.push('Apache');
  rep.section('tech_stack', { detected, server_header: server || null, generator: generator || null });
}

async function textFile(origin, path, timeout) {
  try { return await safeGet(origin + path, { timeout }); } catch (e) { return null; }
}

async function analyzeRobotsSitemap(rep, parsedUrl) {
  const base = parsedUrl.protocol + '//' + parsedUrl.host;
  const data = { robots_txt: false, sitemaps: [], sitemap_url_count: 0, disallow_rules: 0 };
  let sitemapUrls = [];
  const r = await textFile(base, '/robots.txt', 8000);
  if (r && r.status === 200 && r.body.trim() && !/html/i.test(String(r.headers['content-type'] || ''))) {
    data.robots_txt = true;
    r.body.split(/\r?\n/).slice(0, 3000).forEach((line) => {
      const l = line.trim(), low = l.toLowerCase();
      if (low.startsWith('sitemap:')) sitemapUrls.push(l.slice(8).trim());
      else if (low.startsWith('disallow:') && l.split(':').slice(1).join(':').trim()) data.disallow_rules++;
    });
  } else rep.finding('MEDIUM', 'Crawlability', 'No robots.txt found', '', 'Add a robots.txt (even a permissive one) and reference your sitemap.');
  if (!sitemapUrls.length) sitemapUrls = [base + '/sitemap.xml', base + '/sitemap_index.xml']; else data.sitemap_declared_in_robots = true;
  let found = false, total = 0;
  const results = await Promise.all(sitemapUrls.slice(0, 5).map((sm) => countSitemap(sm)));
  results.forEach((res, i) => { if (res.found) { found = true; total += res.count; data.sitemaps.push(sitemapUrls[i]); } });
  data.sitemap_url_count = total;
  if (!found) rep.finding('MEDIUM', 'Crawlability', 'No XML sitemap found', '', 'Generate sitemap.xml and submit it in Google Search Console.');
  rep.section('crawlability', data);
}

const locs = (xml, tag) => [...xml.matchAll(new RegExp('<' + tag + '[\\s>][\\s\\S]*?<loc>\\s*([^<]+?)\\s*</loc>', 'gi'))].map((m) => m[1]);
async function countSitemap(url) {
  try {
    const r = await safeGet(url, { timeout: 10000 });
    if (r.status !== 200 || !r.body.includes('<')) return { found: false, count: 0 };
    if (/<sitemapindex/i.test(r.body)) {
      const kids = locs(r.body, 'sitemap').slice(0, 10);
      const counts = await Promise.all(kids.map(async (k) => { try { const rr = await safeGet(k, { timeout: 10000 }); return (rr.body.match(/<url[\s>]/gi) || []).length; } catch (e) { return 0; } }));
      return { found: true, count: counts.reduce((a, b) => a + b, 0) };
    }
    return { found: true, count: (r.body.match(/<url[\s>]/gi) || []).length };
  } catch (e) { return { found: false, count: 0 }; }
}

async function analyzeLlms(rep, parsedUrl) {
  const r = await textFile(parsedUrl.protocol + '//' + parsedUrl.host, '/llms.txt', 6000);
  rep.section('llms_txt', { present: !!(r && r.status === 200 && r.body.trim() && !/html/i.test(String(r.headers['content-type'] || ''))) });
}

function failed(url, kind, message, status) {
  return { url, final_url: url, fetched: false, score: null, grade: null, issue_counts: { HIGH: 0, MEDIUM: 0, LOW: 0 }, total_issues: 0, findings: [], sections: {}, status_code: status || null, blocked: kind === 'not_allowed', error: { kind, message } };
}

async function deepAudit(input) {
  let url = String(input || '').trim();
  if (!url) return failed(url, 'invalid_url', 'A website URL is required.');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let resp;
  try { resp = await safeGet(url, { timeout: 15000 }); }
  catch (e) {
    if (e instanceof FetchError) return failed(url, e.kind === 'not_allowed' ? 'not_allowed' : e.kind, e.message);
    return failed(url, 'connection', 'Could not fetch the page.');
  }
  if (resp.status >= 400) return failed(url, 'http_error', httpMessage(resp.status), resp.status);
  const type = String(resp.headers['content-type'] || '').toLowerCase();
  if (type && !['html', 'xml', 'text/plain'].some((t) => type.includes(t))) return failed(url, 'not_html', 'That address is a file, not a web page, so it cannot be audited.', resp.status);

  const rep = new Report(url);
  const parsed = new URL(resp.url);
  const doc = parse(resp.body);
  const safe = (name, fn) => { try { return fn(); } catch (e) { rep.section(name, { error: String(e.message).slice(0, 120) }); } };
  safe('redirects', () => analyzeRedirects(rep, resp));
  safe('indexability', () => analyzeIndexability(rep, doc, resp));
  safe('canonical', () => analyzeCanonical(rep, doc));
  safe('on_page', () => analyzeOnPage(rep, doc));
  safe('images', () => analyzeImages(rep, doc));
  safe('links', () => analyzeLinks(rep, doc, parsed));
  safe('structured_data', () => analyzeStructuredData(rep, doc));
  safe('social', () => analyzeSocial(rep, doc));
  safe('international', () => analyzeInternational(rep, doc));
  safe('tech_stack', () => analyzeTech(rep, resp, doc));
  safe('mixed_content', () => analyzeMixedContent(rep, parsed, doc));
  // network checks run side by side
  await Promise.all([
    analyzeSecurity(rep, parsed, resp).catch((e) => rep.section('security', { error: String(e.message).slice(0, 120) })),
    analyzeRobotsSitemap(rep, parsed).catch((e) => rep.section('crawlability', { error: String(e.message).slice(0, 120) })),
    analyzeLlms(rep, parsed).catch(() => rep.section('llms_txt', { present: false }))
  ]);
  const out = rep.build();
  out.fetched = true; out.status_code = resp.status;
  return out;
}

/* A crawl that cannot read the page is an error, never a score. */
async function crawl(url) {
  const report = await deepAudit(url);
  if (report.fetched === false) {
    const err = report.error || {};
    if (['invalid_url', 'not_allowed'].includes(err.kind)) throw new ToolError(400, 'invalid_url', err.message || 'Please enter a valid website address.');
    throw new ToolError(422, 'site_unreachable', err.message || 'That site could not be read.');
  }
  return report;
}

/* ═══ Single-purpose tools ═══ */
const STOP = new Set(('a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our ours out over own same she so some such than that the their theirs them then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your yours').split(' '));

function syllables(word) {
  const groups = (word.match(/[aeiouy]+/g) || []).length;
  let n = groups;
  if (word.endsWith('e') && n > 1 && !word.endsWith('le') && !word.endsWith('ee')) n--;
  return Math.max(1, n);
}

function textStats(doc, lang) {
  const text = doc.text();
  const words = (text.match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*/g) || []).map((w) => w.toLowerCase());
  const total = words.length;
  if (!total) return { word_count: 0, top_words: [], top_phrases: [], readability: null };
  const count = (list) => list.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const kept = words.filter((w) => !STOP.has(w) && w.length > 2);
  const pairs = [];
  for (let i = 0; i < words.length - 1; i++) { const a = words[i], b = words[i + 1]; if (!STOP.has(a) && !STOP.has(b) && a.length > 2 && b.length > 2) pairs.push(a + ' ' + b); }
  let readability = null;
  if (String(lang || 'en').toLowerCase().startsWith('en')) {
    const sentences = Math.max(1, (text.match(/[.!?]+(?:\s|$)/g) || []).length);
    const syl = words.reduce((s, w) => s + syllables(w), 0);
    const score = 206.835 - 1.015 * (total / sentences) - 84.6 * (syl / total);
    readability = { flesch_reading_ease: Math.round(Math.max(0, Math.min(100, score)) * 10) / 10, sentences, words_per_sentence: Math.round((total / sentences) * 10) / 10 };
  }
  return {
    word_count: total,
    top_words: top(count(kept), 20).map(([word, c]) => ({ word, count: c, percent: Math.round((10000 * c) / total) / 100 })),
    top_phrases: top(count(pairs), 12).filter(([, c]) => c > 1).map(([phrase, c]) => ({ phrase, count: c })),
    readability
  };
}

async function pageDetails(url) {
  const resp = await fetchPage(url);
  if (resp.status >= 400) throw new ToolError(422, 'site_unreachable', 'The page answered with error code ' + resp.status + ', so there is nothing to check.');
  const ctype = String(resp.headers['content-type'] || '').toLowerCase();
  if (ctype && !ctype.includes('html')) throw new ToolError(400, 'invalid_url', 'That address is a file, not a web page.');
  const final = resp.url, host = new URL(final).host.toLowerCase();
  const doc = parse(resp.body);
  const description = doc.meta('description');
  const canonical = doc.canonical();
  const meta = {
    title: doc.title || null, title_length: doc.title.length, description, description_length: (description || '').length,
    canonical: canonical ? (() => { try { return new URL(canonical, final).href; } catch (e) { return null; } })() : null,
    robots: doc.meta('robots'), x_robots_tag: lower(resp.headers)['x-robots-tag'] || null, viewport: doc.meta('viewport'), language: doc.lang || null,
    charset: doc.charset, open_graph: doc.metaPrefix('og:', 'property'), twitter: doc.metaPrefix('twitter:', 'name')
  };
  const heads = doc.headings();
  const counts = {}; for (let n = 1; n <= 6; n++) counts['h' + n] = heads.filter((h) => h.level === n).length;
  const images = doc.images().filter((i) => (i.src || i['data-src']) && !String(i.src || '').startsWith('data:')).map((i) => {
    const src = i.src || i['data-src'];
    let abs = src; try { abs = new URL(src, final).href; } catch (e) { /* keep */ }
    return { src: clip(abs, 400), alt: i.alt !== undefined ? clip(i.alt, 200) : null, has_size: !!(i.width && i.height), lazy: i.loading === 'lazy' };
  });
  const internal = [], external = [], seen = new Set();
  doc.anchors().forEach((a) => {
    if (!a.href || /^(#|mailto:|tel:|javascript:|data:)/i.test(a.href)) return;
    let full; try { full = new URL(a.href, final); } catch (e) { return; }
    full.hash = '';
    if (!/^https?:$/.test(full.protocol) || seen.has(full.href)) return;
    seen.add(full.href);
    const item = { url: clip(full.href, 400), text: a.text || null, nofollow: a.rel.toLowerCase().split(/\s+/).includes('nofollow') };
    (full.host.toLowerCase() === host ? internal : external).push(item);
  });
  return {
    url, final_url: final, status_code: resp.status, meta,
    headings: { outline: heads.slice(0, MAX_LIST), total: heads.length, counts },
    images: { total: images.length, missing_alt: images.filter((i) => i.alt === null).length, empty_alt: images.filter((i) => i.alt === '').length, without_size: images.filter((i) => !i.has_size).length, items: images.slice(0, MAX_LIST) },
    links: { internal_total: internal.length, external_total: external.length, nofollow_total: [...internal, ...external].filter((i) => i.nofollow).length, internal: internal.slice(0, MAX_LIST), external: external.slice(0, MAX_LIST) },
    text: textStats(doc, doc.lang)
  };
}

async function redirectChain(url) {
  const resp = await fetchPage(url);
  const hops = resp.history.map((h) => ({ url: clip(h.url, 400), status_code: h.status }));
  hops.push({ url: clip(resp.url, 400), status_code: resp.status });
  const first = new URL(hops[0].url), last = new URL(hops[hops.length - 1].url);
  return { start_url: url, final_url: resp.url, final_status: resp.status, redirects: resp.history.length, hops, http_to_https: first.protocol === 'http:' && last.protocol === 'https:', host_changed: first.host.toLowerCase() !== last.host.toLowerCase(), server: resp.headers.server || null, content_type: resp.headers['content-type'] || null };
}

async function linkStatus(url) {
  let current = url;
  try {
    for (let i = 0; i < 4; i++) {
      const r = await safeHead(current, { timeout: 8000 });
      const loc = r.headers.location;
      if ([301, 302, 303, 307, 308].includes(r.status) && loc) { current = new URL(loc, r.url).href; continue; }
      return [r.status, null];
    }
    return [null, 'Too many redirects'];
  } catch (e) {
    if (e instanceof UnsafeUrlError) return [null, 'Address not allowed'];
    if (e && (e.code === 'ETIMEDOUT' || /timed out/i.test(e.message))) return [null, 'No answer in time'];
    return [null, 'Could not connect'];
  }
}

async function checkLinks(url) {
  const d = await pageDetails(url);
  const todo = [...d.links.internal.map((i) => ({ ...i, kind: 'internal' })), ...d.links.external.map((i) => ({ ...i, kind: 'external' }))].slice(0, MAX_LINK_CHECKS);
  const results = new Array(todo.length);
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (next < todo.length) { const i = next++; results[i] = await linkStatus(todo[i].url); } }));
  const checked = todo.map((item, i) => {
    const [status, reason] = results[i];
    // 999 is LinkedIn's (and some others') answer to automated checks: the page exists, the check was refused.
    const state = status === null ? 'unknown' : [401, 403, 429, 999].includes(status) ? 'blocked' : status >= 400 ? 'broken' : 'ok';
    return { url: item.url, text: item.text, kind: item.kind, nofollow: item.nofollow, status_code: status, state, reason };
  });
  return { final_url: d.final_url, internal_total: d.links.internal_total, external_total: d.links.external_total, nofollow_total: d.links.nofollow_total, checked_total: checked.length, not_checked: d.links.internal_total + d.links.external_total - checked.length, broken: checked.filter((c) => c.state === 'broken').length, checked };
}

async function sitemapInfo(url) {
  const out = { url: clip(url, 400), found: false };
  try {
    const r = await safeGet(url, { timeout: 10000 });
    if (r.status !== 200 || !r.body.includes('<')) { out.status_code = r.status; return [out, []]; }
    out.found = true;
    if (/<sitemapindex/i.test(r.body)) { const kids = locs(r.body, 'sitemap'); out.type = 'index'; out.child_sitemaps = kids.length; return [out, kids]; }
    out.type = 'list'; out.url_count = (r.body.match(/<url[\s>]/gi) || []).length;
    return [out, []];
  } catch (e) { return [out, []]; }
}

async function robotsDetails(url) {
  const checked = await checkedUrl(url);
  const u = new URL(checked), base = u.protocol + '//' + u.host;
  const out = { site: base, robots: { found: false }, sitemaps: [] };
  const declared = [];
  let resp;
  try { resp = await safeGet(base + '/robots.txt', { timeout: 10000 }); }
  catch (e) { if (e instanceof FetchError && e.kind === 'not_allowed') throw new ToolError(400, 'invalid_url', e.message); throw new ToolError(422, 'site_unreachable', 'The site could not be reached.'); }
  const isText = !/html/i.test(String(resp.headers['content-type'] || ''));
  if (resp.status === 200 && resp.body.trim() && isText) {
    const groups = [], rules = []; let current = null, blocksAll = false;
    resp.body.split(/\r?\n/).slice(0, 3000).forEach((raw) => {
      const line = raw.split('#')[0].trim();
      const idx = line.indexOf(':'); if (idx < 0) return;
      const key = line.slice(0, idx).trim().toLowerCase(), value = line.slice(idx + 1).trim();
      if (key === 'user-agent') {
        if (!current || current.allow || current.disallow) { current = { agents: [], allow: 0, disallow: 0, crawl_delay: null }; groups.push(current); }
        current.agents.push(clip(value, 80));
      } else if ((key === 'allow' || key === 'disallow') && current) {
        if (key === 'disallow' && !value) return;
        current[key]++;
        if (rules.length < 60) rules.push({ agent: current.agents.join(', ').slice(0, 80), rule: key[0].toUpperCase() + key.slice(1), path: clip(value, 200) });
        if (key === 'disallow' && value === '/' && current.agents.includes('*')) blocksAll = true;
      } else if (key === 'crawl-delay' && current) current.crawl_delay = clip(value, 20);
      else if (key === 'sitemap') declared.push(value);
    });
    out.robots = { found: true, size_bytes: Buffer.byteLength(resp.body), groups: groups.slice(0, 30), rules, rule_total: groups.reduce((s, g) => s + g.allow + g.disallow, 0), blocks_all_crawlers: blocksAll, sitemaps_declared: declared.slice(0, 10).map((s) => clip(s, 400)) };
  } else out.robots.status_code = resp.status;
  const queue = declared.slice(0, 5).length ? declared.slice(0, 5) : [base + '/sitemap.xml', base + '/sitemap_index.xml'];
  let total = 0;
  for (const sm of queue) {
    const [info, kids] = await sitemapInfo(sm);
    if (!info.found && !declared.length) continue;
    let counted = 0;
    if (kids.length) {
      const subs = await Promise.all(kids.slice(0, 10).map((k) => sitemapInfo(k)));
      counted = subs.reduce((s, [i]) => s + (i.url_count || 0), 0);
      info.url_count = counted; info.children_counted = Math.min(10, kids.length);
    }
    total += info.url_count || 0;
    out.sitemaps.push(info);
  }
  out.sitemap_url_total = total;
  return out;
}

async function sslDetails(url) {
  const checked = await checkedUrl(url);
  return inspectCert(new URL(checked).hostname);
}

module.exports = { ToolError, deepAudit, crawl, pageDetails, redirectChain, checkLinks, robotsDetails, sslDetails, inspectCert, checkedUrl };
