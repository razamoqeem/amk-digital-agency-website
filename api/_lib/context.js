'use strict';
/* KivoReach Website: loads AGENCY_CONTEXT.md, the only source of facts for the chat assistant.
   Shared by api/chat.js and api/health.js so the health check proves exactly what the chat can read. */
const fs = require('fs');
const path = require('path');

const BUILT_IN = 'KivoReach is an AI-based digital marketing and SEO agency. It offers SEO, AI search (GEO/AEO), paid ads and social, email marketing, lead generation and strategy, plus free SEO tools. Plans, prices and contact details are not published yet.';

function load() {
  const places = [['project folder', path.join(process.cwd(), 'AGENCY_CONTEXT.md')], ['above api/_lib', path.join(__dirname, '..', '..', 'AGENCY_CONTEXT.md')], ['api folder', path.join(__dirname, '..', 'AGENCY_CONTEXT.md')]];
  for (const [where, file] of places) {
    try {
      const text = fs.readFileSync(file, 'utf8').trim();
      if (text) return { text: text.slice(0, 8000), found: true, where, bytes: Buffer.byteLength(text) };
    } catch (e) { /* try the next place */ }
  }
  return { text: BUILT_IN, found: false, where: null, bytes: 0 };
}

module.exports = { load };
