// step-recorder.test.js — privacy filtering and redaction in the step recorder, plus HelperClient spawning
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJournal } = require('../../src/learning/journal');
const { createStepRecorder } = require('../../src/learning/step-recorder');
const { createPolicy } = require('../../src/learning/privacy');
const { HelperClient } = require('../../src/learning/helper-client');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const journal = createJournal(dir);
  const watching = [];
  const shots = [];
  const rec = createStepRecorder({
    policy: createPolicy(),
    journal,
    onWatchingChange: (b) => watching.push(b),
    onScreenshotWanted: (id) => shots.push(id)
  });
  return { dir, journal, rec, watching, shots };
}
const safari = { bundleId: 'com.apple.Safari', appName: 'Safari', window: 'Docs', url: 'https://example.com/a' };
const iterm = { bundleId: 'com.googlecode.iterm2', appName: 'iTerm2', window: 'zsh', url: null };
const field = (title) => ({ role: 'AXTextField', title, placeholder: null, description: null });
function allJournalText(dir) {
  return fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}

test('recorder drops everything in 1Password', () => {
  const { journal, rec, watching, shots } = setup();
  const ctx = { bundleId: 'com.1password.1password', appName: '1Password', window: 'Vault', url: null };
  rec.handle({ type: 'app', ...ctx });
  rec.handle({ type: 'click', ts: 1, target: { role: 'AXButton', title: 'Copy', description: null }, ...ctx });
  assert.deepStrictEqual(journal.readSince(null), []);
  assert.deepStrictEqual(watching, [false]);
  assert.deepStrictEqual(shots, []);
});

test('recorder reports watching only on transitions', () => {
  const { rec, watching } = setup();
  rec.handle({ type: 'app', ...safari });
  rec.handle({ type: 'click', ts: 1, target: {}, ...safari });
  rec.handle({ type: 'app', bundleId: 'com.1password.1password', appName: '1Password', window: 'x', url: null });
  rec.handle({ type: 'app', bundleId: 'com.1password.1password', appName: '1Password', window: 'y', url: null });
  rec.handle({ type: 'app', ...safari });
  assert.deepStrictEqual(watching, [true, false, true]);
});

test('recorder redacts typed value', () => {
  const { journal, rec, shots } = setup();
  rec.handle({ type: 'app', ...safari });
  rec.handle({ type: 'typed', ts: 2, text: 'ssh root@10.0.0.5', secure: false, field: field('Address'), isTerminal: false, visibleLine: null, ...safari });
  const [s] = journal.readSince(null);
  assert.strictEqual(s.action, 'type');
  assert.strictEqual(s.value, 'ssh root@[IP]');
  assert.ok(s.redactions.includes('IP'));
  assert.deepStrictEqual(shots, [s.id]);
});

test('recorder never writes secure text', () => {
  const { dir, journal, rec } = setup();
  rec.handle({ type: 'app', ...safari });
  rec.handle({ type: 'typed', ts: 2, text: null, secure: true, field: field('Address'), isTerminal: false, visibleLine: null, ...safari });
  rec.handle({ type: 'typed', ts: 3, text: 'leaked-secret', secure: true, field: field('Address'), isTerminal: false, visibleLine: null, ...safari });
  assert.deepStrictEqual(journal.readSince(null), []);
  assert.ok(!allJournalText(dir).includes('leaked-secret'));
});

test('typed in password-labelled field is dropped', () => {
  const { journal, rec } = setup();
  rec.handle({ type: 'app', ...safari });
  rec.handle({ type: 'typed', ts: 2, text: 'abc', secure: false, field: field('Password'), isTerminal: false, visibleLine: null, ...safari });
  assert.deepStrictEqual(journal.readSince(null), []);
});

test('terminal command recorded, password input not', () => {
  const { dir, journal, rec } = setup();
  rec.handle({ type: 'app', ...iterm });
  rec.handle({ type: 'typed', ts: 2, text: 'git push', secure: false, field: field(null), isTerminal: true, visibleLine: '$ git push', ...iterm });
  rec.handle({ type: 'typed', ts: 3, text: 'hunter2', secure: false, field: field(null), isTerminal: true, visibleLine: 'Password: ', ...iterm });
  const steps = journal.readSince(null);
  assert.strictEqual(steps.length, 1);
  assert.strictEqual(steps[0].action, 'command');
  assert.strictEqual(steps[0].value, 'git push');
  assert.ok(!allJournalText(dir).includes('hunter2'));
});

test('terminal bundle with isTerminal false never falls back to type', () => {
  const { journal, rec } = setup();
  rec.handle({ type: 'app', ...iterm });
  rec.handle({ type: 'typed', ts: 3, text: 'hunter2', secure: false, field: field(null), isTerminal: false, visibleLine: 'Password: ', ...iterm });
  assert.deepStrictEqual(journal.readSince(null), []);
});

test('click and shortcut steps are redacted and request screenshots; unknown and screenshot events ignored', () => {
  const { journal, rec, shots } = setup();
  rec.handle({ type: 'app', ...safari, window: 'Inbox 10.0.0.5' });
  rec.handle({ type: 'click', ts: 1, target: { role: 'AXButton', title: 'Mail 10.0.0.5', description: null, menuPath: null }, ...safari, window: 'Inbox 10.0.0.5' });
  rec.handle({ type: 'shortcut', ts: 2, keys: 'cmd+s', ...safari });
  rec.handle({ type: 'screenshot', ts: 3, id: 'x', jpegBase64: null, width: 0, height: 0 });
  rec.handle({ type: 'permissions', screen: true, accessibility: true, input: true });
  rec.handle({ type: 'weird' });
  const steps = journal.readSince(null);
  assert.strictEqual(steps.length, 2);
  assert.ok(!JSON.stringify(steps[0]).includes('10.0.0.5'));
  assert.ok(steps[0].redactions.length > 0);
  assert.strictEqual(steps[1].keys, 'cmd+s');
  assert.strictEqual(shots.length, 2);
});

test('browser without url is not watched even if flag absent', () => {
  const { journal, rec } = setup();
  const ctx = { bundleId: 'com.apple.Safari', appName: 'Safari', window: 'x', url: null };
  rec.handle({ type: 'app', ...ctx });
  rec.handle({ type: 'click', ts: 1, target: {}, ...ctx });
  assert.deepStrictEqual(journal.readSince(null), []);
});

test('HelperClient emits parsed lines, then dead for a missing binary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));
  const bin = path.join(dir, 'fake-helper');
  fs.writeFileSync(bin, '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"permissions",screen:true}));\nconsole.log("not json");\nconsole.log(JSON.stringify({type:"app",bundleId:"x"}));\nsetTimeout(()=>process.exit(0), 50);\n');
  fs.chmodSync(bin, 0o755);
  const c = new HelperClient(bin);
  const events = [];
  let spawned = 0;
  c.on('event', (e) => events.push(e.type));
  c.on('spawned', () => { spawned++; });
  const dead = new Promise((r) => c.once('dead', r));
  c.start();
  await dead;
  assert.ok(events.includes('permissions') && events.includes('app'));
  assert.strictEqual(spawned, 2); // initial spawn + one auto-restart
  assert.strictEqual(events.length >= 2, true);

  const missing = new HelperClient(path.join(dir, 'nope'));
  let spawned2 = 0;
  missing.on('spawned', () => { spawned2++; });
  const dead2 = new Promise((r) => missing.once('dead', r));
  missing.start();
  await dead2;
  assert.strictEqual(spawned2, 0);
});

test('HelperClient.send writes a JSON line to the child stdin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));
  const bin = path.join(dir, 'echo-helper');
  fs.writeFileSync(bin, '#!/usr/bin/env node\nprocess.stdin.on("data",d=>{process.stdout.write(JSON.stringify({type:"echo",got:d.toString().trim()})+"\\n");});\n');
  fs.chmodSync(bin, 0o755);
  const c = new HelperClient(bin);
  const got = new Promise((r) => c.on('event', (e) => e.type === 'echo' && r(e)));
  c.start();
  c.send({ cmd: 'pause' });
  const e = await got;
  assert.deepStrictEqual(JSON.parse(e.got), { cmd: 'pause' });
  c.stop();
});

test('typing is dropped if any field label is a password prompt', () => {
  const { journal, rec } = setup();
  rec.handle({ type: 'app', ...safari });
  rec.handle({ type: 'typed', ts: 2, text: 'abc', secure: false, field: { role: 'AXTextField', title: 'Login', placeholder: 'Password', description: null }, isTerminal: false, visibleLine: null, ...safari });
  assert.deepStrictEqual(journal.readSince(null), []);
});

test('HelperClient stop/start does not orphan a child or emit after final stop', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));
  const bin = path.join(dir, 'tick-helper');
  fs.writeFileSync(bin, '#!/usr/bin/env node\nsetInterval(()=>console.log(JSON.stringify({type:"tick",pid:process.pid})),20);\n');
  fs.chmodSync(bin, 0o755);
  const c = new HelperClient(bin);
  const pids = new Set();
  let stoppedAt = 0;
  let late = 0;
  c.on('event', (e) => {
    pids.add(e.pid);
    if (stoppedAt && Date.now() > stoppedAt + 50) late++;
  });
  c.start();
  await new Promise((r) => setTimeout(r, 200));
  c.stop();
  c.start();
  await new Promise((r) => setTimeout(r, 300));
  c.stop();
  stoppedAt = Date.now();
  await new Promise((r) => setTimeout(r, 400));
  assert.strictEqual(late, 0);
  for (const pid of pids) {
    assert.throws(() => process.kill(pid, 0), 'child ' + pid + ' still alive');
  }
});
