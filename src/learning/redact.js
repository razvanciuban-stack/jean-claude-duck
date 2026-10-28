// redact.js — single redaction layer: strips secrets/PII from text before anything is written to disk
// Rules run in order; later rules never touch earlier placeholders. Over-redaction beats leaking.

const PLACEHOLDER = /^\[[A-Z_]+\]$/u;
const QUOTED_OR_WORD = '"[^"\\n]*"|\'[^\'\\n]*\'|\\S+';

// Value text without its surrounding quotes
function unquote(v) {
  return /^(["']).*\1$/u.test(v) ? v.slice(1, -1) : v;
}

// Replacement value; JSON-style (quoted key) keeps the value's own quotes so the JSON stays well-formed
function maskValue(keyQuote, value, mask) {
  if (keyQuote && /^(["']).*\1$/u.test(value)) return `${value[0]}${mask}${value[0]}`;
  return mask;
}

function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function shannonEntropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const BENIGN_ENV = new Set(['NODE_ENV', 'PATH', 'PORT', 'HOME', 'USER', 'SHELL', 'LANG', 'TERM', 'PWD', 'EDITOR', 'TZ', 'CI']);

// Each rule: replace(match, ...groups) returns the new text, or undefined to leave the match alone.
const RULES = [
  // PEM private key blocks (multi-line)
  {
    kind: 'PRIVATE_KEY',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/gu,
    replace: () => '[PRIVATE_KEY]',
  },
  // Unterminated/truncated private key: redact from the header to the end
  {
    kind: 'PRIVATE_KEY',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*$/gu,
    replace: () => '[PRIVATE_KEY]',
  },
  // user:pass@ credentials inside connection strings (scheme://user:pass@host)
  {
    kind: 'SECRET',
    pattern: /(?<![\w+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s:@/]*:\S*@/giu, // greedy: up to the LAST @ (password may contain @ or /)
    replace: (m, scheme) => `${scheme}[SECRET]@`,
  },
  // password-style key=value / key: value / "key":"value" / "password is value" (value may be quoted)
  {
    kind: 'PASSWORD',
    pattern: new RegExp(`(pass(?:word|wd)?|pwd|parola)([\\w-]*)(["']?)(\\s*[=:]\\s*|\\s+(?:is|este)\\s+)(${QUOTED_OR_WORD})`, 'giu'),
    replace: (m, key, rest, kq, sep, value) => {
      if (key === 'PWD' && !rest && !kq) return undefined; // $PWD env var is benign (allowlisted)
      if (PLACEHOLDER.test(unquote(value))) return undefined;
      return `${key}${rest}${kq}${sep}${maskValue(kq, value, '[PASSWORD]')}`;
    },
  },
  // CLI password flags: mysql -pSECRET, curl --password SECRET / --password=SECRET
  {
    kind: 'PASSWORD',
    pattern: /\b((?:mysql|mysqldump|mariadb)\b[^\n]*?\s)-p(?=\S)(\S+)/giu,
    replace: (m, head, value) => (PLACEHOLDER.test(value) ? undefined : `${head}-p[PASSWORD]`),
  },
  {
    kind: 'PASSWORD',
    pattern: /(--(?:password|passwd|pass|pwd))(=|\s+)(\S+)/giu,
    replace: (m, flag, sep, value) => (PLACEHOLDER.test(unquote(value)) ? undefined : `${flag}${sep}[PASSWORD]`),
  },
  // OpenAI/Anthropic-style sk- keys, Stripe sk_live_, Slack xox tokens, Google AIza keys
  {
    kind: 'API_KEY',
    pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|[sr]k_(?:live|test)_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/gu,
    replace: () => '[API_KEY]',
  },
  // GitHub tokens
  {
    kind: 'API_KEY',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/gu,
    replace: () => '[API_KEY]',
  },
  // AWS access key ids
  {
    kind: 'API_KEY',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
    replace: () => '[API_KEY]',
  },
  // JWTs
  {
    kind: 'API_KEY',
    pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/gu,
    replace: () => '[API_KEY]',
  },
  // Authorization schemes: Bearer / Basic / Token <credential> (Basic/Token need a digit or base64 char to skip plain English)
  {
    kind: 'API_KEY',
    pattern: /\b(Bearer|Basic|Token)(\s+)(?=[A-Za-z0-9._~+/=-]*[\d=+/.])[A-Za-z0-9._~+/=-]{8,}/giu,
    replace: (m, scheme, ws) => `${scheme}${ws}[API_KEY]`,
  },
  // secret-bearing NAME=value / "name": "value" (token, secret, key, auth, credential), JSON keys included
  // Note: "token"/"secret" are deliberately [SECRET] here, not [PASSWORD].
  {
    kind: 'SECRET',
    pattern: new RegExp(`(?<![\\w.-])([\\w.-]*(?:secret|token|auth|credential|key))(["']?)(\\s*[=:]\\s*)(${QUOTED_OR_WORD})`, 'giu'),
    replace: (m, name, kq, sep, value) => (PLACEHOLDER.test(unquote(value)) ? undefined : `${name}${kq}${sep}${maskValue(kq, value, '[SECRET]')}`),
  },
  // Line-anchored .env lines: any UPPER_SNAKE=value is a secret unless the key is a benign allowlisted one
  {
    kind: 'SECRET',
    pattern: new RegExp(`^([ \\t]*(?:export[ \\t]+)?)([A-Z][A-Z0-9_]*)(=)(${QUOTED_OR_WORD})`, 'gmu'),
    replace: (m, head, name, eq, value) => (BENIGN_ENV.has(name) || PLACEHOLDER.test(unquote(value)) ? undefined : `${head}${name}${eq}[SECRET]`),
  },
  // IBAN (compact or space-grouped)
  {
    kind: 'IBAN',
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/giu,
    replace: () => '[IBAN]',
  },
  // Payment cards: 13-19 digits, optional space/dash grouping, Luhn-valid only
  {
    kind: 'CARD',
    pattern: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/gu,
    replace: (m) => {
      const digits = m.replace(/\D/gu, '');
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? '[CARD]' : undefined;
    },
  },
  // IPv4 (every octet <= 255)
  {
    kind: 'IP',
    pattern: /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w]|\.\d)/gu,
    replace: () => '[IP]',
  },
  // IPv6 (full or :: compressed)
  {
    kind: 'IP',
    pattern: /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|::[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})(?![\w:])/giu,
    replace: () => '[IP]',
  },
  // International phone numbers (+CC ...)
  {
    kind: 'PHONE',
    pattern: /(?<![\w+])\+\d[\d ().-]{6,16}\d(?!\d)/gu,
    replace: () => '[PHONE]',
  },
  // National 10-digit numbers starting with 0 (e.g. 0721 234 567)
  {
    kind: 'PHONE',
    pattern: /(?<![\w.-])0\d{2,3}[ .-]?\d{3}[ .-]?\d{3,4}(?![\w-])/gu,
    replace: () => '[PHONE]',
  },
  // Long hex runs (SHA-256, hex keys, git SHAs) that mix letters and digits
  {
    kind: 'API_KEY',
    pattern: /(?<![\w])[0-9a-f]{32,}(?![\w])/giu,
    replace: (m) => (/\d/u.test(m) && /[a-f]/iu.test(m) ? '[API_KEY]' : undefined),
  },
  // Anything long, token-shaped and high-entropy is treated as a key
  {
    kind: 'API_KEY',
    pattern: /[A-Za-z0-9+/=_-]{32,}/gu,
    replace: (m) => (shannonEntropy(m) > 4.0 ? '[API_KEY]' : undefined),
  },
];

function redact(input) {
  if (typeof input !== 'string') return { text: input == null ? '' : String(input), kinds: [] };
  let text = input;
  const kinds = [];
  for (const rule of RULES) {
    let hit = false;
    text = text.replace(rule.pattern, (...args) => {
      const out = rule.replace(...args);
      if (out === undefined) return args[0];
      hit = true;
      return out;
    });
    if (hit && !kinds.includes(rule.kind)) kinds.push(rule.kind);
  }
  return { text, kinds };
}

function redactDeep(value) {
  if (typeof value === 'string') return redact(value).text;
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}

module.exports = { redact, redactDeep };
