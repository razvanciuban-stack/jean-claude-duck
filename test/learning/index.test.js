// index.test.js — learning controller: on/off, pause, watching, permissions, tick, screenshots
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');
const { createLearning, statusLine, PERMISSIONS } = require('../../src/learning');
const { readWeek, writeWeek } = require('../../src/learning/pipeline');

const T0 = new Date(2026, 9, 28, 10, 0, 0).getTime();

class FakeHelper extends EventEmitter {
  constructor(binPath) { super(); this.binPath = binPath; this.sent = []; this.started = false; this.stopped = false; this.sendOk = true; }
  start() { this.started = true; if (FakeHelper.dieOnStart) this.emit('dead'); }
  send(cmd) { this.sent.push(cmd); return this.sendOk; }
  stop() { this.stopped = true; }
}

function fakeStore(init = {}) {
  const m = new Map(Object.entries(init));
  return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v), m };
}

function setup(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysthi-idx-'));
  const helpers = [];
  const intervals = [];
  const notes = [];
  const watching = [];
  const missing = [];
  const pushed = [];
  let unavailable = 0;
  let reportResult = { written: false };
  const pipelineCalls = { run: 0 };
  let runImpl = async () => 'nothing';
  const store = over.store || fakeStore();
  const deps = {
    createHelper: (p) => { const h = new FakeHelper(p); helpers.push(h); return h; },
    createPipeline: () => ({ runIfIdle: () => { pipelineCalls.run++; return runImpl(); }, status: () => ({}) }),
    maybeWriteWeeklyReport: () => reportResult,
    isAvailable: async () => true,
    getIdleMs: () => 0,
    now: () => T0,
    setInterval: (fn, ms) => { const h = { fn, ms, cleared: false }; intervals.push(h); return h; },
    clearInterval: (h) => { if (h) h.cleared = true; },
    createVisionQueue: ({ onDescription }) => {
      const q = { stopped: false, onDescription, push: (id, jpeg) => { if (!q.stopped) pushed.push({ id, jpeg }); }, stop: () => { q.stopped = true; }, size: () => 0 };
      return q;
    },
    ...(over.deps || {}),
  };
  const learning = createLearning({
    userDataDir: path.join(root, 'userData'),
    vaultDir: path.join(root, 'vault'),
    helperPath: '/fake/mysthi-helper',
    store,
    notify: (title, body) => notes.push({ title, body }),
    onWatchingChange: (w) => watching.push(w),
    onMissingPermissions: (m) => missing.push(m),
    onHelperUnavailable: () => { unavailable++; },
    deps,
  });
  return {
    root, learning, helpers, intervals, notes, watching, missing, pushed, store, pipelineCalls,
    stateDir: path.join(root, 'userData', 'learning'),
    vaultDir: path.join(root, 'vault'),
    get unavailable() { return unavailable; },
    setReport: (r) => { reportResult = r; },
    setRun: (fn) => { runImpl = fn; },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

test('disabled by default and not watching', () => {
  const ctx = setup();
  assert.strictEqual(ctx.learning.isEnabled(), false);
  assert.strictEqual(ctx.learning.isWatching(), false);
  assert.strictEqual(ctx.learning.status().enabled, false);
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: off');
  ctx.learning.start(); // store says off -> nothing starts
  assert.strictEqual(ctx.helpers.length, 0);
  assert.deepStrictEqual(ctx.watching, []);
  assert.strictEqual(ctx.learning.togglePause(), false); // no-op while off
  assert.strictEqual(ctx.learning.status().paused, false);
});

test('enable persists, sets enabledAt once, ensures vault, requests permissions', () => {
  const ctx = setup();
  ctx.learning.enable();
  assert.strictEqual(ctx.store.get('learning.enabled'), true);
  assert.strictEqual(readWeek(ctx.stateDir).enabledAt, T0);
  assert.ok(fs.existsSync(path.join(ctx.vaultDir, 'do-not-watch.md')));
  assert.strictEqual(ctx.helpers.length, 1);
  assert.strictEqual(ctx.helpers[0].binPath, '/fake/mysthi-helper');
  assert.ok(ctx.helpers[0].started);
  assert.deepStrictEqual(ctx.helpers[0].sent, [{ cmd: 'request-permissions' }]);
  assert.strictEqual(ctx.learning.isWatching(), true);
  assert.deepStrictEqual(ctx.watching, [true]);
  assert.strictEqual(ctx.intervals[0].ms, 60000);

  ctx.learning.disable();
  writeWeek(ctx.stateDir, { ...readWeek(ctx.stateDir), enabledAt: 123 });
  ctx.learning.enable();
  assert.strictEqual(readWeek(ctx.stateDir).enabledAt, 123); // not overwritten
});

test('togglePause flips watching and calls onWatchingChange(false)', () => {
  const ctx = setup();
  ctx.learning.enable();
  assert.strictEqual(ctx.learning.isWatching(), true);
  assert.strictEqual(ctx.learning.togglePause(), true);
  assert.strictEqual(ctx.learning.isWatching(), false);
  assert.deepStrictEqual(ctx.watching, [true, false]);
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: paused');
  assert.deepStrictEqual(ctx.helpers[0].sent.slice(-1), [{ cmd: 'pause' }]);
  ctx.learning.togglePause();
  assert.strictEqual(ctx.learning.isWatching(), true);
  assert.deepStrictEqual(ctx.watching, [true, false, true]);
  assert.deepStrictEqual(ctx.helpers[0].sent.slice(-1), [{ cmd: 'resume' }]);
});

test('weekly report triggers notify', async () => {
  const ctx = setup();
  ctx.learning.enable();
  ctx.setReport({ written: true, relPath: 'reports/2026-11-04-week.md' });
  await ctx.learning.tick();
  assert.strictEqual(ctx.pipelineCalls.run >= 1, true);
  assert.deepStrictEqual(ctx.notes, [{ title: "Mysthi's weekly report is ready", body: 'reports/2026-11-04-week.md' }]);
  ctx.setReport({ written: false });
  await ctx.learning.tick();
  assert.strictEqual(ctx.notes.length, 1);
});

test('tick does not overlap, swallows errors, and its interval is cleared on disable', async () => {
  const ctx = setup();
  ctx.learning.enable();
  let release;
  ctx.setRun(() => new Promise((r) => { release = r; }));
  const first = ctx.learning.tick();
  await flush();
  await ctx.learning.tick(); // overlapping -> skipped
  assert.strictEqual(ctx.pipelineCalls.run, 1);
  release('ran');
  await first;
  ctx.setRun(async () => { throw new Error('secret data'); });
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try { await ctx.learning.tick(); } finally { console.error = orig; }
  assert.ok(errs.every((e) => !e.includes('secret')));
  assert.strictEqual(ctx.pipelineCalls.run, 2);
  const iv = ctx.intervals[0];
  ctx.learning.disable();
  assert.strictEqual(iv.cleared, true);
  assert.ok(ctx.helpers[0].stopped);
  assert.strictEqual(ctx.store.get('learning.enabled'), false);
  assert.strictEqual(ctx.learning.isWatching(), false);
});

test('model availability shows in status', async () => {
  const ctx = setup({ deps: { isAvailable: async () => false } });
  ctx.learning.enable();
  await ctx.learning.tick();
  assert.strictEqual(ctx.learning.status().model, 'unavailable');
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: model unavailable');
});

test('missing permissions are reported once with settings urls', () => {
  const ctx = setup();
  ctx.learning.enable();
  ctx.helpers[0].emit('event', { type: 'permissions', screen: false, accessibility: true, input: false });
  ctx.helpers[0].emit('event', { type: 'permissions', screen: false, accessibility: true, input: false });
  assert.strictEqual(ctx.missing.length, 1);
  assert.deepStrictEqual(ctx.missing[0].map((m) => m.key), ['screen', 'input']);
  assert.deepStrictEqual(ctx.missing[0].map((m) => m.url), [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  ]);
  assert.deepStrictEqual(ctx.learning.status().permissions, { screen: false, accessibility: true, input: false });
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: missing permissions');
  ctx.helpers[0].emit('event', { type: 'permissions', screen: true, accessibility: true, input: true });
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: watching');
  assert.strictEqual(PERMISSIONS.length, 3);
});

test('start() resumes when previously enabled, without prompting for permissions', () => {
  const ctx = setup({ store: fakeStore({ 'learning.enabled': true }) });
  assert.strictEqual(ctx.learning.isEnabled(), true);
  ctx.learning.start();
  assert.strictEqual(ctx.helpers.length, 1);
  assert.deepStrictEqual(ctx.helpers[0].sent, []);
  ctx.helpers[0].emit('event', { type: 'permissions', screen: false, accessibility: false, input: false });
  assert.strictEqual(ctx.missing.length, 0);
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: missing permissions');
});

test('screenshots: step -> screenshot cmd -> vision queue -> journal description', () => {
  const ctx = setup();
  ctx.learning.enable();
  const h = ctx.helpers[0];
  h.emit('event', { type: 'click', ts: T0, bundleId: 'com.apple.finder', appName: 'Finder', window: 'Docs', target: { role: 'AXButton', title: 'New Folder' } });
  const shot = h.sent.find((c) => c.cmd === 'screenshot');
  assert.ok(shot && typeof shot.id === 'string');
  h.emit('event', { type: 'screenshot', id: shot.id, jpegBase64: 'AAAA', bundleId: 'com.apple.finder', appName: 'Finder', window: 'Docs', url: null });
  h.emit('event', { type: 'screenshot', id: 'x', jpegBase64: null });
  assert.deepStrictEqual(ctx.pushed, [{ id: shot.id, jpeg: 'AAAA' }]);

  // paused: no further steps, screenshots or pushes
  ctx.learning.togglePause();
  const before = h.sent.length;
  h.emit('event', { type: 'click', ts: T0, bundleId: 'com.apple.finder', appName: 'Finder', window: 'Docs', target: { title: 'x' } });
  h.emit('event', { type: 'screenshot', id: 'late', jpegBase64: 'BBBB', bundleId: 'com.apple.finder', appName: 'Finder', window: 'Docs', url: null });
  assert.strictEqual(h.sent.length, before);
  assert.strictEqual(ctx.pushed.length, 1);
});

test('do-not-watch reload closes eyes in a blocked app', async () => {
  const ctx = setup();
  ctx.learning.enable();
  const dnw = fs.readFileSync(path.join(ctx.vaultDir, 'do-not-watch.md'), 'utf8').replace('## Apps\n\n', '## Apps\n\n- Secret App\n');
  fs.writeFileSync(path.join(ctx.vaultDir, 'do-not-watch.md'), dnw);
  await ctx.learning.tick();
  ctx.helpers[0].emit('event', { type: 'app', ts: T0, bundleId: 'com.x.secret', appName: 'Secret App', window: 'w' });
  assert.strictEqual(ctx.learning.isWatching(), false);
  assert.deepStrictEqual(ctx.watching, [true, false]);
  assert.strictEqual(ctx.learning.isEnabled(), true);
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: not watching this app');
  ctx.helpers[0].emit('event', { type: 'app', ts: T0, bundleId: 'com.apple.finder', appName: 'Finder', window: 'w' });
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: watching');
  assert.strictEqual(ctx.learning.isWatching(), true);
});

test('dead helper turns learning off and reports once', () => {
  const ctx = setup();
  ctx.learning.enable();
  ctx.helpers[0].emit('dead');
  assert.strictEqual(ctx.learning.isEnabled(), false);
  assert.strictEqual(ctx.store.get('learning.enabled'), false);
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: off');
  assert.strictEqual(ctx.intervals[0].cleared, true);
  ctx.learning.enable();
  ctx.helpers[1].emit('dead');
  assert.strictEqual(ctx.unavailable, 1);
});

test('statusLine maps every state', () => {
  assert.strictEqual(statusLine({ enabled: false }), 'Learning: off');
  assert.strictEqual(statusLine({ enabled: true, paused: true, model: 'unavailable' }), 'Learning: paused');
  assert.strictEqual(statusLine({ enabled: true, paused: false, permissions: { screen: true, accessibility: false, input: true }, model: 'unavailable' }), 'Learning: missing permissions');
  assert.strictEqual(statusLine({ enabled: true, paused: false, permissions: null, model: 'unavailable' }), 'Learning: model unavailable');
  assert.strictEqual(statusLine({ enabled: true, paused: false, permissions: null, model: 'ok' }), 'Learning: watching');
  assert.strictEqual(statusLine({ enabled: true, paused: false, permissions: null, model: 'unavailable', context: 'blocked' }), 'Learning: not watching this app');
});

test('restarted helper is re-paused', () => {
  const ctx = setup();
  ctx.learning.enable();
  const h = ctx.helpers[0];
  h.emit('spawned'); // not paused: nothing sent
  assert.ok(!h.sent.some((c) => c.cmd === 'pause'));
  ctx.learning.togglePause();
  h.sent.length = 0;
  h.emit('spawned'); // auto-restart while paused
  assert.deepStrictEqual(h.sent, [{ cmd: 'pause' }]);
  h.sendOk = false;
  h.emit('spawned'); // pause cannot be delivered -> helper stopped
  assert.ok(h.stopped);
  assert.strictEqual(ctx.learning.isWatching(), false);
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: paused');
});

test('undeliverable pause stops the helper and resume restarts it', () => {
  const ctx = setup();
  ctx.learning.enable();
  const h = ctx.helpers[0];
  h.sendOk = false;
  assert.strictEqual(ctx.learning.togglePause(), true);
  assert.ok(h.stopped);
  assert.strictEqual(ctx.learning.status().paused, true);
  assert.strictEqual(ctx.learning.isWatching(), false);
  assert.strictEqual(ctx.intervals[0].cleared, true);
  h.emit('event', { type: 'click', ts: T0, bundleId: 'com.apple.finder', appName: 'Finder', window: 'w', target: { title: 'x' } });
  assert.ok(!h.sent.some((c) => c.cmd === 'screenshot'));
  assert.strictEqual(ctx.learning.togglePause(), true); // resume -> fresh helper
  assert.strictEqual(ctx.helpers.length, 2);
  assert.ok(ctx.helpers[1].started);
  assert.strictEqual(ctx.learning.isWatching(), true);
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: watching');
});

test('failed enable/start turns learning off and reports', () => {
  const boom = () => { throw new Error('no'); };
  const ctx = setup({ deps: { createHelper: boom } });
  ctx.learning.enable();
  assert.strictEqual(ctx.learning.isEnabled(), false);
  assert.strictEqual(ctx.store.get('learning.enabled'), false);
  assert.strictEqual(ctx.unavailable, 1);
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: off');

  const ctx2 = setup({ store: fakeStore({ 'learning.enabled': true }), deps: { createHelper: boom } });
  ctx2.learning.start();
  assert.strictEqual(ctx2.learning.isEnabled(), false);
  assert.strictEqual(ctx2.unavailable, 1);
});

test('helper dying synchronously in start does not leak the interval', () => {
  FakeHelper.dieOnStart = true;
  try {
    const ctx = setup();
    ctx.learning.enable();
    assert.strictEqual(ctx.learning.isEnabled(), false);
    assert.strictEqual(ctx.intervals.length, 0);
    assert.deepStrictEqual(ctx.helpers[0].sent, []);
    assert.strictEqual(ctx.unavailable, 1);
  } finally {
    FakeHelper.dieOnStart = false;
  }
});

test('screenshot whose own context is do-not-watch is dropped, never described', () => {
  const ctx = setup();
  ctx.learning.enable();
  const h = ctx.helpers[0];
  // typed in Notes, then switched to 1Password: the screenshot shows 1Password
  h.emit('event', { type: 'typed', ts: T0, text: 'groceries', secure: false, field: { role: 'AXTextArea', title: 'Note' }, isTerminal: false, visibleLine: null, bundleId: 'com.apple.Notes', appName: 'Notes', window: 'List', url: null });
  const shot = h.sent.find((c) => c.cmd === 'screenshot');
  assert.ok(shot);
  h.emit('event', { type: 'screenshot', id: shot.id, jpegBase64: 'SECRET', bundleId: 'com.1password.1password', appName: '1Password', window: 'Vault', url: null });
  // a bank tab in a browser
  h.emit('event', { type: 'screenshot', id: 'b', jpegBase64: 'BANK', bundleId: 'com.google.Chrome', appName: 'Google Chrome', window: 'Login', url: 'https://www.ing.ro/login' });
  // a browser with no URL fails closed
  h.emit('event', { type: 'screenshot', id: 'c', jpegBase64: 'NOURL', bundleId: 'com.google.Chrome', appName: 'Google Chrome', window: 'x', url: null });
  // no context at all (older helper) fails closed
  h.emit('event', { type: 'screenshot', id: 'd', jpegBase64: 'NOCTX' });
  assert.deepStrictEqual(ctx.pushed, []);
  h.emit('event', { type: 'screenshot', id: 'e', jpegBase64: 'OK', bundleId: 'com.apple.Notes', appName: 'Notes', window: 'List', url: null });
  assert.deepStrictEqual(ctx.pushed, [{ id: 'e', jpeg: 'OK' }]);
});

test('eyes close while a permission is missing and reopen when granted', async () => {
  const ctx = setup();
  ctx.learning.enable();
  assert.strictEqual(ctx.learning.isWatching(), true);
  ctx.helpers[0].emit('event', { type: 'permissions', screen: true, accessibility: false, input: true });
  assert.strictEqual(ctx.learning.isWatching(), false);
  assert.deepStrictEqual(ctx.watching, [true, false]);
  ctx.helpers[0].emit('event', { type: 'permissions', screen: true, accessibility: true, input: true });
  assert.strictEqual(ctx.learning.isWatching(), true);
  assert.deepStrictEqual(ctx.watching, [true, false, true]);
});

test('model unavailable does not close the eyes', async () => {
  const ctx = setup({ deps: { isAvailable: async () => false } });
  ctx.learning.enable();
  await flush();
  assert.strictEqual(ctx.learning.statusLabel(), 'Learning: model unavailable');
  assert.strictEqual(ctx.learning.isWatching(), true);
});

test('pipeline gets an isEnabled callback that follows the on/off state', () => {
  let args = null;
  const ctx = setup({ deps: { createPipeline: (a) => { args = a; return { runIfIdle: async () => 'nothing', status: () => ({}) }; } } });
  ctx.learning.enable();
  assert.strictEqual(typeof args.isEnabled, 'function');
  assert.strictEqual(args.isEnabled(), true);
  ctx.learning.disable();
  assert.strictEqual(args.isEnabled(), false);
});
