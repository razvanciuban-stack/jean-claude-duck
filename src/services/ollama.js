// ollama.js — shared local Ollama client (chat, JSON chat, availability check)
const http = require('http');

const DEFAULT_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 30000;

class OllamaJSONError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = 'OllamaJSONError';
    this.raw = raw;
  }
}

function baseUrl() {
  return process.env.MYSTHI_OLLAMA_URL || DEFAULT_URL;
}

function request(method, path, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl());
    const data = payload === undefined ? null : JSON.stringify(payload);
    const headers = data ? { 'Content-Type': 'application/json' } : {};
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers,
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

// Accepts a single JSON reply or NDJSON stream lines; returns the joined content.
function extractContent(body) {
  try {
    const parsed = JSON.parse(body);
    return (parsed.message && parsed.message.content) || '';
  } catch {
    let text = '';
    for (const line of body.trim().split('\n')) {
      try {
        const obj = JSON.parse(line);
        if (obj.message && obj.message.content) text += obj.message.content;
      } catch {}
    }
    return text;
  }
}

// think: false skips a reasoning model's hidden "thinking" step (much faster for short structured answers)
async function chat({ model, messages, format, options, think, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const payload = { model, messages, stream: false };
  if (format) payload.format = format;
  if (think !== undefined) payload.think = think;
  if (options) payload.options = options;
  const body = await request('POST', '/api/chat', payload, timeoutMs);
  return extractContent(body);
}

async function chatJSON(args) {
  let raw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    raw = await chat({ ...args, format: 'json' });
    try {
      return JSON.parse(raw);
    } catch {}
  }
  throw new OllamaJSONError('Ollama returned invalid JSON', raw);
}

async function isAvailable(model) {
  try {
    const body = await request('GET', '/api/tags', undefined, 15000); // generous: Ollama answers slowly while generating
    const models = JSON.parse(body).models || [];
    return models.some((m) => m.name === model);
  } catch {
    return false;
  }
}

module.exports = { chat, chatJSON, isAvailable, OllamaJSONError };
