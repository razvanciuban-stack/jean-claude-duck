// journal.js — append-only, redacted on-disk step journal (JSONL per day) plus processing cursor

const fs = require('node:fs');
const path = require('node:path');
const { redact, redactDeep } = require('./redact');

function dayStamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function createJournal(dir) {
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
    safe.redactions = step.redactions || [];
    appendLine(path.join(dir, `steps-${dayStamp(Date.now())}.jsonl`), safe);
  }

  function attachDescription(stepId, text) {
    appendLine(path.join(dir, `steps-${dayStamp(Date.now())}.jsonl`), {
      patch: stepId,
      description: redact(String(text)).text
    });
  }

  function readAll() {
    const files = fs.readdirSync(dir).filter((f) => /^steps-.*\.jsonl$/.test(f)).sort();
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

  return { append, readSince, markProcessed, lastProcessed, attachDescription };
}

module.exports = { createJournal };
