// index.js — the learning controller: on/off, pause, watching state, permissions onboarding, 60 s tick
// Never requires 'electron': main.js passes the store, callbacks and getIdleMs in.
// Never logs event data — only fixed strings.

const path = require('path');
const { HelperClient } = require('./helper-client');
const { createJournal } = require('./journal');
const { createStepRecorder } = require('./step-recorder');
const { createPolicy, BROWSER_BUNDLES } = require('./privacy');
const { createVisionQueue } = require('./vision');
const { createVault } = require('./vault');
const { createPipeline, readWeek, writeWeek } = require('./pipeline');
const { maybeWriteWeeklyReport } = require('./reports');
const { isAvailable } = require('../services/ollama');
const { TEXT_MODEL, VAULT_DIR, IDLE_THRESHOLD_MS } = require('./config');

const STORE_KEY = 'learning.enabled';
const TICK_MS = 60000;
const SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?';
const PERMISSIONS = [
  { key: 'screen', name: 'Screen Recording', url: `${SETTINGS}Privacy_ScreenCapture` },
  { key: 'accessibility', name: 'Accessibility', url: `${SETTINGS}Privacy_Accessibility` },
  { key: 'input', name: 'Input Monitoring', url: `${SETTINGS}Privacy_ListenEvent` },
];
const REPORT_TITLE = "Mysthi's weekly report is ready";

const REAL_DEPS = {
  createHelper: (binPath) => new HelperClient(binPath),
  createPipeline,
  maybeWriteWeeklyReport,
  isAvailable,
  createVisionQueue,
  getIdleMs: () => 0, // never idle unless main passes the real system idle time
  now: Date.now,
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
};

function missingPermissions(perms) {
  if (!perms) return [];
  return PERMISSIONS.filter((p) => perms[p.key] === false);
}

// Priority: off > paused > missing permissions > do-not-watch context > model unavailable > watching
function statusLine({ enabled, paused, permissions, model, context } = {}) {
  if (!enabled) return 'Learning: off';
  if (paused) return 'Learning: paused';
  if (missingPermissions(permissions).length) return 'Learning: missing permissions';
  if (context === 'blocked') return 'Learning: not watching this app';
  if (model === 'unavailable') return 'Learning: model unavailable';
  return 'Learning: watching';
}

function memoryStore() {
  const m = new Map();
  return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v) };
}

function createLearning({
  userDataDir,
  helperPath,
  vaultDir = VAULT_DIR,
  store = memoryStore(),
  notify = () => {},
  onWatchingChange = () => {},
  onStatusChange = () => {},
  onMissingPermissions = () => {},
  onHelperUnavailable = () => {},
  deps = {},
}) {
  const d = { ...REAL_DEPS, ...deps };
  const stateDir = path.join(userDataDir, 'learning');
  const vault = createVault(vaultDir);
  const policy = createPolicy();

  let enabled = store.get(STORE_KEY, false) === true;
  let paused = false;
  let permissions = null;
  let model = 'ok';
  let contextAllowed = true;
  let watching = false;
  let lastLabel = statusLine(status());

  let helper = null;
  let journal = null;
  let recorder = null;
  let pipeline = null;
  let vision = null;
  let interval = null;
  let ticking = false;
  let onboarding = false; // show the missing-permissions dialog once per user-initiated enable()
  let reportedDead = false;

  function status() {
    return { enabled, paused, permissions: permissions && { ...permissions }, model, context: contextAllowed ? 'allowed' : 'blocked' };
  }

  function update() {
    // Eyes close when off, paused, the helper is gone, a permission is missing, or the app is do-not-watch.
    // A missing model does not close them: steps are still recorded and learned once the model is back.
    const w = !!(enabled && !paused && helper && contextAllowed && !missingPermissions(permissions).length);
    if (w !== watching) {
      watching = w;
      onWatchingChange(w);
    }
    const label = statusLine(status());
    if (label !== lastLabel) {
      lastLabel = label;
      onStatusChange(label);
    }
  }

  function reloadPolicy() {
    try {
      const { apps, domains } = vault.loadDoNotWatch();
      policy.setLists({ doNotWatchApps: apps, doNotWatchDomains: domains });
    } catch {
      console.error('learning: could not reload do-not-watch list');
    }
  }

  function startVision() {
    vision = d.createVisionQueue({
      onDescription: (stepId, text) => {
        try { if (journal) journal.attachDescription(stepId, text); } catch { console.error('learning: could not attach description'); }
      },
    });
  }

  function stopVision() {
    if (vision) vision.stop();
    vision = null;
  }

  // Note-making and screenshot descriptions share one local model, which answers one request at a time:
  // pause descriptions while she makes notes so the big requests don't queue behind them and time out
  async function withVisionPaused(fn) {
    const hadVision = !!vision;
    stopVision();
    try {
      return await fn();
    } finally {
      if (hadVision && enabled && !paused && pipeline && !vision) startVision();
    }
  }

  // Fails closed: a screenshot without its own app context (e.g. an older helper) is never described
  function screenshotAllowed(event) {
    const str = (v) => (typeof v === 'string' && v ? v : null);
    const c = { bundleId: str(event.bundleId), appName: str(event.appName), window: str(event.window), url: str(event.url) };
    if (!c.bundleId && !c.appName) return false;
    try {
      return policy.canWatch({ ...c, isBrowser: BROWSER_BUNDLES.includes(c.bundleId) });
    } catch {
      return false;
    }
  }

  function onHelperEvent(h, event) {
    if (h !== helper || !event || typeof event !== 'object') return;
    if (event.type === 'permissions') {
      permissions = { screen: !!event.screen, accessibility: !!event.accessibility, input: !!event.input };
      const missing = missingPermissions(permissions);
      if (!missing.length) onboarding = false;
      else if (onboarding) {
        onboarding = false;
        onMissingPermissions(missing.map((p) => ({ ...p })));
      }
      update();
      return;
    }
    if (paused) return; // helper is paused too; drop anything that raced the pause
    if (event.type === 'screenshot') {
      // The image shows whatever was frontmost when it was taken, which may not be the step's app:
      // judge it by its own context and drop it (releasing the jpeg) unless that context may be watched.
      if (typeof event.jpegBase64 === 'string' && event.jpegBase64 && vision && screenshotAllowed(event)) {
        vision.push(event.id, event.jpegBase64);
      }
      return;
    }
    try {
      recorder.handle(event);
    } catch {
      console.error('learning: could not record step');
    }
  }

  // Helper died, or the runtime could not be built: turn learning off and tell the user once
  function fail() {
    console.error('learning: helper unavailable');
    disable();
    if (!reportedDead) {
      reportedDead = true;
      onHelperUnavailable();
    }
  }

  function onHelperDead(h) {
    if (h !== helper) return;
    fail();
  }

  function startRuntime() {
    reloadPolicy();
    journal = createJournal(stateDir);
    pipeline = d.createPipeline({ journal, vault, stateDir, now: d.now, getIdleMs: d.getIdleMs, isEnabled: () => enabled });
    contextAllowed = true;
    recorder = createStepRecorder({
      policy,
      journal,
      onWatchingChange: (allowed) => { contextAllowed = allowed; update(); },
      onScreenshotWanted: (stepId) => { if (helper && !paused) helper.send({ cmd: 'screenshot', id: stepId }); },
    });
    startVision();
    const h = d.createHelper(helperPath);
    helper = h;
    h.on('event', (event) => onHelperEvent(h, event));
    h.on('dead', () => onHelperDead(h));
    // A restarted helper comes up unpaused: re-apply the pause, and if that cannot be delivered stop it
    h.on('spawned', () => {
      if (h === helper && paused && !h.send({ cmd: 'pause' })) {
        stopRuntime();
        update();
      }
    });
    h.start();
    if (helper !== h) return; // died synchronously; fail() already cleaned up
    interval = d.setInterval(() => { tick(); }, TICK_MS);
    if (interval && typeof interval.unref === 'function') interval.unref();
  }

  function stopRuntime() {
    if (interval) d.clearInterval(interval);
    interval = null;
    stopVision();
    const h = helper;
    helper = null;
    if (h) h.stop();
    recorder = null;
    pipeline = null;
    journal = null;
    contextAllowed = true;
    permissions = null;
    onboarding = false;
  }

  // Resume after an app restart when learning was left on; no permission prompt
  function start() {
    if (!enabled || helper) return;
    try {
      vault.ensure();
      startRuntime();
    } catch {
      fail();
      return;
    }
    update();
  }

  function enable() {
    if (enabled && helper) return;
    enabled = true;
    store.set(STORE_KEY, true);
    try {
      const week = readWeek(stateDir);
      if (week.enabledAt == null) writeWeek(stateDir, { ...week, enabledAt: d.now() });
      vault.ensure();
      startRuntime();
      if (helper) { // a helper that died during start() has already turned learning off
        onboarding = true;
        helper.send({ cmd: 'request-permissions' });
      }
    } catch {
      fail();
      return;
    }
    update();
    checkModel().catch(() => {});
  }

  function disable() {
    enabled = false;
    paused = false;
    store.set(STORE_KEY, false);
    stopRuntime();
    update();
  }

  // Pausing stops capture in the helper and drops queued screenshots; resuming starts a fresh queue.
  // If the pause cannot be delivered the helper is stopped (still paused); resuming then restarts it.
  function togglePause() {
    if (!enabled) return false;
    if (!helper) {
      if (!paused) return false;
      paused = false;
      try {
        startRuntime();
      } catch {
        fail();
        return true;
      }
      update();
      return true;
    }
    paused = !paused;
    if (paused) {
      stopVision();
      if (!helper.send({ cmd: 'pause' })) stopRuntime();
    } else {
      helper.send({ cmd: 'resume' });
      startVision();
    }
    update();
    return true;
  }

  // Ollama can be slow to answer while it is busy describing screenshots, so one missed check
  // isn't enough to call the model unavailable: it takes two misses in a row
  let modelMisses = 0;
  async function checkModel() {
    let ok = false;
    try { ok = await d.isAvailable(TEXT_MODEL); } catch { ok = false; }
    modelMisses = ok ? 0 : modelMisses + 1;
    model = modelMisses >= 2 ? 'unavailable' : 'ok';
    update();
  }

  async function tick() {
    if (ticking || !enabled || !pipeline) return;
    ticking = true;
    try {
      reloadPolicy();
      await checkModel();
      if (!pipeline) return;
      if (d.getIdleMs() >= IDLE_THRESHOLD_MS) await withVisionPaused(() => pipeline.runIfIdle());
      else await pipeline.runIfIdle(); // returns straight away when not idle
      if (!enabled) return;
      const r = d.maybeWriteWeeklyReport({ vault, stateDir, now: d.now });
      if (r && r.written) notify(REPORT_TITLE, r.relPath);
    } catch {
      console.error('learning: tick failed');
    } finally {
      ticking = false;
    }
  }

  // "Make notes now": turn everything recorded so far into notes without waiting for idle time
  let makingNotes = false;
  async function makeNotesNow() {
    if (!enabled || !pipeline) return { result: 'off' };
    if (makingNotes) return { result: 'busy' };
    makingNotes = true;
    update();
    try {
      const result = await withVisionPaused(() => pipeline.runNow());
      return { result, ...pipeline.status() };
    } catch {
      console.error('learning: make notes failed');
      return { result: 'failed' };
    } finally {
      makingNotes = false;
      update();
    }
  }

  // App quit: stop the helper without changing the persisted on/off choice
  function shutdown() {
    stopRuntime();
  }

  return {
    start,
    enable,
    disable,
    togglePause,
    makeNotesNow,
    isMakingNotes: () => makingNotes,
    tick,
    shutdown,
    isEnabled: () => enabled,
    isWatching: () => watching,
    isPaused: () => paused,
    status,
    statusLabel: () => statusLine(status()),
  };
}

module.exports = { createLearning, statusLine, PERMISSIONS, STORE_KEY };
