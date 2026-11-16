#!/usr/bin/env node
/* AMK Digital Agency Website: check the structured data (JSON-LD) on every built page. No dependencies.
   Run after a build:  node scripts/validate-schema.mjs [folder]      (default: public)
   Checks: valid JSON, schema.org context, no raw "<", every @id link points to a node that exists,
   one Organization/WebSite per page, breadcrumb positions 1..n, required fields per type, no ratings
   or reviews (we never publish them). Exit code 1 if anything fails. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] || 'public';
const REQUIRED = {
  Organization: ['name', 'url', 'logo'],
  WebSite: ['name', 'url'],
  WebPage: ['url', 'name'], CollectionPage: ['url', 'name'], AboutPage: ['url', 'name'], ProfilePage: ['url', 'name'],
  Person: ['name'],
  SoftwareApplication: ['name', 'applicationCategory', 'operatingSystem'],
  WebApplication: ['name', 'url', 'applicationCategory', 'offers'],
  TechArticle: ['headline', 'publisher'],
  BreadcrumbList: ['itemListElement'],
  ItemList: ['itemListElement'],
  FAQPage: ['mainEntity'],
};
const FORBIDDEN = ['aggregateRating', 'review', 'Review', 'AggregateRating'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}
function refs(value, found = []) {
  if (Array.isArray(value)) value.forEach((v) => refs(v, found));
  else if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '@id') found.push(value['@id']);
    else keys.forEach((k) => refs(value[k], found));
  }
  return found;
}

let pages = 0, blocks = 0;
const errors = [];
for (const file of walk(root)) {
  const html = readFileSync(file, 'utf8');
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  const rel = relative(root, file);
  let m, any = false;
  while ((m = re.exec(html))) {
    any = true; blocks++;
    const fail = (msg) => errors.push(rel + ': ' + msg);
    if (m[1].includes('<')) fail('raw "<" inside JSON-LD (must be \\u003c)');
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { fail('invalid JSON: ' + e.message); continue; }
    if (data['@context'] !== 'https://schema.org') fail('missing @context https://schema.org');
    const nodes = Array.isArray(data['@graph']) ? data['@graph'] : [data];
    const ids = new Set(nodes.map((n) => n['@id']).filter(Boolean));
    const count = {};
    for (const n of nodes) {
      const type = n['@type'];
      count[type] = (count[type] || 0) + 1;
      for (const f of REQUIRED[type] || []) if (n[f] == null || n[f] === '') fail(type + ' is missing "' + f + '"');
      for (const f of FORBIDDEN) if (JSON.stringify(n).includes('"' + f + '"')) fail(type + ' contains "' + f + '" (never published)');
      if (type === 'BreadcrumbList' || type === 'ItemList') {
        (n.itemListElement || []).forEach((it, i) => { if (it.position !== i + 1) fail(type + ' position ' + it.position + ' should be ' + (i + 1)); });
      }
      if (type === 'WebApplication' && n.offers && n.offers.price !== '0') fail('WebApplication offers a price that is not shown on the page');
    }
    for (const id of refs(nodes)) if (!ids.has(id)) fail('@id link points to nothing in this page: ' + id);
    for (const t of ['Organization', 'WebSite']) if ((count[t] || 0) > 1) fail('more than one ' + t);
  }
  if (any) pages++;
}

console.log('Structured data: ' + blocks + ' block(s) on ' + pages + ' page(s) checked in ' + root + '/');
if (!blocks) console.log('No structured data found. It is only built when SITE_URL is set.');
if (errors.length) { console.log(errors.length + ' problem(s):'); errors.forEach((e) => console.log('  - ' + e)); process.exit(1); }
console.log('No problems found.');
