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

test('does not backtrack quadratically on long dashed input', () => {
  const t0 = Date.now();
  redact('a-'.repeat(20000));
  assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
});

test('a path to one of her own notes is not mistaken for a key; real keys still are', () => {
  const { redact } = require('../../src/learning/redact');
  const note = 'Noted in memory/2026-11-04-release-ul-aplicatiei-mysthi-1-0.md';
  assert.strictEqual(redact(note).text, note);
  assert.strictEqual(redact('see lessons/create-and-customize-a-greeting-card-in-sketch.md').text, 'see lessons/create-and-customize-a-greeting-card-in-sketch.md');
  assert.match(redact('token Zx8Qp2Lm9Rt4Vb7Nc1Kd5Hf3Jg6Ws0Ye').text, /\[API_KEY\]/);
  assert.match(redact('memory/Zx8Qp2Lm9Rt4Vb7Nc1Kd5Hf3Jg6Ws0Ye').text, /\[API_KEY\]/);
});

// Phase 6: a table of fake secrets — what is hidden, and what deliberately is not (see docs/learning-setup.md)
test('fake secrets are hidden: keys, tokens, cards, IBAN, IPs, phones, passwords, CNP, PIN/CVV', () => {
  const { redact } = require('../../src/learning/redact');
  const hidden = {
    'sk-ant-api03-Zx8Qp2Lm9Rt4Vb7Nc1Kd5Hf3Jg6Ws0YeAbCd': '[API_KEY]',
    'ghp_Zx8Qp2Lm9Rt4Vb7Nc1Kd5Hf3Jg6Ws0YeAb12': '[API_KEY]',
    'AKIAZX8QP2LM9RT4VB7N': '[API_KEY]',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc123def456': '[API_KEY]',
    '4111 1111 1111 1111': '[CARD]',
    'RO49 AAAA 1B31 0075 9384 0000': '[IBAN]',
    '10.0.0.5': '[IP]',
    '0722 123 456': '[PHONE]',
    'password=hunter2': 'password=[PASSWORD]',
    'parola: Mere123!': 'parola: [PASSWORD]',
    'CNP 1960521123451': 'CNP [CNP]',
    'PIN 4821': 'PIN [PIN]',
    'CVV: 123': 'CVV: [PIN]',
    'codul PIN este 1234': 'codul PIN este [PIN]',
  };
  for (const [input, want] of Object.entries(hidden)) assert.strictEqual(redact(input).text, want, input);
});

test('look-alikes stay: wrong CNP control digit, "pin the tab", page numbers', () => {
  const { redact } = require('../../src/learning/redact');
  for (const t of ['1960521123456', 'pin the tab', 'page 1234', 'Release on 27 Nov']) assert.strictEqual(redact(t).text, t);
});

test('known limits (documented): emails, street addresses, unlabelled short codes are not hidden', () => {
  const { redact } = require('../../src/learning/redact');
  for (const t of ['ana.pop@example.com', 'Strada Lalelelor 12, Cluj', 'exp 12/27', 'my code is 4821']) assert.strictEqual(redact(t).text, t);
});
