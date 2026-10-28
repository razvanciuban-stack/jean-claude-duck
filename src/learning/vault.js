// vault.js — filesystem access to the Mysthi section of the Obsidian vault
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { VAULT_DIR } = require('./config');
const defaults = require('./data/default-do-not-watch.json');

const SUBDIRS = ['lessons', 'knowledge', 'log', 'reports'];
const DNW_FILE = 'do-not-watch.md';

function seedDoNotWatch() {
  const list = (items) => items.map((i) => `- ${i}`).join('\n');
  return `# Do not watch\n\nMysthi never observes these. Edit freely.\n\n## Apps\n\n${list(defaults.apps)}\n\n## Websites\n\n${list(defaults.domains)}\n`;
}

function createVault(rootDir = VAULT_DIR) {
  const root = path.resolve(rootDir);

  function resolve(relPath) {
    const full = path.resolve(root, relPath);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Path escapes vault: ${relPath}`);
    }
    return full;
  }

  function writeAtomic(relPath, text) {
    const full = resolve(relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, full);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch (_) { /* already gone */ }
      throw err;
    }
  }

  function read(relPath) {
    try {
      return fs.readFileSync(resolve(relPath), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
      throw err;
    }
  }

  function exists(relPath) {
    return fs.existsSync(resolve(relPath));
  }

  function list(relDir) {
    try {
      return fs.readdirSync(resolve(relDir)).filter((f) => !f.endsWith('.tmp'));
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
      throw err;
    }
  }

  function ensure() {
    fs.mkdirSync(root, { recursive: true });
    for (const d of SUBDIRS) fs.mkdirSync(path.join(root, d), { recursive: true });
    if (!exists(DNW_FILE)) writeAtomic(DNW_FILE, seedDoNotWatch());
  }

  function loadDoNotWatch() {
    const out = { apps: [], domains: [] };
    const text = read(DNW_FILE);
    if (text == null) return out;
    let target = null;
    for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.trim();
      const heading = /^##\s+(.*)$/.exec(line);
      if (heading) {
        const name = heading[1].trim().toLowerCase();
        target = name === 'apps' ? out.apps : name === 'websites' ? out.domains : null;
        continue;
      }
      const item = /^[-*]\s+(.+)$/.exec(line);
      if (item && target) target.push(item[1].trim());
    }
    return out;
  }

  return { ensure, writeAtomic, read, exists, list, loadDoNotWatch };
}

module.exports = { createVault };
