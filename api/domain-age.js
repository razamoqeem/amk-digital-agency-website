'use strict';
/* KivoReach Website: domain age from RDAP (served at /v1/tools/domain-age). */
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
  await runTool(ctx, { tool: 'domain-age', group: 'registry', cacheKey: 'age:' + domain, work: () => D.getDomainAge(domain), shape: D.freshAge });
});
