'use strict';
/* AMK Digital Agency Website: the shared path every tool request takes.
   Order: front door (method, same-origin, rate limit, JSON) > saved result > bot check >
   visitor allowance > network allowance > daily budget > the real work > count. */
const crypto = require('crypto');
const guard = require('./guard');
const store = require('./store');
const { ToolError } = require('./analyze');

const CACHE_SECONDS = guard.intEnv('TOOLS_CACHE_HOURS', 24) * 3600;
const IP_DAILY_RUNS = guard.intEnv('TOOLS_IP_DAILY_RUNS', 30);
const appUrl = () => { const v = guard.env('APP_URL').replace(/\/+$/, ''); return /^https?:\/\//.test(v) ? v : ''; };
const sha = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');

/* tool: name shown to the page; group: budget group; cacheKey: saved-result key;
   work(): returns data or throws ToolError; shape(data): what the page receives. */
async function runTool(ctx, { tool, group, cacheKey, work, shape }) {
  const { res, ip, vid, cookies, body } = ctx;
  const reply = (status, payload, extra = {}) => guard.send(res, status, payload, { cookies, ...extra });
  const fail = async (status, code, message, extra) => {
    const out = { ok: false, tool, error: { code, message } };
    try { out.runs = await guard.runsInfo(vid, tool); } catch (e) { /* the message still goes out */ }
    if (code === 'limit_reached') out.upgrade_url = appUrl() ? appUrl() + '/signup?ref=' + tool : '';
    reply(status, out, extra);
  };
  const ok = async (data, cached) => reply(200, { ok: true, tool, cached, runs: await guard.runsInfo(vid, tool), data: shape(data) });

  try {
    const hit = store.cacheGet(cacheKey);
    if (hit) return await ok(hit, true);

    const verdict = await guard.botCheck(String(body.turnstile_token || ''), ip);
    if (verdict === 'unavailable') return fail(503, 'bot_check_unavailable', 'The security check for this service is not set up yet.');
    if (verdict !== 'ok') return fail(403, 'bot_check_failed', 'Please complete the check and try again.');

    const runs = await guard.runsInfo(vid, tool);
    if (runs.limits.blocked_by) return fail(429, 'limit_reached', runs.limits.message);

    const ipKey = 'ipd:' + guard.hash('ip', ip) + ':' + tool + ':' + guard.day();
    if ((await store.incr(ipKey, guard.secondsToEndOfDay())) > IP_DAILY_RUNS) {
      return fail(429, 'rate_limited', "This network has reached today's free limit for this tool. Please try again tomorrow.", { retryAfter: 3600 });
    }
    if (await guard.budgetFull(group)) return fail(503, 'busy', 'The free tools are in high demand right now. Please try again later.', { retryAfter: 3600 });

    let data;
    try { data = await work(); }
    catch (e) {
      if (e instanceof ToolError) return fail(e.status, e.code, e.message);
      return fail(500, 'tool_error', 'Something went wrong while running this tool. Please try again.');
    }
    await Promise.all([guard.countRun(vid, tool), guard.budgetAdd(group)]);
    store.cacheSet(cacheKey, data, CACHE_SECONDS);
    return await ok(data, false);
  } catch (e) {
    return fail(503, 'busy', 'Please try again in a moment.');
  }
}

module.exports = { runTool, sha };
