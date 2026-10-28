// reports.js — Markdown reports written into the vault (daily log; weekly report added later)

const SECTIONS = ['New lessons', 'Updated lessons', 'New knowledge'];

function oneLine(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function link(lesson) {
  const title = oneLine(lesson.title).replace(/[|[\]]/g, ' ').replace(/\s+/g, ' ').trim() || lesson.slug;
  return `[[lessons/${lesson.slug}|${title}]]`;
}

function buildBullets({ lessons = [], facts = [] }) {
  const out = { 'New lessons': [], 'Updated lessons': [], 'New knowledge': [] };
  for (const r of lessons) {
    if (!r || !r.lesson) continue;
    if (r.kind === 'new') {
      out['New lessons'].push(`- ${link(r.lesson)}`);
    } else {
      const ch = (r.changes || []).map(oneLine).filter(Boolean).join('; ');
      out['Updated lessons'].push(`- ${link(r.lesson)}${ch ? ` — ${ch}` : ''}`);
    }
  }
  for (const f of facts) out['New knowledge'].push(`- ${oneLine(f.topic)}: ${oneLine(f.fact)}`);
  return out;
}

// Insert bullets at the end of each of the three sections; null when the file is not in the expected shape
function mergeIntoExisting(text, bullets) {
  const lines = text.split('\n');
  const heads = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^## (.+?)\s*$/.exec(lines[i]);
    if (m && SECTIONS.includes(m[1])) {
      if (heads[m[1]] !== undefined) return null;
      heads[m[1]] = i;
    }
  }
  if (!SECTIONS.every((s) => heads[s] !== undefined)) return null;
  if (!(heads[SECTIONS[0]] < heads[SECTIONS[1]] && heads[SECTIONS[1]] < heads[SECTIONS[2]])) return null;

  // process from the bottom so earlier indices stay valid
  for (const name of [...SECTIONS].reverse()) {
    if (!bullets[name].length) continue;
    let end = lines.length;
    for (let i = heads[name] + 1; i < lines.length; i++) {
      if (/^#{1,2} /.test(lines[i])) { end = i; break; }
    }
    let at = end;
    while (at > heads[name] + 1 && lines[at - 1].trim() === '') at--;
    lines.splice(at, 0, ...bullets[name]);
  }
  return lines.join('\n');
}

function sectionsText(bullets, level) {
  return SECTIONS.map((s) => `${level} ${s}\n\n${bullets[s].length ? bullets[s].join('\n') + '\n' : ''}`).join('\n');
}

function appendDailyLog({ vault, date, lessons = [], facts = [] }) {
  const bullets = buildBullets({ lessons, facts });
  if (SECTIONS.every((s) => !bullets[s].length)) return;
  const rel = `log/${date}.md`;
  const existing = vault.read(rel);
  if (existing == null) {
    const head = `---\ntype: mysthi-log\ndate: ${JSON.stringify(date)}\n---\n\n# ${date}\n\n`;
    vault.writeAtomic(rel, head + sectionsText(bullets, '##'));
    return;
  }
  const merged = mergeIntoExisting(existing, bullets);
  if (merged != null) {
    vault.writeAtomic(rel, merged);
    return;
  }
  const base = existing.endsWith('\n') ? existing : existing + '\n';
  vault.writeAtomic(rel, `${base}\n## Mysthi update ${date}\n\n${sectionsText(bullets, '###')}`);
}

module.exports = { appendDailyLog };
