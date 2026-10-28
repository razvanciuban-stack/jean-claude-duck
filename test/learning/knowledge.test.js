// knowledge.test.js — knowledge extraction, dedupe, per-topic notes
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault } = require('../../src/learning/vault');
const { extractKnowledge } = require('../../src/learning/knowledge');

function tmpVault() {
  const vault = createVault(fs.mkdtempSync(path.join(os.tmpdir(), 'mysthi-kb-')));
  vault.ensure();
  return vault;
}
const steps = [{ id: 'j1', ts: 1, bundleId: 'b', appName: 'Terminal', action: 'command', value: 'git status', target: null, redactions: [] }];

test('knowledge dedupes facts and returns only new ones', async () => {
  const vault = tmpVault();
  const ask1 = async () => ({ facts: [{ topic: 'Git Tools', fact: 'Uses git in Terminal' }, { topic: 'Git Tools', fact: 'uses   GIT in terminal' }] });
  const first = await extractKnowledge({ steps, vault, ask: ask1, today: '2026-10-01' });
  assert.deepStrictEqual(first, [{ topic: 'Git Tools', fact: 'Uses git in Terminal' }]);
  const note = vault.read('knowledge/git-tools.md');
  assert.match(note, /^---\ntype: mysthi-knowledge\ntopic: "Git Tools"\n---/);
  assert.match(note, /- Uses git in Terminal \(first seen 2026-10-01\)/);
  const ask2 = async () => ({ facts: [{ topic: 'git tools', fact: 'USES GIT IN TERMINAL' }, { topic: 'Git Tools', fact: 'Prefers rebase' }, { topic: '!!!', fact: 'Odd topic' }] });
  const second = await extractKnowledge({ steps, vault, ask: ask2, today: '2026-10-02' });
  assert.deepStrictEqual(second.map((f) => f.fact), ['Prefers rebase', 'Odd topic']);
  assert.match(vault.read('knowledge/git-tools.md'), /- Prefers rebase \(first seen 2026-10-02\)/);
  assert.ok(vault.exists('knowledge/general.md'));
  assert.strictEqual((vault.read('knowledge/git-tools.md').match(/^- /gm) || []).length, 2);
});

test('knowledge redacts, and ask failure writes nothing', async () => {
  const vault = tmpVault();
  const r = await extractKnowledge({ steps, vault, ask: async () => ({ facts: [{ topic: 'Env', fact: 'password=hunter2 is used' }] }), today: '2026-10-01' });
  assert.ok(!r[0].fact.includes('hunter2'));
  assert.ok(!vault.read('knowledge/env.md').includes('hunter2'));
  const before = vault.list('knowledge');
  await assert.rejects(extractKnowledge({ steps, vault, ask: async () => { throw new Error('down'); }, today: 'd' }), /down/);
  assert.deepStrictEqual(vault.list('knowledge'), before);
});
