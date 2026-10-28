const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault } = require('../../src/learning/vault');
const { renderLesson } = require('../../src/learning/lesson-note');
const { readWeek, writeWeek } = require('../../src/learning/pipeline');
const { maybeWriteWeeklyReport } = require('../../src/learning/reports');
const { WEEK_MS } = require('../../src/learning/config');

const T0 = new Date(2026, 9, 1, 9, 0, 0).getTime();

function setup(week = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysthi-rep-'));
  const vault = createVault(path.join(root, 'vault'));
  const stateDir = path.join(root, 'state');
  writeWeek(stateDir, { enabledAt: T0, lastReportAt: null, newLessons: [], updated: [], facts: [], ...week });
  return { vault, stateDir };
}

function seedLesson(vault, slug, title, texts, extra = {}) {
  vault.writeAtomic(`lessons/${slug}.md`, renderLesson({
    slug, title, apps: ['com.apple.Safari'], timesObserved: 3, confident: true, firstSeen: '2026-10-01', lastSeen: '2026-10-02',
    steps: texts.map((text, i) => ({ id: `s${i}`, app: 'a', action: 'click', target: '', text, userEdited: false, variants: i === 0 ? (extra.variant ? [extra.variant] : []) : [] })),
  }));
}

test('no report before 7 days', () => {
  const { vault, stateDir } = setup({ newLessons: ['a'] });
  const r = maybeWriteWeeklyReport({ vault, stateDir, now: () => T0 + WEEK_MS - 1 });
  assert.deepStrictEqual(r, { written: false });
  assert.deepStrictEqual(vault.list('reports'), []);
});

test('never writes when not enabled', () => {
  const { vault, stateDir } = setup({ enabledAt: null });
  assert.strictEqual(maybeWriteWeeklyReport({ vault, stateDir, now: () => T0 + 10 * WEEK_MS }).written, false);
});

test('report after 7 days includes full steps of every new lesson', () => {
  const { vault, stateDir } = setup({ newLessons: ['send-invoice', 'export-pdf'], updated: [{ slug: 'send-invoice', changes: ['Dropped a step'] }], facts: [{ topic: 'Billing', fact: 'Net 30 terms' }] });
  seedLesson(vault, 'send-invoice', 'Send invoice', ['Open Mail', 'Attach the PDF', 'Press send'], { variant: 'Hit cmd+enter' });
  seedLesson(vault, 'export-pdf', 'Export PDF', ['Choose File → Export']);
  const now = T0 + WEEK_MS;
  const r = maybeWriteWeeklyReport({ vault, stateDir, now: () => now });
  assert.strictEqual(r.written, true);
  assert.match(r.relPath, /^reports\/2026-10-08-week\.md$/);
  const md = vault.read(r.relPath);
  assert.match(md, /type: mysthi-report/);
  assert.match(md, /period_start: "2026-10-01"/);
  assert.match(md, /new_lessons: 2/);
  assert.match(md, /2 new lessons, 1 updated, 1 new facts/);
  assert.match(md, /### \[\[lessons\/send-invoice\|Send invoice\]\]/);
  for (const s of ['Open Mail', 'Attach the PDF', 'Press send', 'Choose File → Export']) assert.ok(md.includes(s), s);
  assert.match(md, /1\. Open Mail\n/);
  assert.match(md, /\n {3}- Also seen: Hit cmd\+enter/);
  assert.ok(!md.includes('step:s0'));
  assert.ok(!md.includes('mysthi-lesson'));
  assert.match(md, /Dropped a step/);
  assert.match(md, /Billing/);
  assert.match(md, /Net 30 terms/);
});

test('state resets after report', () => {
  const { vault, stateDir } = setup({ newLessons: ['a'], facts: [{ topic: 't', fact: 'f' }] });
  seedLesson(vault, 'a', 'A', ['x']);
  const now = T0 + WEEK_MS;
  maybeWriteWeeklyReport({ vault, stateDir, now: () => now });
  const w = readWeek(stateDir);
  assert.deepStrictEqual({ ...w }, { enabledAt: T0, lastReportAt: now, newLessons: [], updated: [], facts: [] });
  assert.strictEqual(maybeWriteWeeklyReport({ vault, stateDir, now: () => now + 1000 }).written, false);
});

test('removed lesson listed as (note removed); unreadable note does not crash', () => {
  const { vault, stateDir } = setup({ newLessons: ['gone', 'broken'], updated: [{ slug: 'gone', changes: [] }] });
  vault.writeAtomic('lessons/broken.md', '# hand edited, no json block\n');
  const r = maybeWriteWeeklyReport({ vault, stateDir, now: () => T0 + WEEK_MS });
  const md = vault.read(r.relPath);
  assert.match(md, /gone.*\(note removed\)/);
  assert.match(md, /broken.*\(note unreadable — edited by hand\?\)/);
});

test('empty week still writes a short report', () => {
  const { vault, stateDir } = setup();
  const r = maybeWriteWeeklyReport({ vault, stateDir, now: () => T0 + WEEK_MS });
  assert.strictEqual(r.written, true);
  assert.match(vault.read(r.relPath), /Nothing new this week/);
});

test('same-day second report gets a suffix', () => {
  const { vault, stateDir } = setup();
  const now = T0 + WEEK_MS;
  const a = maybeWriteWeeklyReport({ vault, stateDir, now: () => now });
  writeWeek(stateDir, { ...readWeek(stateDir), lastReportAt: T0 });
  const b = maybeWriteWeeklyReport({ vault, stateDir, now: () => now });
  assert.strictEqual(a.relPath, 'reports/2026-10-08-week.md');
  assert.strictEqual(b.relPath, 'reports/2026-10-08-week-2.md');
});

test('failed report write leaves state untouched', () => {
  const { vault, stateDir } = setup({ newLessons: ['a'] });
  const bad = { ...vault, writeAtomic() { throw new Error('disk full'); } };
  assert.throws(() => maybeWriteWeeklyReport({ vault: bad, stateDir, now: () => T0 + WEEK_MS }), /disk full/);
  assert.deepStrictEqual(readWeek(stateDir).newLessons, ['a']);
  assert.strictEqual(readWeek(stateDir).lastReportAt, null);
});
