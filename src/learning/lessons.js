// lessons.js — match observed tasks to lesson notes and merge them; user edits always win
const crypto = require('crypto');
const { renderLesson, parseLesson, LessonParseError } = require('./lesson-note');
const { redact } = require('./redact');
const { chatJSON } = require('../services/ollama');
const { TEXT_MODEL, CONFIDENT_AT, LEARNING_TIMEOUT_MS, LEARNING_NUM_CTX } = require('./config');

const MATCH_PROMPT = [
  'You match a newly observed computer task to previously learned lessons.',
  'You receive JSON: {"task": {"name", "steps": [string]}, "candidates": [{"slug", "title", "apps", "steps": [string]}]}.',
  'If the task is the same procedure as one candidate (same goal, similar steps), answer with that candidate\'s slug.',
  'If none is clearly the same procedure, answer null. Never invent a slug.',
  'Reply with JSON only: {"slug": "<existing slug>" | null}',
].join('\n');

const MERGE_PROMPT = [
  'You merge a newly observed run of a task into an existing lesson.',
  'You receive JSON: {"existing": [{"id", "text", "app", "action", "target", "value"?, "userEdited"}], "run": [{"text", "app", "action", "target", "value"?}]}.',
  'Return the improved list of steps. Keep the "id" of every existing step you keep; steps you add must have no "id".',
  'Drop existing steps that the new run shows are unnecessary. Do not rewrite steps with "userEdited": true; the user owns them.',
  'Write each step "text" as one short imperative sentence. Never include passwords, tokens, or personal data.',
  'Reply with JSON only: {"steps": [{"id"?, "text", "app", "action", "target", "value"?}], "changes": [string]} where "changes" briefly lists what you changed.',
].join('\n');

function clean(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

// Redacted, one-line model/user-facing string
function safe(v) {
  return clean(redact(clean(v)).text);
}

function slugify(text) {
  const s = clean(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return s || 'lesson';
}

function targetTitle(step) {
  const t = step.target;
  if (!t) return '';
  return typeof t === 'string' ? t : clean(t.title || t.description || '');
}

// Deterministic step text from a journal Step (R13)
function describeStep(step) {
  if (step.description) return safe(step.description);
  const app = step.appName || step.bundleId || 'the app';
  const t = step.target;
  switch (step.action) {
    case 'click':
      if (t && Array.isArray(t.menuPath) && t.menuPath.length) return safe(`In ${app}, choose ${t.menuPath.join(' → ')}`);
      return safe(`In ${app}, click ${(t && t.role) || 'element'} "${targetTitle(step)}"`);
    case 'shortcut':
      return safe(`In ${app}, press ${step.keys || ''}`);
    case 'type':
      return safe(`In ${app}, type "${step.value || ''}" into "${targetTitle(step)}"`);
    case 'command':
      return safe(`In ${app}, run \`${step.value || ''}\``);
    default:
      return safe(`In ${app}, ${step.action || 'act'}`);
  }
}

function toLessonStep(step) {
  const out = {
    id: step.id,
    app: step.bundleId || step.appName || '',
    action: step.action,
    target: safe(targetTitle(step)),
    text: describeStep(step),
    userEdited: false,
    variants: [],
  };
  if (step.value != null) out.value = safe(step.value);
  return out;
}

function taskSteps(task, steps) {
  const ids = task && Array.isArray(task.stepIds) ? new Set(task.stepIds) : null;
  return (steps || []).filter((s) => !ids || ids.has(s.id));
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function lessonFiles(vault) {
  return vault.list('lessons').filter((f) => f.endsWith('.md'));
}

function normText(v) {
  return clean(v).toLowerCase();
}

// Remember steps the user removed so a merge can never bring them back
function withTombstones(md, lesson, removed) {
  if (!removed.length) return lesson;
  let old = [];
  try {
    const m = [...md.matchAll(/^```mysthi-lesson[ \t]*\n([\s\S]*?)\n```[ \t]*$/gm)].pop();
    old = JSON.parse(m[1]).steps || [];
  } catch (_) { /* ids alone still protect */ }
  const text = new Map(old.map((s) => [s.id, s.text]));
  const ids = uniq([...(lesson.removedIds || []), ...removed]);
  const texts = uniq([...(lesson.removedTexts || []), ...removed.map((id) => normText(text.get(id)))]);
  return { ...lesson, removedIds: ids, removedTexts: texts };
}

function loadLessons(vault) {
  const out = [];
  for (const file of lessonFiles(vault)) {
    const rel = `lessons/${file}`;
    const md = vault.read(rel);
    if (md == null) continue;
    let parsed;
    try {
      parsed = parseLesson(md);
    } catch (err) {
      if (err instanceof LessonParseError) continue;
      throw err;
    }
    const e = parsed.edits;
    const lesson = withTombstones(md, { ...parsed.lesson, slug: file.slice(0, -3) }, e.removed);
    if (e.changed.length || e.removed.length || e.added.length) vault.writeAtomic(rel, renderLesson(lesson));
    out.push(lesson);
  }
  return out;
}

// Fresh, edit-applied read of one note; null when gone or unparseable
function readLesson(vault, slug) {
  const md = vault.read(`lessons/${slug}.md`);
  if (md == null) return null;
  try {
    const parsed = parseLesson(md);
    return withTombstones(md, { ...parsed.lesson, slug }, parsed.edits.removed);
  } catch (err) {
    if (err instanceof LessonParseError) return null;
    throw err;
  }
}

function payload(obj) {
  return JSON.stringify(obj);
}

function newId() {
  return 'm' + crypto.randomBytes(4).toString('hex');
}

function modelTarget(t, fallback) {
  if (typeof t === 'string') return safe(t);
  if (t && typeof t === 'object') return { role: safe(t.role), title: safe(t.title || t.description) };
  return fallback;
}

function modelStepFields(m, base) {
  const out = {
    app: safe(m.app) || (base ? base.app : ''),
    action: safe(m.action) || (base ? base.action : 'manual'),
    target: modelTarget(m.target, base ? base.target : ''),
  };
  if (m.value != null) out.value = safe(m.value);
  else if (base && base.value != null) out.value = base.value;
  return out;
}

function mergeSteps(existing, modelSteps, tombTexts = []) {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const tomb = new Set(tombTexts);
  const placed = new Map(); // id -> entry in result
  const result = [];
  for (const m of modelSteps) {
    if (!m || typeof m !== 'object') continue;
    const text = safe(m.text);
    if (m.id != null && m.id !== '') {
      // Only ids of steps that exist now are valid; anything else (e.g. user-removed) is dropped
      const old = typeof m.id === 'string' ? byId.get(m.id) : null;
      if (!old) continue;
      if (placed.has(old.id)) {
        const entry = placed.get(old.id);
        if (old.userEdited && text && text !== entry.text && !entry.variants.includes(text)) entry.variants.push(text);
        continue;
      }
      let entry;
      if (old.userEdited) {
        const variants = [...(old.variants || [])];
        if (text && text !== old.text && !variants.includes(text)) variants.push(text);
        entry = { ...old, variants };
      } else {
        entry = { ...old, ...modelStepFields(m, old), text: text || old.text, userEdited: false, variants: old.variants || [] };
      }
      placed.set(old.id, entry);
      result.push(entry);
    } else if (text && !tomb.has(normText(text))) {
      result.push({ id: newId(), ...modelStepFields(m, null), text, userEdited: false, variants: [] });
    }
  }
  // user-edited steps the model omitted keep their original position
  existing.forEach((s, i) => {
    if (s.userEdited && !placed.has(s.id)) result.splice(Math.min(i, result.length), 0, s);
  });
  return result;
}

async function learnTask({ task, steps, lessons, vault, ask = chatJSON, today }) {
  const run = taskSteps(task, steps);
  const runApps = uniq(run.map((s) => s.bundleId || s.appName));
  const newSteps = run.map(toLessonStep);
  const runPayload = newSteps.map((s) => {
    const o = { text: s.text, app: s.app, action: s.action, target: s.target };
    if (s.value != null) o.value = s.value;
    return o;
  });

  // Candidates must still exist on disk: the note is the source of truth
  const candidates = (lessons || []).filter(
    (l) => l && l.slug && (l.apps || []).some((a) => runApps.includes(a)) && vault.exists(`lessons/${l.slug}.md`)
  );

  let matchedSlug = null;
  if (candidates.length) {
    const res = await ask({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: MATCH_PROMPT },
        { role: 'user', content: payload({
          task: { name: safe(task.name), steps: newSteps.map((s) => s.text) },
          candidates: candidates.map((l) => ({ slug: l.slug, title: l.title, apps: l.apps, steps: l.steps.map((s) => s.text) })),
        }) },
      ],
      timeoutMs: LEARNING_TIMEOUT_MS,
      options: { num_ctx: LEARNING_NUM_CTX },
    });
    const slug = res && typeof res.slug === 'string' ? res.slug : null;
    if (slug && candidates.some((c) => c.slug === slug)) matchedSlug = slug;
  }

  const existing = matchedSlug ? readLesson(vault, matchedSlug) : null;

  if (!existing) {
    const taken = new Set(lessonFiles(vault).map((f) => f.slice(0, -3)));
    const base = slugify(task.name);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    const lesson = {
      slug,
      title: safe(task.name) || 'Untitled lesson',
      apps: runApps,
      timesObserved: 1,
      confident: 1 >= CONFIDENT_AT,
      firstSeen: today,
      lastSeen: today,
      steps: newSteps,
    };
    vault.writeAtomic(`lessons/${slug}.md`, renderLesson(lesson));
    return { kind: 'new', lesson, changes: [`Created from ${newSteps.length} observed steps`] };
  }

  const res = await ask({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: MERGE_PROMPT },
      { role: 'user', content: payload({
        existing: existing.steps.map((s) => {
          const o = { id: s.id, text: s.text, app: s.app, action: s.action, target: s.target, userEdited: !!s.userEdited };
          if (s.value != null) o.value = s.value;
          return o;
        }),
        run: runPayload,
      }) },
    ],
    timeoutMs: LEARNING_TIMEOUT_MS,
    options: { num_ctx: LEARNING_NUM_CTX },
  });
  if (!res || !Array.isArray(res.steps)) throw new Error('Merge response has no steps array');
  const changes = (Array.isArray(res.changes) ? res.changes : []).map(safe).filter(Boolean);

  // R16: a response with no usable step text never wipes the lesson
  const usable = res.steps.some((m) => m && typeof m === 'object' && safe(m.text));
  const timesObserved = (existing.timesObserved || 0) + 1;
  const lesson = {
    ...existing,
    apps: uniq([...(existing.apps || []), ...runApps]),
    steps: usable || !existing.steps.length ? mergeSteps(existing.steps, res.steps, existing.removedTexts) : existing.steps,
    timesObserved,
    confident: timesObserved >= CONFIDENT_AT,
    lastSeen: today,
  };
  vault.writeAtomic(`lessons/${existing.slug}.md`, renderLesson(lesson));
  return { kind: 'updated', lesson, changes };
}

module.exports = { loadLessons, learnTask, describeStep, slugify, MATCH_PROMPT, MERGE_PROMPT };
