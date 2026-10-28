// step-recorder.js — turns helper events into privacy-filtered, redacted Steps and journals them

const { redact, redactDeep } = require('./redact');
const { TERMINAL_BUNDLES, BROWSER_BUNDLES } = require('./privacy');

let counter = 0;
function nextId() {
  counter = (counter + 1) % 1679616; // 36^4
  return Date.now().toString(36) + counter.toString(36).padStart(4, '0');
}

const CTX_KEYS = ['bundleId', 'appName', 'window', 'url'];

function createStepRecorder({ policy, journal, onWatchingChange = () => {}, onScreenshotWanted = () => {} }) {
  let currentPolicy = policy;
  let ctx = { bundleId: null, appName: null, window: null, url: null };
  let watching = null;

  function setWatching(allowed) {
    if (watching === allowed) return;
    watching = allowed;
    onWatchingChange(allowed);
  }

  function contextFor(event) {
    const next = { ...ctx };
    for (const k of CTX_KEYS) if (k in event) next[k] = event[k] ?? null;
    return next;
  }

  function policyCtx(c) {
    return { ...c, isBrowser: BROWSER_BUNDLES.includes(c.bundleId) };
  }

  function build(event, c, action, extra) {
    const kinds = new Set();
    const r = (v) => {
      if (typeof v !== 'string') return v;
      const out = redact(v);
      out.kinds.forEach((k) => kinds.add(k));
      return out.text;
    };
    const deep = (v) => {
      if (v == null) return null;
      if (typeof v === 'string') return r(v);
      // Redact each string leaf so kinds are tracked
      if (Array.isArray(v)) return v.map(deep);
      if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]));
      return v;
    };
    const step = {
      id: nextId(),
      ts: typeof event.ts === 'number' ? event.ts : Date.now(),
      bundleId: r(c.bundleId),
      appName: r(c.appName),
      window: r(c.window),
      url: r(c.url),
      action,
      target: extra.target === undefined ? null : deep(extra.target)
    };
    if (extra.keys !== undefined) step.keys = r(extra.keys);
    if (extra.value !== undefined) step.value = r(extra.value);
    step.redactions = [...kinds];
    return step;
  }

  function commit(step) {
    journal.append(step);
    onScreenshotWanted(step.id);
  }

  function handle(event) {
    if (!event || typeof event !== 'object') return;
    const type = event.type;
    if (type !== 'app' && type !== 'click' && type !== 'shortcut' && type !== 'typed') return;

    const c = contextFor(event);
    ctx = c;
    const allowed = currentPolicy.canWatch(policyCtx(c));
    setWatching(allowed);
    if (!allowed || type === 'app') return;

    if (type === 'click') {
      commit(build(event, c, 'click', { target: event.target }));
    } else if (type === 'shortcut') {
      if (typeof event.keys !== 'string') return;
      commit(build(event, c, 'shortcut', { keys: event.keys, target: null }));
    } else {
      handleTyped(event, c);
    }
  }

  function handleTyped(event, c) {
    if (event.secure || typeof event.text !== 'string' || event.text === '') return;
    const f = event.field || {};
    const terminal = TERMINAL_BUNDLES.includes(c.bundleId) || event.isTerminal === true;
    if (terminal) {
      if (!currentPolicy.terminalCommandAllowed({ typed: event.text, visibleLine: event.visibleLine })) return;
      commit(build(event, c, 'command', { value: event.text, target: null }));
      return;
    }
    const fieldLabel = f.title || f.placeholder || f.description || undefined;
    if (!currentPolicy.typedTextAllowed({ bundleId: c.bundleId, isTerminal: false, secure: !!event.secure, fieldLabel })) return;
    commit(build(event, c, 'type', { value: event.text, target: { role: f.role ?? null, title: f.title ?? null } }));
  }

  function setPolicy(p) {
    currentPolicy = p;
  }

  return { handle, setPolicy };
}

module.exports = { createStepRecorder };
