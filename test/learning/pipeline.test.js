// pipeline.test.js — idle pipeline, resumability, daily log, weekly state
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJournal } = require('../../src/learning/journal');
const { createVault } = require('../../src/learning/vault');
const { createPipeline, recordWeek, readWeek } = require('../../src/learning/pipeline');
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
    now: () => T0 + 60 * MIN, getIdleMs: () => 10 * MIN, ...extra,
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
  const p2 = createPipeline({ journal: createJournal(ctx.dir), vault: ctx.vault, stateDir: ctx.dir, deps, now: () => T0 + 60 * MIN, getIdleMs: () => 10 * MIN });
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
  let loads = 0;
  const { deps } = fakeDeps({
    loadLessons: () => { loads++; return []; },
    groupTasks: async () => [{ name: 'A', stepIds: ['a'], isTask: true }, { name: 'B', stepIds: [], isTask: true }],
  });
  await make(ctx, deps).runIfIdle();
  assert.ok(loads >= 2);
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
