'use strict';
/* KivoReach Website: environment preflight.
   Tells you which settings are present or missing. It prints NAMES and a status only, never a value.

   Check the settings on your own PC (a .env file):   node scripts/check-env.js --file .env
   Check what you pulled from Vercel (vercel env pull): node scripts/check-env.js --file .env.production.local
   Check the current shell:                            node scripts/check-env.js
   Exit code 1 means a required setting is missing. */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
const env = Object.assign({}, process.env);

if (fileIdx >= 0) {
  const file = path.resolve(args[fileIdx + 1] || '.env');
  if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(2); }
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  });
}

const val = (n) => String(env[n] || '').trim();
const set = (n) => val(n) !== '' && !/^\[TO BE CONFIRMED\]$/i.test(val(n));
const configJs = (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8'); } catch (e) { return ''; } })();

const rows = [];
const add = (level, name, ok, note) => rows.push({ level, name, ok, note });

add('REQUIRED', 'TOOLS_SECRET', val('TOOLS_SECRET').length >= 24, 'at least 24 characters (signs the visitor cookie)');
add('REQUIRED', 'TURNSTILE_SECRET', set('TURNSTILE_SECRET'), 'bot-check secret key; without it production refuses tools, chat and form');
add('REQUIRED', 'turnstileSiteKey in js/config.js', /turnstileSiteKey:\s*"[0-9A-Za-z_-]{10,}"/.test(configJs), 'public site key, committed in js/config.js (not an environment value)');
add('REQUIRED', 'Redis store', (set('UPSTASH_REDIS_REST_URL') && set('UPSTASH_REDIS_REST_TOKEN')) || (set('KV_REST_API_URL') && set('KV_REST_API_TOKEN')), 'UPSTASH_REDIS_REST_URL + _TOKEN (or KV_REST_API_URL + _TOKEN); without it limits are per server instance only');
add('REQUIRED', 'Chat key', set('GEMINI_SEO_API_KEY') || set('OPENROUTER_API_KEY'), 'GEMINI_SEO_API_KEY and/or OPENROUTER_API_KEY (free-tier keys)');
add('REQUIRED', 'Request form destination', set('LEAD_WEBHOOK_URL') && /^https:\/\//.test(val('LEAD_WEBHOOK_URL')), 'LEAD_WEBHOOK_URL must be an https address (or rely on the Redis store)');
add('ADVISED', 'LEAD_WEBHOOK_SECRET', set('LEAD_WEBHOOK_SECRET') && val('LEAD_WEBHOOK_SECRET').length >= 24, 'signs each delivery so the receiver can verify it (24+ characters)');
add('ADVISED', 'HEALTH_TOKEN', val('HEALTH_TOKEN').length >= 24, 'switches on the owner-only /api/health check (24+ characters); lets you verify the deployed settings');
add('ADVISED', 'SITE_URL', /^https:\/\/[^/\s]+$/.test(val('SITE_URL')) && !/vercel\.app/.test(val('SITE_URL')), 'final https address, no trailing slash, not a *.vercel.app address');
add('ADVISED', 'APP_URL', /^https:\/\/[^/\s]+$/.test(val('APP_URL')) && !/vercel\.app/.test(val('APP_URL')), 'address of the App, when it exists');
add('OPTIONAL', 'OPEN_PAGERANK_KEY', set('OPEN_PAGERANK_KEY'), 'turns Domain Rank on (the free key works from one network address only)');
['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY'].forEach((n) => add('MUST NOT', n, !set(n), 'paid-provider key: do not add it to this project (the website never reads it)'));

const width = Math.max.apply(null, rows.map((r) => r.name.length));
let missing = 0, warn = 0;
console.log('');
rows.forEach((r) => {
  const status = r.level === 'MUST NOT' ? (r.ok ? 'ok     ' : 'REMOVE ') : (r.ok ? 'ok     ' : r.level === 'REQUIRED' ? 'MISSING' : r.level === 'ADVISED' ? 'advise ' : 'off    ');
  if (!r.ok && (r.level === 'REQUIRED')) missing++;
  if (!r.ok && (r.level === 'ADVISED' || r.level === 'MUST NOT')) warn++;
  console.log(status + '  ' + r.level.padEnd(9) + ' ' + r.name.padEnd(width) + '  ' + r.note);
});
console.log('\n' + (missing ? missing + ' required setting(s) missing.' : 'All required settings present.') + (warn ? ' ' + warn + ' item(s) to review.' : ''));
process.exit(missing ? 1 : 0);
