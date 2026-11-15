'use strict';
/* AMK Digital Agency Website: small HTML reader (no dependencies).
   It only extracts what the SEO checks need. It never runs or renders the page,
   and every value it returns is plain text. */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };

function decodeEntities(text) {
  return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attrs(tagText) {
  const out = {};
  const re = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  const body = tagText.replace(/^<\s*[a-z0-9-]+/i, '').replace(/\/?>$/, '');
  while ((m = re.exec(body))) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decodeEntities(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '');
  }
  return out;
}

function tags(html, name) {
  const re = new RegExp('<' + name + '\\b[^>]*>', 'gi');
  return (html.match(re) || []).map((t) => attrs(t));
}

function clip(text, limit) { return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit); }

/* Parse once, then ask questions of the result. */
function parse(rawHtml) {
  const noComments = String(rawHtml || '').replace(/<!--[\s\S]*?-->/g, '');
  const noBlocks = noComments.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const metas = tags(noComments, 'meta');
  const links = tags(noComments, 'link');

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(noComments);
  const htmlTag = /<html\b[^>]*>/i.exec(noComments);

  const doc = {
    title: titleMatch ? clip(decodeEntities(titleMatch[1]), 500) : '',
    lang: htmlTag ? (attrs(htmlTag[0]).lang || null) : null,
    metas, links,
    meta(name, key = 'name') {
      const m = metas.find((x) => (x[key] || '').toLowerCase() === name.toLowerCase() && x.content != null);
      return m ? clip(m.content, 500) : null;
    },
    metaPrefix(prefix, key) {
      const out = {};
      metas.forEach((m) => {
        const k = (m[key] || '').toLowerCase();
        if (k.startsWith(prefix) && m.content) out[k.slice(prefix.length)] = clip(m.content, 300);
      });
      return out;
    },
    hasCharset: metas.some((m) => m.charset),
    charset: (metas.find((m) => m.charset) || {}).charset || null,
    canonical() {
      const l = links.find((x) => (x.rel || '').toLowerCase().split(/\s+/).includes('canonical'));
      return l && l.href ? l.href : null;
    },
    alternates() { return links.filter((x) => (x.rel || '').toLowerCase().split(/\s+/).includes('alternate') && x.hreflang); },
    headings() {
      const out = [];
      const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
      let m;
      while ((m = re.exec(noBlocks))) out.push({ level: Number(m[1]), text: clip(stripTags(m[2]), 200) });
      return out;
    },
    images() { return tags(noComments, 'img'); },
    anchors() {
      const out = [];
      const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
      let m;
      while ((m = re.exec(noBlocks))) {
        const a = attrs('<a ' + m[1] + '>');
        if (a.href !== undefined) out.push({ href: a.href.trim(), rel: a.rel || '', text: clip(stripTags(m[2]), 120) });
      }
      return out;
    },
    jsonLd() {
      const out = [];
      const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
      let m;
      while ((m = re.exec(noComments))) out.push(m[1]);
      return out;
    },
    text() { return stripTags(noBlocks); },
    resourceUrls() {
      const out = [];
      [['img', 'src'], ['script', 'src'], ['link', 'href'], ['iframe', 'src'], ['source', 'src'], ['video', 'src']].forEach(([t, a]) => {
        tags(noComments, t).forEach((x) => { if (x[a]) out.push(x[a]); });
      });
      return out;
    },
    raw: noComments
  };
  return doc;
}

module.exports = { parse, stripTags, decodeEntities, clip, attrs };
