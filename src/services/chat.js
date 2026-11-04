// chat.js — talking with Mysthi: replies stream from the one local model; the conversation is kept, redacted
const { TEXT_MODEL } = require('../learning/config');
const { redact } = require('../learning/redact');
const { buildSystemPrompt } = require('./personality');

const HISTORY_KEY = 'mysthiChat'; // a fresh history: the old duck-era chat stays untouched until it's cleaned up
const MAX_STORED = 200;           // messages kept across sessions
const CONTEXT_MESSAGES = 16;      // most recent messages sent with each question
const MAX_REPLY_TOKENS = 600;
// Longest wait for the next piece of a reply. The first piece can take a while: the one local model answers
// one request at a time, and a note-making request already in progress has to finish first (up to ~2 min).
const SILENCE_TIMEOUT_MS = 300000;

// deps: { store: { get(key, fallback), set(key, value) }, stream: ollama.chatStream,
//         knowledgeFor: (text) => string, now: () => Date }
function createChat(deps) {
  const { store, stream, knowledgeFor = () => '', now = () => new Date() } = deps;

  const history = () => store.get(HISTORY_KEY, []);
  function remember(role, content) {
    // Nothing reaches disk unredacted, chat included
    const list = history();
    list.push({ role, content: redact(String(content)).text, at: now().getTime() });
    store.set(HISTORY_KEY, list.slice(-MAX_STORED));
  }

  // onToken(piece) as the reply arrives; resolves with the full reply text
  async function send(text, { onToken = () => {} } = {}) {
    const question = String(text || '').trim();
    if (!question) throw new Error('Empty message');
    const context = history().slice(-CONTEXT_MESSAGES).map(({ role, content }) => ({ role, content }));
    remember('user', question);
    let knowledge = '';
    try { knowledge = knowledgeFor(question) || ''; } catch { knowledge = ''; }
    const reply = await stream({
      model: TEXT_MODEL,
      think: false,
      messages: [
        { role: 'system', content: buildSystemPrompt({ now: now(), knowledge }) },
        ...context,
        { role: 'user', content: question },
      ],
      options: { num_predict: MAX_REPLY_TOKENS },
      timeoutMs: SILENCE_TIMEOUT_MS,
      onToken,
    });
    const clean = reply.trim();
    if (clean) remember('assistant', clean);
    return clean;
  }

  // What the chat window shows when it opens
  function recent(limit = 40) {
    return history().slice(-limit).map(({ role, content }) => ({ role, content }));
  }

  function clear() {
    store.set(HISTORY_KEY, []);
  }

  return { send, recent, clear };
}

module.exports = { createChat, HISTORY_KEY };
