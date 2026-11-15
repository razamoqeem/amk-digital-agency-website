'use strict';
/* AMK Digital Agency Website: safe outbound fetching (no dependencies).

   Every request that uses an address typed by a visitor goes through here.
   Protection layers:
     1. The address is checked: http(s) only, ports 80/443 only, no user name or
        password, no forbidden characters, no internal host names.
     2. The name is looked up and EVERY address it returns must be public.
     3. The connection is pinned to the address that was checked, so a name that
        changes its answer between the check and the connection (DNS rebinding)
        cannot reach an internal address.
     4. Each redirect is checked again, from step 1.
     5. Time and size limits: slow or huge answers are cut off.
*/
const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12000;
const USER_AGENT = 'Mozilla/5.0 (compatible; AMK-SEO-Check/2.0)';

class UnsafeUrlError extends Error {}
class FetchError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.localdomain'];
const FORBIDDEN_CHARS = /["'<>`^|\\{}\s\u0000-\u001f\u007f]/;

/* Ranges that are never public. net.BlockList does the matching. */
const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['2001::', 32], ['2002::', 16], ['100::', 64]
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv6'));

/* "::ffff:7f00:1" and "64:ff9b::7f00:1" carry an IPv4 address: test that one. */
function embeddedV4(ip) {
  const m = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m) return m[1];
  const h = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (h) {
    const hi = parseInt(h[1], 16), lo = parseInt(h[2], 16);
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  return null;
}

function isPublicIp(ip) {
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 6) {
    const inner = embeddedV4(ip.toLowerCase());
    if (inner) return isPublicIp(inner);
  }
  return !blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/* Returns { url: URL, ip: {address, family} } for a safe public address, or throws UnsafeUrlError. */
async function validatePublicUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw new UnsafeUrlError('A website URL is required.');
  let text = input.trim();
  if (text.length > MAX_URL_LENGTH) throw new UnsafeUrlError('That URL is too long.');
  if (FORBIDDEN_CHARS.test(text)) throw new UnsafeUrlError('That URL contains characters that are not allowed.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'https://' + text;

  let url;
  try { url = new URL(text); } catch (e) { throw new UnsafeUrlError("That doesn't look like a valid website address."); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('Only http:// and https:// addresses can be checked.');
  if (url.username || url.password) throw new UnsafeUrlError('URLs containing a username or password are not allowed.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new UnsafeUrlError("That doesn't look like a valid website address.");

  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) throw new UnsafeUrlError("That doesn't look like a valid website address.");
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError('Internal or private addresses cannot be checked.');
  }

  if (net.isIP(host)) {
    if (!isPublicIp(host)) throw new UnsafeUrlError('Internal or private addresses cannot be checked.');
    return { url, ip: { address: host, family: net.isIP(host) } };
  }
  if (!host.includes('.')) throw new UnsafeUrlError("That doesn't look like a valid website address.");

  let records;
  try { records = await dns.lookup(host, { all: true, verbatim: true }); }
  catch (e) { throw new UnsafeUrlError("That domain doesn't appear to exist. Check the address for typos."); }
  if (!records.length) throw new UnsafeUrlError("That domain doesn't appear to exist. Check the address for typos.");
  // ALL answers must be public: one internal address in the list is enough to refuse.
  if (!records.every((r) => isPublicIp(r.address))) throw new UnsafeUrlError('Internal or private addresses cannot be checked.');
  return { url, ip: { address: records[0].address, family: records[0].family } };
}

/* A DNS lookup that always answers with the address that was already checked. */
function pinnedLookup(ip) {
  return (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options ? options : {};
    if (opts.all) cb(null, [{ address: ip.address, family: ip.family }]);
    else cb(null, ip.address, ip.family);
  };
}

function classify(err) {
  const code = err && err.code;
  const text = String((err && err.message) || '');
  if (err instanceof UnsafeUrlError) return ['not_allowed', err.message];
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return ['dns', "That domain doesn't appear to resolve. Check the URL for typos."];
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timed? ?out/i.test(text)) return ['timeout', 'The site took too long to respond.'];
  if (/^(CERT_|DEPTH_ZERO|UNABLE_TO_|SELF_SIGNED|ERR_TLS_CERT)/.test(code || '') || /certificate/i.test(text)) return ['ssl', "The site's SSL certificate could not be verified."];
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return ['connection', 'Could not connect to that site.'];
  return ['connection', 'Could not fetch the page.'];
}

/* One request, no redirects followed. The address must already be validated. */
function requestOnce(checked, { method = 'GET', headers = {}, timeout = DEFAULT_TIMEOUT_MS, maxBytes = MAX_BODY_BYTES } = {}) {
  const { url, ip } = checked;
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (fn, value) => { if (!finished) { finished = true; clearTimeout(timer); fn(value); } };
    const req = lib.request({
      protocol: url.protocol, hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search, method, lookup: pinnedLookup(ip), servername: net.isIP(url.hostname) ? undefined : url.hostname,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                 'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'en-US,en;q=0.9', ...headers }
    }, (res) => {
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = []; let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
        if (size >= maxBytes) { req.destroy(); stream.destroy(); finish(); }   // cut off, never read fully
      });
      const finish = () => done(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).slice(0, maxBytes).toString('utf8') });
      stream.on('end', finish);
      stream.on('error', (e) => (chunks.length ? finish() : done(reject, e)));
    });
    const timer = setTimeout(() => { req.destroy(new Error('timed out')); done(reject, Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })); }, timeout);
    req.on('error', (e) => done(reject, e));
    req.end();
  });
}

/* GET with redirects: every hop is validated again. Returns { status, headers, body, url, history }.
   Throws FetchError (kind: not_allowed, dns, timeout, ssl, connection, redirects). */
async function safeGet(input, opts = {}) {
  const max = opts.maxRedirects == null ? MAX_REDIRECTS : opts.maxRedirects;
  const history = [];
  let current = input;
  for (let hop = 0; hop <= max; hop++) {
    let checked;
    try { checked = await validatePublicUrl(current); }
    catch (e) { const [kind, message] = classify(e); throw new FetchError(kind, message); }
    let res;
    try { res = await requestOnce(checked, opts); }
    catch (e) { const [kind, message] = classify(e); throw new FetchError(kind, message); }
    const location = res.headers.location;
    if ([301, 302, 303, 307, 308].includes(res.status) && location && !opts.noFollow) {
      history.push({ url: checked.url.href, status: res.status });
      try { current = new URL(location, checked.url).href; } catch (e) { throw new FetchError('not_allowed', 'The site redirects to an invalid address.'); }
      continue;
    }
    return { ...res, url: checked.url.href, history, ip: checked.ip };
  }
  throw new FetchError('redirects', 'The site redirects too many times.');
}

/* One request without following redirects (used by the link checker). */
async function safeHead(input, opts = {}) {
  const checked = await validatePublicUrl(input);
  let res = await requestOnce(checked, { ...opts, method: 'HEAD', maxBytes: 1024 });
  if ([403, 405, 501].includes(res.status)) res = await requestOnce(checked, { ...opts, method: 'GET', maxBytes: 4096 });
  return { status: res.status, headers: res.headers, url: checked.url.href };
}

module.exports = { validatePublicUrl, safeGet, safeHead, isPublicIp, pinnedLookup, UnsafeUrlError, FetchError, classify };
