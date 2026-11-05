const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault } = require('../src/learning/vault');
const { createVaultMemory } = require('../src/services/vault-memory');
const { parseRemember, saveMemory } = require('../src/services/memory-notes');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysthi-remember-'));
  const vault = createVault(root);
  vault.ensure();
  return { root, vault };
}
const NOW = new Date(2026, 10, 4, 15, 30);

test('only an explicit "ține minte" / "remember" at the start is a request to save', () => {
  assert.deepStrictEqual(parseRemember('Ține minte că beau cafea fără zahăr'), { fact: 'beau cafea fără zahăr', lang: 'ro' });
  assert.deepStrictEqual(parseRemember('tine minte: deploy-ul e vinerea'), { fact: 'deploy-ul e vinerea', lang: 'ro' });
  assert.deepStrictEqual(parseRemember('Remember that the staging server is slow'), { fact: 'the staging server is slow', lang: 'en' });
  assert.deepStrictEqual(parseRemember('remember, Daria owns the design system'), { fact: 'Daria owns the design system', lang: 'en' });
  assert.strictEqual(parseRemember('Do you remember what I said?'), null);
  assert.strictEqual(parseRemember('nu ții minte nimic'), null);
  assert.strictEqual(parseRemember('rememberable things'), null);
  assert.deepStrictEqual(parseRemember('ține minte'), { fact: '', lang: 'ro' });
});

test('a request saves a note in memory/ with user-explicit frontmatter, exactly as said', () => {
  const { vault } = setup();
  const fact = 'Beau cafeaua fără zahăr; AXA e asigurarea mea.';
  const saved = saveMemory({ vault, fact, now: NOW });
  assert.match(saved.path, /^memory\/2026-11-04-beau-cafeaua-fara-zahar[a-z0-9-]*\.md$/);
  const md = vault.read(saved.path);
  assert.match(md, /^---\n/);
  assert.match(md, /\ncreated: "2026-11-04T/);
  assert.match(md, /\nupdated: "2026-11-04T/);
  assert.match(md, /\nsource: user-explicit\n/);
  assert.match(md, /\nstatus: active\n/);
  assert.ok(md.includes(fact), 'kept word for word, no jargon filter');
  assert.strictEqual(saved.changed, false);
});

test('secrets in the message are redacted in the note, and the caller is told', () => {
  const { vault } = setup();
  const saved = saveMemory({ vault, fact: 'my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and card 4111 1111 1111 1111', now: NOW });
  const md = vault.read(saved.path);
  assert.ok(!md.includes('abcdefghijklmnopqrstuvwxyz123456'));
  assert.ok(!md.includes('4111 1111 1111 1111'));
  assert.strictEqual(saved.changed, true);
  assert.ok(!saved.text.includes('4111'));
});

test('two notes with the same words the same day get different files', () => {
  const { vault } = setup();
  const a = saveMemory({ vault, fact: 'Standup at 10', now: NOW });
  const b = saveMemory({ vault, fact: 'Standup at 10', now: NOW });
  assert.notStrictEqual(a.path, b.path);
  assert.ok(vault.exists(a.path) && vault.exists(b.path));
});

test('an empty fact is refused and writes nothing', () => {
  const { root, vault } = setup();
  assert.throws(() => saveMemory({ vault, fact: '   ', now: NOW }), /Nothing to remember/);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'memory')), []);
});

test('a saved note is found by the next question, also after a restart (fresh index)', () => {
  const { vault, root } = setup();
  saveMemory({ vault, fact: 'Parola Wi-Fi de la birou o știe Daria, nu o salva.', now: NOW });
  saveMemory({ vault, fact: 'Deploy-ul pe producție se face doar marțea.', now: NOW });
  const restarted = createVaultMemory({ vault: createVault(root) });
  const [hit] = restarted.search('când facem deploy pe producție?');
  assert.match(hit.path, /^memory\/.*deploy/);
  assert.strictEqual(hit.source, 'user-explicit');
  assert.match(hit.snippet, /doar marțea/);
});

test('a write cut off half-way leaves no note: the .tmp file is never indexed', () => {
  const { root, vault } = setup();
  fs.writeFileSync(path.join(root, 'memory', 'half.md.123.abcd.tmp'), '---\nsource: user-explicit\n---\n# Half\nunfinishedword');
  assert.deepStrictEqual(createVaultMemory({ vault }).search('unfinishedword'), []);
});

test('memory/ is created with the other vault folders', () => {
  const { root } = setup();
  assert.ok(fs.statSync(path.join(root, 'memory')).isDirectory());
});

// --- Phase 3: correct, delete, trash ---
const { correctMemory, deleteMemory, emptyTrash, isActiveNote } = require('../src/services/memory-notes');
const LATER = new Date(2026, 10, 5, 10, 0);

test('correcting a note writes a new one and marks the old one superseded; search returns only the new', () => {
  const { vault } = setup();
  const memory = createVaultMemory({ vault });
  const old = saveMemory({ vault, fact: 'Release-ul Mysthi 1.0 e pe 20 noiembrie.', now: NOW });
  assert.match(memory.search('când e release-ul Mysthi?')[0].snippet, /20 noiembrie/);
  const fixed = correctMemory({ vault, path: old.path, fact: 'Release-ul Mysthi 1.0 e pe 27 noiembrie.', now: LATER });
  assert.notStrictEqual(fixed.path, old.path);
  const oldMd = vault.read(old.path);
  assert.match(oldMd, /\nstatus: superseded\n/);
  assert.match(oldMd, new RegExp(`\\nsuperseded_by: "${fixed.path}"\\n`));
  assert.match(oldMd, /\nupdated: "2026-11-05T/);
  assert.match(vault.read(fixed.path), new RegExp(`\\nreplaces: "${old.path}"\\n`));
  assert.strictEqual(isActiveNote(vault, old.path), false);
  assert.strictEqual(isActiveNote(vault, fixed.path), true);
  const hits = memory.search('când e release-ul Mysthi?');
  assert.deepStrictEqual(hits.map((h) => h.path), [fixed.path]);
  assert.match(hits[0].snippet, /27 noiembrie/);
});

test('deleting moves the note to .trash/, which is never searched; emptying the trash removes it', () => {
  const { root, vault } = setup();
  const memory = createVaultMemory({ vault });
  const n = saveMemory({ vault, fact: 'Codul ușii de la birou e pe bilețelul galben.', now: NOW });
  assert.strictEqual(memory.search('codul ușii birou')[0].path, n.path);
  const res = deleteMemory({ vault, path: n.path });
  assert.match(res.trashPath, /^\.trash\/2026-11-04-/);
  assert.strictEqual(vault.exists(n.path), false);
  assert.ok(vault.exists(res.trashPath));
  assert.deepStrictEqual(memory.search('codul ușii birou'), []);
  assert.strictEqual(isActiveNote(vault, n.path), false);
  assert.strictEqual(emptyTrash({ vault }), 1);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, '.trash')), []);
});

test('deleting the same name twice keeps both copies in the trash', () => {
  const { vault } = setup();
  const a = saveMemory({ vault, fact: 'Standup at 10', now: NOW });
  const t1 = deleteMemory({ vault, path: a.path }).trashPath;
  const b = saveMemory({ vault, fact: 'Standup at 10', now: NOW });
  assert.strictEqual(b.path, a.path);
  const t2 = deleteMemory({ vault, path: b.path }).trashPath;
  assert.notStrictEqual(t1, t2);
});

test('only notes in memory/ can be corrected or deleted: lessons, ../, links and missing notes are refused', () => {
  const { root, vault } = setup();
  vault.writeAtomic('lessons/a.md', '# A');
  vault.writeAtomic('knowledge/k.md', '# K');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mysthi-out-'));
  fs.writeFileSync(path.join(outside, 'x.md'), 'outside');
  fs.symlinkSync(path.join(outside, 'x.md'), path.join(root, 'memory', 'link-out.md'));
  fs.symlinkSync(path.join(root, 'knowledge', 'k.md'), path.join(root, 'memory', 'link-in.md'));
  for (const p of ['lessons/a.md', '../x.md', 'memory/../lessons/a.md', 'memory/sub/x.md', 'memory/link-out.md', 'memory/link-in.md', 'memory/missing.md', '.trash/x.md']) {
    assert.throws(() => deleteMemory({ vault, path: p }), /Only your own notes|not found/i, p);
    assert.throws(() => correctMemory({ vault, path: p, fact: 'x', now: NOW }), /Only your own notes|not found/i, p);
  }
  assert.ok(fs.existsSync(path.join(outside, 'x.md')));
  assert.ok(vault.exists('knowledge/k.md'));
});

test('a superseded note cannot be corrected again (correct the newest one)', () => {
  const { vault } = setup();
  const a = saveMemory({ vault, fact: 'v1', now: NOW });
  correctMemory({ vault, path: a.path, fact: 'v2', now: LATER });
  assert.throws(() => correctMemory({ vault, path: a.path, fact: 'v3', now: LATER }), /already replaced/);
});

test('deleting a corrected note also trashes the older versions it replaced', () => {
  const { vault } = setup();
  const v1 = saveMemory({ vault, fact: 'Release on 20 Nov', now: NOW });
  const v2 = correctMemory({ vault, path: v1.path, fact: 'Release on 27 Nov', now: LATER });
  const v3 = correctMemory({ vault, path: v2.path, fact: 'Release on 29 Nov', now: LATER });
  const res = deleteMemory({ vault, path: v3.path });
  assert.strictEqual(res.olderVersions, 2);
  for (const p of [v1.path, v2.path, v3.path]) assert.strictEqual(vault.exists(p), false, p);
  assert.strictEqual(vault.list('.trash').length, 3);
});
