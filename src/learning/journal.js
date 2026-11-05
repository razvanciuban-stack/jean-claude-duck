// journal.js — append-only, redacted on-disk step journal (JSONL per day) plus processing cursor

const fs = require('node:fs');
const path = require('node:path');
const { redact, redactDeep } = require('./redact');
const { JOURNAL_RETENTION_DAYS } = require('./config');

const DAY_FILE = /^steps-(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

function dayStamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// retentionDays: days of steps kept on disk; older day files are deleted (on start and on each new day)
function createJournal(dir, { retentionDays = JOURNAL_RETENTION_DAYS, now = Date.now } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
  const statePath = path.join(dir, 'state.json');

  function appendLine(file, obj) {
    let prefix = '';
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        if (size > 0) {
          const b = Buffer.alloc(1);
          fs.readSync(fd, b, 0, 1, size - 1);
          if (b[0] !== 0x0a) prefix = '\n'; // crash-truncated last line
        }
      } finally { fs.closeSync(fd); }
    } catch { /* file does not exist yet */ }
    fs.appendFileSync(file, prefix + JSON.stringify(obj) + '\n', { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  }

  function append(step) {
    // Defense in depth: nothing reaches disk unredacted
    const safe = redactDeep(step);
    // The id is made by the app from the clock, never from what the user typed, and can look like a
    // secret (e.g. 'mw24kjt00002' matches the IBAN pattern): keep it, or every step would share '[IBAN]'
    safe.id = step.id;
    safe.redactions = step.redactions || [];
    const file = path.join(dir, `steps-${dayStamp(now())}.jsonl`);
    if (!fs.existsSync(file)) prune(); // first step of a new day
    appendLine(file, safe);
  }

  const dayFiles = () => fs.readdirSync(dir).filter((f) => DAY_FILE.test(f));

  // Delete day files older than the retention; returns how many were removed
  function prune() {
    const days = Number(retentionDays);
    if (!(days > 0)) return 0;
    const today = new Date(now());
    const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days).getTime();
    let removed = 0;
    for (const f of dayFiles()) {
      const [, y, m, d] = DAY_FILE.exec(f);
      if (new Date(Number(y), Number(m) - 1, Number(d)).getTime() < cutoff) {
        try { fs.unlinkSync(path.join(dir, f)); removed++; } catch { /* already gone */ }
      }
    }
    return removed;
  }

  // "Delete all": every recorded step and the processing cursor. Returns how many day files were removed.
  function clear() {
    let removed = 0;
    for (const f of dayFiles()) {
      try { fs.unlinkSync(path.join(dir, f)); removed++; } catch { /* already gone */ }
    }
    try { fs.unlinkSync(statePath); } catch { /* none yet */ }
    return removed;
  }

  function attachDescription(stepId, text) {
    appendLine(path.join(dir, `steps-${dayStamp(now())}.jsonl`), {
      patch: stepId,
      description: redact(String(text)).text
    });
  }

  function readAll() {
    const files = dayFiles().sort();
    const steps = [];
    const byId = new Map();
    const patches = [];
    for (const f of files) {
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        if (!line) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (obj && obj.patch) patches.push(obj);
        else if (obj && obj.id) { steps.push(obj); byId.set(obj.id, obj); }
      }
    }
    for (const p of patches) {
      const s = byId.get(p.patch);
      if (s) s.description = p.description;
    }
    return steps;
  }

  function readSince(stepId) {
    const steps = readAll();
    if (stepId == null) return steps;
    const idx = steps.findIndex((s) => s.id === stepId);
    return idx < 0 ? steps : steps.slice(idx + 1);
  }

  function markProcessed(stepId) {
    const tmpPath = statePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify({ lastProcessed: stepId }), { mode: 0o600 });
    try { fs.chmodSync(tmpPath, 0o600); } catch { /* best effort */ }
    fs.renameSync(tmpPath, statePath);
  }

  function lastProcessed() {
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf8')).lastProcessed || null;
    } catch {
      return null;
    }
  }

  return { append, readSince, markProcessed, lastProcessed, attachDescription, prune, clear };
}

module.exports = { createJournal };
