const test = require('node:test');
const assert = require('node:assert');
const { isMeaningful, isUsefulFact } = require('../../src/learning/meaningful');

test('steps with names, shortcuts, typed text or commands count', () => {
  assert.ok(isMeaningful({ action: 'click', target: { role: 'AXButton', title: 'Export' } }));
  assert.ok(isMeaningful({ action: 'click', target: { role: 'AXMenuItem', title: '', menuPath: ['File', 'Export'] } }));
  assert.ok(isMeaningful({ action: 'shortcut', keys: 'cmd+shift+e' }));
  assert.ok(isMeaningful({ action: 'type', value: 'icons-final' }));
  assert.ok(isMeaningful({ action: 'command', value: 'git status' }));
});

test('clicks on unnamed elements do not count, even with a screenshot description', () => {
  assert.ok(!isMeaningful({ action: 'click', target: { role: 'AXScrollArea', title: null }, description: 'The user scrolled the chat' }));
  assert.ok(!isMeaningful({ action: 'click', target: { role: 'AXGroup', title: '  ' } }));
  assert.ok(!isMeaningful({ action: 'click', target: null }));
  assert.ok(!isMeaningful({ action: 'type', value: '' }));
});

test('facts about the user are kept; jargon and bare app names are dropped', () => {
  assert.ok(isUsefulFact({ topic: 'Projects', fact: 'Keeps the Mysthi app in ~/Experimenting-24Mar/jean-claude-duck.' }));
  assert.ok(isUsefulFact({ topic: 'Shortcuts', fact: 'Exports Figma frames with cmd+shift+e.' }));
  assert.ok(!isUsefulFact({ topic: 'Naming Convention', fact: "Accessibility UI elements are referenced using 'AXScrollArea'." }));
  assert.ok(!isUsefulFact({ topic: 'Tool Used', fact: "Uses the application named 'Claude'." }));
  assert.ok(!isUsefulFact({ topic: 'x', fact: 'short' }));
  assert.ok(!isUsefulFact(null));
});
