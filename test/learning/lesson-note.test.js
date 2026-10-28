// lesson-note.test.js — render/parse round trip and edit detection
const test = require('node:test');
const assert = require('node:assert');
const { renderLesson, parseLesson, LessonParseError } = require('../../src/learning/lesson-note');

function sample() {
  return {
    slug: 'export-report',
    title: 'Export the weekly report',
    apps: ['com.apple.Safari', 'com.microsoft.Excel'],
    timesObserved: 3,
    confident: true,
    firstSeen: '2026-10-01',
    lastSeen: '2026-10-20',
    steps: [
      { id: 's1', app: 'com.apple.Safari', action: 'click', target: 'Reports tab', text: 'Open the Reports tab', userEdited: false, variants: [] },
      { id: 's2', app: 'com.apple.Safari', action: 'click', target: 'Export', text: 'Click Export', userEdited: false, variants: ['Press the Export button'] },
      { id: 's3', app: 'com.microsoft.Excel', action: 'type', target: 'Cell A1', value: 'Week', text: 'Type the week label', userEdited: false, variants: [] },
    ],
  };
}

test('render then parse is lossless with no edits', () => {
  const lesson = sample();
  const { lesson: out, edits } = parseLesson(renderLesson(lesson));
  assert.deepStrictEqual(edits, { changed: [], removed: [], added: [] });
  assert.deepStrictEqual(out, lesson);
});

test('render emits the fixed frontmatter keys and step comments', () => {
  const md = renderLesson(sample());
  assert.match(md, /^---\ntitle: "Export the weekly report"\ntype: mysthi-lesson\n/);
  assert.match(md, /times_observed: 3/);
  assert.match(md, /\n2\. Click Export <!-- step:s2 -->\n   - Also seen: Press the Export button\n/);
  assert.match(md, /```mysthi-lesson\n/);
});

test('edited step text wins', () => {
  const md = renderLesson(sample()).replace('Click Export', 'Click the big Export button');
  const { lesson, edits } = parseLesson(md);
  assert.deepStrictEqual(edits.changed, ['s2']);
  assert.strictEqual(lesson.steps[1].text, 'Click the big Export button');
  assert.strictEqual(lesson.steps[1].userEdited, true);
  assert.strictEqual(lesson.steps[0].userEdited, false);
});

test('deleted line removes step', () => {
  const md = renderLesson(sample()).replace('1. Open the Reports tab <!-- step:s1 -->\n', '');
  const { lesson, edits } = parseLesson(md);
  assert.deepStrictEqual(edits.removed, ['s1']);
  assert.deepStrictEqual(lesson.steps.map((s) => s.id), ['s2', 's3']);
});

test('new line without id becomes user step', () => {
  const md = renderLesson(sample()).replace('## Steps\n\n', '## Steps\n\n1. Log in first\n');
  const { lesson, edits } = parseLesson(md);
  assert.strictEqual(edits.added.length, 1);
  const added = edits.added[0];
  assert.strictEqual(added.text, 'Log in first');
  assert.strictEqual(added.userEdited, true);
  assert.strictEqual(added.action, 'manual');
  assert.ok(added.id && !['s1', 's2', 's3'].includes(added.id));
  assert.strictEqual(lesson.steps[0].id, added.id);
  assert.strictEqual(lesson.steps.length, 4);
});

test('reordered lines reorder steps', () => {
  const md = renderLesson(sample());
  const l1 = '1. Open the Reports tab <!-- step:s1 -->\n';
  const l3 = '3. Type the week label <!-- step:s3 -->\n';
  const swapped = md.replace(l1, '@@1').replace(l3, l1).replace('@@1', l3);
  const { lesson, edits } = parseLesson(swapped);
  assert.deepStrictEqual(lesson.steps.map((s) => s.id), ['s3', 's2', 's1']);
  assert.deepStrictEqual(edits, { changed: [], removed: [], added: [] });
});

test('renumbering, 1) style and trailing whitespace are not edits', () => {
  const md = renderLesson(sample())
    .replace('1. Open', '7) Open')
    .replace('<!-- step:s1 -->', '<!-- step:s1 -->   ')
    .replace('3. Type', '9.   Type');
  const { edits } = parseLesson(md);
  assert.deepStrictEqual(edits, { changed: [], removed: [], added: [] });
});

test('CRLF line endings parse the same', () => {
  const lesson = sample();
  const { lesson: out, edits } = parseLesson(renderLesson(lesson).replace(/\n/g, '\r\n'));
  assert.deepStrictEqual(edits, { changed: [], removed: [], added: [] });
  assert.deepStrictEqual(out, lesson);
});

test('user-edited title is taken from the heading', () => {
  const md = renderLesson(sample()).replace('# Export the weekly report', '# Weekly export');
  assert.strictEqual(parseLesson(md).lesson.title, 'Weekly export');
});

test('deleted Also seen line drops that variant', () => {
  const md = renderLesson(sample()).replace('   - Also seen: Press the Export button\n', '');
  const { lesson, edits } = parseLesson(md);
  assert.deepStrictEqual(lesson.steps[1].variants, []);
  assert.deepStrictEqual(edits.changed, []);
});

test('missing JSON block throws LessonParseError', () => {
  const md = renderLesson(sample()).replace(/```mysthi-lesson[\s\S]*$/, '');
  assert.throws(() => parseLesson(md), LessonParseError);
});

test('malformed JSON block throws LessonParseError', () => {
  const md = renderLesson(sample()).replace('"slug"', '"slug" oops');
  assert.throws(() => parseLesson(md), (e) => e instanceof LessonParseError && e.name === 'LessonParseError');
});

const { normalizeLesson } = require('../../src/learning/lesson-note');

function roundTrip(mutate) {
  const lesson = sample();
  mutate(lesson);
  const { lesson: out, edits } = parseLesson(renderLesson(lesson));
  assert.deepStrictEqual(edits, { changed: [], removed: [], added: [] });
  assert.deepStrictEqual(out, normalizeLesson(lesson));
  return out;
}

test('round trip survives newline in step text', () => {
  const out = roundTrip((l) => { l.steps[1].text = 'line1\nline2'; });
  assert.strictEqual(out.steps[1].text, 'line1 line2');
});

test('round trip survives injected numbered line', () => {
  roundTrip((l) => { l.steps[0].text = 'x\n2. injected'; });
});

test('round trip survives injected heading', () => {
  roundTrip((l) => { l.steps[0].text = 'x\n## Other\nmore'; });
});

test('round trip survives newline in variant and drops empty variants', () => {
  const out = roundTrip((l) => { l.steps[1].variants = ['v1\nv2', '  ', 'v3']; });
  assert.deepStrictEqual(out.steps[1].variants, ['v1 v2', 'v3']);
});

test('round trip survives newline in title', () => {
  const out = roundTrip((l) => { l.title = 'Two\nlines'; });
  assert.strictEqual(out.title, 'Two lines');
});

test('round trip survives step comment sequences in text', () => {
  roundTrip((l) => { l.steps[0].text = 'evil <!-- step:s2 --> text'; });
  roundTrip((l) => { l.steps[2].variants = ['a <!-- step:s1 --> b']; });
});
