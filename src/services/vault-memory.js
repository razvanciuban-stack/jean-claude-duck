// vault-memory.js — what the chat can recall: a small full-text index over Mysthi's own notes, with sources.
// Reads only through the vault (lexical + realpath checks), never outside ~/ObsidianVault/mysthi.

// The folders the chat can recall from — one list, used for indexing and refreshing alike
const INDEXED_DIRS = ['lessons', 'knowledge', 'log', 'memory'];
// Notes you asked her to keep are facts from you; everything else she inferred from your screen
const sourceOf = (dir) => (dir === 'memory' ? 'user-explicit' : 'screen-derived');

const K1 = 1.2;
const B = 0.75;
const TITLE_BOOST = 1.5;

// Common words that match everything and say nothing (English + Romanian, already without diacritics)
const STOPWORDS = new Set((
  'the a an and or of to in on at for with from by is are was were be been it this that these those i you he she we they ' +
  'me my your our their what which who how when where why do does did can could would should will just about into then ' +
  'si sau de la in pe cu din ce cum cand unde care cine este sunt am ai au fi fost un o unei unui al ale lui le nu da mai ' +
  'eu tu el ea noi voi ei ele imi iti ma te se sa ca dar pentru prin despre asta acest aceasta acel acea fac face facut'
).split(' '));

// Lowercase, no diacritics: "Iconițe" and "iconite" are the same word
function normalize(text) {
  return String(text).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

function tokenize(text) {
  return (normalize(text).match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Notes are written in English, questions often come in Romanian. Everyday computer words (stems, no
// diacritics) get their English word added to the question; a stem matches any Romanian ending.
const RO_EN = [
  ['scurtatur', 'shortcut'], ['tastatur', 'keyboard'], ['tast', 'key'], ['fisier', 'file'], ['dosar', 'folder'],
  ['numesc', 'name naming'], ['numes', 'name naming'], ['nume', 'name naming'], ['redenumesc', 'rename'],
  ['salvez', 'save'], ['salva', 'save'], ['deschid', 'open'], ['inchid', 'close'], ['sterg', 'delete'],
  ['copiez', 'copy'], ['copia', 'copy'], ['lipesc', 'paste'], ['lipi', 'paste'], ['duplic', 'duplicate'],
  ['trimit', 'send'], ['mesaj', 'message'], ['retea', 'network'], ['setari', 'settings'], ['strat', 'layer'],
  ['spatiu', 'workspace'], ['aplicati', 'app'], ['fereastr', 'window'], ['traducer', 'translation'],
  ['cautar', 'search'], ['caut', 'search'], ['export', 'export'], ['import', 'import'], ['imagin', 'image'],
  ['iconit', 'icon'], ['pagin', 'page'], ['legatur', 'link'], ['link', 'link'], ['ecran', 'screen'],
  ['lansez', 'launch'], ['pornesc', 'launch start'],
];
function expandQuestion(question) {
  const extra = [];
  for (const w of normalize(question).match(/[\p{L}\p{N}]+/gu) || []) {
    for (const [stem, en] of RO_EN) if (w.startsWith(stem) && stem !== en) { extra.push(en); break; }
  }
  return extra.length ? `${question} ${extra.join(' ')}` : question;
}

function frontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  return m ? { raw: m[1], body: md.slice(m[0].length) } : { raw: '', body: md };
}

function titleOf(md, file) {
  const fm = /^title:\s*"?(.+?)"?\s*$/m.exec(frontmatter(md).raw);
  if (fm) return fm[1].replace(/\\"/g, '"');
  const h = /^#\s+(.+)$/m.exec(frontmatter(md).body);
  return h ? h[1].trim() : file.replace(/\.md$/, '').replace(/-/g, ' ');
}

// The readable part of a note: no frontmatter, no lesson JSON block, no step markers, no role jargon
function readableText(md) {
  return frontmatter(md.replace(/\r\n?/g, '\n')).body
    .replace(/```mysthi-lesson[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\bAX[A-Z][A-Za-z]*\s*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The part of a note worth showing: from the first line that matches the question, up to maxChars
function snippetFor(text, queryTokens, maxChars) {
  const lines = text.split('\n');
  const matches = (w) => queryTokens.some((q) => w === q || (q.length >= 4 && w.startsWith(q)));
  let start = lines.findIndex((l) => tokenize(l).some(matches));
  if (start < 0) start = 0;
  // Keep a heading line just above the match for context
  if (start > 0 && /^#/.test(lines[start - 1])) start -= 1;
  let out = '';
  for (const line of lines.slice(start)) {
    if (out.length + line.length + 1 > maxChars) break;
    out += (out ? '\n' : '') + line;
  }
  return out || text.slice(0, maxChars);
}

// vault: from createVault. budget: max characters of excerpts per question; perNote: max per note.
function createVaultMemory({ vault, dirs = INDEXED_DIRS, budget = 3000, perNote = 700, maxNotes = 5 }) {
  const docs = new Map(); // relPath -> { mtime, title, text, source, tf: Map, titleTokens: Set, len }

  // Cheap refresh: re-read only notes whose modification time changed; forget deleted ones
  function refresh() {
    const seen = new Set();
    for (const dir of dirs) {
      let files = [];
      try { files = vault.list(dir); } catch { files = []; }
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const rel = `${dir}/${file}`;
        const mtime = vault.mtime(rel);
        if (mtime == null) continue; // missing, or a link that leaves the vault
        seen.add(rel);
        const known = docs.get(rel);
        if (known && known.mtime === mtime) continue;
        let md;
        try { md = vault.read(rel); } catch { md = null; }
        if (md == null) { docs.delete(rel); continue; }
        const title = titleOf(md, file);
        const text = readableText(md);
        const tf = new Map();
        const tokens = tokenize(`${title}\n${text}`);
        for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
        docs.set(rel, { mtime, title, text, source: sourceOf(dir), tf, titleTokens: new Set(tokenize(title)), len: tokens.length || 1 });
      }
    }
    for (const rel of [...docs.keys()]) if (!seen.has(rel)) docs.delete(rel);
  }

  // How often word t appears in a note. Romanian endings vary (export / exportă / exportat), so a word of
  // 4+ letters also counts its longer forms; the exact form counts double.
  function freq(tf, t) {
    let f = (tf.get(t) || 0) * 2;
    if (t.length >= 4) for (const [k, n] of tf) if (k !== t && k.startsWith(t)) f += n;
    return f / 2;
  }
  const hasWord = (set, t) => set.has(t) || (t.length >= 4 && [...set].some((k) => k.startsWith(t)));

  // Best-matching notes for a question: [{ path, title, snippet, source, score }], within the character budget
  function search(question) {
    refresh();
    const q = [...new Set(tokenize(expandQuestion(question)))];
    if (!q.length || !docs.size) return [];
    const N = docs.size;
    const avgLen = [...docs.values()].reduce((s, d) => s + d.len, 0) / N;
    const df = new Map(q.map((t) => [t, 0]));
    for (const d of docs.values()) for (const t of q) if (freq(d.tf, t) > 0) df.set(t, df.get(t) + 1);
    const idf = (t) => Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));

    const scored = [];
    for (const [rel, d] of docs) {
      let score = 0;
      for (const t of q) {
        const f = freq(d.tf, t);
        if (f) score += idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avgLen)));
        if (hasWord(d.titleTokens, t)) score += TITLE_BOOST * idf(t);
      }
      if (score > 0) scored.push({ rel, d, score });
    }
    scored.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));

    const out = [];
    let used = 0;
    for (const { rel, d, score } of scored.slice(0, maxNotes)) {
      const room = Math.min(perNote, budget - used);
      if (room < 120) break;
      const snippet = snippetFor(d.text, q, room);
      used += snippet.length;
      out.push({ path: rel, title: d.title, snippet, source: d.source, score: Math.round(score * 100) / 100 });
    }
    return out;
  }

  return { search, refresh, size: () => docs.size };
}

module.exports = { createVaultMemory, INDEXED_DIRS, normalize, tokenize, readableText, expandQuestion };
