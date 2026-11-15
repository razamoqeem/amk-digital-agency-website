'use strict';
/* AMK Digital Agency Website: request protection shared by every endpoint.

   Layers, in the order a request meets them:
     1. Method, size and content-type checks
     2. Same-origin check (browsers on our own pages only)
     3. Per-network-address rate limit (per minute)
     4. Bot check (Cloudflare Turnstile), required in production
     5. Per-visitor and per-network daily allowances
     6. A daily budget that pauses a service before it is overloaded
   Secrets come from environment variables only and are never sent to a browser or written to a log. */
const crypto = require('crypto');
const store = require('./store');

const IS_PROD = process.env.VERCEL_ENV === 'production';
const env = (name) => String(process.env[name] || '').trim();
const intEnv = (name, d) => { const n = parseInt(env(name), 10); return Number.isFinite(n) && n >= 0 ? n : d; };

/* ── Secrets ─────────────────────────────────────────────── */
function secret() {
  const s = env('TOOLS_SECRET');
  if (s.length >= 24) return s;
  return IS_PROD ? null : 'local-testing-only-secret-never-used-in-production';
}
function hash(kind, value) {
  const key = secret();
  return crypto.createHmac('sha256', key || 'x').update(kind + ':' + value).digest('hex').slice(0, 32);
}

/* ── Request reading and replying ────────────────────────── */
function clientIp(req) {
  const h = req.headers;
  const ip = String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || 'unknown').trim();
  return ip.slice(0, 64);
}

function send(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (extra.retryAfter) res.setHeader('Retry-After', String(extra.retryAfter));
  if (extra.cookies && extra.cookies.length) res.setHeader('Set-Cookie', extra.cookies);
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 10000) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) return { error: 'Send JSON.' };
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > maxBytes) return { error: 'The request is too large.' };
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) return { error: 'The request is too large.' };
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? { data } : { error: 'Send a JSON object.' };
  } catch (e) { return { error: 'The request could not be read.' }; }
}

function queryOf(req) {
  try { return Object.fromEntries(new URL(req.url, 'http://x').searchParams); } catch (e) { return {}; }
}

/* ── Same-origin check ───────────────────────────────────── */
function allowedHosts() {
  const list = [env('SITE_URL')].concat(env('ALLOWED_ORIGINS').split(','));
  return list.map((u) => { try { return new URL(u.trim()).host.toLowerCase(); } catch (e) { return ''; } }).filter(Boolean);
}
function sameOrigin(req, isPost) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  const origin = req.headers.origin;
  if (origin) {
    try { const h = new URL(origin).host.toLowerCase(); return h === host || allowedHosts().includes(h); } catch (e) { return false; }
  }
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (site) return site === 'same-origin' || site === 'none';
  return !isPost;   // a POST with no Origin and no fetch metadata is not from one of our pages
}

/* ── Visitor cookie ──────────────────────────────────────── */
function visitor(req) {
  const raw = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith('amk_vid='));
  if (raw) {
    const [vid, sig] = raw.slice(8).split('.');
    if (/^[a-f0-9]{32}$/.test(vid || '') && sig && sig.length === 32 &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(hash('vid', vid)))) return { vid, isNew: false };
  }
  return { vid: crypto.randomBytes(16).toString('hex'), isNew: true };
}
function visitorCookie(req, vid) {
  const secure = String(req.headers['x-forwarded-proto'] || '').startsWith('https') ? '; Secure' : '';
  return 'amk_vid=' + vid + '.' + hash('vid', vid) + '; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax' + secure;
}

/* ── Counters ────────────────────────────────────────────── */
const day = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);
function endOfDayIso() { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString().replace(/\.\d+Z$/, 'Z'); }
function endOfMonthIso() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().replace(/\.\d+Z$/, 'Z'); }
const secondsToEndOfDay = () => Math.max(60, Math.ceil((new Date(endOfDayIso()) - Date.now()) / 1000) + 3600);

async function rateLimited(kind, id, limit, windowSeconds) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const n = await store.incr('rl:' + kind + ':' + hash('ip', id) + ':' + bucket, windowSeconds * 2);
  return n > limit;
}

/* ── Bot check (Cloudflare Turnstile) ────────────────────── */
function botCheckConfigured() { return !!env('TURNSTILE_SECRET'); }
function botCheckRequired() { return botCheckConfigured() || (IS_PROD && env('REQUIRE_BOT_CHECK') !== '0'); }

/* Returns 'ok', 'failed' (the visitor did not pass) or 'unavailable' (we are not set up for it). */
async function botCheck(token, ip) {
  if (!botCheckRequired()) return 'ok';
  if (!botCheckConfigured()) return 'unavailable';
  if (typeof token !== 'string' || !token || token.length > 2048) return 'failed';
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env('TURNSTILE_SECRET'), response: token, remoteip: ip }).toString(),
      signal: AbortSignal.timeout(8000)
    });
    const out = await res.json();
    return out && out.success === true ? 'ok' : 'failed';
  } catch (e) { return 'failed'; }
}

/* ── Tool allowances (daily and monthly per visitor, daily per tool, daily per network) ── */
const TOOL_CAPS = (() => {
  const base = { links: 3, 'domain-overview': 5 };
  try { return { ...base, ...JSON.parse(env('TOOLS_TOOL_LIMITS') || '{}') }; } catch (e) { return base; }
})();
const LIMITS = () => ({ enabled: env('TOOLS_LIMITS_OFF') !== '1', daily: intEnv('TOOLS_DAILY_LIMIT', 10), monthly: intEnv('TOOLS_MONTHLY_LIMIT', 100), warn: 80 });

const part = (used, limit, resets) => ({ used, limit, remaining: limit ? Math.max(0, limit - used) : null, resets_at: resets });

async function toolLimits(vid, tool) {
  const keys = ['u:' + vid + ':*:' + day(), 'u:' + vid + ':*:' + month(), 'u:' + vid + ':' + tool + ':' + day()];
  const [d, m, t] = await store.getMany(keys);
  return buildLimits(d, m, t, tool);
}

function buildLimits(d, m, t, tool) {
  const cfg = LIMITS();
  const toolCap = Number(TOOL_CAPS[tool]) || 0;
  const out = {
    tier: 'free', enforced: cfg.enabled,
    daily: part(d, cfg.daily, endOfDayIso()), monthly: part(m, cfg.monthly, endOfMonthIso()),
    session: part(0, 0, null), tool_daily: part(t, toolCap, endOfDayIso()),
    blocked_by: null, message: null, warning: null
  };
  if (!cfg.enabled) return out;
  const messages = {
    monthly: "You've reached your monthly usage allowance. Your access will refresh at the beginning of the next month.",
    daily: "You've reached your daily free usage limit. Your allowance will refresh tomorrow. You can return then to continue.",
    tool_daily: "You've reached today's limit for this tool. It will refresh tomorrow. Other tools may still be available."
  };
  for (const name of ['monthly', 'daily', 'tool_daily']) {
    if (out[name].limit && out[name].used >= out[name].limit) { out.blocked_by = name; out.message = messages[name]; return out; }
  }
  for (const [name, label] of [['monthly', 'monthly'], ['daily', 'daily']]) {
    const { limit, used } = out[name];
    if (limit && used * 100 >= cfg.warn * limit) {
      const left = limit - used;
      out.warning = "You've used " + Math.round((100 * used) / limit) + '% of your available ' + label + ' allowance. You have ' + left + ' run' + (left === 1 ? '' : 's') + ' remaining.';
      break;
    }
  }
  return out;
}

async function countRun(vid, tool) {
  await Promise.all([
    store.incr('u:' + vid + ':*:' + day(), secondsToEndOfDay()),
    store.incr('u:' + vid + ':*:' + month(), 40 * 86400),
    store.incr('u:' + vid + ':' + tool + ':' + day(), secondsToEndOfDay())
  ]);
}

const runsShape = (limits) => ({ stage: 'anonymous', tool_runs: 0, free_without_email: 0, used: limits.daily.used, limit: limits.daily.limit, remaining: limits.daily.remaining, limits });

async function runsInfo(vid, tool) { return runsShape(await toolLimits(vid, tool)); }

/* Every tool's allowance for one visitor, read in one round trip. */
async function allRuns(vid, tools) {
  const keys = ['u:' + vid + ':*:' + day(), 'u:' + vid + ':*:' + month()].concat(tools.map((t) => 'u:' + vid + ':' + t + ':' + day()));
  const v = await store.getMany(keys);
  return Object.fromEntries(tools.map((t, i) => [t, runsShape(buildLimits(v[0], v[1], v[2 + i], t))]));
}

/* ── Daily budget per upstream group ─────────────────────── */
const BUDGET = { crawl: intEnv('TOOLS_CRAWL_DAILY_LIMIT', 500), registry: intEnv('TOOLS_REGISTRY_DAILY_LIMIT', 500), rank: intEnv('TOOLS_RANK_DAILY_LIMIT', 500) };
async function budgetFull(group) { return (await store.get('budget:' + group + ':' + day())) >= 0.8 * (BUDGET[group] || 500); }
async function budgetAdd(group) { await store.incr('budget:' + group + ':' + day(), secondsToEndOfDay()); }

/* ── Shared front door for every POST endpoint ───────────── */
/* Returns a context, or null after replying with an error. */
async function door(req, res, { method = 'POST', rateKind, perMinute = intEnv('TOOLS_RATE_PER_MINUTE', 20), maxBytes = 10000 } = {}) {
  const fail = (status, code, message, extra) => { send(res, status, { ok: false, error: { code, message } }, extra); return null; };
  if (req.method !== method) { res.setHeader('Allow', method); return fail(405, 'method_not_allowed', 'This address does not accept that kind of request.'); }
  if (!secret()) return fail(503, 'not_configured', 'This service is not set up yet.');
  if (!sameOrigin(req, method === 'POST')) return fail(403, 'forbidden', 'This request is not allowed.');
  const ip = clientIp(req);
  let limited;
  try { limited = await rateLimited(rateKind, ip, perMinute, 60); } catch (e) { return fail(503, 'busy', 'Please try again in a moment.'); }
  if (limited) return fail(429, 'rate_limited', 'Too many requests. Please wait a minute and try again.', { retryAfter: 60 });
  let body = {};
  if (method === 'POST') {
    const parsed = await readJson(req, maxBytes);
    if (parsed.error) return fail(400, 'bad_request', parsed.error);
    body = parsed.data;
  }
  const v = visitor(req);
  return { req, res, ip, body, vid: v.vid, isNew: v.isNew, cookies: v.isNew ? [visitorCookie(req, v.vid)] : [], fail };
}

/* Wrap an endpoint so an unexpected error never leaks details. */
function endpoint(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      if (!res.headersSent) send(res, 500, { ok: false, error: { code: 'server_error', message: 'Something went wrong. Please try again.' } });
    }
  };
}

module.exports = {
  IS_PROD, env, intEnv, hash, clientIp, send, readJson, queryOf, sameOrigin, visitor, visitorCookie,
  rateLimited, botCheck, botCheckRequired, botCheckConfigured, toolLimits, countRun, runsInfo, allRuns, budgetFull, budgetAdd,
  door, endpoint, day, endOfDayIso, secondsToEndOfDay, TOOL_CAPS
};
