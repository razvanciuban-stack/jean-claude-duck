// Ollama-powered AI for Jean Claude Van Damme with persistent memory + Obsidian brain
const { chat } = require('./ollama');
const memory = require('./memory');
const { getRelevantKnowledge } = require('./obsidian-brain');

function init() {
  // Load existing history on start
  console.log(`[JCVD] Memory loaded: ${memory.getHistory().length} messages`);
}

async function validateKey() {
  return { valid: true };
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
    const content = await chat({
      model: 'llama3.1:8b',
      messages: [
        { role: 'system', content: fullPrompt },
        ...recentMessages,
      ],
      options: {
        temperature: 0.7,
        num_predict: 300,
      },
    });

    // Clean up response
    let text = (content || "Let me think about that...")
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
