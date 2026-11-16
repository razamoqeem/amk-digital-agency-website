'use strict';
/* AMK Digital Agency Website: free-audit / invite request form (served at /v1/leads and /api/lead).

   Where the request goes (the owner chooses one, both are private to the owner):
     LEAD_WEBHOOK_URL  an https address that receives the request as JSON (for example a Slack, Make, Zapier or Apps Script webhook)
     or the Redis store (UPSTASH_REDIS_REST_URL / _TOKEN), where requests are kept in a list.
   With neither set, the form says it is not available instead of pretending it worked.

   Webhook verification: when LEAD_WEBHOOK_SECRET is set, every delivery carries
     X-AMK-Timestamp   seconds since 1970
     X-AMK-Signature   sha256=<hex>  =  HMAC-SHA256(secret, timestamp + "." + exact request body)
   The receiver recomputes it, compares in constant time, and rejects timestamps older than 5 minutes.
   A receiver check: recompute the HMAC over timestamp + "." + raw body, compare in constant time. */
const crypto = require('crypto');
const store = require('./_lib/store');
const guard = require('./_lib/guard');

const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = guard.endpoint(async (req, res) => {
  const ctx = await guard.door(req, res, { rateKind: 'lead', perMinute: 5, maxBytes: 8000 });
  if (!ctx) return;
  const reply = (status, body) => guard.send(res, status, body, { cookies: ctx.cookies });
  const fail = (status, code, message) => reply(status, { ok: false, error: { code, message } });

  // Hidden field a person never fills in: bots do. Pretend it worked so they learn nothing.
  if (clean(ctx.body.company_site, 100)) return reply(200, { ok: true, status: 'received' });

  const name = clean(ctx.body.name, 80), email = clean(ctx.body.email, 254).toLowerCase(), website = clean(ctx.body.website, 200);
  if (!name) return fail(400, 'invalid_name', 'Please enter your name.');
  if (!EMAIL_RE.test(email)) return fail(400, 'invalid_email', 'Please enter a valid email address.');
  if (website && !/^(https?:\/\/)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/:?#].*)?$/i.test(website)) return fail(400, 'invalid_website', 'Please enter a valid website address.');
  if (ctx.body.consent !== true) return fail(400, 'consent_required', 'Please agree to be contacted about your request.');

  const verdict = await guard.botCheck(String(ctx.body.turnstile_token || ''), ctx.ip);
  if (verdict === 'unavailable') return fail(503, 'bot_check_unavailable', 'The security check for this form is not set up yet.');
  if (verdict !== 'ok') return fail(403, 'bot_check_failed', 'Please complete the check and try again.');

  // At most 5 requests a day from one network, so the inbox cannot be flooded.
  try { if ((await store.incr('lead:ip:' + guard.hash('ip', ctx.ip) + ':' + guard.day(), guard.secondsToEndOfDay())) > 5) return fail(429, 'rate_limited', 'Too many requests from this network today. Please try again tomorrow.'); }
  catch (e) { return fail(503, 'busy', 'Please try again in a moment.'); }

  const message = clean(ctx.body.message, 1000);
  const record = { name, email, website: website || null, message: message || null, source: clean(ctx.body.source, 40) || 'chat', submitted_at: new Date().toISOString() };
  const hook = guard.env('LEAD_WEBHOOK_URL');
  try {
    if (/^https:\/\//.test(hook)) {
      const payload = JSON.stringify(record);
      const headers = { 'Content-Type': 'application/json', 'User-Agent': 'AMK-Website-Lead/1.0' };
      const hookSecret = guard.env('LEAD_WEBHOOK_SECRET');
      if (hookSecret) {
        const ts = String(Math.floor(Date.now() / 1000));
        headers['X-AMK-Timestamp'] = ts;
        headers['X-AMK-Signature'] = 'sha256=' + crypto.createHmac('sha256', hookSecret).update(ts + '.' + payload).digest('hex');
      }
      const r = await fetch(hook, { method: 'POST', redirect: 'error', headers, body: payload, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return fail(502, 'delivery_failed', 'Your request could not be sent. Please try again later.');
    } else if (!(await store.push('leads', record))) {
      return fail(503, 'not_configured', 'This form is not available yet. Please try again later.');
    }
  } catch (e) { return fail(502, 'delivery_failed', 'Your request could not be sent. Please try again later.'); }
  return reply(200, { ok: true, status: 'received' });
});
