// lesson-note.js — render/parse Mysthi lesson notes; user edits in Obsidian win
const crypto = require('crypto');

const FENCE = 'mysthi-lesson';

class LessonParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LessonParseError';
  }
}

// One-line, comment-free text so render is an identity for parse.
function clean(value) {
  return String(value == null ? '' : value)
    .replace(/<!--/g, '<!\u2014')
    .replace(/-->/g, '\u2014>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLesson(lesson) {
  return {
    ...lesson,
    title: clean(lesson.title),
    steps: lesson.steps.map((s) => ({
      ...s,
      text: clean(s.text),
      variants: (s.variants || []).map(clean).filter(Boolean),
    })),
  };
}

function renderLesson(rawLesson) {
  const lesson = normalizeLesson(rawLesson);
  const q = (v) => JSON.stringify(v);
  const out = [
    '---',
    `title: ${q(lesson.title)}`,
    'type: mysthi-lesson',
    `apps: ${q(lesson.apps)}`,
    `times_observed: ${q(lesson.timesObserved)}`,
    `confident: ${q(lesson.confident)}`,
    `first_seen: ${q(lesson.firstSeen)}`,
    `last_seen: ${q(lesson.lastSeen)}`,
    '---',
    '',
    `# ${lesson.title}`,
    '',
    '## Steps',
    '',
  ];
  lesson.steps.forEach((s, i) => {
    out.push(`${i + 1}. ${s.text} <!-- step:${s.id} -->`);
    for (const v of s.variants || []) out.push(`   - Also seen: ${v}`);
  });
  out.push('', '```' + FENCE, JSON.stringify(lesson, null, 2), '```', '');
  return out.join('\n');
}

function extractJson(text) {
  const re = new RegExp('^```' + FENCE + '[ \\t]*\\n([\\s\\S]*?)\\n```[ \\t]*$', 'gm');
  let m;
  let last = null;
  while ((m = re.exec(text)) !== null) last = m;
  if (!last) throw new LessonParseError(`Missing \`${FENCE}\` JSON block`);
  let lesson;
  try {
    lesson = JSON.parse(last[1]);
  } catch (err) {
    throw new LessonParseError(`Invalid \`${FENCE}\` JSON block: ${err.message}`);
  }
  if (!lesson || typeof lesson !== 'object' || !Array.isArray(lesson.steps)) {
    throw new LessonParseError(`\`${FENCE}\` JSON block is not a lesson`);
  }
  return { lesson, index: last.index };
}

function parseListLines(text, jsonIndex) {
  const lines = text.slice(0, jsonIndex).split('\n');
  const items = [];
  let inSteps = false;
  let title = null;
  let inFront = lines[0] && lines[0].trim() === '---';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFront) {
      if (i > 0 && line.trim() === '---') inFront = false;
      continue;
    }
    if (title === null) {
      const h1 = /^#\s+(.+?)\s*$/.exec(line);
      if (h1) title = h1[1];
    }
    if (/^##\s+/.test(line)) {
      inSteps = /^##\s+steps\s*$/i.test(line.trim());
      continue;
    }
    if (!inSteps) continue;
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (num) {
      const idMatch = /<!--\s*step:(\S+?)\s*-->/.exec(num[1]);
      items.push({
        id: idMatch ? idMatch[1] : null,
        text: num[1].replace(/<!--\s*step:\S+?\s*-->/g, '').trim(),
        variants: [],
      });
      continue;
    }
    const seen = /^\s+[-*]\s+Also seen:\s*(.*?)\s*$/.exec(line);
    if (seen && items.length && seen[1]) items[items.length - 1].variants.push(seen[1]);
  }
  return { items, title };
}

function parseLesson(markdown) {
  const text = String(markdown).replace(/\r\n?/g, '\n');
  const { lesson, index } = extractJson(text);
  const { items, title } = parseListLines(text, index);

  const byId = new Map(lesson.steps.map((s) => [s.id, s]));
  const used = new Set();
  const changed = [];
  const added = [];
  const steps = [];

  for (const item of items) {
    const known = item.id && byId.has(item.id) && !used.has(item.id) ? byId.get(item.id) : null;
    if (known) {
      used.add(known.id);
      const step = { ...known, variants: item.variants };
      if (item.text !== String(known.text).trim()) {
        step.text = item.text;
        step.userEdited = true;
        changed.push(known.id);
      }
      steps.push(step);
    } else if (item.text) {
      const step = {
        id: 'u' + crypto.randomBytes(4).toString('hex'),
        app: '',
        action: 'manual',
        target: '',
        text: item.text,
        userEdited: true,
        variants: item.variants,
      };
      added.push(step);
      steps.push(step);
    }
  }
  const removed = lesson.steps.filter((s) => !used.has(s.id)).map((s) => s.id);

  const out = { ...lesson, steps };
  if (title) out.title = title;
  return { lesson: out, edits: { changed, removed, added } };
}

module.exports = { normalizeLesson, renderLesson, parseLesson, LessonParseError };
