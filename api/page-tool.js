'use strict';
/* KivoReach Website: the single-purpose tools (served at /v1/tools/<name>). */
const guard = require('./_lib/guard');
const { runTool, sha } = require('./_lib/run-tool');
const A = require('./_lib/analyze');

const pick = (r, name) => (r.sections || {})[name] || {};
const TOOLS = {
  'meta-tags': ['page', A.pageDetails, (d) => ({ final_url: d.final_url, meta: d.meta })],
  'headings': ['page', A.pageDetails, (d) => ({ final_url: d.final_url, headings: d.headings })],
  'images': ['page', A.pageDetails, (d) => ({ final_url: d.final_url, images: d.images })],
  'keyword-density': ['page', A.pageDetails, (d) => ({ final_url: d.final_url, text: d.text, language: d.meta.language })],
  'links': ['links', A.checkLinks, (d) => d],
  'redirects': ['hops', A.redirectChain, (d) => d],
  'robots-sitemap': ['robots', A.robotsDetails, (d) => d],
  'ssl-check': ['ssl', A.sslDetails, (d) => d],
  'schema-social': ['crawl', A.crawl, (r) => ({ final_url: r.final_url, structured_data: pick(r, 'structured_data'), social: pick(r, 'social') })],
  'technology': ['crawl', A.crawl, (r) => ({ final_url: r.final_url, tech_stack: pick(r, 'tech_stack'), security: pick(r, 'security') })]
};

module.exports = guard.endpoint(async (req, res) => {
  const tool = String(guard.queryOf(req).tool || '').slice(0, 40);
  if (!Object.prototype.hasOwnProperty.call(TOOLS, tool)) return guard.send(res, 404, { ok: false, error: { code: 'not_found', message: 'There is no tool with that name.' } });
  const ctx = await guard.door(req, res, { rateKind: 'tool' });
  if (!ctx) return;
  const [prefix, run, shape] = TOOLS[tool];
  let url;
  try { url = await A.checkedUrl(ctx.body.url); }
  catch (e) { if (e instanceof A.ToolError) return ctx.fail(e.status, e.code, e.message); throw e; }
  if (prefix === 'robots' || prefix === 'ssl') { const u = new URL(url); url = u.protocol + '//' + u.host + '/'; }
  await runTool(ctx, { tool, group: 'crawl', cacheKey: prefix + ':' + sha(url), work: () => run(url), shape });
});
