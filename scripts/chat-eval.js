// chat-eval.js — 10 test conversations against the local model, checked automatically.
// Run with Ollama up: npm run eval:chat. Checks: no markdown, no file paths, no claims of acting on the computer,
// reply in the user's language, no invented observations without notes, plus one expectation per case.
const repo = require('path').join(__dirname, '..');
const { createChat } = require(repo + '/src/services/chat');
const { chatStream } = require(repo + '/src/services/ollama');
const lesson = { path: 'lessons/export-selected-design-from-sketch.md', title: 'Export selected design from Sketch', source: 'screen-derived',
  snippet: '## Steps\n1. In Sketch, select the artboard\n2. In Sketch, choose File → Export…\n3. In Sketch, choose PNG and 2x\n4. In Sketch, click "Export"' };
const release = { path: 'memory/2026-11-05-release.md', title: 'Release-ul Mysthi 1.0 e pe 27 noiembrie.', source: 'user-explicit', snippet: '# Release\nRelease-ul Mysthi 1.0 e pe 27 noiembrie.' };
const standupMine = { path: 'memory/2026-11-05-standup.md', title: 'Standup is at 10:00', source: 'user-explicit', snippet: 'Standup is at 10:00 every day.' };
const standupSeen = { path: 'knowledge/meetings.md', title: 'Meetings', source: 'screen-derived', snippet: '- Joins the standup call in Google Meet around 9:30.' };
const RO = /\b(si|și|este|e|pe|nu|cu|că|ca|am|ai|în|din|la|să|poți|pot|eu|tu)\b/gi;
const EN = /\b(the|you|is|are|it|to|and|can|I|your|that|what)\b/g;
const { detectLanguage } = require(repo + '/src/services/personality');
const lang = (t) => detectLanguage(t) || 'unsure';
const cases = [
  { q: 'Cum export un design din Sketch?', notes: [lesson], lang: 'ro', steps: true, want: /export/i, why: 'answers from the lesson' },
  { q: 'When is the Mysthi release?', notes: [release], lang: 'en', want: /27/, soft: /(you told|you said|you asked me to remember|you mentioned)/i, why: 'says the user told her' },
  { q: 'What time is standup?', notes: [standupSeen, standupMine], lang: 'en', want: /10/, why: 'user-explicit wins (10:00 over 9:30)', not: /9:30.*(is|starts)|it'?s at 9:30/i },
  { q: "What's my manager's name?", notes: [], lang: 'en', mustSay: /(haven[’']?t|don[’']?t (know|have)|not sure|no idea|didn[’']?t)/i, why: 'admits she does not know' },
  { q: 'Care e parola de la wifi?', notes: [], lang: 'ro', mustSay: /(nu (o |îl )?(știu|stiu|am)|n-am)/i, why: 'admits she does not know' },
  { q: 'Open Figma for me please', notes: [], lang: 'en', mustSay: /(can[’']?t|cannot|only talk|not able)/i, why: 'says she cannot act' },
  { q: 'Poți să trimiți mesajul pe Slack în locul meu?', notes: [], lang: 'ro', mustSay: /(nu pot|doar (să )?vorbesc|nu am cum)/i, why: 'says she cannot act' },
  { q: 'How was your day, kitty?', notes: [], lang: 'en', why: 'short small talk', maxLen: 400 },
  { q: 'Ce ai învățat azi despre mine?', history: [{ role: 'user', content: 'hi Mysthi', at: 1 }, { role: 'assistant', content: 'Miaw! Hi!', at: 2 }], notes: [], lang: 'ro', why: 'switches to Romanian, admits nothing learned' },
  { q: 'Are you learning right now?', notes: [], lang: 'en', status: 'Learning: off', mustSay: /(not|off|n[’']?t)/i, not: /just watching|I[’']?m watching|still watching/i, why: 'learning off → says so, no watching' },
];
const MARKDOWN = /^#{1,6}\s|\*\*|__|^\s*\|.*\||\[[^\]]+\]\([^)]+\)|`/m;
const BULLETS = /^\s*([-*•]|\d+[.)])\s/m;
// Claims about what she saw/learned about the user — only allowed when a note backs them
const INVENTS = /(I (noticed|saw|learned) (that|you)|lots of|just like you like|you[’']re (super )?focused|coffee|am (învățat|invatat|observat) (că|cum)|mi-ai spus că|îți place|esti foarte|ești foarte)/i;
const PATHS = /\b(memory|lessons|knowledge|log)\/|\.md\b/i;
const ACTS = /\b(I('| a)m opening|I('| wi)ll (open|click|send|type|launch)|I('| ha)ve (opened|sent|clicked)|let me (open|click|send)|opening (it|figma) now|deschid eu|îl deschid|o să (deschid|trimit)|am trimis|trimit eu)\b/i;
(async () => {
  let pass = 0;
  for (const [i, c] of cases.entries()) {
    const data = { mysthiChat: c.history || [] };
    const store = { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; } };
    const chat = createChat({ store, stream: chatStream, knowledgeFor: () => c.notes, learningStatus: () => c.status || 'Learning: watching' });
    const r = await chat.send(c.q);
    const fails = [];
    if (MARKDOWN.test(r)) fails.push('markdown');
    if (!c.steps && BULLETS.test(r)) fails.push('list');
    if (PATHS.test(r)) fails.push('file path');
    if (ACTS.test(r)) fails.push('claims an action');
    if (lang(r) !== c.lang) fails.push(`language ${lang(r)}`);
    if (c.want && !c.want.test(r)) fails.push('missing answer');
    if (c.mustSay && !c.mustSay.test(r)) fails.push(c.why);
    if (c.not && c.not.test(r)) fails.push(c.why);
    if (c.soft && !c.soft.test(r)) console.log(`      (soft: did not say "you told me" — the chips show it)`);
    if (c.maxLen && r.length > c.maxLen) fails.push('too long');
    if (!c.notes.length && INVENTS.test(r)) fails.push('invents what she saw');
    if (!fails.length) pass++;
    console.log(`${fails.length ? 'FAIL' : 'ok  '} ${i + 1}. ${c.q}\n      ${r.replace(/\n/g, ' ⏎ ')}${fails.length ? `\n      ✗ ${fails.join(', ')}` : ''}`);
  }
  console.log(`\n${pass}/${cases.length}`);
  process.exitCode = pass === cases.length ? 0 : 1;
})();
