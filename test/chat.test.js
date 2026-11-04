const test = require('node:test');
const assert = require('node:assert');
const { createChat, HISTORY_KEY } = require('../src/services/chat');
const { TEXT_MODEL } = require('../src/learning/config');

function fakeStore(init = {}) {
  const data = { ...init };
  return { data, get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; } };
}

test('a question streams back and both sides are remembered', async () => {
  const store = fakeStore();
  let request = null;
  const chat = createChat({
    store,
    stream: async (args) => { request = args; args.onToken('Miaw! '); args.onToken('Bună!'); return 'Miaw! Bună!'; },
    now: () => new Date(2026, 10, 4, 9, 30),
  });
  const pieces = [];
  const reply = await chat.send('  Salut, Mysthi  ', { onToken: (t) => pieces.push(t) });
  assert.strictEqual(reply, 'Miaw! Bună!');
  assert.deepStrictEqual(pieces, ['Miaw! ', 'Bună!']);
  assert.strictEqual(request.model, TEXT_MODEL);
  assert.strictEqual(request.think, false);
  assert.match(request.messages[0].content, /You are Mysthi/);
  assert.match(request.messages[0].content, /morning \(09:30\)/);
  assert.deepStrictEqual(request.messages.at(-1), { role: 'user', content: 'Salut, Mysthi' });
  assert.deepStrictEqual(chat.recent(), [
    { role: 'user', content: 'Salut, Mysthi' },
    { role: 'assistant', content: 'Miaw! Bună!' },
  ]);
});

test('earlier messages are sent as context, and vault notes go in the system prompt', async () => {
  const store = fakeStore({ [HISTORY_KEY]: [{ role: 'user', content: 'hi', at: 1 }, { role: 'assistant', content: 'Miaw', at: 2 }] });
  let request = null;
  const chat = createChat({ store, stream: async (a) => { request = a; return 'ok'; }, knowledgeFor: () => '[lessons] Export icons: use Sketch' });
  await chat.send('How do I export icons?');
  assert.deepStrictEqual(request.messages.slice(1, 3), [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Miaw' }]);
  assert.match(request.messages[0].content, /Export icons: use Sketch/);
});

test('chat history is saved redacted', async () => {
  const store = fakeStore();
  const chat = createChat({ store, stream: async () => 'Server 10.0.0.5 noted' });
  await chat.send('my password=hunter2 and server 10.0.0.5');
  const saved = JSON.stringify(store.data[HISTORY_KEY]);
  assert.ok(!saved.includes('hunter2'));
  assert.ok(!saved.includes('10.0.0.5'));
});

test('a failed reply keeps the question but saves no empty answer; empty questions are refused', async () => {
  const store = fakeStore();
  const chat = createChat({ store, stream: async () => { throw new Error('Ollama timeout'); } });
  await assert.rejects(chat.send('hello?'), /timeout/);
  assert.deepStrictEqual(chat.recent(), [{ role: 'user', content: 'hello?' }]);
  await assert.rejects(chat.send('   '), /Empty/);
});
