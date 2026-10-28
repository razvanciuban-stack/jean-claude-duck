// helper-client.js — spawns the native mysthi-helper and relays its JSON lines as 'event's
// Never logs raw lines or parsed events: they contain unredacted captured text.

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

class HelperClient extends EventEmitter {
  constructor(binPath) {
    super();
    this.binPath = binPath;
    this.child = null;
    this.stopped = false;
    this.restarts = 0;
    this.buffer = '';
  }

  start() {
    this.stopped = false;
    this._spawn();
  }

  _spawn() {
    let child;
    try {
      child = spawn(this.binPath, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      this._died();
      return;
    }
    this.child = child;
    this.buffer = '';
    let handled = false;
    const onGone = () => {
      if (handled) return;
      handled = true;
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      if (this.restarts < 1) {
        this.restarts += 1;
        this._spawn();
      } else {
        this._died();
      }
    };
    child.on('error', onGone);
    child.on('exit', onGone);
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onData(chunk));
  }

  _onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        console.error('helper-client: unparseable line dropped');
        continue;
      }
      this.emit('event', event);
    }
  }

  _died() {
    this.emit('dead');
  }

  send(cmd) {
    if (!this.child || !this.child.stdin.writable) return false;
    try {
      this.child.stdin.write(JSON.stringify(cmd) + '\n');
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    this.stopped = true;
    const child = this.child;
    this.child = null;
    if (child) {
      try { child.stdin.end(); } catch { /* ignore */ }
      try { child.kill(); } catch { /* ignore */ }
    }
  }
}

module.exports = { HelperClient };
