// segmenter.js — splits journal steps into time segments and asks the local model to group them into tasks
const { chatJSON } = require('../services/ollama');
const { TEXT_MODEL, SEGMENT_GAP_MS, LEARNING_TIMEOUT_MS, LEARNING_NUM_CTX } = require('./config');

const MAX_STEPS_PER_CALL = 120;
const MAX_FIELD = 200;
const MAX_NAME = 80;

const GROUP_PROMPT = `You are given a chronological list of a user's computer actions, one per line, formatted as:
id | app | action | target title | value | description

Split the steps into tasks the user was trying to accomplish. Give each task a short imperative name (for example "Export app icons from Figma"). Set "isTask" to false for browsing, reading, or window switching that has no clear goal. Use only the ids given, and use each id at most once.
Respond with JSON only: {"tasks":[{"name":"...","stepIds":["..."],"isTask":true}]}`;

function splitAtBoundaries(steps, gapMs = SEGMENT_GAP_MS) {
  const segments = [];
  let cur = null;
  let prev = null;
  for (const step of steps) {
    if (!cur || step.ts - prev.ts >= gapMs) {
      cur = [];
      segments.push(cur);
    }
    cur.push(step);
    prev = step;
  }
  return segments;
}

const clip = (s) => String(s == null ? '' : s).replace(/\s*\n\s*/g, ' ').slice(0, MAX_FIELD);

function listing(steps) {
  return steps.map((s) => {
    const value = s.action === 'shortcut' ? (s.keys || '') : (s.value || '');
    return [s.id, s.appName || '', s.action || '', (s.target && s.target.title) || '', clip(value), clip(s.description)].join(' | ');
  }).join('\n');
}

// Missing means "is a task"; the string "false" (any case, any padding) means false
function parseIsTask(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim().toLowerCase() !== 'false';
  return Boolean(v);
}

function validate(raw, steps, used) {
  if (!raw || !Array.isArray(raw.tasks)) return null;
  const known = new Set(steps.map((s) => s.id));
  const out = [];
  for (const t of raw.tasks) {
    if (!t || typeof t.name !== 'string' || !Array.isArray(t.stepIds)) continue;
    const name = t.name.trim().slice(0, MAX_NAME);
    if (!name) continue;
    const stepIds = [];
    for (const id of t.stepIds) {
      if (known.has(id) && !used.has(id)) {
        used.add(id);
        stepIds.push(id);
      }
    }
    if (!stepIds.length) continue;
    out.push({ name, stepIds, isTask: parseIsTask(t.isTask) });
  }
  return out;
}

async function groupTasks(segment, ask = chatJSON) {
  const used = new Set();
  const result = [];
  try {
    for (let i = 0; i < segment.length; i += MAX_STEPS_PER_CALL) {
      const win = segment.slice(i, i + MAX_STEPS_PER_CALL);
      const raw = await ask({
        model: TEXT_MODEL,
        messages: [
          { role: 'system', content: GROUP_PROMPT },
          { role: 'user', content: listing(win) },
        ],
        timeoutMs: LEARNING_TIMEOUT_MS,
        options: { num_ctx: LEARNING_NUM_CTX },
      });
      const tasks = validate(raw, win, used);
      if (!tasks) return null;
      result.push(...tasks);
    }
  } catch (_) {
    return null;
  }
  return result;
}

module.exports = { splitAtBoundaries, groupTasks, GROUP_PROMPT, MAX_STEPS_PER_CALL, MAX_FIELD };
