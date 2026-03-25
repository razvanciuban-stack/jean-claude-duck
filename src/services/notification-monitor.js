// notification-monitor.js — watches macOS notifications via log stream
const { spawn } = require('child_process');
const EventEmitter = require('events');

class NotificationMonitor extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.running = false;
    this.lastNotificationTime = 0;
    this.debounceCooldown = 3000; // 3 seconds between triggers
  }

  start() {
    if (this.running) return;
    this.running = true;

    try {
      this.proc = spawn('log', [
        'stream',
        '--predicate',
        'eventMessage CONTAINS "userNotificationCenter" OR eventMessage CONTAINS "didReceiveNotification" OR subsystem == "com.apple.UNUserNotificationCenter"',
        '--style',
        'compact',
      ]);

      this.proc.stdout.on('data', (data) => {
        const text = data.toString();
        // Skip the initial "Filtering the log data" header line
        if (text.includes('Filtering the log data')) return;

        const now = Date.now();
        if (now - this.lastNotificationTime < this.debounceCooldown) return;

        this.lastNotificationTime = now;
        this.emit('notification');
      });

      this.proc.stderr.on('data', () => {
        // Ignore stderr noise from log stream
      });

      this.proc.on('error', (err) => {
        console.error('NotificationMonitor: failed to start log stream', err.message);
        this.running = false;
      });

      this.proc.on('close', () => {
        this.running = false;
        this.proc = null;
      });
    } catch (err) {
      console.error('NotificationMonitor: could not spawn log stream', err.message);
      this.running = false;
    }
  }

  stop() {
    this.running = false;
    if (this.proc) {
      try {
        this.proc.kill('SIGTERM');
      } catch {
        // already dead
      }
      this.proc = null;
    }
  }
}

module.exports = new NotificationMonitor();
