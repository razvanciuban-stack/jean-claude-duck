// pipeline.js — idle-time learning pipeline: journal -> segments -> tasks -> lessons/knowledge -> daily log
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { splitAtBoundaries, groupTasks } = require('./segmenter');
const { loadLessons, learnTask } = require('./lessons');
const { extractKnowledge } = require('./knowledge');
const { isAvailable } = require('../services/ollama');
const { appendDailyLog } = require('./reports');
const { IDLE_THRESHOLD_MS, SEGMENT_GAP_MS, TEXT_MODEL } = require('./config');

const WEEKLY_FILE = 'weekly.json';
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'EAI_AGAIN', 'EPIPE']);

const REAL_DEPS = { isAvailable, groupTasks, loadLessons, learnTask, extractKnowledge };

function emptyWeek() {
  return { enabledAt: null, lastReportAt: null, newLessons: [], updated: [], facts: [] };
}

function readWeek(stateDir) {
  try {
    const w = JSON.parse(fs.readFileSync(path.join(stateDir, WEEKLY_FILE), 'utf8'));
    return { ...emptyWeek(), ...w };
  } catch {
    return emptyWeek();
  }
}

function writeWeek(stateDir, week) {
  atomicWrite(path.join(stateDir, WEEKLY_FILE), JSON.stringify(week, null, 2));
}

function atomicWrite(full, text) {
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch { /* best effort */ }
    fs.renameSync(tmp, full);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw err;
  }
}

// results: { lessons: {kind, lesson, changes}[], facts: {topic, fact}[] }
function recordWeek(stateDir, results) {
  const week = readWeek(stateDir);
  for (const r of (results && results.lessons) || []) {
    if (!r || !r.lesson || !r.lesson.slug) continue;
    const slug = r.lesson.slug;
    if (r.kind === 'new') {
      if (!week.newLessons.includes(slug)) week.newLessons.push(slug);
    } else {
      const entry = week.updated.find((u) => u.slug === slug);
      const changes = r.changes || [];
      if (entry) entry.changes.push(...changes.filter((c) => !entry.changes.includes(c)));
      else week.updated.push({ slug, changes: [...changes] });
    }
  }
  for (const f of (results && results.facts) || []) {
    if (!f) continue;
    if (!week.facts.some((x) => x.topic === f.topic && x.fact === f.fact)) week.facts.push({ topic: f.topic, fact: f.fact });
  }
  writeWeek(stateDir, week);
}

const PROGRESS_FILE = 'progress.json';
const MAX_ATTEMPTS = 3;

function readProgress(stateDir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(stateDir, PROGRESS_FILE), 'utf8'));
    return p && p.segmentLastStepId ? p : null;
  } catch {
    return null;
  }
}

function writeProgress(stateDir, prog) {
  atomicWrite(path.join(stateDir, PROGRESS_FILE), JSON.stringify(prog));
}

function clearProgress(stateDir) {
  try { fs.unlinkSync(path.join(stateDir, PROGRESS_FILE)); } catch { /* none */ }
}

function localDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isConnectionError(err) {
  if (!err) return false;
  if (CONNECTION_CODES.has(err.code)) return true;
  // A request timeout ("Ollama timeout") is NOT a connection error: the server answered the connection
  // but was too slow, so it counts as an attempt and a segment can't be retried forever.
  return /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|socket hang up|fetch failed/i.test(String(err.message || ''));
}

// Thrown when the user came back (or turned learning off) between tasks: stop, keep progress, don't count
class Interrupted extends Error {
  constructor(reason) {
    super(reason);
    this.interrupted = reason;
  }
}

function createPipeline({ journal, vault, stateDir, deps = {}, now = Date.now, getIdleMs, isEnabled = () => true }) {
  const d = { ...REAL_DEPS, ...deps };
  const state = { lastRunAt: null, lastResult: null, pending: 0, running: false };

  async function processSegment(segment, today, force) {
    const lastId = segment[segment.length - 1].id;
    let prog = readProgress(stateDir);
    if (!prog || prog.segmentLastStepId !== lastId) prog = { segmentLastStepId: lastId, learnedTaskKeys: [], results: [], facts: null, attempts: 0 };

    const tasks = await d.groupTasks(segment);
    if (!tasks) {
      if (!(await d.isAvailable(TEXT_MODEL))) throw Object.assign(new Error('Model unavailable'), { connection: true });
      throw new Error('Task grouping failed');
    }
    let lessons = d.loadLessons(vault);
    if (!prog.facts) {
      prog.facts = await d.extractKnowledge({ steps: segment, vault, today });
      writeProgress(stateDir, prog);
    }
    for (const task of tasks) {
      if (!task.isTask) continue;
      const ids = new Set(task.stepIds);
      const steps = segment.filter((s) => ids.has(s.id));
      if (!steps.length) continue;
      const key = [...task.stepIds].sort().join(',');
      if (prog.learnedTaskKeys.includes(key)) continue;
      if (!isEnabled()) throw new Interrupted('disabled');
      if (!force && getIdleMs() < IDLE_THRESHOLD_MS) throw new Interrupted('not-idle');
      const res = await d.learnTask({ task, steps, lessons, vault, today });
      prog.learnedTaskKeys.push(key);
      prog.results.push({ kind: res.kind, lesson: { slug: res.lesson.slug, title: res.lesson.title }, changes: res.changes || [] });
      writeProgress(stateDir, prog);
      lessons = d.loadLessons(vault);
    }
    appendDailyLog({ vault, date: today, lessons: prog.results, facts: prog.facts });
    recordWeek(stateDir, { lessons: prog.results, facts: prog.facts });
    journal.markProcessed(lastId);
    clearProgress(stateDir);
  }

  function skipSegment(segment, today) {
    appendDailyLog({ vault, date: today, notes: ["Skipped a stretch of activity Mysthi couldn't make sense of"] });
    journal.markProcessed(segment[segment.length - 1].id);
    clearProgress(stateDir);
  }

  async function modelAvailable() {
    try { return !!(await d.isAvailable(TEXT_MODEL)); } catch { return false; }
  }

  // force: the user asked for notes now — don't wait for idle, and include the stretch still in progress
  async function run(force) {
    if (!force && getIdleMs() < IDLE_THRESHOLD_MS) return 'not-idle';
    const steps = journal.readSince(journal.lastProcessed());
    state.pending = steps.length;
    if (!steps.length) return 'nothing';
    const segments = splitAtBoundaries(steps, SEGMENT_GAP_MS);
    const last = segments[segments.length - 1];
    if (!force && now() - last[last.length - 1].ts < SEGMENT_GAP_MS) segments.pop(); // may still be in progress
    if (!segments.length) return 'nothing';
    if (!(await d.isAvailable(TEXT_MODEL))) return 'model-unavailable';

    const today = localDate(now());
    for (const segment of segments) {
      if (!force && getIdleMs() < IDLE_THRESHOLD_MS) return 'not-idle';
      try {
        await processSegment(segment, today, force);
      } catch (err) {
        if (err && err.interrupted) {
          state.lastResult = err.interrupted;
          return err.interrupted;
        }
        if (err && err.connection || isConnectionError(err) || !(await modelAvailable())) {
          state.lastResult = 'model-unavailable';
          return 'model-unavailable';
        }
        const lastId = segment[segment.length - 1].id;
        let prog = readProgress(stateDir);
        if (!prog || prog.segmentLastStepId !== lastId) prog = { segmentLastStepId: lastId, learnedTaskKeys: [], results: [], facts: null, attempts: 0 };
        prog.attempts += 1;
        if (prog.attempts >= MAX_ATTEMPTS) {
          skipSegment(segment, today);
          state.lastResult = 'skipped segment after 3 failures';
          continue;
        }
        writeProgress(stateDir, prog);
        state.lastResult = `ran (stopped: ${err && err.message ? err.message : err})`;
        return 'ran';
      }
    }
    return 'ran';
  }

  async function runOnce(force) {
    if (state.running) return 'busy';
    state.running = true;
    state.lastResult = null;
    try {
      const result = await run(force);
      if (!state.lastResult) state.lastResult = result;
      return result;
    } finally {
      state.lastRunAt = now();
      state.running = false;
    }
  }

  // Every minute: only when the user has been idle for a while
  async function runIfIdle() {
    const result = await runOnce(false);
    return result === 'busy' ? 'nothing' : result;
  }

  // "Make notes now" from the menu: process everything recorded so far, idle or not
  function runNow() {
    return runOnce(true);
  }

  function status() {
    return { ...state };
  }

  return { runIfIdle, runNow, status };
}

module.exports = { createPipeline, recordWeek, readWeek, writeWeek, isConnectionError };
