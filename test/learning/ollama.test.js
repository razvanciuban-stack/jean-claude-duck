// ollama.test.js — tests for the shared Ollama client against a local stub server
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server;
let hits = 0;
let handler;

before(async () => {
  server = http.createServer((req, res) => {
    hits++;
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => handler(req, res, body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.MYSTHI_OLLAMA_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

beforeEach(() => { hits = 0; });

function ollama() {
  return require('../../src/services/ollama');
}

test('chat returns message content', async () => {
  handler = (req, res) => res.end(JSON.stringify({ message: { content: 'hi' } }));
  const out = await ollama().chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
  assert.strictEqual(out, 'hi');
});

test('chat joins NDJSON stream lines', async () => {
  handler = (req, res) => res.end(
    JSON.stringify({ message: { content: 'a' } }) + '\n' +
    JSON.stringify({ message: { content: 'b' } }) + '\n'
  );
  const out = await ollama().chat({ model: 'm', messages: [] });
  assert.strictEqual(out, 'ab');
});

test('chatJSON retries once then throws', async () => {
  handler = (req, res) => res.end(JSON.stringify({ message: { content: 'not json' } }));
  const { chatJSON, OllamaJSONError } = ollama();
  await assert.rejects(chatJSON({ model: 'm', messages: [] }), OllamaJSONError);
  assert.strictEqual(hits, 2);
});

test('isAvailable false when model missing', async () => {
  handler = (req, res) => res.end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }));
  const { isAvailable } = ollama();
  assert.strictEqual(await isAvailable('qwen2.5vl:7b'), false);
  assert.strictEqual(await isAvailable('llama3.1:8b'), true);
});

test('vision defaultDescribe sends num_ctx with its request', async () => {
  let payload;
  handler = (req, res, body) => { payload = JSON.parse(body); res.end(JSON.stringify({ message: { content: 'described' } })); };
  const { defaultDescribe } = require('../../src/learning/vision');
  const { LEARNING_NUM_CTX } = require('../../src/learning/config');
  assert.strictEqual(await defaultDescribe(null, 'aGk='), 'described');
  assert.strictEqual(payload.options.num_ctx, LEARNING_NUM_CTX);
  assert.strictEqual(payload.options.num_predict, 60);
});

test('think: false is sent so reasoning models skip their hidden thinking step', async () => {
  let sent = null;
  handler = (req, res, body) => { sent = JSON.parse(body); res.end(JSON.stringify({ message: { content: 'ok' } })); };
  await ollama().chat({ model: 'm', messages: [], think: false });
  assert.strictEqual(sent.think, false);
  await ollama().chat({ model: 'm', messages: [] });
  assert.ok(!('think' in sent), 'not sent unless asked for');
});
