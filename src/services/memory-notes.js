// memory-notes.js — notes you ask her to keep ("ține minte că…" / "remember…"), saved in mysthi/memory/.
// Only an explicit request saves anything. Your words are kept as you said them, after redaction.
const { redact } = require('../learning/redact');

const fold = (s) => String(s).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

// "ține minte (că|:|,) X" / "remember (that|:|,) X" at the very start → { fact, lang }; anything else → null
const TRIGGERS = [
  { lang: 'ro', re: /^tine\s+minte\b\s*(?:ca\b|[:,\-–—])?\s*/ },
  { lang: 'en', re: /^remember\b\s*(?:that\b|[:,\-–—])?\s*/ },
];
function parseRemember(text) {
  const raw = String(text || '').trim().normalize('NFC');
  const folded = fold(raw); // same length as raw: each composed letter (ț, ă, î…) folds to one plain letter
  for (const { lang, re } of TRIGGERS) {
    const m = re.exec(folded);
    if (m) return { fact: raw.slice(m[0].length).trim(), lang };
  }
  return null;
}

function slugOf(text) {
  const words = fold(text).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return words.join('-').slice(0, 50).replace(/-+$/, '') || 'note';
}

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Writes memory/<date>-<slug>.md atomically. Returns { path, text, changed } — text is what was saved,
// changed is true when redaction hid something (so she can show you what was kept).
function saveMemory({ vault, fact, now = new Date() }) {
  const original = String(fact || '').trim();
  if (!original) throw new Error('Nothing to remember');
  const text = redact(original).text.trim();
  const base = `memory/${localDate(now)}-${slugOf(text)}`;
  let rel = `${base}.md`;
  for (let n = 2; vault.exists(rel); n++) rel = `${base}-${n}.md`;
  const firstLine = text.split('\n')[0];
  const title = firstLine.length > 60 ? `${firstLine.slice(0, 59).trimEnd()}…` : firstLine;
  const stamp = now.toISOString();
  const md = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `created: "${stamp}"`,
    `updated: "${stamp}"`,
    'source: user-explicit',
    'status: active',
    '---',
    '',
    `# ${title}`,
    '',
    text,
    '',
  ].join('\n');
  vault.writeAtomic(rel, md);
  return { path: rel, text, changed: text !== original };
}

module.exports = { parseRemember, saveMemory };
