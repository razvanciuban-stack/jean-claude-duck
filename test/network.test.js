// network.test.js — nothing in the app talks to another machine: one local Ollama, no other network code
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
function sources(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.(js|html)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const files = ['main.js', ...sources('src')];

test('the Ollama address is always this Mac', () => {
  const { baseUrl } = require('../src/services/ollama');
  const saved = process.env.MYSTHI_OLLAMA_URL;
  try {
    delete process.env.MYSTHI_OLLAMA_URL;
    assert.strictEqual(baseUrl(), 'http://127.0.0.1:11434');
    process.env.MYSTHI_OLLAMA_URL = 'http://localhost:11500';
    assert.strictEqual(baseUrl(), 'http://localhost:11500');
    for (const bad of ['http://example.com:11434', 'https://127.0.0.1.evil.com', 'http://192.168.1.5:11434', 'nonsense']) {
      process.env.MYSTHI_OLLAMA_URL = bad;
      assert.strictEqual(baseUrl(), 'http://127.0.0.1:11434', bad);
    }
  } finally {
    if (saved === undefined) delete process.env.MYSTHI_OLLAMA_URL; else process.env.MYSTHI_OLLAMA_URL = saved;
  }
});

test('only the Ollama client opens connections, and no code or page reaches another host', () => {
  for (const f of files) {
    // Code only: comment lines may mention example URLs
    const src = fs.readFileSync(path.join(root, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (f !== path.join('src', 'services', 'ollama.js')) {
      assert.doesNotMatch(src, /require\(['"](?:node:)?(?:http|https|net|tls|dgram|http2)['"]\)/, `${f} opens connections`);
    }
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|new WebSocket|EventSource|net\.request|sendBeacon/, `${f} uses web requests`);
    // Links the user clicks (shell.openExternal) are fine; any other remote URL is not
    const urls = [...src.matchAll(/https?:\/\/[^\s'"`)<>]+/g)].map((m) => m[0]);
    for (const u of urls) {
      const host = new URL(u).hostname;
      // www.w3.org: SVG/XML namespace names, never fetched
      const ok = ['127.0.0.1', 'localhost', 'www.w3.org'].includes(host) || /openExternal|url:/.test(src.slice(Math.max(0, src.indexOf(u) - 120), src.indexOf(u)));
      assert.ok(ok, `${f} mentions ${u}`);
    }
  }
});

test('no cloud AI SDK is installed', () => {
  const pkg = require('../package.json');
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.ok(!deps.some((d) => /anthropic|openai|google|cohere|mistral/i.test(d)), deps.join(', '));
});

test('no path is written for one user: everything starts from the home folder', () => {
  for (const f of [...files, 'package.json']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(src, /\/Users\/[a-z]|\/home\/[a-z]|ciubanrazvan/i, f);
  }
});
