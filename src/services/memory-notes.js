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
function saveMemory({ vault, fact, now = new Date(), replaces = null }) {
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
    ...(replaces ? [`replaces: ${JSON.stringify(replaces)}`] : []),
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

// --- Correct, delete, trash. Only your own notes (memory/<file>.md) — lessons are edited in Obsidian. ---

const MEMORY_NOTE = /^memory\/[^/\\]+\.md$/;
const TRASH = '.trash';

function checkOwnNote(vault, rel) {
  const p = String(rel || '');
  if (!MEMORY_NOTE.test(p) || p.includes('..') || vault.isLink(p)) {
    throw new Error('Only your own notes (memory/) can be changed here');
  }
  if (!vault.exists(p)) throw new Error('Note not found');
  return p;
}

const statusOf = (md) => ((/^---\n[\s\S]*?^status:\s*"?([a-z-]+)"?\s*$[\s\S]*?^---$/m.exec(md || '') || [])[1] || 'active');

// Set (or add) frontmatter fields, leaving everything else as it was
function setFields(md, fields) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  const lines = m ? m[1].split('\n') : [];
  for (const [k, v] of Object.entries(fields)) {
    const line = `${k}: ${v}`;
    const i = lines.findIndex((l) => l.startsWith(`${k}:`));
    if (i >= 0) lines[i] = line; else lines.push(line);
  }
  const body = m ? md.slice(m[0].length) : md;
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

// Is this note still what she should rely on? (gone, deleted or superseded → no)
function isActiveNote(vault, rel) {
  if (!vault.exists(rel)) return false;
  return statusOf(vault.read(rel)) !== 'superseded';
}

// A new note with the right version; the old one stays as history, marked superseded
function correctMemory({ vault, path: rel, fact, now = new Date() }) {
  const p = checkOwnNote(vault, rel);
  const md = vault.read(p);
  if (statusOf(md) === 'superseded') throw new Error('This note was already replaced; correct the newest one');
  const fresh = saveMemory({ vault, fact, now, replaces: p });
  vault.writeAtomic(p, setFields(md, {
    status: 'superseded',
    updated: JSON.stringify(now.toISOString()),
    superseded_by: JSON.stringify(fresh.path),
  }));
  return { ...fresh, replaced: p };
}

// Moves the note to mysthi/.trash/ (never searched); emptyTrash removes it for good
// The older versions too (the notes it replaced, and those before them): deleting a fact removes all of it.
function deleteMemory({ vault, path: rel }) {
  const p = checkOwnNote(vault, rel);
  const toTrash = (notePath) => {
    const name = notePath.slice('memory/'.length, -3);
    let trashPath = `${TRASH}/${name}.md`;
    for (let n = 2; vault.exists(trashPath); n++) trashPath = `${TRASH}/${name}-${n}.md`;
    vault.move(notePath, trashPath);
    return trashPath;
  };
  const older = [];
  let prev = (/^replaces:\s*"([^"]+)"\s*$/m.exec(vault.read(p) || '') || [])[1];
  while (prev && !older.includes(prev)) {
    try { checkOwnNote(vault, prev); } catch { break; }
    older.push(prev);
    prev = (/^replaces:\s*"([^"]+)"\s*$/m.exec(vault.read(prev) || '') || [])[1];
  }
  const trashPath = toTrash(p);
  older.forEach(toTrash);
  return { path: p, trashPath, olderVersions: older.length };
}

function emptyTrash({ vault }) {
  let removed = 0;
  for (const f of vault.list(TRASH)) {
    const rel = `${TRASH}/${f}`;
    if (vault.isLink(rel) || !f.endsWith('.md')) continue;
    vault.remove(rel);
    removed++;
  }
  return removed;
}

module.exports = { parseRemember, saveMemory, correctMemory, deleteMemory, emptyTrash, isActiveNote };
