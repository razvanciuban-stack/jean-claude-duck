// config.js — constants for the Mysthi learning agent
const os = require('os');
const path = require('path');

module.exports = {
  VISION_MODEL: 'qwen3-vl:8b-instruct', // the instruct edition answers directly; the plain 8b tag is the thinking edition
  TEXT_MODEL: 'qwen3-vl:8b-instruct',
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
  // Longest answer a learning call may write: a task list, a merged lesson or a few facts fit easily;
  // anything longer is a runaway reply and is cut off in seconds instead of running into the timeout
  LEARNING_MAX_TOKENS: 4096,
  VISION_TIMEOUT_MS: 60000,
  // Days of screen journal kept on disk (store key journalRetentionDays overrides it)
  JOURNAL_RETENTION_DAYS: 30,
};
