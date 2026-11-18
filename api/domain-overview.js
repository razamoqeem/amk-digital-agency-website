'use strict';
/* KivoReach Website: domain overview (served at /v1/tools/domain-overview). */
const guard = require('./_lib/guard');
const { runTool } = require('./_lib/run-tool');
const { ToolError } = require('./_lib/analyze');
const D = require('./_lib/domain');

module.exports = guard.endpoint(async (req, res) => {
  const ctx = await guard.door(req, res, { rateKind: 'tool' });
  if (!ctx) return;
  let domain;
  try { domain = D.cleanDomain(ctx.body.domain); }
  catch (e) { if (e instanceof ToolError) return ctx.fail(e.status, e.code, e.message); throw e; }
  await runTool(ctx, { tool: 'domain-overview', group: 'crawl', cacheKey: 'overview:' + domain, work: () => D.overview(domain), shape: (data) => ({ ...data, registration: D.freshAge(data.registration) }) });
});
