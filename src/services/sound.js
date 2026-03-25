// sound.js — generates and plays a quack sound using macOS say/afplay
const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const QUACK_PATH = path.join(__dirname, '..', '..', 'assets', 'quack.aiff');

function ensureQuackSound() {
  const assetsDir = path.join(__dirname, '..', '..', 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  if (!fs.existsSync(QUACK_PATH)) {
    // Generate a quack sound using say command with a duck-like voice
    try {
      execSync(`say -v Cellos "quack" -o "${QUACK_PATH}"`);
    } catch {
      try {
        // Fallback: use any available voice with a fast rate
        execSync(`say -v Alex "quack" -o "${QUACK_PATH}" --rate=300`);
      } catch {
        console.error('sound.js: could not generate quack sound');
      }
    }
  }
}

function playQuack() {
  if (!fs.existsSync(QUACK_PATH)) {
    // Last resort: just use say directly
    exec('say -v Cellos "quack"');
    return;
  }

  try {
    exec(`afplay "${QUACK_PATH}"`);
  } catch {
    // silent fail
  }
}

module.exports = { ensureQuackSound, playQuack };
