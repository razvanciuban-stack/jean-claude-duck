// memory.js — persistent conversation memory for Jean Claude Van Damme
const fs = require('fs');
const path = require('path');
const Store = require('electron-store');

const store = new Store();
const MAX_MESSAGES = 200; // keep last 200 messages across sessions

function getHistory() {
  return store.get('conversationHistory', []);
}

function addMessage(role, content) {
  const history = getHistory();
  history.push({
    role,
    content,
    timestamp: Date.now(),
  });

  // Trim if too long
  if (history.length > MAX_MESSAGES) {
    history.splice(0, history.length - MAX_MESSAGES);
  }

  store.set('conversationHistory', history);
  return history;
}

function getRecentMessages(count = 20) {
  const history = getHistory();
  return history.slice(-count).map(({ role, content }) => ({ role, content }));
}

// Build a summary of key facts the user has shared
function getMemorySummary() {
  const history = getHistory();
  if (history.length === 0) return '';

  const totalMessages = history.length;
  const userMessages = history.filter(m => m.role === 'user');
  const firstChat = history[0]?.timestamp;
  const daysSinceFirst = firstChat ? Math.floor((Date.now() - firstChat) / 86400000) : 0;

  let summary = `You have had ${totalMessages} messages with this user over ${daysSinceFirst} day(s). `;
  summary += `They have sent ${userMessages.length} messages to you. `;

  // Extract recent topics (last 10 user messages)
  const recentTopics = userMessages.slice(-10).map(m => m.content);
  if (recentTopics.length > 0) {
    summary += `Recent topics they asked about: ${recentTopics.join(' | ')}`;
  }

  return summary;
}

function clearHistory() {
  store.set('conversationHistory', []);
}

module.exports = { addMessage, getRecentMessages, getMemorySummary, clearHistory, getHistory };
