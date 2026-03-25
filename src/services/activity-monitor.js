// activity-monitor.js — watches what the user is doing on their Mac
const { exec } = require('child_process');
const EventEmitter = require('events');
const os = require('os');
const path = require('path');

class ActivityMonitor extends EventEmitter {
  constructor() {
    super();
    this.currentApp = null;
    this.lastAppChangeTime = Date.now();
    this.lastReactionTime = 0;
    this.lastCommitTimestamp = null;
    this.appCheckInterval = null;
    this.idleCheckInterval = null;
    this.gitCheckInterval = null;
    this.timeCheckInterval = null;
    this.running = false;

    // Minimum 30 seconds between reactions
    this.reactionCooldown = 30000;
  }

  start() {
    if (this.running) return;
    this.running = true;

    // Check active app every 5 seconds
    this.appCheckInterval = setInterval(() => this._checkActiveApp(), 5000);

    // Check idle every 30 seconds
    this.idleCheckInterval = setInterval(() => this._checkIdle(), 30000);

    // Check git every 15 seconds
    this.gitCheckInterval = setInterval(() => this._checkGit(), 15000);

    // Check time every 30 minutes
    this.timeCheckInterval = setInterval(() => this._checkTime(), 30 * 60 * 1000);

    // Initial checks
    this._checkActiveApp();
    this._checkGit();

    // First time-based reaction after 2 minutes
    setTimeout(() => this._checkTime(), 120000);
  }

  stop() {
    this.running = false;
    if (this.appCheckInterval) clearInterval(this.appCheckInterval);
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
    if (this.gitCheckInterval) clearInterval(this.gitCheckInterval);
    if (this.timeCheckInterval) clearInterval(this.timeCheckInterval);
  }

  _canReact() {
    return Date.now() - this.lastReactionTime >= this.reactionCooldown;
  }

  _emitReaction(text) {
    if (!this._canReact()) return;
    this.lastReactionTime = Date.now();
    this.emit('reaction', { text });
  }

  _checkActiveApp() {
    const cmd = `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`;
    exec(cmd, { timeout: 3000 }, (err, stdout) => {
      if (err) return;
      const appName = stdout.trim();
      if (!appName) return;

      if (appName !== this.currentApp) {
        const previousApp = this.currentApp;
        this.currentApp = appName;
        this.lastAppChangeTime = Date.now();
        this.emit('activity:app-changed', { app: appName, previous: previousApp });
        this._reactToApp(appName);
      }
    });
  }

  _reactToApp(appName) {
    const name = appName.toLowerCase();
    let pool = null;

    if (['terminal', 'iterm2', 'iterm', 'warp'].some(t => name.includes(t))) {
      pool = ['💻 hacking away!', '⌨️ terminal time!', '🐛 debugging?'];
    } else if (['visual studio code', 'code', 'cursor', 'zed'].some(t => name.includes(t))) {
      pool = ['👨‍💻 coding mode!', '📝 writing code!', '🔧 building stuff!'];
    } else if (['google chrome', 'chrome', 'safari', 'firefox', 'arc'].some(t => name.includes(t))) {
      pool = ['🌐 surfing the web!', '🔍 researching?', '📖 reading time!'];
    } else if (['slack', 'discord', 'messages'].some(t => name.includes(t))) {
      pool = ['💬 chatting!', '🗣️ socializing!'];
    } else if (['spotify', 'music', 'apple music'].some(t => name.includes(t))) {
      pool = ['🎵 vibing!', '🎶 good taste!'];
    } else if (name === 'finder') {
      pool = ['📁 organizing!', '🗂️ finding stuff!'];
    } else if (name === 'claude') {
      pool = ['🤖 talking to my cousin!', '🧠 AI time!'];
    } else if (['preview', 'photos'].some(t => name.includes(t))) {
      pool = ['📸 looking at pics!'];
    }

    if (pool) {
      const text = pool[Math.floor(Math.random() * pool.length)];
      this._emitReaction(text);
    }
  }

  _checkIdle() {
    const timeSinceChange = Date.now() - this.lastAppChangeTime;
    if (timeSinceChange >= 2 * 60 * 1000) {
      const pool = ['😴 zzz...', '💤 still there?', '☕ coffee break?', '🫠 hello?'];
      const text = pool[Math.floor(Math.random() * pool.length)];
      this._emitReaction(text);
    }
  }

  _checkGit() {
    const homeDir = os.homedir();
    const cmd = `git -C "${homeDir}" log -1 --format=%ct 2>/dev/null`;
    exec(cmd, { timeout: 3000 }, (err, stdout) => {
      if (err) return;
      const timestamp = stdout.trim();
      if (!timestamp) return;

      if (this.lastCommitTimestamp === null) {
        // First check — just record, don't react
        this.lastCommitTimestamp = timestamp;
        return;
      }

      if (timestamp !== this.lastCommitTimestamp) {
        this.lastCommitTimestamp = timestamp;
        this.emit('activity:git-commit');
        const pool = ['🎉 nice commit!', '✅ shipped it!', '🚀 deploying?'];
        const text = pool[Math.floor(Math.random() * pool.length)];
        this._emitReaction(text);
      }
    });
  }

  _checkTime() {
    const hour = new Date().getHours();
    let pool = null;

    if (hour < 9) {
      pool = ['🌅 early bird!', '☕ morning!'];
    } else if (hour >= 23) {
      pool = ['🌙 night owl!', '😴 bedtime?'];
    } else if (hour >= 12 && hour < 13) {
      pool = ['🍕 lunch break?'];
    }

    if (pool) {
      const text = pool[Math.floor(Math.random() * pool.length)];
      this._emitReaction(text);
    }
  }
}

module.exports = new ActivityMonitor();
