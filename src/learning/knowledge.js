// knowledge.js — grow the Mysthi knowledge base (tools, paths, conventions, shortcuts, settings)
const { redact } = require('./redact');
const { chatJSON } = require('../services/ollama');
const { TEXT_MODEL, LEARNING_TIMEOUT_MS, LEARNING_NUM_CTX } = require('./config');

// Same bounds as task grouping: a long segment is sent in windows, each step line clipped
const MAX_STEPS_PER_CALL = 120;
const MAX_FIELD = 200;
const { describeStep } = require('./lessons');

const KNOWLEDGE_PROMPT = [
  'You extract durable facts about the user\'s computer setup from observed steps.',
  'You receive JSON: {"steps": [string]}.',
  'Only report facts about: tools they use, projects and paths, naming conventions, keyboard shortcuts, settings.',
  'Ignore one-off content, personal data, secrets, and anything not clearly durable.',
  'Reply with JSON only: {"facts": [{"topic": "<short topic>", "fact": "<one sentence>"}]}',
].join('\n');

function clean(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function safe(v) {
  return clean(redact(clean(v)).text);
}

function topicSlug(topic) {
  const s = clean(topic).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return s || 'general';
}

function norm(fact) {
  return clean(fact).toLowerCase();
}

function existingFacts(md) {
  const out = new Set();
  for (const line of String(md || '').split('\n')) {
    const m = /^\s*-\s+(.*?)(?:\s*\(first seen [^)]*\))?\s*$/.exec(line);
    if (m && m[1]) out.add(norm(m[1]));
  }
  return out;
}

async function extractKnowledge({ steps, vault, ask = chatJSON, today }) {
  const lines = (steps || []).map((st) => describeStep(st).slice(0, MAX_FIELD));
  const facts = [];
  for (let i = 0; i < lines.length; i += MAX_STEPS_PER_CALL) {
    const res = await ask({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: KNOWLEDGE_PROMPT },
        { role: 'user', content: JSON.stringify({ steps: lines.slice(i, i + MAX_STEPS_PER_CALL) }) },
      ],
      timeoutMs: LEARNING_TIMEOUT_MS,
      options: { num_ctx: LEARNING_NUM_CTX },
    });
    if (!res || !Array.isArray(res.facts)) throw new Error('Knowledge response has no facts array');
    facts.push(...res.facts);
  }

  const groups = new Map(); // slug -> { topic, md, known, fresh: [] }
  const added = [];
  for (const f of facts) {
    if (!f || typeof f !== 'object') continue;
    const fact = safe(f.fact);
    if (!fact) continue;
    const topic = safe(f.topic) || 'general';
    const slug = topicSlug(topic);
    let g = groups.get(slug);
    if (!g) {
      const md = vault.read(`knowledge/${slug}.md`);
      g = { topic, md, known: existingFacts(md), fresh: [] };
      groups.set(slug, g);
    }
    if (g.known.has(norm(fact))) continue;
    g.known.add(norm(fact));
    g.fresh.push(fact);
    added.push({ topic, fact });
  }

  for (const [slug, g] of groups) {
    if (!g.fresh.length) continue;
    const lines = g.fresh.map((fact) => `- ${fact} (first seen ${today})`).join('\n') + '\n';
    let text;
    if (g.md == null) {
      text = `---\ntype: mysthi-knowledge\ntopic: ${JSON.stringify(g.topic)}\n---\n\n# ${g.topic}\n\n${lines}`;
    } else {
      text = (g.md.endsWith('\n') ? g.md : g.md + '\n') + lines;
    }
    vault.writeAtomic(`knowledge/${slug}.md`, text);
  }
  return added;
}

module.exports = { extractKnowledge, topicSlug, KNOWLEDGE_PROMPT, MAX_STEPS_PER_CALL, MAX_FIELD };
