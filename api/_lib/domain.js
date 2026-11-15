'use strict';
/* AMK Digital Agency Website: domain age, domain rank and the overview report.
   Age comes from RDAP, the registries' official JSON service (works on Vercel, unlike port-43 WHOIS).
   Rank comes from Open PageRank and needs OPEN_PAGERANK_KEY. Nothing is estimated or adjusted. */
const dns = require('dns').promises;
const store = require('./store');
const { safeGet, isPublicIp } = require('./safe-fetch');
const { ToolError, crawl, checkedUrl } = require('./analyze');

const IANA_LIST = 'https://data.iana.org/rdap/dns.json';
const RANK_ENDPOINT = 'https://openpagerank.keywordseverywhere.com/v1/domains/bulk';
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const RDAP_HEADERS = { Accept: 'application/rdap+json, application/json', 'User-Agent': 'AMK-Domain-Age/2.0' };

function cleanDomain(text) {
  let d = String(text || '').trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].split('?')[0].split('#')[0];
  d = d.split('@').pop().split(':')[0].replace(/\.$/, '');
  if (d.startsWith('www.')) d = d.slice(4);
  try { d = require('url').domainToASCII(d) || ''; } catch (e) { d = ''; }
  if (!DOMAIN_RE.test(d)) throw new ToolError(400, 'invalid_domain', 'Please enter a valid domain name, for example example.com.');
  return d;
}

const parseDate = (t) => { const d = new Date(t); return t && !isNaN(d) ? d : null; };

function ageResult(domain, created, expires, registrar, source, nameservers) {
  const days = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
  return {
    domain, registered_on: created.toISOString().slice(0, 10), expires_on: expires ? expires.toISOString().slice(0, 10) : null,
    age_days: days, age_years: Math.round((days / 365.25) * 10) / 10,
    registrar: registrar ? String(registrar).slice(0, 120) : null,
    nameservers: [...new Set((nameservers || []).filter(Boolean).map((n) => String(n).toLowerCase().replace(/\.$/, '').slice(0, 120)))].sort().slice(0, 8), source
  };
}

async function rdapServers() {
  let list = store.cacheGet('iana-rdap-list');
  if (!list) {
    const r = await safeGet(IANA_LIST, { headers: RDAP_HEADERS, timeout: 10000 });
    if (r.status !== 200) throw new Error('iana');
    list = JSON.parse(r.body);
    store.cacheSet('iana-rdap-list', list, 24 * 3600);
  }
  const out = {};
  (list.services || []).forEach(([endings, urls]) => {
    const https = urls.filter((u) => u.startsWith('https://'));
    if (https.length) endings.forEach((e) => { out[e.toLowerCase()] = https[0].replace(/\/+$/, ''); });
  });
  return out;
}

function registrarName(record) {
  for (const entity of record.entities || []) {
    if ((entity.roles || []).includes('registrar')) {
      for (const item of ((entity.vcardArray || [null, []])[1]) || []) if (item && item[0] === 'fn') return item[3];
    }
  }
  return null;
}

async function getDomainAge(domain) {
  const ending = domain.split('.').pop();
  let servers = {};
  try { servers = await rdapServers(); } catch (e) { servers = {}; }
  const base = servers[ending];
  if (!base) throw new ToolError(404, 'not_available', 'Domain age is not available for .' + ending + ' domains.');
  const labels = domain.split('.');
  // A sub-domain has no record of its own: try the name, then its parents.
  for (let start = 0; start < Math.max(1, labels.length - 1); start++) {
    const name = labels.slice(start).join('.');
    if (name.split('.').length < 2) break;
    let r;
    try { r = await safeGet(base + '/domain/' + encodeURIComponent(name), { headers: RDAP_HEADERS, timeout: 10000 }); }
    catch (e) { throw new ToolError(422, 'lookup_failed', 'The domain registry did not answer. Please try again later.'); }
    if (r.status === 404) continue;
    if (r.status === 429) throw new ToolError(422, 'lookup_failed', 'The domain registry is busy. Please try again in a few minutes.');
    if (r.status !== 200) throw new ToolError(422, 'lookup_failed', 'The domain registry did not answer. Please try again later.');
    let record;
    try { record = JSON.parse(r.body); } catch (e) { throw new ToolError(422, 'lookup_failed', 'The domain registry sent an unreadable answer.'); }
    const events = {};
    (record.events || []).forEach((e) => { events[e.eventAction] = e.eventDate; });
    const created = parseDate(events.registration);
    if (!created) throw new ToolError(404, 'not_available', 'The registry does not publish a registration date for ' + name + '.');
    return ageResult(name, created, parseDate(events.expiration), registrarName(record), 'rdap', (record.nameservers || []).map((n) => n && n.ldhName));
  }
  throw new ToolError(404, 'not_found', domain + ' does not appear to be registered.');
}

async function getDomainRank(domain) {
  const key = String(process.env.OPEN_PAGERANK_KEY || '').trim();
  if (!key) throw new ToolError(404, 'not_available', 'This tool is not switched on yet.');
  let res;
  try {
    res = await fetch(RANK_ENDPOINT, { method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ domains: [domain], include_history: false }), signal: AbortSignal.timeout(10000) });
  } catch (e) { throw new ToolError(422, 'lookup_failed', 'The rank service did not answer. Please try again later.'); }
  if (res.status === 429) throw new ToolError(503, 'busy', 'The rank service is busy. Please try again later.');
  // 401 / 403 here mean the key is wrong or tied to another network address (the free key allows one address).
  if (res.status !== 200) throw new ToolError(422, 'lookup_failed', 'The rank service is not available right now.');
  let body, row;
  try { body = await res.json(); row = (body.results || [null])[0]; } catch (e) { throw new ToolError(422, 'lookup_failed', 'The rank service sent an unreadable answer.'); }
  if (!row || !row.found || row.open_page_rank == null) throw new ToolError(404, 'not_found', 'No rank data is published for ' + domain + '.');
  return { domain: String(row.domain || domain).slice(0, 253), rank_score: row.open_page_rank, global_position: row.rank, referring_domains: row.referring_domains, data_date: body.as_of, source: 'Open PageRank' };
}

const OVERVIEW_SECTIONS = ['redirects', 'security', 'mixed_content', 'indexability', 'canonical', 'on_page', 'images', 'links', 'structured_data', 'social', 'international', 'crawlability', 'tech_stack', 'llms_txt'];

async function publicIps(domain) {
  try { const r = await dns.lookup(domain, { all: true }); return [...new Set(r.map((x) => x.address).filter(isPublicIp))].sort().slice(0, 4); } catch (e) { return []; }
}

/* Each part is tried on its own, so one failing source never hides the others. */
async function overview(domain) {
  const out = { domain, checked_at: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' };
  const reason = (e) => (e instanceof ToolError ? e.message : 'This check could not be completed.');
  const [site, age, rank, ips] = await Promise.all([
    (async () => { try { return { report: await crawl(await checkedUrl('https://' + domain + '/')) }; } catch (e) { return { reason: reason(e) }; } })(),
    (async () => { try { return { data: await getDomainAgeCached(domain) }; } catch (e) { return { reason: reason(e) }; } })(),
    (async () => {
      if (!String(process.env.OPEN_PAGERANK_KEY || '').trim()) return { reason: 'Domain rank is not switched on.' };
      try { return { data: await getDomainRank(domain) }; } catch (e) { return { reason: reason(e) }; }
    })(),
    publicIps(domain)
  ]);
  if (site.report) {
    const r = site.report, s = r.sections || {};
    out.site = { available: true, final_url: r.final_url, status_code: r.status_code, score: r.score, grade: r.grade, issue_counts: r.issue_counts, total_issues: r.total_issues,
      findings: r.findings.slice(0, 10).map((f) => ({ severity: f.severity, category: f.category, title: f.title, recommendation: f.recommendation || '' })),
      sections: Object.fromEntries(OVERVIEW_SECTIONS.map((n) => [n, s[n] || {}])) };
  } else out.site = { available: false, reason: site.reason };
  out.registration = age.data ? { available: true, ...age.data } : { available: false, reason: age.reason };
  out.rank = rank.data ? { available: true, ...rank.data } : { available: false, reason: rank.reason };
  out.hosting = { available: ips.length > 0, ip_addresses: ips };
  if (!out.site.available && !out.registration.available && !out.rank.available) throw new ToolError(422, 'site_unreachable', out.site.reason || 'No information could be found for that domain.');
  return out;
}

async function getDomainAgeCached(domain) {
  const key = 'age:' + domain;
  const hit = store.cacheGet(key);
  if (hit) return hit;
  const data = await getDomainAge(domain);
  store.cacheSet(key, data, 24 * 3600);
  return data;
}

/* The age is worked out again on every reply so a saved result never shows a stale number. */
function freshAge(data) {
  if (!data || !data.registered_on) return data;
  const days = Math.max(0, Math.floor((Date.now() - new Date(data.registered_on + 'T00:00:00Z').getTime()) / 86400000));
  return { ...data, age_days: days, age_years: Math.round((days / 365.25) * 10) / 10 };
}

module.exports = { cleanDomain, getDomainAge, getDomainRank, overview, freshAge };
