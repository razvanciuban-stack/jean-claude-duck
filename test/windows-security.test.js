// windows-security.test.js — both windows are locked down: sandbox, isolation, no Node, narrow bridges
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

for (const [name, file] of [['pet', 'src/windows/pet-window.js'], ['chat', 'src/windows/chat-window.js']]) {
  test(`${name} window: sandboxed, isolated, no Node, no navigation`, () => {
    const src = read(file);
    assert.match(src, /sandbox:\s*true/);
    assert.match(src, /contextIsolation:\s*true/);
    assert.match(src, /nodeIntegration:\s*false/);
    assert.doesNotMatch(src, /nodeIntegration:\s*true|contextIsolation:\s*false/);
    assert.match(src, /will-navigate/);
    assert.match(src, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  });
}

test('pet page uses no Node and only messages its bridge allows', () => {
  const html = read('src/renderer/pet/index.html');
  assert.doesNotMatch(html, /require\(/);
  assert.match(html, /Content-Security-Policy/);
  const preload = read('src/renderer/pet/preload.js');
  const allowed = new Set([...preload.matchAll(/'([a-z]+:[a-z-]+)'/g)].map((m) => m[1]));
  const used = [...html.matchAll(/ipcRenderer\.(?:send|on|once)\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 10);
  for (const ch of used) assert.ok(allowed.has(ch), `${ch} is not in the pet bridge`);
});

test('chat page uses no Node', () => {
  assert.doesNotMatch(read('src/renderer/chat/chat.js'), /require\(/);
  assert.doesNotMatch(read('src/renderer/chat/index.html'), /require\(/);
});
