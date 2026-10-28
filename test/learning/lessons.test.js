// lessons.test.js — lesson matching/merging; user edits always win
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault } = require('../../src/learning/vault');
const { parseLesson, renderLesson } = require('../../src/learning/lesson-note');
const { loadLessons, learnTask } = require('../../src/learning/lessons');

function tmpVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mysthi-lessons-'));
  const vault = createVault(dir);
  vault.ensure();
  return { dir, vault };
}

const steps = [
  { id: 'j1', ts: 1, bundleId: 'com.apple.Safari', appName: 'Safari', window: 'W', url: null, action: 'click', target: { role: 'AXButton', title: 'Reports' }, redactions: [] },
  { id: 'j2', ts: 2, bundleId: 'com.apple.Safari', appName: 'Safari', window: 'W', url: null, action: 'shortcut', target: null, keys: 'cmd+s', redactions: [] },
  { id: 'j3', ts: 3, bundleId: 'com.apple.Safari', appName: 'Safari', window: 'W', url: null, action: 'click', target: { role: 'AXMenuItem', title: 'Export', menuPath: ['File', 'Export'] }, description: 'Export the file', redactions: [] },
];
const task = { name: 'Export the weekly report', stepIds: ['j1', 'j2', 'j3'], isTask: true };

function scripted(responses) {
  const calls = [];
  const ask = async (args) => {
    calls.push(args);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(args) : r;
  };
  ask.calls = calls;
  return ask;
}

async function learnNew(vault, today = '2026-10-01') {
  const lessons = loadLessons(vault);
  return learnTask({ task, steps, lessons, vault, ask: scripted([]), today });
}

test('unmatched task creates lesson with timesObserved 1', async () => {
  const { vault } = tmpVault();
  const res = await learnNew(vault);
  assert.strictEqual(res.kind, 'new');
  assert.strictEqual(res.lesson.timesObserved, 1);
  assert.strictEqual(res.lesson.confident, false);
  assert.strictEqual(res.lesson.slug, 'export-the-weekly-report');
  assert.deepStrictEqual(res.lesson.steps.map((s) => s.text), [
    'In Safari, click AXButton "Reports"',
    'In Safari, press cmd+s',
    'Export the file',
  ]);
  assert.deepStrictEqual(res.lesson.steps.map((s) => s.id), ['j1', 'j2', 'j3']);
  assert.ok(vault.exists('lessons/export-the-weekly-report.md'));
  assert.strictEqual(loadLessons(vault).length, 1);
});

test('new lesson slug avoids collisions including unparseable notes', async () => {
  const { vault } = tmpVault();
  vault.writeAtomic('lessons/export-the-weekly-report.md', 'user garbage, not a lesson');
  const res = await learnNew(vault);
  assert.strictEqual(res.lesson.slug, 'export-the-weekly-report-2');
  assert.strictEqual(vault.read('lessons/export-the-weekly-report.md'), 'user garbage, not a lesson');
  assert.strictEqual(loadLessons(vault).length, 1);
});

test('matched task merges and becomes confident on third observation', async () => {
  const { vault } = tmpVault();
  await learnNew(vault);
  for (let n = 2; n <= 3; n++) {
    const lessons = loadLessons(vault);
    const ask = scripted([
      { slug: 'export-the-weekly-report' },
      (args) => {
        const payload = JSON.parse(args.messages[1].content);
        return { steps: payload.existing.map((s) => ({ id: s.id, text: s.text, app: s.app, action: s.action, target: s.target })), changes: ['Confirmed steps'] };
      },
    ]);
    const res = await learnTask({ task, steps, lessons, vault, ask, today: `2026-10-0${n}` });
    assert.strictEqual(res.kind, 'updated');
    assert.strictEqual(res.lesson.timesObserved, n);
    assert.strictEqual(res.lesson.confident, n >= 3);
    assert.strictEqual(res.lesson.lastSeen, `2026-10-0${n}`);
    assert.strictEqual(res.lesson.firstSeen, '2026-10-01');
    assert.deepStrictEqual(res.changes, ['Confirmed steps']);
    assert.strictEqual(ask.calls[0].messages[0].role, 'system');
  }
  assert.strictEqual(loadLessons(vault)[0].confident, true);
});

test('unknown slug from the model is treated as new', async () => {
  const { vault } = tmpVault();
  await learnNew(vault);
  const ask = scripted([{ slug: 'made-up' }]);
  const res = await learnTask({ task, steps, lessons: loadLessons(vault), vault, ask, today: '2026-10-02' });
  assert.strictEqual(res.kind, 'new');
  assert.strictEqual(res.lesson.slug, 'export-the-weekly-report-2');
});

test('user-edited step survives a merge that rewrites it', async () => {
  const { vault } = tmpVault();
  await learnNew(vault);
  const md = vault.read('lessons/export-the-weekly-report.md').replace('In Safari, press cmd+s', 'Save with the keyboard');
  vault.writeAtomic('lessons/export-the-weekly-report.md', md);
  const ask = scripted([
    { slug: 'export-the-weekly-report' },
    (args) => {
      const payload = JSON.parse(args.messages[1].content);
      return {
        steps: payload.existing.map((s) => ({ id: s.id, text: s.id === 'j2' ? 'Press cmd+s to save' : s.text, app: s.app, action: s.action, target: s.target })),
        changes: ['Reworded save'],
      };
    },
  ]);
  const res = await learnTask({ task, steps, lessons: loadLessons(vault), vault, ask, today: '2026-10-02' });
  const s2 = res.lesson.steps.find((s) => s.id === 'j2');
  assert.strictEqual(s2.text, 'Save with the keyboard');
  assert.strictEqual(s2.userEdited, true);
  assert.deepStrictEqual(s2.variants, ['Press cmd+s to save']);
  const onDisk = parseLesson(vault.read('lessons/export-the-weekly-report.md')).lesson;
  assert.strictEqual(onDisk.steps.find((s) => s.id === 'j2').text, 'Save with the keyboard');
});

test('user-edited step the model omitted is kept in position', async () => {
  const { vault } = tmpVault();
  await learnNew(vault);
  const md = vault.read('lessons/export-the-weekly-report.md').replace('In Safari, press cmd+s', 'Save with the keyboard');
  vault.writeAtomic('lessons/export-the-weekly-report.md', md);
  const ask = scripted([
    { slug: 'export-the-weekly-report' },
    { steps: [{ id: 'j1', text: 'Click Reports', app: 'com.apple.Safari', action: 'click', target: 'Reports' }], changes: [] },
  ]);
  const res = await learnTask({ task, steps, lessons: loadLessons(vault), vault, ask, today: '2026-10-02' });
  assert.deepStrictEqual(res.lesson.steps.map((s) => s.id), ['j1', 'j2']);
});

test('user-removed step is not resurrected', async () => {
  const { vault } = tmpVault();
  await learnNew(vault);
  const md = vault.read('lessons/export-the-weekly-report.md').replace(/^2\. .*\n/m, '');
  vault.writeAtomic('lessons/export-the-weekly-report.md', md);
  let payload;
  const mk = () => scripted([
    { slug: 'export-the-weekly-report' },
    (args) => {
      payload = JSON.parse(args.messages[1].content);
      return { steps: [
        { id: 'j1', text: 'a', app: 'x', action: 'click', target: 't' },
        { id: 'j2', text: 'zombie', app: 'x', action: 'click', target: 't' },
        { text: 'In Safari, press cmd+s', app: 'x', action: 'shortcut', target: '' },
        { text: 'Brand new step', app: 'x', action: 'click', target: 't' },
      ], changes: [] };
    },
  ]);
  // First load tombstones the removal and rewrites the note; a second load must still remember it.
  loadLessons(vault);
  const res = await learnTask({ task, steps, lessons: loadLessons(vault), vault, ask: mk(), today: '2026-10-02' });
  assert.ok(!payload.existing.some((s) => s.id === 'j2'));
  assert.ok(!res.lesson.steps.some((s) => s.id === 'j2' || s.text === 'zombie' || s.text === 'In Safari, press cmd+s'));
  assert.ok(res.lesson.steps.some((s) => s.text === 'Brand new step' && /^m[0-9a-f]{8}$/.test(s.id)));
  assert.deepStrictEqual(res.lesson.removedIds, ['j2']);
  // and again on the next observation, from disk
  const res2 = await learnTask({ task, steps, lessons: loadLessons(vault), vault, ask: mk(), today: '2026-10-03' });
  assert.ok(!res2.lesson.steps.some((s) => s.text === 'In Safari, press cmd+s'));
});

test('model app/action/target are redacted before writing', async () => {
  const { vault } = tmpVault();
  await learnNew(vault);
  const ask = scripted([
    { slug: 'export-the-weekly-report' },
    { steps: [
      { id: 'j1', text: 'Open', app: 'host 10.0.0.5', action: 'click', target: { role: 'AXButton', title: 'sk-abcdefghijklmnopqrstuvwxyz123456' } },
      { text: 'New', app: 'a', action: 'click', target: 'key sk-abcdefghijklmnopqrstuvwxyz123456 at 10.0.0.5' },
    ], changes: [] },
  ]);
  await learnTask({ task, steps, lessons: loadLessons(vault), vault, ask, today: '2026-10-02' });
  const disk = vault.read('lessons/export-the-weekly-report.md');
  assert.ok(!disk.includes('sk-abcdefghij'));
  assert.ok(!disk.includes('10.0.0.5'));
});

test('empty or text-less model steps keep the lesson but count the observation', async () => {
  const { vault } = tmpVault();
  await learnNew(vault);
  for (const bad of [[], [{ id: 'j1' }, { app: 'x' }]]) {
    const before = loadLessons(vault)[0];
    const ask = scripted([{ slug: 'export-the-weekly-report' }, { steps: bad, changes: [] }]);
    const res = await learnTask({ task, steps, lessons: [before], vault, ask, today: '2026-10-05' });
    assert.deepStrictEqual(res.lesson.steps, before.steps);
    assert.strictEqual(res.lesson.timesObserved, before.timesObserved + 1);
    assert.strictEqual(res.lesson.lastSeen, '2026-10-05');
  }
});

test('duplicate model ids: first wins, extra text goes to variants of a user-edited step', async () => {
  const { vault } = tmpVault();
  await learnNew(vault);
  const md = vault.read('lessons/export-the-weekly-report.md').replace('In Safari, press cmd+s', 'Save it');
  vault.writeAtomic('lessons/export-the-weekly-report.md', md);
  const ask = scripted([
    { slug: 'export-the-weekly-report' },
    { steps: [
      { id: 'j2', text: 'Save A', app: 'a', action: 'shortcut', target: '' },
      { id: 'j2', text: 'Save B', app: 'a', action: 'shortcut', target: '' },
      { id: 'j1', text: 'One', app: 'a', action: 'click', target: '' },
      { id: 'j1', text: 'One again', app: 'a', action: 'click', target: '' },
    ], changes: [] },
  ]);
  const res = await learnTask({ task, steps, lessons: loadLessons(vault), vault, ask, today: '2026-10-02' });
  assert.deepStrictEqual(res.lesson.steps.map((s) => s.id), ['j2', 'j1']);
  assert.deepStrictEqual(res.lesson.steps[0].variants, ['Save A', 'Save B']);
  assert.strictEqual(res.lesson.steps[1].text, 'One');
});

test('merge drops omitted plain steps, adds id-less steps, redacts model strings', async () => {
  const { vault } = tmpVault();
  await learnNew(vault);
  const ask = scripted([
    { slug: 'export-the-weekly-report' },
    { steps: [{ id: 'j1', text: 'Open Reports', app: 'com.apple.Safari', action: 'click', target: 'Reports' }, { text: 'Set password=hunter2 now', app: 'com.apple.Safari', action: 'type', target: 'f', value: 'v' }], changes: ['token=abcd1234 noted'] },
  ]);
  const res = await learnTask({ task, steps, lessons: loadLessons(vault), vault, ask, today: '2026-10-02' });
  assert.strictEqual(res.lesson.steps.length, 2);
  assert.ok(!res.lesson.steps[1].text.includes('hunter2'));
  assert.ok(!res.changes[0].includes('abcd1234'));
  assert.ok(!vault.read('lessons/export-the-weekly-report.md').includes('hunter2'));
});

test('deleted note means task is new', async () => {
  const { vault, dir } = tmpVault();
  await learnNew(vault);
  const stale = loadLessons(vault);
  fs.unlinkSync(path.join(dir, 'lessons', 'export-the-weekly-report.md'));
  assert.strictEqual(loadLessons(vault).length, 0);
  const res = await learnTask({ task, steps, lessons: loadLessons(vault), vault, ask: scripted([]), today: '2026-10-02' });
  assert.strictEqual(res.kind, 'new');
  // even a stale in-memory list does not resurrect the deleted note
  fs.unlinkSync(path.join(dir, 'lessons', 'export-the-weekly-report.md'));
  const res2 = await learnTask({ task, steps, lessons: stale, vault, ask: scripted([{ slug: 'export-the-weekly-report' }]), today: '2026-10-03' });
  assert.strictEqual(res2.kind, 'new');
});

test('ask failure rejects and writes nothing', async () => {
  const { vault } = tmpVault();
  await learnNew(vault);
  const before = vault.read('lessons/export-the-weekly-report.md');
  await assert.rejects(learnTask({ task, steps, lessons: loadLessons(vault), vault, ask: scripted([new Error('boom')]), today: '2026-10-02' }), /boom/);
  await assert.rejects(learnTask({ task, steps, lessons: loadLessons(vault), vault, ask: scripted([{ slug: 'export-the-weekly-report' }, new Error('boom2')]), today: '2026-10-02' }), /boom2/);
  assert.strictEqual(vault.read('lessons/export-the-weekly-report.md'), before);
  assert.strictEqual(vault.list('lessons').length, 1);
});

test('loadLessons applies user edits and rewrites JSON block', () => {
  const { vault } = tmpVault();
  const lesson = { slug: 'x', title: 'X', apps: ['a'], timesObserved: 1, confident: false, firstSeen: '2026-10-01', lastSeen: '2026-10-01', steps: [{ id: 's1', app: 'a', action: 'click', target: 't', text: 'Old', userEdited: false, variants: [] }] };
  vault.writeAtomic('lessons/x.md', renderLesson(lesson).replace('1. Old', '1. New'));
  const [loaded] = loadLessons(vault);
  assert.strictEqual(loaded.steps[0].text, 'New');
  assert.strictEqual(loaded.slug, 'x');
  const json = /```mysthi-lesson\n([\s\S]*?)\n```/.exec(vault.read('lessons/x.md'))[1];
  assert.strictEqual(JSON.parse(json).steps[0].text, 'New');
  assert.strictEqual(JSON.parse(json).steps[0].userEdited, true);
});

test('match and merge calls set the learning timeout and num_ctx', async () => {
  const { LEARNING_TIMEOUT_MS, LEARNING_NUM_CTX } = require('../../src/learning/config');
  const { vault } = tmpVault();
  await learnNew(vault);
  const ask = scripted([
    { slug: 'export-the-weekly-report' },
    (args) => ({ steps: JSON.parse(args.messages[1].content).existing.map((s) => ({ id: s.id, text: s.text })), changes: [] }),
  ]);
  await learnTask({ task, steps, lessons: loadLessons(vault), vault, ask, today: '2026-10-02' });
  assert.strictEqual(ask.calls.length, 2);
  for (const c of ask.calls) {
    assert.strictEqual(c.timeoutMs, LEARNING_TIMEOUT_MS);
    assert.strictEqual(c.options.num_ctx, LEARNING_NUM_CTX);
  }
});
