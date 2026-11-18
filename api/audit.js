'use strict';
/* KivoReach Website: SEO audit and page scan (served at /v1/tools/seo-audit and /v1/tools/site-scan). */
const guard = require('./_lib/guard');
const { runTool, sha } = require('./_lib/run-tool');
const { ToolError, crawl, checkedUrl } = require('./_lib/analyze');

const host = (u) => { try { return new URL(u).host; } catch (e) { return ''; } };

function auditShape(report) {
  const s = report.sections || {}, security = s.security || {}, cr = s.crawlability || {}, on = s.on_page || {};
  const robots = (s.indexability || {}).meta_robots || '';
  const crawler = robots.includes('noindex') ? 'Blocked from search (noindex)' : !cr.robots_txt ? 'Allowed (no robots.txt found)' : 'Open to search engines';
  const f = report.findings || [];
  return {
    domain: host(report.final_url || report.url), score: report.score, grade: report.grade, issue_counts: report.issue_counts, total_issues: report.total_issues,
    metrics: { crawler_access: crawler, https: security.https ? 'Secure (HTTPS)' : 'Not secure (no HTTPS)', word_count: on.word_count },
    most_important_fix: f.length ? (f[0].title + ': ' + (f[0].recommendation || '')).replace(/: $/, '') : '',
    top_findings: f.slice(0, 5).map((x) => ({ severity: x.severity, title: x.title }))
  };
}

const scanShape = (keyword) => (report) => {
  const s = report.sections || {}, on = s.on_page || {};
  const match = keyword ? { in_title: (on.title || '').toLowerCase().includes(keyword), in_description: (on.meta_description || '').toLowerCase().includes(keyword) } : null;
  const data = {};
  ['on_page', 'images', 'structured_data', 'security', 'crawlability', 'international', 'tech_stack', 'llms_txt', 'social'].forEach((n) => { data[n] = s[n] || {}; });
  return { ...data, domain: host(report.final_url || report.url), score: report.score, keyword_match: match };
};

module.exports = guard.endpoint(async (req, res) => {
  const tool = guard.queryOf(req).tool;
  if (tool !== 'seo-audit' && tool !== 'site-scan') return guard.send(res, 404, { ok: false, error: { code: 'not_found', message: 'There is no tool with that name.' } });
  const ctx = await guard.door(req, res, { rateKind: 'tool' });
  if (!ctx) return;
  let url;
  try { url = await checkedUrl(ctx.body.url); }
  catch (e) { if (e instanceof ToolError) return ctx.fail(e.status, e.code, e.message); throw e; }
  const keyword = String(ctx.body.keyword || '').trim().toLowerCase().slice(0, 100);
  await runTool(ctx, { tool, group: 'crawl', cacheKey: 'crawl:' + sha(url), work: () => crawl(url), shape: tool === 'seo-audit' ? auditShape : scanShape(keyword) });
});
