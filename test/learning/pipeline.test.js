// pipeline.test.js — idle pipeline, resumability, daily log, weekly state
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJournal } = require('../../src/learning/journal');
const { createVault } = require('../../src/learning/vault');
const { createPipeline, recordWeek, readWeek, isConnectionError } = require('../../src/learning/pipeline');
const { appendDailyLog } = require('../../src/learning/reports');

const MIN = 60000;
const T0 = new Date(2026, 9, 28, 10, 0, 0).getTime();

function tmp(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }
function setup() {
  const dir = tmp('mysthi-pj-');
  const vault = createVault(tmp('mysthi-pv-'));
  vault.ensure();
  return { dir, vault, journal: createJournal(dir) };
}
function step(id, ts) {
  return { id, ts, bundleId: 'b', appName: 'App', action: 'click', target: { title: id }, redactions: [] };
}
function fakeDeps(over = {}) {
  const calls = { learn: [], know: 0, group: 0 };
  const deps = {
    isAvailable: async () => true,
    loadLessons: () => [],
    groupTasks: async (seg) => { calls.group++; return [{ name: 'Task ' + seg[0].id, stepIds: seg.map((s) => s.id), isTask: true }]; },
    learnTask: async ({ task, steps }) => {
      calls.learn.push({ task, steps });
      const slug = task.name.toLowerCase().replace(/\s+/g, '-');
      return { kind: 'new', lesson: { slug, title: task.name }, changes: ['Created'] };
    },
    extractKnowledge: async () => { calls.know++; return [{ topic: 'T', fact: 'F' }]; },
    ...over,
  };
  return { deps, calls };
}
function make(ctx, deps, extra = {}) {
  return createPipeline({
    journal: ctx.journal, vault: ctx.vault, stateDir: ctx.dir, deps,
    now: () => T0 + 60 * MIN, getIdleMs: () => 10 * MIN, minLessonSteps: 1, ...extra,
  });
}

test('does nothing when not idle', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  const { deps, calls } = fakeDeps();
  const p = make(ctx, deps, { getIdleMs: () => 1000 });
  assert.strictEqual(await p.runIfIdle(), 'not-idle');
  assert.strictEqual(calls.group, 0);
  assert.strictEqual(ctx.journal.lastProcessed(), null);
});

test('model unavailable leaves pointer unchanged', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  const { deps, calls } = fakeDeps({ isAvailable: async () => false });
  const p = make(ctx, deps);
  assert.strictEqual(await p.runIfIdle(), 'model-unavailable');
  assert.strictEqual(ctx.journal.lastProcessed(), null);
  assert.strictEqual(calls.group, 0);
});

test('connection failure mid-run reports model-unavailable and keeps earlier segments', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  ctx.journal.append(step('b', T0 + 10 * MIN));
  const { deps } = fakeDeps({
    learnTask: async ({ task }) => {
      if (task.name === 'Task b') { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; }
      return { kind: 'new', lesson: { slug: 'task-a', title: 'Task a' }, changes: [] };
    },
  });
  const p = make(ctx, deps);
  assert.strictEqual(await p.runIfIdle(), 'model-unavailable');
  assert.strictEqual(ctx.journal.lastProcessed(), 'a');
});

test('other failure returns ran and does not advance past the segment', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  const { deps } = fakeDeps({ extractKnowledge: async () => { throw new Error('bad json'); } });
  const p = make(ctx, deps);
  assert.strictEqual(await p.runIfIdle(), 'ran');
  assert.strictEqual(ctx.journal.lastProcessed(), null);
  assert.match(p.status().lastResult, /ran/);
});

test('resumes after restart without reprocessing', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  ctx.journal.append(step('b', T0 + 10 * MIN));
  const { deps, calls } = fakeDeps();
  assert.strictEqual(await make(ctx, deps).runIfIdle(), 'ran');
  assert.strictEqual(calls.learn.length, 2);
  assert.strictEqual(ctx.journal.lastProcessed(), 'b');
  const p2 = createPipeline({ journal: createJournal(ctx.dir), vault: ctx.vault, stateDir: ctx.dir, deps, now: () => T0 + 60 * MIN, getIdleMs: () => 10 * MIN, minLessonSteps: 1 });
  assert.strictEqual(await p2.runIfIdle(), 'nothing');
  assert.strictEqual(calls.learn.length, 2);
});

test('leaves in-progress trailing segment', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  ctx.journal.append(step('b', T0 + 59 * MIN)); // 1 min before now: still in progress
  const { deps, calls } = fakeDeps();
  assert.strictEqual(await make(ctx, deps).runIfIdle(), 'ran');
  assert.strictEqual(calls.learn.length, 1);
  assert.strictEqual(ctx.journal.lastProcessed(), 'a');
});

test('runNow processes everything while the user is active, including the stretch in progress', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  ctx.journal.append(step('b', T0 + 59 * MIN)); // still in progress
  const { deps, calls } = fakeDeps();
  const p = make(ctx, deps, { getIdleMs: () => 1000 }); // not idle
  assert.strictEqual(await p.runNow(), 'ran');
  assert.strictEqual(calls.learn.length, 2);
  assert.strictEqual(ctx.journal.lastProcessed(), 'b');
  assert.ok(ctx.vault.read(`log/${new Date(T0).getFullYear()}-10-28.md`), 'daily log written');
});

test('runNow while a run is in progress reports busy', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  let release;
  const { deps } = fakeDeps({ groupTasks: () => new Promise((r) => { release = () => r([]); }) });
  const p = make(ctx, deps);
  const first = p.runNow();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(await p.runNow(), 'busy');
  release();
  await first;
});

test('a stretch of only unnamed clicks is marked done without asking the model', async () => {
  const ctx = setup();
  ctx.journal.append({ id: 'u1', ts: T0, bundleId: 'b', appName: 'Claude', action: 'click', target: { role: 'AXScrollArea', title: null }, redactions: [] });
  ctx.journal.append({ id: 'u2', ts: T0 + 1000, bundleId: 'b', appName: 'Claude', action: 'click', target: { role: 'AXGroup', title: '' }, redactions: [] });
  const { deps, calls } = fakeDeps();
  assert.strictEqual(await make(ctx, deps).runIfIdle(), 'ran');
  assert.strictEqual(calls.group, 0);
  assert.strictEqual(calls.know, 0);
  assert.strictEqual(ctx.journal.lastProcessed(), 'u2');
});

test('tasks shorter than 3 meaningful steps do not become lessons', async () => {
  const ctx = setup();
  for (const id of ['a', 'b', 'c', 'd', 'e']) ctx.journal.append(step(id, T0 + id.charCodeAt(0) * 1000));
  const { deps, calls } = fakeDeps({ groupTasks: async () => [
    { name: 'Short', stepIds: ['a', 'b'], isTask: true },
    { name: 'Long', stepIds: ['c', 'd', 'e'], isTask: true },
  ] });
  await make(ctx, deps, { minLessonSteps: 3 }).runIfIdle();
  assert.deepStrictEqual(calls.learn.map((c) => c.task.name), ['Long']);
});

test('null grouping stops without advancing', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  ctx.journal.append(step('b', T0 + 10 * MIN));
  const { deps, calls } = fakeDeps({ groupTasks: async (seg) => (seg[0].id === 'b' ? null : [{ name: 'Task a', stepIds: ['a'], isTask: true }]) });
  const p = make(ctx, deps);
  await p.runIfIdle();
  assert.strictEqual(ctx.journal.lastProcessed(), 'a');
  assert.strictEqual(calls.learn.length, 1);
  assert.strictEqual(p.status().pending, 2);
});

test('per-task steps only, isTask false makes no lesson, knowledge once per segment', async () => {
  const ctx = setup();
  ['a', 'b', 'c'].forEach((id, i) => ctx.journal.append(step(id, T0 + i * 1000)));
  const { deps, calls } = fakeDeps({
    groupTasks: async () => [
      { name: 'Do X', stepIds: ['a', 'c'], isTask: true },
      { name: 'Browse', stepIds: ['b'], isTask: false },
    ],
  });
  await make(ctx, deps).runIfIdle();
  assert.strictEqual(calls.learn.length, 1);
  assert.deepStrictEqual(calls.learn[0].steps.map((s) => s.id), ['a', 'c']);
  assert.strictEqual(calls.know, 1);
});

test('reloads lessons after each learnTask', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  ctx.journal.append(step('b', T0 + 1000));
  let loads = 0;
  const { deps } = fakeDeps({
    loadLessons: () => { loads++; return []; },
    groupTasks: async () => [{ name: 'A', stepIds: ['a'], isTask: true }, { name: 'B', stepIds: ['b'], isTask: true }],
  });
  await make(ctx, deps).runIfIdle();
  assert.ok(loads >= 3);
  const empty = fakeDeps({ groupTasks: async () => [{ name: 'E', stepIds: [], isTask: true }] });
  await make(ctx, empty.deps).runIfIdle();
  assert.strictEqual(empty.calls.learn.length, 0);
});

test('daily log lists new and updated lessons, plus weekly state', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  ctx.journal.append(step('b', T0 + 10 * MIN));
  const { deps } = fakeDeps({
    learnTask: async ({ task }) => (task.name === 'Task a'
      ? { kind: 'new', lesson: { slug: 'task-a', title: 'Task a' }, changes: ['Created'] }
      : { kind: 'updated', lesson: { slug: 'old', title: 'Old one' }, changes: ['Dropped step 2'] }),
  });
  const p = make(ctx, deps);
  await p.runIfIdle();
  const log = ctx.vault.read('log/2026-10-28.md');
  assert.match(log, /^---\ntype: mysthi-log\ndate: "2026-10-28"\n---/);
  assert.match(log, /## New lessons\n+- \[\[lessons\/task-a\|Task a\]\]/);
  assert.match(log, /## Updated lessons\n+- \[\[lessons\/old\|Old one\]\].*Dropped step 2/);
  assert.match(log, /## New knowledge\n+- .*T.*F/);
  const w = readWeek(ctx.dir);
  assert.deepStrictEqual(w.newLessons, ['task-a']);
  assert.deepStrictEqual(w.updated, [{ slug: 'old', changes: ['Dropped step 2'] }]);
  assert.strictEqual(w.facts.length, 1);
  assert.strictEqual(w.enabledAt, null);
  assert.strictEqual(w.lastReportAt, null);
  assert.strictEqual(fs.statSync(path.join(ctx.dir, 'weekly.json')).mode & 0o777, 0o600);
  assert.strictEqual(p.status().lastResult, 'ran');
  assert.strictEqual(p.status().running, false);
});

test('appendDailyLog appends bullets into existing sections without duplicating headings', () => {
  const vault = tmp('mysthi-dl-');
  const v = createVault(vault); v.ensure();
  const l1 = { kind: 'new', lesson: { slug: 'a', title: 'A' }, changes: ['c'] };
  const l2 = { kind: 'new', lesson: { slug: 'b', title: 'B' }, changes: ['c'] };
  appendDailyLog({ vault: v, date: '2026-10-28', lessons: [l1], facts: [] });
  appendDailyLog({ vault: v, date: '2026-10-28', lessons: [l2], facts: [{ topic: 'x', fact: 'y' }] });
  const t = v.read('log/2026-10-28.md');
  assert.strictEqual((t.match(/^## New lessons$/gm) || []).length, 1);
  assert.match(t, /\[\[lessons\/a\|A\]\]\n- \[\[lessons\/b\|B\]\]/);
  assert.match(t, /## New knowledge\n+- x: y/);
});

test('appendDailyLog appends a new block when the file shape is unexpected', () => {
  const v = createVault(tmp('mysthi-dl2-')); v.ensure();
  v.writeAtomic('log/2026-10-28.md', 'my own notes\n');
  appendDailyLog({ vault: v, date: '2026-10-28', lessons: [{ kind: 'new', lesson: { slug: 'a', title: 'A' }, changes: [] }], facts: [] });
  const t = v.read('log/2026-10-28.md');
  assert.ok(t.startsWith('my own notes\n'));
  assert.match(t, /\[\[lessons\/a\|A\]\]/);
});

test('recordWeek creates and accumulates weekly.json', () => {
  const dir = tmp('mysthi-wk-');
  recordWeek(dir, { lessons: [{ kind: 'new', lesson: { slug: 'a', title: 'A' }, changes: [] }], facts: [{ topic: 't', fact: 'f' }] });
  recordWeek(dir, { lessons: [{ kind: 'updated', lesson: { slug: 'a', title: 'A' }, changes: ['x'] }], facts: [{ topic: 't', fact: 'f' }] });
  const w = readWeek(dir);
  assert.deepStrictEqual(w.newLessons, ['a']);
  assert.deepStrictEqual(w.updated, [{ slug: 'a', changes: ['x'] }]);
  assert.strictEqual(w.facts.length, 1);
});

const two = async () => [{ name: 'One', stepIds: ['a'], isTask: true }, { name: 'Two', stepIds: ['b'], isTask: true }];

test('retry skips tasks already learned (no double count)', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  ctx.journal.append(step('b', T0 + 1000));
  let failTwo = true;
  const seen = [];
  const { deps } = fakeDeps({
    groupTasks: two,
    learnTask: async ({ task }) => {
      if (task.name === 'Two' && failTwo) { failTwo = false; throw new Error('boom'); }
      seen.push(task.name);
      return { kind: 'new', lesson: { slug: task.name.toLowerCase(), title: task.name }, changes: [] };
    },
  });
  const p = make(ctx, deps);
  assert.strictEqual(await p.runIfIdle(), 'ran');
  assert.strictEqual(ctx.journal.lastProcessed(), null);
  assert.strictEqual(await p.runIfIdle(), 'ran');
  assert.deepStrictEqual(seen, ['One', 'Two']);
  assert.strictEqual(ctx.journal.lastProcessed(), 'b');
  assert.ok(!fs.existsSync(path.join(ctx.dir, 'progress.json')));
  assert.deepStrictEqual(readWeek(ctx.dir).newLessons, ['one', 'two']);
});

test('segment failing 3 times is skipped with a note', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  const { deps } = fakeDeps({ learnTask: async () => { throw new Error('bad'); } });
  const p = make(ctx, deps);
  assert.strictEqual(await p.runIfIdle(), 'ran');
  assert.strictEqual(await p.runIfIdle(), 'ran');
  assert.strictEqual(ctx.journal.lastProcessed(), null);
  await p.runIfIdle();
  assert.strictEqual(ctx.journal.lastProcessed(), 'a');
  assert.strictEqual(p.status().lastResult, 'skipped segment after 3 failures');
  assert.match(ctx.vault.read('log/2026-10-28.md'), /## Notes\n+- Skipped a stretch of activity Mysthi couldn't make sense of/);
  assert.ok(!fs.existsSync(path.join(ctx.dir, 'progress.json')));
});

test('connection failures never count toward skipping', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  const { deps } = fakeDeps({ learnTask: async () => { const e = new Error('x'); e.code = 'ECONNREFUSED'; throw e; } });
  const p = make(ctx, deps);
  for (let i = 0; i < 5; i++) assert.strictEqual(await p.runIfIdle(), 'model-unavailable');
  assert.strictEqual(ctx.journal.lastProcessed(), null);
});

test('null grouping with model gone re-probes: model-unavailable, no attempt counted', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  let probes = 0;
  const { deps } = fakeDeps({ groupTasks: async () => null, isAvailable: async () => ++probes === 1 });
  const p = make(ctx, deps);
  assert.strictEqual(await p.runIfIdle(), 'model-unavailable');
  assert.ok(!fs.existsSync(path.join(ctx.dir, 'progress.json')));
});

test('stops with not-idle when user returns between segments', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  ctx.journal.append(step('b', T0 + 10 * MIN));
  let idle = 10 * MIN;
  const { deps } = fakeDeps({
    learnTask: async ({ task }) => { idle = 0; return { kind: 'new', lesson: { slug: task.name, title: task.name }, changes: [] }; },
  });
  const p = make(ctx, deps, { getIdleMs: () => idle });
  assert.strictEqual(await p.runIfIdle(), 'not-idle');
  assert.strictEqual(ctx.journal.lastProcessed(), 'a');
});

test('knowledge runs before learning', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  const order = [];
  const { deps } = fakeDeps({
    extractKnowledge: async () => { order.push('k'); return []; },
    learnTask: async ({ task }) => { order.push('l'); return { kind: 'new', lesson: { slug: 's', title: 't' }, changes: [] }; },
  });
  await make(ctx, deps).runIfIdle();
  assert.deepStrictEqual(order, ['k', 'l']);
});

test('appendDailyLog skips bullets that already exist', () => {
  const v = createVault(tmp('mysthi-dl3-')); v.ensure();
  const l = { kind: 'new', lesson: { slug: 'a', title: 'A' }, changes: [] };
  appendDailyLog({ vault: v, date: '2026-10-28', lessons: [l], facts: [] });
  appendDailyLog({ vault: v, date: '2026-10-28', lessons: [l], facts: [] });
  assert.strictEqual((v.read('log/2026-10-28.md').match(/\[\[lessons\/a\|A\]\]/g) || []).length, 1);
});

test('timeouts count as attempts: a slow model cannot retry a segment forever', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  const { deps } = fakeDeps({ extractKnowledge: async () => { throw new Error('Ollama timeout'); } });
  const p = make(ctx, deps);
  assert.strictEqual(await p.runIfIdle(), 'ran');
  assert.strictEqual(await p.runIfIdle(), 'ran');
  assert.strictEqual(ctx.journal.lastProcessed(), null);
  await p.runIfIdle();
  assert.strictEqual(ctx.journal.lastProcessed(), 'a');
  assert.strictEqual(p.status().lastResult, 'skipped segment after 3 failures');
});

test('isConnectionError: timeout is not a connection error, refused / unreachable are', () => {
  assert.strictEqual(isConnectionError(new Error('Ollama timeout')), false);
  assert.strictEqual(isConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:11434')), true);
  assert.strictEqual(isConnectionError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), true);
  assert.strictEqual(isConnectionError(new Error('socket hang up')), true);
  assert.strictEqual(isConnectionError(new Error('Merge response has no steps array')), false);
});

test('model gone after a failure: not counted as an attempt', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  let probes = 0;
  const { deps } = fakeDeps({
    isAvailable: async () => ++probes === 1,
    learnTask: async () => { throw new Error('Ollama returned invalid JSON'); },
  });
  const p = make(ctx, deps);
  assert.strictEqual(await p.runIfIdle(), 'model-unavailable');
  const prog = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'progress.json'), 'utf8'));
  assert.strictEqual(prog.attempts, 0);
});

test('re-checks idle before each learnTask: stops mid-segment, keeps learned tasks, no pointer advance', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  ctx.journal.append(step('b', T0 + 1000));
  let idle = 10 * MIN;
  const seen = [];
  const { deps } = fakeDeps({
    groupTasks: two,
    learnTask: async ({ task }) => {
      seen.push(task.name);
      idle = 0; // user comes back after the first task
      return { kind: 'new', lesson: { slug: task.name.toLowerCase(), title: task.name }, changes: [] };
    },
  });
  const p = make(ctx, deps, { getIdleMs: () => idle });
  assert.strictEqual(await p.runIfIdle(), 'not-idle');
  assert.deepStrictEqual(seen, ['One']);
  assert.strictEqual(ctx.journal.lastProcessed(), null);
  const prog = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'progress.json'), 'utf8'));
  assert.strictEqual(prog.learnedTaskKeys.length, 1);
  assert.strictEqual(prog.attempts, 0);
  idle = 10 * MIN;
  assert.strictEqual(await p.runIfIdle(), 'ran');
  assert.deepStrictEqual(seen, ['One', 'Two']);
  assert.strictEqual(ctx.journal.lastProcessed(), 'b');
});

test('re-checks isEnabled before each learnTask: disabling stops without advancing', async () => {
  const ctx = setup();
  ctx.journal.append(step('a', T0));
  ctx.journal.append(step('b', T0 + 1000));
  let enabled = true;
  const seen = [];
  const { deps } = fakeDeps({
    groupTasks: two,
    learnTask: async ({ task }) => {
      seen.push(task.name);
      enabled = false;
      return { kind: 'new', lesson: { slug: task.name.toLowerCase(), title: task.name }, changes: [] };
    },
  });
  const p = make(ctx, deps, { isEnabled: () => enabled });
  assert.strictEqual(await p.runIfIdle(), 'disabled');
  assert.deepStrictEqual(seen, ['One']);
  assert.strictEqual(ctx.journal.lastProcessed(), null);
  const prog = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'progress.json'), 'utf8'));
  assert.strictEqual(prog.learnedTaskKeys.length, 1);
});
