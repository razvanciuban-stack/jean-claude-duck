// redact.test.js — redaction layer tests driven by the secrets corpus
const test = require('node:test');
const assert = require('node:assert');
const corpus = require('../fixtures/secrets.json');
const { redact, redactDeep } = require('../../src/learning/redact');

test('redacts every corpus entry', () => {
  for (const { input, expected } of corpus) {
    assert.strictEqual(redact(input).text, expected, `input: ${JSON.stringify(input)}`);
  }
});

test('redaction is idempotent', () => {
  for (const { input } of corpus) {
    const once = redact(input).text;
    assert.strictEqual(redact(once).text, once);
  }
});

test('reports kinds, unique and in order applied', () => {
  assert.deepStrictEqual(redact('ssh root@192.168.1.20').kinds, ['IP']);
  assert.deepStrictEqual(redact('nothing to see').kinds, []);
  const r = redact('host 10.0.0.1 and 10.0.0.2 key ghp_' + 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5'.slice(0, 36));
  assert.deepStrictEqual(r.kinds, ['API_KEY', 'IP']);
  assert.deepStrictEqual(redact('DB_PASSWORD=x').kinds, ['PASSWORD']);
});

test('redactDeep redacts nested strings and leaves numbers', () => {
  const input = { a: 'ssh root@192.168.1.20', n: 42, ok: true, nil: null, list: ['DB_PASSWORD=hunter2', 7, { deep: '+40 721 234 567' }] };
  const out = redactDeep(input);
  assert.deepStrictEqual(out, { a: 'ssh root@[IP]', n: 42, ok: true, nil: null, list: ['DB_PASSWORD=[PASSWORD]', 7, { deep: '[PHONE]' }] });
  assert.strictEqual(input.a, 'ssh root@192.168.1.20');
});
