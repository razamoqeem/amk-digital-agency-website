'use strict';
/* KivoReach Website: owner-only deployment check (served at /api/health).

   Purpose: after you add environment variables in Vercel and redeploy, this tells you, from the real
   deployed function, which settings it can see, whether the chat can read AGENCY_CONTEXT.md, whether the
   Redis store answers, and (with ?wait=N) how long a function may run before Vercel stops it.

   It is switched on only when HEALTH_TOKEN (24+ characters) is set, and every request must send
   "Authorization: Bearer <HEALTH_TOKEN>". Without that it answers 404, as if it did not exist.
   It reports yes/no and sizes. It never returns a value, a key, or part of one. */
const crypto = require('crypto');
const guard = require('./_lib/guard');
const store = require('./_lib/store');
const context = require('./_lib/context');

const MAX_WAIT_SECONDS = 28;   // stays below the 30-second function setting

function tokenOk(req) {
  const expected = guard.env('HEALTH_TOKEN');
  if (expected.length < 24) return false;
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const has = (n) => guard.env(n) !== '';

module.exports = guard.endpoint(async (req, res) => {
  const notFound = () => guard.send(res, 404, { ok: false, error: { code: 'not_found', message: 'Not found.' } });
  if (req.method !== 'GET' || !tokenOk(req)) {
    // Slow wrong guesses down a little without storing anything about the visitor.
    await new Promise((r) => setTimeout(r, 300));
    return notFound();
  }

  const started = Date.now();
  const q = guard.queryOf(req);
  const wait = Math.max(0, Math.min(MAX_WAIT_SECONDS, parseInt(q.wait, 10) || 0));
  if (wait) await new Promise((r) => setTimeout(r, wait * 1000));

  let redis = { configured: store.persistent, answers: false };
  if (store.persistent) {
    try { await store.incr('health:ping', 60); redis.answers = true; } catch (e) { redis.answers = false; }
  }
  const ctx = context.load();

  guard.send(res, 200, {
    ok: true,
    runtime: { node: process.version, vercel_environment: process.env.VERCEL_ENV || null, region: process.env.VERCEL_REGION || null },
    waited_seconds: wait,
    elapsed_ms: Date.now() - started,
    settings_present: {
      TOOLS_SECRET: guard.env('TOOLS_SECRET').length >= 24,
      TURNSTILE_SECRET: has('TURNSTILE_SECRET'),
      GEMINI_SEO_API_KEY: has('GEMINI_SEO_API_KEY'),
      OPENROUTER_API_KEY: has('OPENROUTER_API_KEY'),
      LEAD_WEBHOOK_URL: /^https:\/\//.test(guard.env('LEAD_WEBHOOK_URL')),
      LEAD_WEBHOOK_SECRET: guard.env('LEAD_WEBHOOK_SECRET').length >= 24,
      SITE_URL: /^https:\/\//.test(guard.env('SITE_URL')),
      APP_URL: /^https:\/\//.test(guard.env('APP_URL')),
      OPEN_PAGERANK_KEY: has('OPEN_PAGERANK_KEY')
    },
    paid_keys_present_but_unused: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY'].filter(has),
    redis,
    agency_context: { readable: ctx.found, bytes: ctx.bytes, found_in: ctx.where },
    bot_check_required: guard.botCheckRequired()
  });
});
