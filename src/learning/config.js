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
};
