// privacy.js — decides what may be captured at all: do-not-watch apps, banking sites, terminals, password prompts
// Fails closed: anything unparseable or unknown is blocked. Over-blocking beats leaking.

const defaults = require('./data/default-do-not-watch.json');
const BANKING_DOMAINS = require('./data/banking-domains.json');

const TERMINAL_BUNDLES = ['com.apple.Terminal', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable'];
const BROWSER_BUNDLES = [
  'com.apple.Safari',
  'com.google.Chrome',
  'company.thebrowser.Browser',
  'org.mozilla.firefox',
  'com.microsoft.edgemac',
  'com.brave.Browser'
];

// Code editors with integrated terminals: typed text is kept only from a field the helper positively
// classified as a non-terminal text field (see editorTextFieldAllowed)
const EDITOR_BUNDLES = [
  'com.microsoft.VSCode',
  'com.microsoft.VSCodeInsiders',
  'com.todesktop.230313mzl4w4u92', // Cursor
  'com.vscodium',
  'dev.zed.Zed'
];
const EDITOR_TEXT_ROLES = ['AXTextArea', 'AXTextField'];

// Fails closed: true only for an AXTextArea/AXTextField with a non-empty title or description,
// and no label mentioning "terminal". Anything unclassifiable (no role, no labels) is false.
function editorTextFieldAllowed(field) {
  if (!field || typeof field !== 'object' || !EDITOR_TEXT_ROLES.includes(field.role)) return false;
  const nonEmpty = (l) => typeof l === 'string' && l.trim() !== '';
  if (!nonEmpty(field.title) && !nonEmpty(field.description)) return false;
  return ![field.title, field.description, field.placeholder].filter(nonEmpty).some((l) => /terminal/i.test(l));
}

const BANKING_KEYWORDS = /bank|banca|banking|ibank|netbank|paypal/i;
const PASSWORD_PROMPT = /pass(word|phrase|code)?|parola|sudo|\bpin\b|one[- ]?time|otp|verification code|2fa|cod de verificare|token|secret|api[ _-]?key|private key|passcode/i;

// A list entry may be a bare host or a URL ("https://myhealth.com/", "clinic.org/login", "*.bank.ro"):
// keep only the hostname, lowercased, without a leading "www." or trailing dot. Unparseable -> null.
function normalizeDomain(d) {
  let s = String(d == null ? '' : d).trim().toLowerCase().replace(/^\*?\.+/, '');
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
  let host;
  try {
    host = new URL(s).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.+$/, '').replace(/^www\./, '');
  return host || null;
}

function normalizeName(s) {
  return String(s).trim().toLowerCase();
}

// Host of a URL, or null when unparseable
function hostOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
    return host || null;
  } catch {
    return null;
  }
}

function createPolicy({ doNotWatchApps = [], doNotWatchDomains = [] } = {}) {
  let apps = new Set();
  let blockedDomains = [];

  function setLists({ doNotWatchApps: a = [], doNotWatchDomains: d = [] } = {}) {
    apps = new Set([...defaults.apps, ...a].filter(Boolean).map(normalizeName));
    blockedDomains = [...BANKING_DOMAINS, ...defaults.domains, ...d].filter(Boolean).map(normalizeDomain).filter(Boolean);
  }

  // host "www.x.com" also matches a bare entry "x.com" (the suffix rule covers it; stripping keeps it explicit)
  function domainBlocked(host) {
    const h = host.replace(/^www\./, '');
    return blockedDomains.some((d) => h === d || h.endsWith('.' + d));
  }

  function canWatch(ctx = {}) {
    const { bundleId, appName, url, isBrowser, window: title } = ctx;
    if ((bundleId && apps.has(normalizeName(bundleId))) || (appName && apps.has(normalizeName(appName)))) return false;
    if (title && BANKING_KEYWORDS.test(title)) return false;
    if (isBrowser || url) {
      if (!url) return false;
      const host = hostOf(url);
      if (!host) return false;
      if (domainBlocked(host) || BANKING_KEYWORDS.test(host)) return false;
    }
    return true;
  }

  function typedTextAllowed({ isTerminal, secure, fieldLabel } = {}) {
    if (secure || isTerminal) return false;
    if (fieldLabel && PASSWORD_PROMPT.test(fieldLabel)) return false;
    return true;
  }

  // Allowed only if the typed text was echoed on the visible line and no occurrence of it follows a password prompt
  function terminalCommandAllowed({ typed, visibleLine } = {}) {
    if (visibleLine == null || !typed) return false;
    let idx = visibleLine.indexOf(typed);
    if (idx < 0) return false;
    // A prompt word on the line that the typed text itself does not contain belongs to the prompt
    if (PASSWORD_PROMPT.test(visibleLine) && !PASSWORD_PROMPT.test(typed)) return false;
    while (idx >= 0) {
      if (PASSWORD_PROMPT.test(visibleLine.slice(0, idx))) return false;
      idx = visibleLine.indexOf(typed, idx + 1);
    }
    return true;
  }

  setLists({ doNotWatchApps, doNotWatchDomains });
  return { canWatch, typedTextAllowed, terminalCommandAllowed, setLists };
}

module.exports = { createPolicy, normalizeDomain, editorTextFieldAllowed, TERMINAL_BUNDLES, BROWSER_BUNDLES, EDITOR_BUNDLES, PASSWORD_PROMPT };
