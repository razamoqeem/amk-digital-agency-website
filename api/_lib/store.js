'use strict';
/* KivoReach Website: small counter store.

   Counters (daily limits, rate limits) must survive between serverless calls.
   Preferred: a Redis database over HTTPS (Upstash, or Vercel KV which uses the same service).
   Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN).
   Without it, counters live in the memory of one warm function instance only. That is fine
   for local testing and is NOT enough protection on the internet: a visitor can wait for a
   fresh instance and get a fresh allowance. The security checklist says so too. */

const URL_ = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const persistent = /^https:\/\//.test(URL_) && !!TOKEN;

const mem = globalThis.__amkMem || (globalThis.__amkMem = new Map());
function sweep() {
  if (mem.size < 5000) return;
  const now = Date.now();
  for (const [k, v] of mem) if (v.exp && v.exp < now) mem.delete(k);
}

async function redis(commands) {
  const res = await fetch(URL_ + '/pipeline', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands), signal: AbortSignal.timeout(4000)
  });
  if (!res.ok) throw new Error('store_error');
  const out = await res.json();
  return out.map((r) => { if (r.error) throw new Error('store_error'); return r.result; });
}

/* Add one and return the new total. The key expires after ttlSeconds. */
async function incr(key, ttlSeconds) {
  if (persistent) {
    const [n] = await redis([['INCR', key], ['EXPIRE', key, String(ttlSeconds)]]);
    return Number(n);
  }
  sweep();
  const now = Date.now();
  const cur = mem.get(key);
  const value = cur && (!cur.exp || cur.exp > now) ? cur.value + 1 : 1;
  mem.set(key, { value, exp: now + ttlSeconds * 1000 });
  return value;
}

async function decr(key) {
  if (persistent) { await redis([['DECR', key]]); return; }
  const cur = mem.get(key);
  if (cur) cur.value = Math.max(0, cur.value - 1);
}

async function get(key) {
  if (persistent) { const [v] = await redis([['GET', key]]); return Number(v || 0); }
  const cur = mem.get(key);
  return cur && (!cur.exp || cur.exp > Date.now()) ? cur.value : 0;
}

/* Read several counters in one round trip. */
async function getMany(keys) {
  if (persistent) { const r = await redis(keys.map((k) => ['GET', k])); return r.map((v) => Number(v || 0)); }
  return keys.map((k) => { const c = mem.get(k); return c && (!c.exp || c.exp > Date.now()) ? c.value : 0; });
}

/* Append a JSON record to a list (used for leads when no webhook is set). Needs the Redis store. */
async function push(listKey, record) {
  if (!persistent) return false;
  await redis([['LPUSH', listKey, JSON.stringify(record)], ['LTRIM', listKey, '0', '4999']]);
  return true;
}

/* Short-lived saved results (per warm instance only). */
const cache = globalThis.__amkCache || (globalThis.__amkCache = new Map());
function cacheGet(key) {
  const c = cache.get(key);
  if (c && c.exp > Date.now()) return c.data;
  cache.delete(key);
  return null;
}
function cacheSet(key, data, seconds) {
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, { data, exp: Date.now() + seconds * 1000 });
}

module.exports = { incr, decr, get, getMany, push, cacheGet, cacheSet, persistent };
