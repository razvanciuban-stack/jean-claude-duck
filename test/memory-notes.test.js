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
