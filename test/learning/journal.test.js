// journal.test.js — journal round-trip, resume, patching and file modes
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJournal } = require('../../src/learning/journal');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'journal-'));
}
function step(id, extra = {}) {
  return { id, ts: 1, bundleId: 'b', appName: 'a', window: 'w', url: null, action: 'click', target: null, redactions: [], ...extra };
}

test('journal round-trips steps and resumes after lastProcessed', () => {
  const dir = path.join(tmp(), 'learning');
  const j = createJournal(dir);
  j.append(step('a1'));
  j.append(step('a2'));
  j.append(step('a3'));
  assert.strictEqual(j.readSince(null).length, 3);
  assert.strictEqual(j.lastProcessed(), null);
  j.markProcessed('a1');
  const j2 = createJournal(dir);
  assert.strictEqual(j2.lastProcessed(), 'a1');
  assert.deepStrictEqual(j2.readSince(j2.lastProcessed()).map((s) => s.id), ['a2', 'a3']);
});

test('attachDescription patches the step', () => {
  const j = createJournal(path.join(tmp(), 'l'));
  j.append(step('a1'));
  j.append(step('a2'));
  j.attachDescription('a1', 'Clicked the Save button');
  const all = j.readSince(null);
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].description, 'Clicked the Save button');
  assert.strictEqual(all[1].description, undefined);
});

test('attachDescription redacts the description', () => {
  const dir = path.join(tmp(), 'l');
  const j = createJournal(dir);
  j.append(step('a1'));
  j.attachDescription('a1', 'ssh root@10.0.0.5');
  assert.strictEqual(j.readSince(null)[0].description, 'ssh root@[IP]');
  for (const f of fs.readdirSync(dir)) {
    assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes('10.0.0.5'));
  }
});

test('journal files are 0600 and dir is 0700', () => {
  const dir = path.join(tmp(), 'l');
  const j = createJournal(dir);
  j.append(step('a1'));
  j.markProcessed('a1');
  assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);
  for (const f of fs.readdirSync(dir)) {
    assert.strictEqual(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600);
  }
});
