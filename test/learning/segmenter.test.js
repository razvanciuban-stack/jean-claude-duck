// segmenter.test.js — tests for step segmentation and task grouping
const test = require('node:test');
const assert = require('node:assert');
const { splitAtBoundaries, groupTasks, GROUP_PROMPT } = require('../../src/learning/segmenter');
const { OllamaJSONError } = require('../../src/services/ollama');

const mk = (id, ts, extra = {}) => ({
  id, ts, bundleId: 'b', appName: 'Figma', window: 'w', url: null,
  action: 'click', target: { role: 'AXButton', title: `T${id}` }, redactions: 0, ...extra,
});

test('splits on 3-minute gaps', () => {
  const segs = splitAtBoundaries([mk('a', 0), mk('b', 60000), mk('c', 300000)]);
  assert.deepStrictEqual(segs.map((s) => s.map((x) => x.id)), [['a', 'b'], ['c']]);
  assert.deepStrictEqual(splitAtBoundaries([]), []);
});

test('groupTasks returns validated tasks and sends the listing', async () => {
  let args;
  const ask = async (a) => { args = a; return { tasks: [{ name: ' Export icons ', stepIds: ['a', 'b'], isTask: true }, { name: 'Browse', stepIds: ['c'] }] }; };
  const seg = [mk('a', 0), mk('b', 1, { action: 'shortcut', keys: 'cmd+e', target: null }), mk('c', 2)];
  const out = await groupTasks(seg, ask);
  assert.deepStrictEqual(out, [
    { name: 'Export icons', stepIds: ['a', 'b'], isTask: true },
    { name: 'Browse', stepIds: ['c'], isTask: true },
  ]);
  assert.strictEqual(args.messages[0].content, GROUP_PROMPT);
  assert.ok(args.messages[1].content.includes('b | Figma | shortcut |  | cmd+e | '));
  assert.ok(args.messages[1].content.includes('a | Figma | click | Ta |  | '));
});

test('groupTasks drops unknown ids, duplicate ids, empty tasks, bad names', async () => {
  const ask = async () => ({ tasks: [
    { name: 'One', stepIds: ['a', 'zzz'], isTask: false },
    { name: 'Two', stepIds: ['a', 'b'], isTask: true },
    { name: 'Three', stepIds: ['a'], isTask: true },
    { name: '  ', stepIds: ['b'] },
  ] });
  const out = await groupTasks([mk('a', 0), mk('b', 1)], ask);
  assert.deepStrictEqual(out, [
    { name: 'One', stepIds: ['a'], isTask: false },
    { name: 'Two', stepIds: ['b'], isTask: true },
  ]);
});

test('groupTasks returns null when ask throws', async () => {
  assert.strictEqual(await groupTasks([mk('a', 0)], async () => { throw new OllamaJSONError('x'); }), null);
  assert.strictEqual(await groupTasks([mk('a', 0)], async () => { throw new Error('ECONNREFUSED'); }), null);
});

test('groupTasks returns null when tasks is not an array', async () => {
  assert.strictEqual(await groupTasks([mk('a', 0)], async () => ({ tasks: 'no' })), null);
  assert.strictEqual(await groupTasks([mk('a', 0)], async () => null), null);
});

test('caps at 120 steps per call, concatenates, null if any window fails', async () => {
  const seg = Array.from({ length: 250 }, (_, i) => mk(`s${i}`, i));
  const sizes = [];
  const ask = async ({ messages }) => {
    const ids = messages[1].content.split('\n').map((l) => l.split(' | ')[0]);
    sizes.push(ids.length);
    return { tasks: [{ name: 'T', stepIds: ids, isTask: true }] };
  };
  const out = await groupTasks(seg, ask);
  assert.deepStrictEqual(sizes, [120, 120, 10]);
  assert.strictEqual(out.length, 3);
  let n = 0;
  const failing = async (a) => (++n === 2 ? null : ask(a));
  assert.strictEqual(await groupTasks(seg, failing), null);
});

test('truncates description and value to 200 chars in the listing', async () => {
  let content;
  const ask = async ({ messages }) => { content = messages[1].content; return { tasks: [] }; };
  await groupTasks([mk('a', 0, { value: 'v'.repeat(500), description: 'd'.repeat(500) })], ask);
  assert.ok(content.includes('v'.repeat(200) + ' | '));
  assert.ok(!content.includes('v'.repeat(201)));
  assert.ok(!content.includes('d'.repeat(201)));
});
