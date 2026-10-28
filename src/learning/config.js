// config.js — constants for the Mysthi learning agent
const os = require('os');
const path = require('path');

module.exports = {
  VISION_MODEL: 'qwen2.5vl:7b',
  TEXT_MODEL: 'qwen2.5vl:7b',
  VAULT_DIR: path.join(os.homedir(), 'ObsidianVault', 'mysthi'),
  IDLE_THRESHOLD_MS: 180000,
  CONFIDENT_AT: 3,
  VISION_QUEUE_CAP: 20,
  VISION_MIN_INTERVAL_MS: 5000,
  SEGMENT_GAP_MS: 180000,
  WEEK_MS: 604800000,
  // Learning calls run on a local model while the user is idle: allow slow answers, and a context big
  // enough for a 120-step listing so nothing is truncated silently.
  LEARNING_TIMEOUT_MS: 240000,
  LEARNING_NUM_CTX: 16384,
  VISION_TIMEOUT_MS: 60000,
};
