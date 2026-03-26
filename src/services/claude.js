// Ollama-powered AI for Jean Claude Van Damme with persistent memory + Obsidian brain
const http = require('http');
const memory = require('./memory');
const { getRelevantKnowledge } = require('./obsidian-brain');

function init() {
  // Load existing history on start
  console.log(`[JCVD] Memory loaded: ${memory.getHistory().length} messages`);
}

async function validateKey() {
  return { valid: true };
}

function ollamaRequest(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/chat',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          const lines = body.trim().split('\n');
          let fullText = '';
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.message && obj.message.content) {
                fullText += obj.message.content;
              }
            } catch {}
          }
          resolve({ message: { content: fullText || 'Let me think about that...' } });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timeout')); });
    req.write(data);
    req.end();
  });
}

async function sendMessage(userMessage, systemPrompt) {
  // Save user message to persistent memory
  memory.addMessage('user', userMessage);

  // Get relevant Obsidian knowledge for this specific question
  const relevantKnowledge = getRelevantKnowledge(userMessage);

  // Build full system prompt with relevant knowledge injected
  let fullPrompt = systemPrompt;
  if (relevantKnowledge) {
    fullPrompt += relevantKnowledge;
  }

  // Get recent conversation for context (last 20 messages)
  const recentMessages = memory.getRecentMessages(20);

  try {
    const response = await ollamaRequest({
      model: 'llama3.1:8b',
      messages: [
        { role: 'system', content: fullPrompt },
        ...recentMessages,
      ],
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 300,
      },
    });

    // Clean up response
    let text = (response.message?.content || "Let me think about that...")
      .replace(/\*[^*]+\*/g, '')
      .replace(/[#*_~`]/g, '')
      .replace(/\n{2,}/g, '\n')
      .trim() || "Let me think about that...";

    // Save assistant response to persistent memory
    memory.addMessage('assistant', text);

    return { text };
  } catch (err) {
    console.error('Ollama error:', err.message);
    return { text: getFallbackResponse(userMessage) };
  }
}

function getFallbackResponse(msg) {
  const fallbacks = [
    "My brain is warming up, try again in a moment!",
    "Ollama seems to be napping. Give it a second!",
    "Connection hiccup. Try again!",
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

module.exports = { init, validateKey, sendMessage };
