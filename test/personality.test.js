// personality.test.js — how Mysthi is told to talk (the model's answers are checked by the manual 10-conversation eval)
const test = require('node:test');
const assert = require('node:assert');
const { buildSystemPrompt, detectLanguage } = require('../src/services/personality');

test('language of your last message: Romanian with or without diacritics, English, unsure', () => {
  for (const t of ['Cum export un design din Sketch?', 'Care e parola de la wifi?', 'release-ul e pe 27 noiembrie', 'Ce faci?', 'Ține minte']) assert.strictEqual(detectLanguage(t), 'ro', t);
  for (const t of ['How was your day, kitty?', 'Open Figma for me please', 'the release is on the 27th']) assert.strictEqual(detectLanguage(t), 'en', t);
  for (const t of ['ok', 'Mysthi?', '42']) assert.strictEqual(detectLanguage(t), '', t);
});

test('the reply language is the last line; nothing is added when unsure', () => {
  assert.match(buildSystemPrompt({ lang: 'ro' }), /reply in Romanian\.$/);
  assert.match(buildSystemPrompt({ lang: 'en' }), /reply in English\.$/);
  assert.doesNotMatch(buildSystemPrompt({ lang: '' }), /The user wrote in/);
});

test('her learning status is said plainly, and "off" means not watching', () => {
  assert.match(buildSystemPrompt({ learning: 'Learning: watching' }), /You are watching their screen and learning right now\./);
  assert.match(buildSystemPrompt({ learning: 'Learning: off' }), /NOT watching their screen or learning/);
  assert.match(buildSystemPrompt({ learning: 'Learning: paused' }), /paused: you are NOT watching/);
  assert.match(buildSystemPrompt({ learning: 'Learning: not watching this app' }), /NOT watching right now/);
  assert.match(buildSystemPrompt({ learning: '' }), /do not claim you are watching/);
});

test('with no notes she is told not to describe your work; rules ban markdown, paths and acting', () => {
  const p = buildSystemPrompt({});
  assert.match(p, /No notes matched this question\. You have no notes about what the user did/);
  assert.match(p, /no markdown/);
  assert.match(p, /Never write file names or paths/);
  assert.match(p, /You can only talk/);
  assert.match(p, /"you told me" only for a note marked "the user told you this"/);
});

test('chat replies use a slightly lower temperature', async () => {
  const { createChat } = require('../src/services/chat');
  let options = null;
  const data = {};
  const chat = createChat({ store: { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; } }, stream: async (a) => { options = a.options; return 'ok'; } });
  await chat.send('hi');
  assert.ok(options.temperature > 0 && options.temperature < 0.8, String(options.temperature));
});

test('markdown in a reply is shown as plain text; numbered steps and normal punctuation stay', () => {
  const { plainText } = require('../src/services/chat');
  assert.strictEqual(plainText('2. Mergi în meniul **Fișier → Exportă...**.'), '2. Mergi în meniul Fișier → Exportă....');
  assert.strictEqual(plainText('## Pași\nSee [Release](memory/x.md) and `cmd+s`'), 'Pași\nSee Release and cmd+s');
  assert.strictEqual(plainText('a__b__ c'), 'ab c');
  assert.strictEqual(plainText('Pret: 5 * 3 = 15, ok? Miaw.'), 'Pret: 5 * 3 = 15, ok? Miaw.');
});

test('the shown and saved reply is the cleaned text', async () => {
  const { createChat, HISTORY_KEY } = require('../src/services/chat');
  const data = {};
  const chat = createChat({ store: { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; } }, stream: async () => 'Use **Export**.' });
  assert.strictEqual(await chat.send('how?'), 'Use Export.');
  assert.strictEqual(data[HISTORY_KEY].at(-1).content, 'Use Export.');
});
