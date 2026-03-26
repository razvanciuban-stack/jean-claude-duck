// sound.js — plays real duck quack sound
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const QUACK_PATH = path.join(__dirname, '..', '..', 'assets', 'quack.mp3');

function ensureQuackSound() {
  if (!fs.existsSync(QUACK_PATH)) {
    console.warn('sound.js: quack.mp3 not found in assets/');
  }
}

function playQuack() {
  if (!fs.existsSync(QUACK_PATH)) return;
  try {
    // Slight speed variation for natural feel
    const rate = 0.9 + Math.random() * 0.2;
    exec(`afplay -r ${rate.toFixed(2)} "${QUACK_PATH}"`);
  } catch {
    // silent fail
  }
}

module.exports = { ensureQuackSound, playQuack };
