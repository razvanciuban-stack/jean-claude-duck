const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault } = require('../src/learning/vault');
const { createVaultMemory, INDEXED_DIRS, readableText } = require('../src/services/vault-memory');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysthi-mem-'));
  const vault = createVault(root);
  vault.ensure();
  return { root, vault, memory: createVaultMemory({ vault }) };
}

const lesson = (title, steps) => `---
title: "${title}"
type: mysthi-lesson
---

# ${title}

## Steps

${steps.map((s, i) => `${i + 1}. ${s} <!-- step:s${i} -->`).join('\n')}

\`\`\`mysthi-lesson
{ "slug": "x", "steps": [{ "id": "s0", "secretJsonOnly": "zzqqjson" }] }
\`\`\`
`;

test('indexes the Mysthi folders, including memory/', () => {
  assert.deepStrictEqual(INDEXED_DIRS, ['lessons', 'knowledge', 'log', 'memory']);
});

test('a note with diacritics is found by a question without them, and the other way round', () => {
  const { vault, memory } = setup();
  vault.writeAtomic('lessons/export.md', lesson('Exportă iconițele din Sketch', ['In Sketch, click AXButton "Export"', 'In Sketch, choose PNG @2x']));
  vault.writeAtomic('knowledge/slack.md', '---\ntype: mysthi-knowledge\n---\n# Slack\n- Pastes share links into Slack after publishing.\n');
  const hits = memory.search('cum export iconitele?');
  assert.strictEqual(hits[0].path, 'lessons/export.md');
  assert.strictEqual(hits[0].title, 'Exportă iconițele din Sketch');
  assert.strictEqual(hits[0].source, 'screen-derived');
  assert.strictEqual(memory.search('iconițe exportă')[0].path, 'lessons/export.md');
});

test('lessons and knowledge are both found; notes outside mysthi/ folders are not', () => {
  const { root, vault, memory } = setup();
  vault.writeAtomic('lessons/publish.md', lesson('Publish design file to share link', ['In Chrome, click "Publish to share link"']));
  vault.writeAtomic('knowledge/workflow.md', '---\ntype: mysthi-knowledge\n---\n# Workflow\n- Publishes prototypes and pastes the link into Slack.\n');
  vault.writeAtomic('reports/2026-11-04-week.md', '# Report\nPublish prototype share link Slack');
  fs.writeFileSync(path.join(root, '..', `outside-${path.basename(root)}.md`), 'Publish share link Slack');
  const paths = memory.search('publish share link slack').map((h) => h.path);
  assert.ok(paths.includes('lessons/publish.md'));
  assert.ok(paths.includes('knowledge/workflow.md'));
  assert.ok(!paths.some((p) => p.startsWith('reports/')), 'reports repeat lessons; not indexed');
  assert.ok(paths.every((p) => !p.includes('outside')));
});

test('a note added or deleted shows up at the very next question', () => {
  const { root, vault, memory } = setup();
  assert.deepStrictEqual(memory.search('figma frames'), []);
  vault.writeAtomic('knowledge/figma.md', '# Figma\n- Exports Figma frames as PNG.\n');
  assert.strictEqual(memory.search('figma frames')[0].path, 'knowledge/figma.md');
  fs.unlinkSync(path.join(root, 'knowledge', 'figma.md'));
  assert.deepStrictEqual(memory.search('figma frames'), []);
});

test('notes you asked her to keep (memory/) are found and marked as yours', () => {
  const { vault, memory } = setup();
  vault.writeAtomic('memory/2026-11-04-cafea.md', '---\nsource: user-explicit\n---\n# Cafea\nRazvan bea cafeaua fără zahăr.\n');
  const [hit] = memory.search('ce cafea beau?');
  assert.strictEqual(hit.path, 'memory/2026-11-04-cafea.md');
  assert.strictEqual(hit.source, 'user-explicit');
});

test('excerpts drop the lesson JSON block, step markers and AX role jargon', () => {
  const text = readableText(lesson('Export', ['In Sketch, click AXButton "Export"']));
  assert.ok(!text.includes('zzqqjson'));
  assert.ok(!text.includes('<!--'));
  assert.ok(!/\bAX[A-Z]/.test(text));
  assert.match(text, /click "Export"/);
});

test('a link inside mysthi/ that leads outside the vault is ignored', () => {
  const { root, memory } = setup();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mysthi-out-'));
  fs.writeFileSync(path.join(outside, 'secret.md'), '# Secret\nunicornpassword lives here');
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'knowledge', 'secret.md'));
  assert.deepStrictEqual(memory.search('unicornpassword'), []);
});

test('excerpts stay within the character budget', () => {
  const { vault } = setup();
  const memory = createVaultMemory({ vault, budget: 1000, perNote: 400 });
  for (let i = 0; i < 8; i++) vault.writeAtomic(`knowledge/n${i}.md`, `# Sketch note ${i}\n` + '- Uses Sketch symbols for buttons and icons every day.\n'.repeat(30));
  const hits = memory.search('sketch symbols');
  const total = hits.reduce((s, h) => s + h.snippet.length, 0);
  assert.ok(hits.length >= 2);
  assert.ok(total <= 1000, `total ${total}`);
  assert.ok(hits.every((h) => h.snippet.length <= 400));
});

test('nothing matches → nothing returned (no invented context)', () => {
  const { vault, memory } = setup();
  vault.writeAtomic('knowledge/x.md', '# Sketch\n- Uses Sketch.');
  assert.deepStrictEqual(memory.search('quantum chromodynamics'), []);
  assert.deepStrictEqual(memory.search('the and of'), []);
});

test('Romanian word forms match: export finds exportă and exportat', () => {
  const { vault, memory } = setup();
  vault.writeAtomic('knowledge/a.md', '# Design\n- A exportat cadrele în PNG.\n');
  vault.writeAtomic('knowledge/b.md', '# Slack\n- Trimite linkuri în Slack.\n');
  assert.strictEqual(memory.search('export')[0].path, 'knowledge/a.md');
});

test('a Romanian question finds an English note (keyboard shortcuts, file naming)', () => {
  const { vault, memory } = setup();
  vault.writeAtomic('knowledge/keyboard-shortcuts.md', '# Keyboard shortcuts\n- Uses Cmd+Shift+4 for screenshots.\n');
  vault.writeAtomic('knowledge/naming.md', '# Naming\n- Names files with the date first.\n');
  vault.writeAtomic('knowledge/slack.md', '# Slack\n- Sends links in Slack.\n');
  assert.strictEqual(memory.search('ce scurtături de tastatură folosesc?')[0].path, 'knowledge/keyboard-shortcuts.md');
  assert.strictEqual(memory.search('cum îmi numesc fișierele?')[0].path, 'knowledge/naming.md');
});

test('your own notes (memory/) keep every word, AXA included', () => {
  const { vault, memory } = setup();
  vault.writeAtomic('memory/2026-11-04-asigurare.md', '---\nsource: user-explicit\n---\n# Asigurare\nAXA este asigurarea mea de sănătate.\n');
  assert.match(memory.search('ce asigurare am?')[0].snippet, /AXA este/);
});
