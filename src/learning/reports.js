// reports.js — Markdown reports written into the vault (daily log and weekly report)
const { parseLesson, LessonParseError } = require('./lesson-note');
const { WEEK_MS } = require('./config');

const SECTIONS = ['New lessons', 'Updated lessons', 'New knowledge'];

function oneLine(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function link(lesson) {
  const title = oneLine(lesson.title).replace(/[|[\]]/g, ' ').replace(/\s+/g, ' ').trim() || lesson.slug;
  return `[[lessons/${lesson.slug}|${title}]]`;
}

function buildBullets({ lessons = [], facts = [], notes = [] }) {
  const out = { 'New lessons': [], 'Updated lessons': [], 'New knowledge': [], Notes: [] };
  for (const n of notes) out.Notes.push(`- ${oneLine(n)}`);
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

  // Notes is optional: append the section at the end when missing
  const notesAt = lines.findIndex((l) => /^## Notes\s*$/.test(l));
  if (bullets.Notes.length && notesAt < 0) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', '## Notes', '', ...bullets.Notes, '');
    bullets.Notes = [];
  } else if (notesAt >= 0) {
    heads.Notes = notesAt;
  }

  // process from the bottom so earlier indices stay valid
  const order = [...SECTIONS, ...(heads.Notes !== undefined ? ['Notes'] : [])].sort((a, b) => heads[b] - heads[a]);
  for (const name of order) {
    if (!bullets[name].length) continue;
    let end = lines.length;
    for (let i = heads[name] + 1; i < lines.length; i++) {
      if (/^#{1,2} /.test(lines[i])) { end = i; break; }
    }
    const present = new Set(lines.slice(heads[name] + 1, end));
    const fresh = bullets[name].filter((b) => !present.has(b));
    if (!fresh.length) continue;
    let at = end;
    while (at > heads[name] + 1 && lines[at - 1].trim() === '') at--;
    lines.splice(at, 0, ...fresh);
  }
  return lines.join('\n');
}

function sectionsText(bullets, level) {
  const names = bullets.Notes.length ? [...SECTIONS, 'Notes'] : SECTIONS;
  return names.map((s) => `${level} ${s}\n\n${bullets[s].length ? bullets[s].join('\n') + '\n' : ''}`).join('\n');
}

function appendDailyLog({ vault, date, lessons = [], facts = [], notes = [] }) {
  const bullets = buildBullets({ lessons, facts, notes });
  if (bullets.Notes.length === 0 && SECTIONS.every((s) => !bullets[s].length)) return;
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


function localDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function lessonSection(vault, slug) {
  const md = vault.read(`lessons/${slug}.md`);
  if (md == null) return `### ${slug} (note removed)\n`;
  let lesson;
  try {
    lesson = parseLesson(md).lesson;
  } catch (err) {
    if (err instanceof LessonParseError) return `### ${slug} (note unreadable — edited by hand?)\n`;
    throw err;
  }
  const meta = [
    (lesson.apps || []).length ? `Apps: ${lesson.apps.map(oneLine).join(', ')}` : null,
    `Observed ${lesson.timesObserved || 1} time${lesson.timesObserved === 1 ? '' : 's'}`,
    lesson.confident ? '**confident**' : null,
  ].filter(Boolean).join(' · ');
  const out = [`### ${link({ slug, title: lesson.title })}`, '', meta, ''];
  lesson.steps.forEach((st, i) => {
    out.push(`${i + 1}. ${oneLine(st.text)}`);
    for (const v of st.variants || []) out.push(`   - Also seen: ${oneLine(v)}`);
  });
  return out.join('\n') + '\n';
}

function updatedLine(vault, u) {
  const md = vault.read(`lessons/${u.slug}.md`);
  let title = null;
  if (md != null) {
    try { title = parseLesson(md).lesson.title; } catch (err) { if (!(err instanceof LessonParseError)) throw err; }
  }
  const ch = (u.changes || []).map(oneLine).filter(Boolean).join('; ');
  const head = title ? `- ${link({ slug: u.slug, title })}` : `- ${u.slug}${md == null ? ' (note removed)' : ' (note unreadable — edited by hand?)'}`;
  return head + (ch ? ` — ${ch}` : '');
}

function buildWeeklyReport(vault, week, startMs, endMs) {
  const nNew = week.newLessons.length;
  const nUpd = week.updated.length;
  const nFacts = week.facts.length;
  const summary = `${nNew} new lessons, ${nUpd} updated, ${nFacts} new facts`;
  const start = localDate(startMs);
  const end = localDate(endMs);
  const out = [
    '---', 'type: mysthi-report', `period_start: ${JSON.stringify(start)}`, `period_end: ${JSON.stringify(end)}`,
    `new_lessons: ${nNew}`, `updated_lessons: ${nUpd}`, `new_facts: ${nFacts}`, '---', '',
    `# Mysthi weekly report: ${start} to ${end}`, '', summary, '',
  ];
  if (!nNew && !nUpd && !nFacts) {
    out.push('Nothing new this week. Mysthi is still watching and will report again next week.', '');
    return out.join('\n');
  }
  if (nNew) out.push('## New lessons', '', week.newLessons.map((s) => lessonSection(vault, s)).join('\n'), '');
  if (nUpd) out.push('## Updated lessons', '', ...week.updated.map((u) => updatedLine(vault, u)), '');
  if (nFacts) {
    out.push('## New knowledge', '');
    const byTopic = new Map();
    for (const f of week.facts) {
      const t = oneLine(f.topic) || 'General';
      if (!byTopic.has(t)) byTopic.set(t, []);
      byTopic.get(t).push(oneLine(f.fact));
    }
    for (const [t, facts] of byTopic) out.push(`### ${t}`, '', ...facts.map((f) => `- ${f}`), '');
  }
  return out.join('\n');
}

// Writes the report first, then resets week state; a failed write leaves state for the next tick
function maybeWriteWeeklyReport({ vault, stateDir, now = Date.now }) {
  const { readWeek, writeWeek } = require('./pipeline'); // lazy: pipeline requires this module
  const week = readWeek(stateDir);
  if (week.enabledAt == null) return { written: false };
  const t = now();
  const since = week.lastReportAt ?? week.enabledAt;
  if (t - since < WEEK_MS) return { written: false };

  const base = `reports/${localDate(t)}-week`;
  let relPath = `${base}.md`;
  for (let n = 2; vault.exists(relPath); n++) relPath = `${base}-${n}.md`;
  vault.writeAtomic(relPath, buildWeeklyReport(vault, week, since, t));
  writeWeek(stateDir, { ...week, lastReportAt: t, newLessons: [], updated: [], facts: [] });
  return { written: true, relPath };
}

module.exports = { appendDailyLog, maybeWriteWeeklyReport };
