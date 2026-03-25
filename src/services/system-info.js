const { powerMonitor } = require('electron');

let currentInfo = { battery: 100, charging: true, hour: new Date().getHours() };
let listeners = [];
let lastInteractionTime = Date.now();

function poll() {
  const hour = new Date().getHours();
  const { execSync } = require('child_process');
  try {
    const raw = execSync('pmset -g batt', { encoding: 'utf8' });
    const pctMatch = raw.match(/(\d+)%/);
    const chargingMatch = raw.match(/AC Power/);
    currentInfo = {
      battery: pctMatch ? parseInt(pctMatch[1], 10) : 100,
      charging: !!chargingMatch,
      hour,
    };
  } catch {
    currentInfo = { battery: 100, charging: true, hour };
  }
  listeners.forEach((fn) => fn(currentInfo));
}

function getInfo() {
  return { ...currentInfo };
}

function recordInteraction() {
  lastInteractionTime = Date.now();
}

function isIdle() {
  return Date.now() - lastInteractionTime > 5 * 60 * 1000;
}

function onChange(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

function startPolling() {
  poll();
  setInterval(poll, 60_000);
}

module.exports = { getInfo, onChange, startPolling, recordInteraction, isIdle };
