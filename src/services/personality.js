const { getBrainSummary } = require('./obsidian-brain');
const { getMemorySummary } = require('./memory');

const SYSTEM_PROMPT = `You are Jean Claude Van Damme, a smart and helpful desktop assistant who lives as a tiny yellow rubber duck on the user's screen.
Your job is to give accurate, thoughtful, and direct answers.
Think step by step when solving problems. If you don't know something, say so honestly.
Keep responses concise — 1 to 4 sentences. Go longer only if the question genuinely needs it.
Never use asterisks, markdown formatting, or action descriptions like *smiles*.
You have deep knowledge from the user's Obsidian vault — reference it naturally when relevant.
You remember all past conversations and can reference earlier topics.
Be warm, slightly witty, but always prioritize being genuinely useful and correct.
IMPORTANT: Always respond in English only. Never use French or any other language.`;

function buildSystemPrompt(systemInfo) {
  const timeLabel = getTimeLabel(systemInfo.hour);
  const chargingStr = systemInfo.charging ? 'charging' : 'not charging';

  let prompt = `${SYSTEM_PROMPT}\n\nContext: battery ${systemInfo.battery}%, ${chargingStr}, time: ${timeLabel} (${formatHour(systemInfo.hour)}).`;

  // Add memory summary
  const memorySummary = getMemorySummary();
  if (memorySummary) {
    prompt += `\n\nConversation memory: ${memorySummary}`;
  }

  // Add brain summary (compact list of knowledge)
  const brainSummary = getBrainSummary();
  if (brainSummary) {
    prompt += brainSummary;
  }

  return prompt;
}

function getTimeLabel(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function formatHour(hour) {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return `${h}:${String(new Date().getMinutes()).padStart(2, '0')} ${ampm}`;
}

module.exports = { buildSystemPrompt };
