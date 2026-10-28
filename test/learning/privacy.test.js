// privacy.test.js — privacy policy tests: do-not-watch apps, banking sites, terminals, password prompts
const test = require('node:test');
const assert = require('node:assert');
const { createPolicy, normalizeDomain, editorTextFieldAllowed, TERMINAL_BUNDLES, BROWSER_BUNDLES, EDITOR_BUNDLES } = require('../../src/learning/privacy');

const CHROME = { bundleId: 'com.google.Chrome', appName: 'Google Chrome', isBrowser: true };

function policy(over = {}) {
  return createPolicy({ doNotWatchApps: [], doNotWatchDomains: [], ...over });
}

test('exports terminal and browser bundles', () => {
  assert.ok(TERMINAL_BUNDLES.includes('com.apple.Terminal'));
  assert.ok(TERMINAL_BUNDLES.includes('com.googlecode.iterm2'));
  assert.ok(TERMINAL_BUNDLES.includes('dev.warp.Warp-Stable'));
  assert.strictEqual(BROWSER_BUNDLES.length, 6);
  assert.ok(BROWSER_BUNDLES.includes('com.google.Chrome'));
});

test('blocks 1Password by bundle id', () => {
  const p = policy();
  assert.strictEqual(p.canWatch({ bundleId: 'com.1password.1password', appName: '1Password', isBrowser: false }), false);
});

test('blocks user app by app name case-insensitively', () => {
  const p = policy({ doNotWatchApps: ['Secret App'] });
  assert.strictEqual(p.canWatch({ bundleId: 'x.y', appName: 'secret app', isBrowser: false }), false);
  assert.strictEqual(p.canWatch({ bundleId: 'x.y', appName: 'Other', isBrowser: false }), true);
});

test('blocks user domain online.mybank.example via suffix', () => {
  const p = policy({ doNotWatchDomains: ['mybank.example'] });
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://online.mybank.example/login' }), false);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://mybank.example/' }), false);
});

test('suffix match does not match lookalike notbt.ro', () => {
  const p = policy();
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://notbt.ro/' }), true);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://www.bt.ro/' }), false);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://bt.ro/' }), false);
});

test('blocks built-in banking domains', () => {
  const p = policy();
  for (const u of ['https://revolut.com/', 'https://www.paypal.com/x', 'https://secure.chase.com/', 'https://www.barclays.co.uk/']) {
    assert.strictEqual(p.canWatch({ ...CHROME, url: u }), false, u);
  }
});

test('blocks keyword host ibank.example.com', () => {
  assert.strictEqual(policy().canWatch({ ...CHROME, url: 'https://ibank.example.com/' }), false);
});

test('blocks Chrome tab titled "BT24 - Banca Transilvania"', () => {
  assert.strictEqual(
    policy().canWatch({ ...CHROME, url: 'https://example.com/', window: 'BT24 - Banca Transilvania' }),
    false
  );
});

test('blocks browser with unknown url', () => {
  const p = policy();
  assert.strictEqual(p.canWatch({ ...CHROME, url: null }), false);
  assert.strictEqual(p.canWatch({ ...CHROME }), false);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'not a url' }), false);
});

test('allows github.com in Chrome', () => {
  assert.strictEqual(policy().canWatch({ ...CHROME, url: 'https://github.com/foo/bar', window: 'foo/bar' }), true);
});

test('allows non-browser app without url', () => {
  assert.strictEqual(policy().canWatch({ bundleId: 'com.microsoft.VSCode', appName: 'Code', isBrowser: false }), true);
});

test('setLists replaces user domains', () => {
  const p = policy({ doNotWatchDomains: ['old.example'] });
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://old.example/' }), false);
  p.setLists({ doNotWatchApps: ['New App'], doNotWatchDomains: ['new.example'] });
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://old.example/' }), true);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://new.example/' }), false);
  assert.strictEqual(p.canWatch({ bundleId: 'a', appName: 'new app', isBrowser: false }), false);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://bt.ro/' }), false);
});

test('drops secure field', () => {
  assert.strictEqual(policy().typedTextAllowed({ bundleId: 'a', isTerminal: false, secure: true }), false);
});

test('drops any typing in Terminal', () => {
  assert.strictEqual(policy().typedTextAllowed({ bundleId: 'com.apple.Terminal', isTerminal: true, secure: false }), false);
});

test('drops field labelled "Parola"', () => {
  assert.strictEqual(policy().typedTextAllowed({ bundleId: 'a', isTerminal: false, secure: false, fieldLabel: 'Parola' }), false);
});

test('allows field labelled "File name"', () => {
  assert.strictEqual(policy().typedTextAllowed({ bundleId: 'a', isTerminal: false, secure: false, fieldLabel: 'File name' }), true);
});

test('terminal command allowed when echoed after $ prompt', () => {
  assert.strictEqual(policy().terminalCommandAllowed({ typed: 'git status', visibleLine: '~/app $ git status' }), true);
});

test('terminal command rejected when not echoed', () => {
  assert.strictEqual(policy().terminalCommandAllowed({ typed: 'hunter2', visibleLine: 'Password: ' }), false);
});

test('terminal command rejected after [sudo] password prompt', () => {
  assert.strictEqual(
    policy().terminalCommandAllowed({ typed: 'hunter2', visibleLine: '[sudo] password for raz: hunter2' }),
    false
  );
});

test('terminal command rejected when visibleLine null', () => {
  assert.strictEqual(policy().terminalCommandAllowed({ typed: 'ls', visibleLine: null }), false);
});

test('terminal command rejected when short typed text matches inside a password prompt', () => {
  assert.strictEqual(policy().terminalCommandAllowed({ typed: 'a', visibleLine: 'Password: ' }), false);
});

test('normalizeDomain keeps only the hostname of URL-shaped entries', () => {
  assert.strictEqual(normalizeDomain('https://myhealth.com/'), 'myhealth.com');
  assert.strictEqual(normalizeDomain('clinic.org/login'), 'clinic.org');
  assert.strictEqual(normalizeDomain('  WWW.Example.COM. '), 'example.com');
  assert.strictEqual(normalizeDomain('*.bank.ro'), 'bank.ro');
  assert.strictEqual(normalizeDomain('http://portal.clinic.org:8443/a?b=c'), 'portal.clinic.org');
  assert.strictEqual(normalizeDomain(''), null);
  assert.strictEqual(normalizeDomain('http://'), null);
});

test('user domain entries written as URLs or with www. still block', () => {
  const p = policy({ doNotWatchDomains: ['https://myhealth.com/', 'clinic.org/login', 'www.lab.example'] });
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://myhealth.com/records' }), false);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://www.myhealth.com/' }), false);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://clinic.org/' }), false);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://portal.clinic.org/x' }), false);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://lab.example/' }), false);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://www.lab.example/' }), false);
  assert.strictEqual(p.canWatch({ ...CHROME, url: 'https://notmyhealth.com/' }), true);
});

test('www. host matches a bare built-in entry', () => {
  assert.strictEqual(policy().canWatch({ ...CHROME, url: 'https://www.revolut.com/' }), false);
});

test('default domains block password managers and WhatsApp Web', () => {
  const p = policy();
  for (const u of ['https://web.whatsapp.com/', 'https://vault.bitwarden.com/#/vault', 'https://bitwarden.com/',
    'https://my.1password.com/', 'https://team.1password.com/', 'https://my.1password.eu/']) {
    assert.strictEqual(p.canWatch({ ...CHROME, url: u }), false, u);
  }
});

test('password prompt covers token / secret / API key / private key / passcode', () => {
  const p = policy();
  assert.strictEqual(p.terminalCommandAllowed({ typed: 's3cr3tvalue', visibleLine: 'Enter API token: s3cr3tvalue' }), false);
  assert.strictEqual(p.terminalCommandAllowed({ typed: 'abc123', visibleLine: 'Secret: abc123' }), false);
  for (const label of ['API key', 'api_key', 'Token', 'Client secret', 'Private key', 'Passcode']) {
    assert.strictEqual(p.typedTextAllowed({ isTerminal: false, secure: false, fieldLabel: label }), false, label);
  }
  assert.strictEqual(p.typedTextAllowed({ isTerminal: false, secure: false, fieldLabel: 'File name' }), true);
});

test('editorTextFieldAllowed only for a labelled, non-terminal text field', () => {
  assert.ok(EDITOR_BUNDLES.includes('com.microsoft.VSCode'));
  assert.ok(EDITOR_BUNDLES.includes('com.todesktop.230313mzl4w4u92'));
  assert.ok(EDITOR_BUNDLES.includes('dev.zed.Zed'));
  assert.strictEqual(editorTextFieldAllowed({ role: 'AXTextField', title: 'Search' }), true);
  assert.strictEqual(editorTextFieldAllowed({ role: 'AXTextArea', description: 'Editor content' }), true);
  assert.strictEqual(editorTextFieldAllowed({ role: 'AXTextArea', description: 'Terminal 1' }), false);
  assert.strictEqual(editorTextFieldAllowed({ role: 'AXTextArea', title: 'x', placeholder: 'terminal' }), false);
  assert.strictEqual(editorTextFieldAllowed({ role: 'AXTextArea', placeholder: 'Search' }), false);
  assert.strictEqual(editorTextFieldAllowed({ role: 'AXTextArea', title: '  ' }), false);
  assert.strictEqual(editorTextFieldAllowed({ role: 'AXGroup', title: 'Search' }), false);
  assert.strictEqual(editorTextFieldAllowed({}), false);
  assert.strictEqual(editorTextFieldAllowed(null), false);
});
