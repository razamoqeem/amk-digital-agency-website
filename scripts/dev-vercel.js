'use strict';
/* AMK Digital Agency Website: local stand-in for Vercel (testing only, never deployed).
   Serves public/, applies the rewrites and headers from vercel.json, and runs the files in api/ as functions.
   Run from the Website folder:  node scripts/dev-vercel.js [port]
   It does NOT read .env. Pass settings on the command line when you need them, for example:
     GEMINI_SEO_API_KEY=test AMK_DEV_FAKE_MODELS=1 node scripts/dev-vercel.js 8090
   AMK_DEV_FAKE_MODELS=1 answers the two AI model addresses with a fixed sample, so no real key or quota is used. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.ico': 'image/x-icon' };

if (process.env.AMK_DEV_FAKE_MODELS === '1') {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (/generativelanguage\.googleapis\.com|openrouter\.ai/.test(String(url))) {
      const q = (JSON.parse(init.body).messages || []).slice(-1)[0].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Sample reply (local test, no real model). You asked: ' + String(q).slice(0, 80) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return real(url, init);
  };
}

/* "/v1/tools/:tool" and "/(.*)" style patterns */
function pattern(source) {
  const esc = source.replace(/\(\.\*\)/g, '\u0001').replace(/[.+?^${}|[\]\\()]/g, '\\$&').replace(/\u0001/g, '.*').replace(/:([a-zA-Z]+)/g, '(?<$1>[^/]+)');
  return new RegExp('^' + esc + '$');
}
const rewrites = (CONFIG.rewrites || []).map((r) => ({ re: pattern(r.source), to: r.destination }));
const headerRules = (CONFIG.headers || []).map((h) => ({ re: pattern(h.source), headers: h.headers }));

function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  let pathname = url.pathname;
  headerRules.forEach((rule) => { if (rule.re.test(pathname)) rule.headers.forEach((h) => res.setHeader(h.key, h.value)); });

  for (const r of rewrites) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    let dest = r.to;
    Object.entries(m.groups || {}).forEach(([k, v]) => { dest = dest.replace(':' + k, v); });
    const d = new URL(dest, 'http://x');
    url.searchParams.forEach((v, k) => { if (!d.searchParams.has(k)) d.searchParams.set(k, v); });
    pathname = d.pathname;
    req.url = d.pathname + d.search;
    break;
  }

  const api = /^\/api\/([a-z0-9-]+)$/.exec(pathname);
  if (api) {
    const file = path.join(ROOT, 'api', api[1] + '.js');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
    return require(file)(req, res);
  }

  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { res.statusCode = 400; return res.end('Bad request'); }
  if (rel.includes('..') || rel.includes('\0')) { res.statusCode = 400; return res.end('Bad request'); }
  let file = path.join(PUBLIC, rel);
  if (rel.endsWith('/')) file = path.join(file, 'index.html');
  else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) { res.statusCode = 308; res.setHeader('Location', rel + '/'); return res.end(); }
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    const nf = path.join(PUBLIC, '404.html');
    res.setHeader('Content-Type', MIME['.html']);
    return res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not found');
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
}

function createServer() { return http.createServer((req, res) => { try { handle(req, res); } catch (e) { res.statusCode = 500; res.end('Server error'); } }); }

if (require.main === module) {
  const port = Number(process.argv[2]) || 8090;
  createServer().listen(port, '127.0.0.1', () => console.log('Local test server: http://127.0.0.1:' + port + '/'));
}
module.exports = { createServer };
