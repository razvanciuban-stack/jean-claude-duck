// vault.test.js — vault access against a tmp dir
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault } = require('../../src/learning/vault');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mysthi-vault-'));
}

test('vault.ensure seeds do-not-watch.md and loadDoNotWatch reads it back', () => {
  const root = path.join(tmp(), 'mysthi');
  const vault = createVault(root);
  vault.ensure();
  for (const d of ['lessons', 'knowledge', 'log', 'reports']) {
    assert.ok(fs.statSync(path.join(root, d)).isDirectory());
  }
  const text = vault.read('do-not-watch.md');
  assert.match(text, /## Apps/);
  assert.match(text, /## Websites/);
  const { apps, domains } = vault.loadDoNotWatch();
  assert.ok(apps.includes('com.1password.1password'));
  assert.deepStrictEqual(domains, require('../../src/learning/data/default-do-not-watch.json').domains);
  for (const site of ['web.whatsapp.com', '1password.com', 'facebook.com', 'instagram.com', 'x.com']) {
    assert.ok(domains.includes(site), `${site} is blocked by default`);
  }
});

test('ensure does not overwrite an existing do-not-watch.md', () => {
  const root = tmp();
  const vault = createVault(root);
  vault.writeAtomic('do-not-watch.md', '## Apps\n- my.app\n\n## Websites\n- bank.example.com\n');
  vault.ensure();
  assert.deepStrictEqual(vault.loadDoNotWatch(), { apps: ['my.app'], domains: ['bank.example.com'] });
});

test('loadDoNotWatch ignores other text and returns empty lists when missing', () => {
  const root = tmp();
  const vault = createVault(root);
  assert.deepStrictEqual(vault.loadDoNotWatch(), { apps: [], domains: [] });
  vault.writeAtomic('do-not-watch.md', 'intro\n- stray\n## Apps\r\n- a.b\r\nnote\n* c.d\n## Other\n- nope\n## Websites\n- x.com\n');
  assert.deepStrictEqual(vault.loadDoNotWatch(), { apps: ['a.b', 'c.d'], domains: ['x.com'] });
});

test('writeAtomic creates parent dirs and leaves no .tmp file', () => {
  const root = tmp();
  const vault = createVault(root);
  vault.writeAtomic('lessons/deep/a.md', 'hello');
  assert.strictEqual(vault.read('lessons/deep/a.md'), 'hello');
  vault.writeAtomic('lessons/deep/a.md', 'again');
  assert.strictEqual(vault.read('lessons/deep/a.md'), 'again');
  assert.deepStrictEqual(vault.list('lessons/deep'), ['a.md']);
  assert.ok(!fs.readdirSync(path.join(root, 'lessons', 'deep')).some((f) => f.endsWith('.tmp')));
});

test('read/exists/list handle missing paths', () => {
  const vault = createVault(tmp());
  assert.strictEqual(vault.read('nope.md'), null);
  assert.strictEqual(vault.exists('nope.md'), false);
  assert.deepStrictEqual(vault.list('nodir'), []);
});

test('paths escaping the vault root are rejected', () => {
  const vault = createVault(tmp());
  assert.throws(() => vault.writeAtomic('../evil.md', 'x'));
});
