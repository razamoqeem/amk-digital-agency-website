'use strict';
/* AMK Digital Agency Website: domain rank from Open PageRank (served at /v1/tools/domain-rank).
   Switched on only when OPEN_PAGERANK_KEY is set. The key stays on the server. */
const guard = require('./_lib/guard');
const { runTool } = require('./_lib/run-tool');
const { ToolError } = require('./_lib/analyze');
const D = require('./_lib/domain');

module.exports = guard.endpoint(async (req, res) => {
  const ctx = await guard.door(req, res, { rateKind: 'tool' });
  if (!ctx) return;
  if (!guard.env('OPEN_PAGERANK_KEY')) return ctx.fail(404, 'not_available', 'This tool is not switched on yet.');
  let domain;
  try { domain = D.cleanDomain(ctx.body.domain); }
  catch (e) { if (e instanceof ToolError) return ctx.fail(e.status, e.code, e.message); throw e; }
  await runTool(ctx, { tool: 'domain-rank', group: 'rank', cacheKey: 'rank:' + domain, work: () => D.getDomainRank(domain), shape: (d) => d });
});
