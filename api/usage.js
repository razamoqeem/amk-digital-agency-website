'use strict';
/* KivoReach Website: how many free runs this visitor has left (served at /v1/usage). */
const guard = require('./_lib/guard');

const TOOLS = ['seo-audit', 'site-scan', 'domain-age', 'domain-overview', 'meta-tags', 'headings', 'images', 'keyword-density', 'links', 'redirects', 'robots-sitemap', 'ssl-check', 'schema-social', 'technology'];

module.exports = guard.endpoint(async (req, res) => {
  const ctx = await guard.door(req, res, { method: 'GET', rateKind: 'usage', perMinute: 60 });
  if (!ctx) return;
  const tools = guard.env('OPEN_PAGERANK_KEY') ? TOOLS.concat('domain-rank') : TOOLS;
  const app = guard.env('APP_URL').replace(/\/+$/, '');
  guard.send(res, 200, { ok: true, runs: await guard.allRuns(ctx.vid, tools), upgrade_url: /^https?:\/\//.test(app) ? app + '/signup' : '' }, { cookies: ctx.cookies });
});
