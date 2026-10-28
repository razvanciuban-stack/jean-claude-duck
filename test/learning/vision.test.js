// vision.test.js — tests for the throttled, capped screenshot description queue
const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createVisionQueue } = require('../../src/learning/vision');

const flush = () => new Promise((r) => setImmediate(r));
let queue;

function setup(opts = {}) {
  mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const got = [];
  const deferreds = [];
  const describe = (prev, cur) => {
    calls.push({ prev, cur });
    if (opts.describe) return opts.describe(prev, cur, calls.length);
    return new Promise((resolve, reject) => deferreds.push({ resolve, reject }));
  };
  queue = createVisionQueue({
    describe,
    onDescription: (id, text) => got.push([id, text]),
    cap: opts.cap,
    minIntervalMs: 5000,
  });
  return { calls, got, deferreds };
}

afterEach(() => {
  if (queue) queue.stop();
  queue = null;
  mock.timers.reset();
});

test('drops oldest when over cap', async () => {
  const { calls, deferreds } = setup({ cap: 2 });
  queue.push(1, 'a');
  queue.push(2, 'b');
  queue.push(3, 'c');
  assert.equal(queue.size(), 2);
  deferreds[0].resolve('one');
  await flush();
  mock.timers.tick(5000);
  await flush();
  assert.deepEqual(calls.map((c) => c.cur), ['a', 'c']);
  assert.equal(calls[1].prev, 'a');
});

test('respects min interval', async () => {
  const { calls } = setup({ describe: async () => 'ok' });
  queue.push(1, 'a');
  queue.push(2, 'b');
  await flush();
  assert.equal(calls.length, 1);
  mock.timers.tick(4999);
  await flush();
  assert.equal(calls.length, 1);
  mock.timers.tick(1);
  await flush();
  assert.equal(calls.length, 2);
});

test('redacts descriptions', async () => {
  const { got } = setup({ describe: async () => 'Opened 10.0.0.1 in Safari' });
  queue.push(1, 'a');
  await flush();
  assert.deepEqual(got, [[1, 'Opened [IP] in Safari']]);
});

test('describe failure does not stop the queue', async () => {
  const { got } = setup({
    describe: async (p, c, n) => { if (n === 1) throw new Error('boom'); return 'fine'; },
  });
  const origErr = console.error;
  console.error = () => {};
  try {
    queue.push(1, 'a');
    queue.push(2, 'b');
    await flush();
    mock.timers.tick(5000);
    await flush();
  } finally {
    console.error = origErr;
  }
  assert.deepEqual(got, [[2, 'fine']]);
});

test('before image is null for first item, previous attempted otherwise', async () => {
  const { calls } = setup({ describe: async () => 'x' });
  queue.push(1, 'a');
  await flush();
  mock.timers.tick(5000);
  queue.push(2, 'b');
  await flush();
  assert.equal(calls[0].prev, null);
  assert.equal(calls[1].prev, 'a');
});

test('stop clears queue, makes push a no-op and suppresses in-flight result', async () => {
  const { calls, got, deferreds } = setup();
  queue.push(1, 'a');
  queue.push(2, 'b');
  queue.stop();
  assert.equal(queue.size(), 0);
  queue.push(3, 'c');
  assert.equal(queue.size(), 0);
  deferreds[0].resolve('late');
  await flush();
  mock.timers.tick(10000);
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(got, []);
});
