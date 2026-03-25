// obsidian-brain.js — reads the Obsidian vault to give JCVD knowledge
const fs = require('fs');
const path = require('path');

const VAULT_PATH = '/Users/ciubanrazvan/ObsidianVault';
const FOLDERS = ['decisions', 'lessons', 'patterns', 'projects'];

let brainCache = null;
let lastCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // refresh every 5 minutes

function readMarkdownFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Extract title from first # heading or filename
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : path.basename(filePath, '.md');

    // Extract the core content (skip frontmatter if any)
    let body = content
      .replace(/^---[\s\S]*?---\n*/m, '') // remove frontmatter
      .replace(/^#\s+.+\n*/m, '')          // remove title heading
      .trim();

    // Keep it concise — first 200 chars
    if (body.length > 200) {
      body = body.substring(0, 200) + '...';
    }

    return { title, body };
  } catch {
    return null;
  }
}

function loadBrain() {
  const now = Date.now();
  if (brainCache && (now - lastCacheTime) < CACHE_TTL) {
    return brainCache;
  }

  const brain = {};

  for (const folder of FOLDERS) {
    const folderPath = path.join(VAULT_PATH, folder);
    if (!fs.existsSync(folderPath)) continue;

    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.md'));
    brain[folder] = files.map(f => {
      const entry = readMarkdownFile(path.join(folderPath, f));
      return entry;
    }).filter(Boolean);
  }

  brainCache = brain;
  lastCacheTime = now;
  return brain;
}

// Build a compact knowledge summary for the system prompt
function getBrainSummary() {
  const brain = loadBrain();
  const sections = [];

  if (brain.decisions?.length) {
    const items = brain.decisions.map(d => `- ${d.title}`).join('\n');
    sections.push(`DECISIONS (tech choices the user made):\n${items}`);
  }

  if (brain.lessons?.length) {
    const items = brain.lessons.map(l => `- ${l.title}`).join('\n');
    sections.push(`LESSONS (things the user learned):\n${items}`);
  }

  if (brain.patterns?.length) {
    const items = brain.patterns.map(p => `- ${p.title}`).join('\n');
    sections.push(`PATTERNS (code patterns the user uses):\n${items}`);
  }

  if (brain.projects?.length) {
    const items = brain.projects.map(p => `- ${p.title}`).join('\n');
    sections.push(`PROJECTS:\n${items}`);
  }

  if (sections.length === 0) return '';

  return '\n\nYour knowledge from the user\'s Obsidian brain:\n' + sections.join('\n\n');
}

// Search for specific knowledge when user asks about a topic
function searchBrain(query) {
  const brain = loadBrain();
  const lower = query.toLowerCase();
  const results = [];

  for (const folder of FOLDERS) {
    if (!brain[folder]) continue;
    for (const entry of brain[folder]) {
      if (entry.title.toLowerCase().includes(lower) ||
          entry.body.toLowerCase().includes(lower)) {
        results.push({ folder, ...entry });
      }
    }
  }

  return results;
}

// Get detailed content for relevant entries based on user message
function getRelevantKnowledge(userMessage) {
  const words = userMessage.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const brain = loadBrain();
  const matches = [];

  for (const folder of FOLDERS) {
    if (!brain[folder]) continue;
    for (const entry of brain[folder]) {
      const entryText = (entry.title + ' ' + entry.body).toLowerCase();
      const relevance = words.filter(w => entryText.includes(w)).length;
      if (relevance > 0) {
        matches.push({ folder, relevance, ...entry });
      }
    }
  }

  // Return top 3 most relevant
  matches.sort((a, b) => b.relevance - a.relevance);
  const top = matches.slice(0, 3);

  if (top.length === 0) return '';

  const details = top.map(m => `[${m.folder}] ${m.title}: ${m.body}`).join('\n');
  return `\n\nRelevant knowledge from user's brain:\n${details}`;
}

module.exports = { getBrainSummary, searchBrain, getRelevantKnowledge, loadBrain };
