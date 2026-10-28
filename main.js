const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, safeStorage, Notification, dialog, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const petWindowManager = require('./src/windows/pet-window');
const chatWindowManager = require('./src/windows/chat-window');
const claude = require('./src/services/claude');
const systemInfo = require('./src/services/system-info');
const activityMonitor = require('./src/services/activity-monitor');
const { buildSystemPrompt } = require('./src/services/personality');
const { evaluate, getExpression } = require('./src/services/states');
const notificationMonitor = require('./src/services/notification-monitor');
const { ensureQuackSound, playQuack } = require('./src/services/sound');
const { createLearning } = require('./src/learning');
const { VAULT_DIR } = require('./src/learning/config');

const store = new Store();
let tray = null;
let isTalking = false;
let hasError = false;
let setupWindow = null;
let chatIsOpen = false;

// --- API Key helpers ---
function getApiKey() {
  const encrypted = store.get('apiKey');
  if (!encrypted) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return null;
  }
}

function saveApiKey(key) {
  const encrypted = safeStorage.encryptString(key).toString('base64');
  store.set('apiKey', encrypted);
}

// --- Setup window ---
function showSetup() {
  setupWindow = new BrowserWindow({
    width: 400,
    height: 250,
    frame: true,
    resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  setupWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'setup', 'index.html'));
}

// --- State management ---
function updateSlimeState() {
  const info = systemInfo.getInfo();
  const state = evaluate({
    battery: info.battery,
    charging: info.charging,
    hour: info.hour,
    isTalking,
    hasError,
    isIdle: systemInfo.isIdle(),
  });
  const expression = getExpression(state);
  sendPetState({ state, ...expression });
}

// Every pet:state goes through here so nothing reopens the eyes while learning is on but not watching
function sendPetState(stateData) {
  petWindowManager.sendState(learningEyesClosed() ? { ...stateData, eyes: 'closed' } : stateData);
}

// --- Learning ---
let learning = null;
const reportNotifications = new Set(); // keep Notification objects alive until clicked/closed

function learningEyesClosed() {
  return !!(learning && learning.isEnabled() && !learning.isWatching());
}

function getHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mysthi-helper')
    : path.join(__dirname, 'native', 'mysthi-helper', '.build', 'release', 'mysthi-helper');
}

function notifyReport(title, relPath) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body: relPath });
  reportNotifications.add(n);
  n.on('click', () => {
    reportNotifications.delete(n);
    shell.openPath(path.join(VAULT_DIR, relPath));
  });
  n.on('close', () => reportNotifications.delete(n));
  n.show();
}

function showMissingPermissions(missing) {
  const names = missing.map((m) => m.name).join(', ');
  dialog.showMessageBox({
    type: 'warning',
    title: 'Mysthi needs permissions',
    message: `Mysthi needs ${names} to learn how you work.`,
    detail: 'Open System Settings, turn Jean Claude Duck (or mysthi-helper) on for each missing permission, then come back. Mysthi will pick it up automatically.',
    buttons: [...missing.map((m) => `Open ${m.name}`), 'Later'],
    cancelId: missing.length,
    defaultId: 0,
  }).then(({ response }) => {
    if (response < missing.length) shell.openExternal(missing[response].url);
  }).catch(() => {});
}

function showHelperUnavailable() {
  dialog.showMessageBox({
    type: 'error',
    title: 'Mysthi',
    message: "Mysthi's watcher couldn't start",
    detail: 'Learning has been turned off. If you are running from source, build the helper with `npm run build:helper`, then choose Start learning again.',
  }).catch(() => {});
}

function setupLearning() {
  learning = createLearning({
    userDataDir: app.getPath('userData'),
    helperPath: getHelperPath(),
    store,
    notify: notifyReport,
    onWatchingChange: () => updateSlimeState(),
    onStatusChange: () => { buildTrayMenu(); updateSlimeState(); },
    onMissingPermissions: showMissingPermissions,
    onHelperUnavailable: showHelperUnavailable,
    deps: { getIdleMs: () => powerMonitor.getSystemIdleTime() * 1000 },
  });
  learning.start(); // resumes only if the user left learning on (store key learning.enabled, default false)

  globalShortcut.register('CommandOrControl+Shift+M', () => learning.togglePause());
  petWindowManager.onLearningTogglePause(() => learning.togglePause());
}

function learningMenuItems() {
  if (!learning) return [];
  const on = learning.isEnabled();
  return [
    { label: learning.statusLabel(), enabled: false },
    on
      ? { label: 'Stop learning', click: () => learning.disable() }
      : { label: 'Start learning', click: () => learning.enable() },
    {
      label: learning.isPaused() ? 'Resume learning' : 'Pause learning',
      enabled: on,
      click: () => learning.togglePause(),
    },
    {
      label: 'Open lessons folder',
      click: () => {
        const dir = path.join(VAULT_DIR, 'lessons');
        try { fs.mkdirSync(dir, { recursive: true }); } catch { /* openPath reports it */ }
        shell.openPath(dir);
      },
    },
    { type: 'separator' },
  ];
}
// --- end Learning ---

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        const win = petWindowManager.getWindow();
        if (win) win.isVisible() ? win.hide() : win.show();
      },
    },
    { type: 'separator' },
    ...learningMenuItems(),
    { label: 'About', click: () => {
      dialog.showMessageBox({ title: 'Jean Claude Duck', message: 'Jean Claude Duck v0.1.0\nA pixel-art desktop pet.' });
    }},
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// --- App lifecycle ---
app.whenReady().then(() => {
  claude.init(); // no API key needed in hardcoded mode
  ensureQuackSound();
  startApp();
});

function startApp() {
  systemInfo.startPolling();
  systemInfo.onChange(() => updateSlimeState());

  // Create pet window
  petWindowManager.create();
  updateSlimeState();

  // Show initial greeting after a short delay
  setTimeout(() => {
    const petWin = petWindowManager.getWindow();
    if (petWin) {
      chatWindowManager.create(petWin);
      chatWindowManager.sendResponse("Quack! I'm Jean Claude Duck! Click me to chat.");
    }
  }, 1500);

  // --- Activity Monitor → Reaction Bubbles ---
  activityMonitor.start();
  activityMonitor.on('reaction', ({ text }) => {
    if (chatIsOpen) return; // don't show reactions while chat is open
    const petWin = petWindowManager.getWindow();
    if (petWin && !petWin.isDestroyed()) {
      petWin.webContents.send('pet:reaction', { text });
    }
  });

  // --- Notification Monitor → Quack ---
  notificationMonitor.start();
  notificationMonitor.on('notification', () => {
    playQuack();

    const petWin = petWindowManager.getWindow();
    if (petWin && !petWin.isDestroyed()) {
      // Show a quack reaction bubble
      const quackReactions = ['🔔 quack!', '📬 notification!', '🦆 quack quack!', '📣 someone pinged you!'];
      const text = quackReactions[Math.floor(Math.random() * quackReactions.length)];
      petWin.webContents.send('pet:reaction', { text });

      // Surprised animation — wide eyes + shake
      sendPetState({ state: 'surprised', eyes: 'O O', mouth: '!' });
      setTimeout(() => {
        updateSlimeState(); // restore normal state after 2 seconds
      }, 2000);
    }
  });

  // Tray
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4T2NkoBAwUqifAacBjP8ZGP4zMDAwMjAwMDEQAYYmF4wmA0YTEoGxkJqJiTgXDIIwGE0GAAA+HAkRm5K/wgAAAABJRU5ErkJggg=='
  );
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  setupLearning();
  buildTrayMenu();

  // Global shortcut
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    const win = petWindowManager.getWindow();
    if (win) win.isVisible() ? win.hide() : win.show();
  });

  // IPC: slime click → open chat (pause following so bubble stays aligned)
  ipcMain.on('slime:click', () => {
    const petWin = petWindowManager.getWindow();
    if (petWin) {
      chatIsOpen = true;
      petWindowManager.pauseFollowing();
      chatWindowManager.create(petWin);
    }
  });

  // IPC: track interactions for idle detection
  ipcMain.on('slime:interaction', () => {
    systemInfo.recordInteraction();
    updateSlimeState();
  });

  // IPC: chat message → Ollama
  ipcMain.on('chat:send', async (event, { message }) => {
    systemInfo.recordInteraction();
    isTalking = true;
    chatWindowManager.setWaiting(true);
    updateSlimeState();

    const systemPrompt = buildSystemPrompt(systemInfo.getInfo());
    const result = await claude.sendMessage(message, systemPrompt);

    isTalking = false;

    if (result.error) {
      hasError = true;
      updateSlimeState();
      chatWindowManager.sendError(result.error);
      setTimeout(() => { hasError = false; updateSlimeState(); }, 5000);
    } else {
      hasError = false;
      updateSlimeState();
      chatWindowManager.sendResponse(result.text);
    }
  });

  // IPC: chat dismiss — resume following cursor
  ipcMain.on('chat:dismiss', () => {
    chatIsOpen = false;
    chatWindowManager.close();
    petWindowManager.resumeFollowing();
  });
}

// --- Setup IPC ---
ipcMain.on('setup:validate', async (event, { apiKey }) => {
  const result = await claude.validateKey(apiKey);
  if (result.valid) {
    saveApiKey(apiKey);
    claude.init(apiKey);
    if (setupWindow) {
      setupWindow.close();
      setupWindow = null;
    }
    startApp();
  } else {
    event.reply('setup:error', { error: "That key didn't work — double-check and try again." });
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (learning) learning.shutdown();
  activityMonitor.stop();
  notificationMonitor.stop();
});

app.on('window-all-closed', () => {
  // Don't quit — tray keeps it alive
});
